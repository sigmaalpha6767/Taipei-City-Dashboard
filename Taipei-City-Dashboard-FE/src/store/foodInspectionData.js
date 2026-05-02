// 食安抽驗資料統一 loader — 取代原本 9 處散落的 fetch("/data/prepared/food_inspection.json")
//
// 拉通底層邏輯：
//   raw CSV → postgres-data.food_inspection_raw → BE /api/v1/food/summary → 此 loader → 各 component
//
// 每次刷新頁面只打一次 BE，多個 component 共享同一份結果。

import http from "../router/axios";

let summaryCache = null;
let exposureCache = null;

export function loadFoodInspection({ forceReload = false } = {}) {
	if (forceReload) summaryCache = null;
	if (!summaryCache) {
		summaryCache = http
			.get("/food/summary")
			.then((resp) => resp.data?.data || {})
			.catch((e) => {
				summaryCache = null;
				throw e;
			});
	}
	return summaryCache;
}

// 脆弱場域暴露：facilities/districts/event/summary 來自 postgres-data 三張表
export function loadFoodExposure({ forceReload = false } = {}) {
	if (forceReload) exposureCache = null;
	if (!exposureCache) {
		exposureCache = http
			.get("/food/exposure")
			.then((resp) => resp.data?.data || {})
			.catch((e) => {
				exposureCache = null;
				throw e;
			});
	}
	return exposureCache;
}

export function clearFoodInspectionCache() {
	summaryCache = null;
	exposureCache = null;
}
