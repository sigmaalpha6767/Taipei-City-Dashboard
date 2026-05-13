package ai

import (
	"TaipeiCityDashboardBE/app/models"
	"TaipeiCityDashboardBE/app/services/ai/providers/twcc"
	"TaipeiCityDashboardBE/app/services/ai/tools"
	"TaipeiCityDashboardBE/global"
	"TaipeiCityDashboardBE/logs"
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/tmc/langchaingo/llms"
	"golang.org/x/sync/semaphore"
)

var (
	// aiSemaphore limits the number of concurrent AI requests
	aiSemaphore *semaphore.Weighted
	twccModel   llms.Model
)

func init() {
	aiSemaphore = semaphore.NewWeighted(int64(global.TWCC.MaxConcurrent))
	twccModel = twcc.New(
		global.TWCC.ApiKey,
		global.TWCC.ApiUrl,
		global.TWCC.Model,
		global.TWCC.Timeout,
	)
}

type AIChatRequest struct {
	SessionID string                 `json:"session"`
	UserID    string                 `json:"user_id"`
	IPAddress string                 `json:"ip_address"`
	Messages  []llms.MessageContent  `json:"messages"`
	Params    map[string]interface{} `json:"params"`
}

// ChatWithTWCC handles the AI conversation logic including retries, tool calling loop, and logging.
func ChatWithTWCC(ctx context.Context, req AIChatRequest, options ...llms.CallOption) (*models.AIChatLog, error) {
	if err := aiSemaphore.Acquire(ctx, 1); err != nil {
		return nil, fmt.Errorf("server too busy: %v", err)
	}
	defer aiSemaphore.Release(1)

	session := newSession(req, options...)
	return session.run(ctx)
}

func newSession(req AIChatRequest, options ...llms.CallOption) *aiSession {
	s := &aiSession{
		req:             req,
		options:         options,
		currentMessages: make([]llms.MessageContent, 0),
		startTime:       time.Now(),
	}
	for _, opt := range options {
		opt(&s.callOpts)
	}
	s.injectInstructions()
	return s
}

type aiSession struct {
	req             AIChatRequest
	options         []llms.CallOption
	callOpts        llms.CallOptions
	currentMessages []llms.MessageContent
	totalInput      int
	totalOutput     int
	toolUsed        bool
	executedTools   []string
	// toolCallRecords 保留每次 tool call 的 name + 原始 args，
	// 透過 finalize() 寫進 AIChatLog.ToolCalls 帶回 FE，讓 FE 可以做 UI 動作（如 focus_view）。
	toolCallRecords []models.ToolCallRecord
	// 同一 (tool,args) 的執行結果 cache，避免 LLM 在 multi-turn 重複呼叫
	toolCallCache   map[string]string
	lastResp        *llms.ContentResponse
	lastErr         error
	startTime       time.Time
}

func (s *aiSession) run(ctx context.Context) (*models.AIChatLog, error) {
	// maxLoops 從 5 → 2:TWCC llama 16k context 很緊,單個 tool 結果動輒 3000+ token,
	// 5 輪累積後可達 40000+ token 直接爆 context。2 輪足夠「拿資料 → 整合回答」的常見場景。
	maxLoops := 2
	s.executedTools = make([]string, 0)
	s.toolCallRecords = make([]models.ToolCallRecord, 0)
	s.toolCallCache = make(map[string]string)

	// pendingFinal 追蹤「剛 executeTools 了但還沒 generate 拿最終文字」的狀態。
	// 解決 boundary bug:loop i=1(最後一輪)若 LLM 還呼叫 tool,executeTools 後就直接退出,
	// 沒機會 generate 文字答案,使用者看到 tool calls 跑完但沒回答。
	pendingFinal := false

	for i := 0; i < maxLoops; i++ {
		s.sendHeartbeat(ctx)

		if err := s.generate(ctx); err != nil {
			break
		}
		pendingFinal = false // 剛 generate 過,有 lastResp

		toolCalls := s.extractToolCalls()
		if len(toolCalls) == 0 {
			break
		}

		// Dedup: 如果這一輪所有 tool 都已經呼叫過（相同 args），直接結束
		// 避免 LLM 因為某些原因不停重複呼叫同一 tool
		allDup := true
		for _, tc := range toolCalls {
			sig := tc.FunctionCall.Name + ":" + tc.FunctionCall.Arguments
			if _, seen := s.toolCallCache[sig]; !seen {
				allDup = false
				break
			}
		}
		if allDup {
			logs.FInfo("Loop %d: all tool calls already executed (dedup), forcing final answer", i)
			// 把 cache 結果回灌一次給 LLM，但下一輪要強制回答
			if err := s.executeTools(ctx, toolCalls); err != nil {
				break
			}
			// 再 generate 一次拿最終文字
			s.sendHeartbeat(ctx)
			s.generate(ctx)
			break
		}

		s.toolUsed = true
		logs.FInfo("Loop %d: Processing %d tool calls", i, len(toolCalls))
		if err := s.executeTools(ctx, toolCalls); err != nil {
			break
		}
		pendingFinal = true // 剛跑完 tool,messages 裡有新 tool result,需再 generate 拿文字
	}

	// Boundary fix:迴圈結束後若還有 pendingFinal,強制再 generate 一次以拿到 LLM 的文字答案。
	// 否則使用者只看到「tool_calls 跑完」但沒分析回答。
	if pendingFinal {
		logs.FInfo("Forcing final generate after maxLoops to get text answer")
		s.sendHeartbeat(ctx)
		s.generate(ctx)
	}

	return s.finalize()
}

