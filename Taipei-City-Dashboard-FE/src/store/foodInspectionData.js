// 食安抽驗資料統一 loader — 取代原本 9 處散落的 fetch("/data/prepared/food_inspection.json")
//
// 拉通底層邏輯：
//   raw CSV → postgres-data.food_inspection_raw → BE /api/v1/food/summary → 此 loader → 各 component
//
// 每次刷新頁面只打一次 BE，多個 component 共享同一份結果。

import http from "../router/axios";

let summaryCache = null;
let exposureCache = {}; // keyed by city ('', 'taipei', 'newtaipei', 'metrotaipei')
let diseaseCache = {};  // keyed by city (same key set)

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
// 'city' 可以是 'taipei' / 'newtaipei' / 'metrotaipei' / undefined（雙北全集）
export function loadFoodExposure({ forceReload = false, city = "" } = {}) {
	const key = city || "";
	if (forceReload) delete exposureCache[key];
	if (!exposureCache[key]) {
		const params = key && key !== "metrotaipei" ? { city: key } : {};
		exposureCache[key] = http
			.get("/food/exposure", { params })
			.then((resp) => resp.data?.data || {})
			.catch((e) => {
				delete exposureCache[key];
				throw e;
			});
	}
	return exposureCache[key];
}

// 食源性疾病統計 — Component 6（從 postgres-data.disease_outbreak_stats）
// 'city' 可選值：'metrotaipei' / 'taipei' / 'newtaipei' / 'national' / undefined（預設雙北）
export function loadFoodDiseaseStats({ forceReload = false, city = "" } = {}) {
	const key = city || "";
	if (forceReload) delete diseaseCache[key];
	if (!diseaseCache[key]) {
		const params = key ? { city: key } : {};
		diseaseCache[key] = http
			.get("/food/disease-stats", { params })
			.then((resp) => resp.data?.data || {})
			.catch((e) => {
				delete diseaseCache[key];
				throw e;
			});
	}
	return diseaseCache[key];
}

export function clearFoodInspectionCache() {
	summaryCache = null;
	exposureCache = {};
	diseaseCache = {};
}
