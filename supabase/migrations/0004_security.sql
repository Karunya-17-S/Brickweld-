-- =====================================================================
-- Brickweld ERP — 0004 row level security & grants
-- md          : everything (+ users, MD dashboard)
-- accountant  : everything except MD dashboard & user roles; edits/deletes notify MD
-- supervisor  : projects (no money), attendance, indents, goods receipts (quantities)
-- no role     : nothing (new sign-ups wait for MD)
-- =====================================================================

-- ---------- grants ----------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, public;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
-- hard deletes are never done from the app (soft delete RPC only), except allocation rows via RPC
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM authenticated;
-- tables only written by functions
REVOKE INSERT, UPDATE ON public.user_roles, public.doc_counters, public.audit_log, public.notifications,
  public.payment_allocations, public.grn_items, public.goods_receipts, public.bill_items, public.po_items,
  public.material_request_items FROM authenticated;
GRANT UPDATE (challan_no, vehicle_no, notes, grn_date) ON public.goods_receipts TO authenticated;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;
-- internal helpers not callable directly
REVOKE EXECUTE ON FUNCTION public.recalc_bill(uuid), public.recalc_po(uuid), public.next_doc_no(text, int),
  public.tg_set_updated(), public.tg_doc_no(), public.tg_txn_guard(), public.tg_alloc_guard(), public.tg_audit(),
  public.tg_audit_alloc(), public.tg_attendance_guard(), public.tg_cash_count(), public.handle_new_user() FROM authenticated;

-- ---------- enable RLS everywhere ----------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------- users ----------
CREATE POLICY profiles_read   ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR is_fin());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY roles_read      ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_md());

CREATE POLICY settings_read   ON public.company_settings FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY settings_write  ON public.company_settings FOR UPDATE TO authenticated USING (is_fin()) WITH CHECK (is_fin());

-- ---------- readable by every role, written by finance ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parties', 'teams', 'employees', 'projects', 'machines', 'job_types', 'expense_categories'] LOOP
    EXECUTE format('CREATE POLICY staff_read ON public.%I FOR SELECT TO authenticated USING (is_staff() AND deleted_at IS NULL)', t);
    EXECUTE format('CREATE POLICY fin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (is_fin())', t);
    EXECUTE format('CREATE POLICY fin_update ON public.%I FOR UPDATE TO authenticated USING (is_fin() AND deleted_at IS NULL) WITH CHECK (is_fin())', t);
  END LOOP;
END $$;

-- materials catalogue: supervisors may add new material names
CREATE POLICY staff_read   ON public.materials FOR SELECT TO authenticated USING (is_staff() AND deleted_at IS NULL);
CREATE POLICY staff_insert ON public.materials FOR INSERT TO authenticated WITH CHECK (is_staff());
CREATE POLICY fin_update   ON public.materials FOR UPDATE TO authenticated USING (is_fin() AND deleted_at IS NULL) WITH CHECK (is_fin());

-- ---------- finance only ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_variations', 'money_accounts', 'transactions', 'cash_counts', 'purchase_orders',
                           'work_orders', 'bills', 'wage_adjustments'] LOOP
    EXECUTE format('CREATE POLICY fin_read   ON public.%I FOR SELECT TO authenticated USING (is_fin() AND deleted_at IS NULL)', t);
    EXECUTE format('CREATE POLICY fin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (is_fin())', t);
    EXECUTE format('CREATE POLICY fin_update ON public.%I FOR UPDATE TO authenticated USING (is_fin() AND deleted_at IS NULL) WITH CHECK (is_fin())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['employee_private', 'employee_rates', 'project_financials'] LOOP
    EXECUTE format('CREATE POLICY fin_read   ON public.%I FOR SELECT TO authenticated USING (is_fin())', t);
    EXECUTE format('CREATE POLICY fin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (is_fin())', t);
    EXECUTE format('CREATE POLICY fin_update ON public.%I FOR UPDATE TO authenticated USING (is_fin()) WITH CHECK (is_fin())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['po_items', 'bill_items', 'payment_allocations'] LOOP
    EXECUTE format('CREATE POLICY fin_read ON public.%I FOR SELECT TO authenticated USING (is_fin())', t);
  END LOOP;
END $$;

-- ---------- operations (supervisor + finance) ----------
CREATE POLICY staff_read   ON public.attendance FOR SELECT TO authenticated USING (is_staff() AND deleted_at IS NULL);
CREATE POLICY staff_insert ON public.attendance FOR INSERT TO authenticated WITH CHECK (is_staff());
CREATE POLICY staff_update ON public.attendance FOR UPDATE TO authenticated USING (is_staff() AND deleted_at IS NULL) WITH CHECK (is_staff());

CREATE POLICY staff_read   ON public.material_requests FOR SELECT TO authenticated USING (is_staff() AND deleted_at IS NULL);
CREATE POLICY staff_read   ON public.material_request_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.material_requests r WHERE r.id = request_id AND r.deleted_at IS NULL AND is_staff()));

CREATE POLICY staff_read   ON public.goods_receipts FOR SELECT TO authenticated USING (is_staff() AND deleted_at IS NULL);
CREATE POLICY staff_update ON public.goods_receipts FOR UPDATE TO authenticated USING (is_staff() AND deleted_at IS NULL) WITH CHECK (is_staff());
CREATE POLICY staff_read   ON public.grn_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.goods_receipts g WHERE g.id = grn_id AND g.deleted_at IS NULL AND is_staff()));

-- ---------- audit & notifications ----------
CREATE POLICY fin_read ON public.audit_log FOR SELECT TO authenticated USING (is_fin());
CREATE POLICY own_read ON public.notifications FOR SELECT TO authenticated
  USING (recipient_id = auth.uid() OR (recipient_role IS NOT NULL AND recipient_role = my_role()));
-- doc_counters: no policies (functions only)

-- views run with the caller's rights (security_invoker) — make sure they are granted
GRANT SELECT ON public.v_account_balances, public.v_bill_balances, public.v_transactions, public.v_party_balances,
  public.v_wage_lines, public.v_labour_balances, public.v_project_summary TO authenticated;