func (s *aiSession) sendHeartbeat(ctx context.Context) {
	if s.callOpts.StreamingFunc != nil {
		s.callOpts.StreamingFunc(ctx, []byte(": heartbeat\n\n"))
	}
}

func (s *aiSession) generate(ctx context.Context) error {
	maxRetry := global.TWCC.MaxRetry
	if s.callOpts.StreamingFunc != nil {
		maxRetry = 0
	}

	for i := 0; i <= maxRetry; i++ {
		s.lastResp, s.lastErr = twccModel.GenerateContent(ctx, s.currentMessages, s.options...)
		if s.lastErr == nil {
			s.updateTokens()
			return nil
		}
		logs.FError("Attempt %d failed: %v", i+1, s.lastErr)
		if i < maxRetry {
			time.Sleep(500 * time.Millisecond)
		}
	}
	return s.lastErr
}

func (s *aiSession) extractToolCalls() []llms.ToolCall {
	if s.lastResp == nil || len(s.lastResp.Choices) == 0 {
		return nil
	}
	tc, _ := s.lastResp.Choices[0].GenerationInfo["tool_calls"].([]llms.ToolCall)
	return tc
}

func (s *aiSession) updateTokens() {
	if s.lastResp == nil || len(s.lastResp.Choices) == 0 {
		return
	}
	if usage, ok := s.lastResp.Choices[0].GenerationInfo["usage"].(map[string]interface{}); ok {
		s.totalInput += parseUsageInt(usage["input_tokens"])
		s.totalOutput += parseUsageInt(usage["output_tokens"])
	}
}

func (s *aiSession) executeTools(ctx context.Context, toolCalls []llms.ToolCall) error {
	choice := s.lastResp.Choices[0]
	
	// Add Assistant's intent
	s.currentMessages = append(s.currentMessages, llms.MessageContent{
		Role:  llms.ChatMessageTypeAI,
		Parts: append([]llms.ContentPart{llms.TextContent{Text: choice.Content}}, toolsToParts(toolCalls)...),
	})

	for _, tc := range toolCalls {
		s.executedTools = append(s.executedTools, tc.FunctionCall.Name)
		s.toolCallRecords = append(s.toolCallRecords, models.ToolCallRecord{
			Name: tc.FunctionCall.Name,
			Args: tc.FunctionCall.Arguments,
		})
		sig := tc.FunctionCall.Name + ":" + tc.FunctionCall.Arguments

		var result string
		if cached, ok := s.toolCallCache[sig]; ok {
			// 重複呼叫 → 用上次結果 + 提示 LLM「資料已取得，請依此回答不要再呼叫」
			result = cached + "\n\n[NOTE] 此 tool 已用相同參數呼叫過，請直接根據以上資料給最終答案，不要再呼叫工具。"
			logs.FInfo("Tool dedup hit: %s", sig)
		} else {
			r, err := tools.Execute(ctx, tc.FunctionCall.Name, tc.FunctionCall.Arguments)
			if err != nil {
				r = fmt.Sprintf("Error: %v. Please verify arguments.", err)
				logs.FError("Tool Error: %v", err)
			}
			result = r
			s.toolCallCache[sig] = r
		}

		// Tool result 防爆 — 單個結果超過 6000 chars(~3000 token)就 truncate。
		// 食安 tool 偶爾回傳整個累犯 + 食材陣列幾千筆會直接讓 BE 累積到 40k+ token 爆 context。
		const maxToolResultChars = 6000
		if len(result) > maxToolResultChars {
			logs.FInfo("Tool result truncated: %s (%d → %d chars)", tc.FunctionCall.Name, len(result), maxToolResultChars)
			result = result[:maxToolResultChars] + "\n\n[TRUNCATED] 結果過大已截斷,請以已收到資料回答,不要再呼叫工具拿更多。"
		}

		s.currentMessages = append(s.currentMessages, llms.MessageContent{
			Role: llms.ChatMessageTypeTool,
			Parts: []llms.ContentPart{llms.ToolCallResponse{
				ToolCallID: tc.ID, Name: tc.FunctionCall.Name, Content: result,
			}},
		})
	}
	return nil
}

