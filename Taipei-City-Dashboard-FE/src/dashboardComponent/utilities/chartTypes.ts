interface chartType {
	[index: string]: string;
}

export const chartTypes: chartType = {
	DonutChart: "圓餅圖", // V
	BarChart: "橫向長條圖", // V
	ColumnChart: "縱向長條圖", // V
	BarPercentChart: "長條圖(%)", // V
	TreemapChart: "矩形圖", // V
	DistrictChart: "行政區圖", // V
	MetroChart: "捷運行駛圖", // V
	TimelineSeparateChart: "折線圖(比較)", // V
	TimelineStackedChart: "折線圖(堆疊)", // V
	GuageChart: "量表圖", // V
	RadarChart: "雷達圖", // V
	HeatmapChart: "熱力圖", // V
	PolarAreaChart: "極座標圖", // V
	ColumnLineChart: "長條折線圖", // V
	BarChartWithGoal: "長條圖(目標)", // V
	IconPercentChart: "圖示比例圖", // V
	SpeedometerChart: "儀表板圖", // 暫時不用
	IndicatorChart: "指標圖", // V
	MapLegend: "地圖圖例", // V
	TextUnitChart: "文字數值圖", // V
	FoodSafetyVulnerableExposure: "食安暴露風險", // Component 4
	FoodSafetyRiskInspection: "食品抽驗風險", // Component 1 legacy
	FoodSafetyCategoryChart: "檢體排行", // Component 1
	FoodSafetyDistrictChart: "行政區排行", // Component 1
	FoodSafetyViolationChart: "違規類別占比", // Component 1
	FoodSafetyMonthlyTrendChart: "月份趨勢", // Component 1
	FoodSafetyInspectionListChart: "建議稽查清單", // Component 1
	FoodSafetyCitizenRadar: "市民食安雷達", // Component 6
};
