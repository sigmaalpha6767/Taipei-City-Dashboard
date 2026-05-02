package twcc

type TWCCMessage struct {
	Role       string         `json:"role"`
	Content    *string        `json:"content"`
	Name       string         `json:"name,omitempty"`
	ToolCalls  []TWCCToolCall `json:"tool_calls,omitempty"`
	ToolCallID string         `json:"tool_call_id,omitempty"`
}

// TWCCRequest follows the OpenAI-compatible /chat/completions schema accepted by
// TWCC AI Foundry (https://api-ams.twcc.ai/api/models/chat/completions).
type TWCCRequest struct {
	Model            string        `json:"model"`
	Messages         []TWCCMessage `json:"messages"`
	MaxTokens        *int          `json:"max_tokens,omitempty"`
	Temperature      *float64      `json:"temperature,omitempty"`
	TopP             *float64      `json:"top_p,omitempty"`
	TopK             *int          `json:"top_k,omitempty"`
	FrequencyPenalty *float64      `json:"frequency_penalty,omitempty"`
	Stop             []string      `json:"stop,omitempty"`
	Seed             *int          `json:"seed,omitempty"`
	Stream           bool          `json:"stream,omitempty"`
	Tools            []TWCCTool    `json:"tools,omitempty"`
	ToolChoice       interface{}   `json:"tool_choice,omitempty"`
}

type TWCCTool struct {
	Type     string         `json:"type"`
	Function TWCCToolFunction `json:"function"`
}

type TWCCToolFunction struct {
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Parameters  interface{} `json:"parameters"`
}

type TWCCToolCall struct {
	Index    *int   `json:"index,omitempty"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type TWCCResponse struct {
	GeneratedText string         `json:"generated_text"`
	ToolCalls     []TWCCToolCall `json:"tool_calls,omitempty"`
	Choices       []struct {
		Message struct {
			Role      string         `json:"role"`
			Content   string         `json:"content"`
			ToolCalls []TWCCToolCall `json:"tool_calls,omitempty"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	// TWCC AFS Legacy Fields (at root level)
	PromptTokens    int `json:"prompt_tokens"`
	GeneratedTokens int `json:"generated_tokens"`
	TotalTokens     int `json:"total_tokens"`
	// OpenAI-compatible nested usage
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage,omitempty"`
}

type TWCCStreamResponse struct {
	ID            string         `json:"id"`
	Model         string         `json:"model"`
	GeneratedText string         `json:"generated_text"`
	ToolCalls     []TWCCToolCall `json:"tool_calls,omitempty"`
	Choices       []struct {
		Index int `json:"index"`
		Delta struct {
			Content   string         `json:"content"`
			Role      string         `json:"role"`
			ToolCalls []TWCCToolCall `json:"tool_calls,omitempty"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	// AFS sends these at root level in streaming chunks
	PromptTokens    int `json:"prompt_tokens"`
	GeneratedTokens int `json:"generated_tokens"`
	TotalTokens     int `json:"total_tokens"`
	// Keep Usage for compatibility with other formats/future changes
	Usage *struct {
		PromptTokens    int `json:"prompt_tokens"`
		GeneratedTokens int `json:"generated_tokens"`
		TotalTokens     int `json:"total_tokens"`
	} `json:"usage,omitempty"`
}