func (s *aiSession) injectInstructions() {
	toolNames := ""
	for i, t := range s.callOpts.Tools {
		if i > 0 { toolNames += ", " }
		toolNames += t.Function.Name
	}

	instruction := fmt.Sprintf("\nSystem Instruction:\n1. Use ONLY: [%s].\n2. NEVER nest tool calls \n3. Arguments MUST be literal values (strings, integers, etc.), never function calls \n4. For dependent tasks, call tools sequentially in separate turns.\n5. If stuck, respond with text.", toolNames)
	
	s.currentMessages = make([]llms.MessageContent, 0)
	merged := false
	for _, m := range s.req.Messages {
		if m.Role == llms.ChatMessageTypeSystem && !merged {
			s.currentMessages = append(s.currentMessages, mergeSystemMsg(m, instruction))
			merged = true
		} else {
			s.currentMessages = append(s.currentMessages, m)
		}
	}
	
	if !merged {
		s.currentMessages = append([]llms.MessageContent{{
			Role: llms.ChatMessageTypeSystem,
			Parts: []llms.ContentPart{llms.TextContent{Text: "Instruction: Use tools: [" + toolNames + "]."}},
		}}, s.currentMessages...)
	}
}

func (s *aiSession) finalize() (*models.AIChatLog, error) {
	log := &models.AIChatLog{
		SessionID: s.req.SessionID, UserID: s.req.UserID, IPAddress: s.req.IPAddress,
		Provider: "twcc", Model: global.TWCC.Model, LatencyMS: int(time.Since(s.startTime).Milliseconds()),
		Status: "success", Tools: "[]", CreatedAt: s.startTime,
	}

	if len(s.req.Messages) > 0 {
		log.Question = extractText(s.req.Messages[len(s.req.Messages)-1])
	}

	if s.lastErr != nil {
		log.Status, log.ErrorCode, log.ErrorMessage = "error", "MODEL_ERROR", s.lastErr.Error()
		models.CreateAIChatLog(log)
		return log, s.lastErr
	}

	if s.lastResp != nil && len(s.lastResp.Choices) > 0 {
		log.Answer = s.lastResp.Choices[0].Content
		log.InputTokens, log.OutputTokens = s.totalInput, s.totalOutput
		log.TotalTokens = s.totalInput + s.totalOutput
		if s.toolUsed {
			log.ToolUsed = true
			if toolJSON, err := json.Marshal(s.executedTools); err == nil {
				log.Tools = string(toolJSON)
			}
		}
		// 把 records 帶回（不會被持久化，但會出現在 HTTP response）
		log.ToolCalls = s.toolCallRecords
	}

	if err := models.CreateAIChatLog(log); err != nil {
		logs.FError("DB Log Error: %v", err)
	}
	return log, nil
}

func toolsToParts(calls []llms.ToolCall) []llms.ContentPart {
	parts := make([]llms.ContentPart, len(calls))
	for i, c := range calls { parts[i] = c }
	return parts
}

func mergeSystemMsg(m llms.MessageContent, instruction string) llms.MessageContent {
	newParts := make([]llms.ContentPart, len(m.Parts))
	for i, p := range m.Parts {
		if tp, ok := p.(llms.TextContent); ok {
			newParts[i] = llms.TextContent{Text: tp.Text + instruction}
		} else {
			newParts[i] = p
		}
	}
	return llms.MessageContent{Role: m.Role, Parts: newParts}
}

func extractText(m llms.MessageContent) string {
	for _, p := range m.Parts {
		if t, ok := p.(llms.TextContent); ok { return t.Text }
	}
	return ""
}

func parseUsageInt(val interface{}) int {
	switch v := val.(type) {
	case int: return v
	case float64: return int(v)
	default: return 0
	}
}
