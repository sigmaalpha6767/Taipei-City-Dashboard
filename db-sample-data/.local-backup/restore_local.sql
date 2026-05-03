INSERT INTO public.component_maps VALUES (400, 'school_risk_nodes_tpe', '中小學食安風險地圖', 'circle', 'geojson', NULL, NULL, '{
INSERT INTO public.component_maps VALUES (401, 'school_risk_nodes_metrotpe', '中小學食安風險地圖', 'circle', 'geojson', NULL, NULL, '{
INSERT INTO public.component_maps VALUES (402, 'school_supplier_pairs_tpe', '廠商供應學校', 'circle', 'geojson', NULL, NULL, '{
INSERT INTO public.component_maps VALUES (403, 'school_supplier_pairs_metrotpe', '廠商供應學校', 'circle', 'geojson', NULL, NULL, '{
INSERT INTO public.components VALUES (400, 'school_food_risk', '中小學食安風險地圖');
INSERT INTO public.components VALUES (403, 'school_supplier_picker', '廠商供應學校查詢');
INSERT INTO public.component_charts VALUES ('school_food_risk', '{#E74C3C,#F1C40F}', '{ColumnChart,DistrictChart}', '所');
INSERT INTO public.component_charts VALUES ('school_supplier_picker', '{#16A085}', '{BarChart}', '所');
INSERT INTO public.dashboards VALUES (400, 'food_safety_tpe', '食安健康', '{400,403}', 'restaurant', '2026-05-02 19:21:10.402282+00', '2026-05-02 19:21:10.402282+00');
INSERT INTO public.dashboards VALUES (401, 'food_safety_metrotpe', '食安健康', '{400,403}', 'restaurant', '2026-05-02 19:21:10.402282+00', '2026-05-02 19:21:10.402282+00');
