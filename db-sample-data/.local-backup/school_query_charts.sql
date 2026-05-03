-- Add query_charts rows for components 400 (school_food_risk) and 403 (school_supplier_picker)
-- so that GET /api/v1/dashboard/<index> doesn't 500 when these are referenced.
-- map_config_ids point at component_maps already in DB:
--   400 school_risk_nodes_tpe / 401 school_risk_nodes_metrotpe
--   402 school_supplier_pairs_tpe / 403 school_supplier_pairs_metrotpe
BEGIN;

DELETE FROM public.query_charts WHERE index IN ('school_food_risk','school_supplier_picker');

INSERT INTO public.query_charts
  (index, history_config, map_config_ids, map_filter, time_from, time_to, update_freq, update_freq_unit,
   source, short_desc, long_desc, use_case, links, contributors,
   created_at, updated_at, query_type, query_chart, query_history, city)
VALUES
  ('school_food_risk', NULL, '{400}', NULL, 'static', NULL, NULL, NULL,
   '雙北教育局 / 衛生局', '中小學食安風險節點地圖。', '依當前食安事件，標示中小學暴露風險節點。資料源自 public/mapData/school_risk_nodes_tpe.geojson。', '校方查驗午餐留樣、教育局通知、衛生局派員稽核。',
   '{}', '{doit}',
   '2026-05-02 00:00:00+00', '2026-05-02 00:00:00+00', 'two_d',
   'SELECT ''school'' AS x_axis, 1 AS data', NULL, 'taipei'),
  ('school_food_risk', NULL, '{401}', NULL, 'static', NULL, NULL, NULL,
   '雙北教育局 / 衛生局', '中小學食安風險節點地圖。', '依當前食安事件，標示中小學暴露風險節點。資料源自 public/mapData/school_risk_nodes_metrotpe.geojson。', '校方查驗午餐留樣、教育局通知、衛生局派員稽核。',
   '{}', '{doit}',
   '2026-05-02 00:00:00+00', '2026-05-02 00:00:00+00', 'two_d',
   'SELECT ''school'' AS x_axis, 1 AS data', NULL, 'metrotaipei'),
  ('school_supplier_picker', NULL, '{402}', NULL, 'static', NULL, NULL, NULL,
   '雙北教育局 / 衛生局', '廠商供應學校查詢配對圖。', '依當前事件涉及廠商，列出可能受影響的學校配對關係。資料源自 public/mapData/school_supplier_pairs_tpe.geojson。', '行政決策評估食材供應鏈影響範圍、家長查詢學校用餐風險。',
   '{}', '{doit}',
   '2026-05-02 00:00:00+00', '2026-05-02 00:00:00+00', 'two_d',
   'SELECT ''supplier'' AS x_axis, 1 AS data', NULL, 'taipei'),
  ('school_supplier_picker', NULL, '{403}', NULL, 'static', NULL, NULL, NULL,
   '雙北教育局 / 衛生局', '廠商供應學校查詢配對圖。', '依當前事件涉及廠商，列出可能受影響的學校配對關係。資料源自 public/mapData/school_supplier_pairs_metrotpe.geojson。', '行政決策評估食材供應鏈影響範圍、家長查詢學校用餐風險。',
   '{}', '{doit}',
   '2026-05-02 00:00:00+00', '2026-05-02 00:00:00+00', 'two_d',
   'SELECT ''supplier'' AS x_axis, 1 AS data', NULL, 'metrotaipei');

COMMIT;
