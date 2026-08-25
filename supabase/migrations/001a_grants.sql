-- 001a_grants.sql — Grants for service_role (fixes 42501 when "Automatically expose new tables" is disabled)
GRANT SELECT ON public.admin_users TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO service_role;
GRANT SELECT, INSERT ON public.order_cancel_logs TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.invoice_sequences TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.credit_note_sequences TO service_role;
