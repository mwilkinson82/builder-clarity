-- Least-privilege correction for estimating commercial controls. Lovable's
-- database defaults grant broad table privileges to anon and authenticated;
-- make the intended RLS-backed API surface explicit.

REVOKE ALL ON TABLE public.cost_library_price_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.estimate_commercial_notes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.estimate_alternates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.estimate_bid_packages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.estimate_vendor_quotes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.estimate_versions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.cost_library_price_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.estimate_commercial_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.estimate_alternates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.estimate_bid_packages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.estimate_vendor_quotes TO authenticated;
GRANT SELECT, INSERT ON TABLE public.estimate_versions TO authenticated;

GRANT ALL ON TABLE public.cost_library_price_history TO service_role;
GRANT ALL ON TABLE public.estimate_commercial_notes TO service_role;
GRANT ALL ON TABLE public.estimate_alternates TO service_role;
GRANT ALL ON TABLE public.estimate_bid_packages TO service_role;
GRANT ALL ON TABLE public.estimate_vendor_quotes TO service_role;
GRANT ALL ON TABLE public.estimate_versions TO service_role;

NOTIFY pgrst, 'reload schema';
