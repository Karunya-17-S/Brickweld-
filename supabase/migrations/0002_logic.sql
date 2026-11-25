-- =====================================================================
-- Brickweld ERP — 0002 roles, rules, views, business functions
-- All money maths lives here so every screen shows the same numbers.
-- =====================================================================

-- ---------- roles ----------
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.role FROM user_roles ur JOIN profiles p ON p.id = ur.user_id
  WHERE ur.user_id = auth.uid() AND p.active
$$;
CREATE OR REPLACE FUNCTION public.is_md()    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(public.my_role() = 'md', false) $$;
CREATE OR REPLACE FUNCTION public.is_fin()   RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(public.my_role() IN ('md', 'accountant'), false) $$;
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.my_role() IS NOT NULL $$;

CREATE OR REPLACE FUNCTION public.require_fin() RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN IF NOT public.is_fin() THEN RAISE EXCEPTION 'Only MD or Accountant can do this.' USING ERRCODE = '42501'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.require_staff() RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN IF NOT public.is_staff() THEN RAISE EXCEPTION 'Your account has no role yet. Ask the MD to assign one.' USING ERRCODE = '42501'; END IF; END $$;

-- New sign-ups get a profile but NO role (no access until MD assigns one).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles(id, full_name, email)
  VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- document numbers ----------
CREATE OR REPLACE FUNCTION public.tg_doc_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE col text := TG_ARGV[0]; prefix text := TG_ARGV[1]; cur text;
BEGIN
  EXECUTE format('SELECT ($1).%I', col) INTO cur USING NEW;
  IF cur IS NULL OR trim(cur) = '' THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(col, next_doc_no(prefix, CASE WHEN prefix = 'TXN' THEN 5 ELSE 4 END)));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER doc_no BEFORE INSERT ON public.transactions       FOR EACH ROW EXECUTE FUNCTION public.tg_doc_no('txn_no', 'TXN');
CREATE TRIGGER doc_no BEFORE INSERT ON public.material_requests  FOR EACH ROW EXECUTE FUNCTION public.tg_doc_no('req_no', 'IND');
CREATE TRIGGER doc_no BEFORE INSERT ON public.purchase_orders    FOR EACH ROW EXECUTE FUNCTION public.tg_doc_no('po_no', 'PO');
CREATE TRIGGER doc_no BEFORE INSERT ON public.goods_receipts     FOR EACH ROW EXECUTE FUNCTION public.tg_doc_no('grn_no', 'GRN');
CREATE TRIGGER doc_no BEFORE INSERT ON public.work_orders        FOR EACH ROW EXECUTE FUNCTION public.tg_doc_no('wo_no', 'WO');
CREATE TRIGGER doc_no BEFORE INSERT ON public.bills              FOR EACH ROW EXECUTE FUNCTION public.tg_doc_no('bill_no', 'BILL');
CREATE TRIGGER doc_no BEFORE INSERT ON public.project_variations FOR EACH ROW EXECUTE FUNCTION public.tg_doc_no('var_no', 'VAR');

-- ---------- attendance: day value from in/out time ----------
CREATE OR REPLACE FUNCTION public.parse_hour(p text, p_default_pm boolean)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; has_pm boolean; has_am boolean; parts text[]; h numeric; m numeric := 0;
BEGIN
  IF p IS NULL OR trim(p) = '' THEN RETURN NULL; END IF;
  s := lower(trim(p));
  has_pm := s LIKE '%pm%'; has_am := s LIKE '%am%';
  s := trim(replace(replace(replace(s, 'pm', ''), 'am', ''), '.', ':'));
  parts := string_to_array(s, ':');
  BEGIN
    h := parts[1]::numeric;
    IF array_length(parts, 1) > 1 AND parts[2] <> '' THEN m := parts[2]::numeric / 60; END IF;
  EXCEPTION WHEN others THEN RETURN NULL; END;
  IF has_pm THEN IF h < 12 THEN h := h + 12; END IF;
  ELSIF has_am THEN IF h = 12 THEN h := 0; END IF;
  ELSIF h >= 13 OR h = 12 THEN NULL;
  ELSIF p_default_pm THEN h := h + 12;
  END IF;
  RETURN h + m;
END $$;

CREATE OR REPLACE FUNCTION public.calc_day_value(p_in text, p_out text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE s company_settings; a numeric; b numeric; hrs numeric;
BEGIN
  SELECT * INTO s FROM company_settings WHERE id = 1;
  a := parse_hour(p_in, false); b := parse_hour(p_out, true);
  IF a IS NULL OR b IS NULL OR b <= a THEN RETURN 0; END IF;
  hrs := b - a;
  IF hrs >= coalesce(s.ot_day_hours, 12) THEN RETURN 1.5;
  ELSIF hrs >= coalesce(s.full_day_hours, 8) THEN RETURN 1;
  ELSIF hrs >= coalesce(s.half_day_hours, 4) THEN RETURN 0.5;
  END IF;
  RETURN 0;
END $$;

-- Attendance guard: leave = 0 days; project must not be deleted; worker must exist.
CREATE OR REPLACE FUNCTION public.tg_attendance_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_leave THEN NEW.day_value := 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Choose a valid project / site for this attendance.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_guard BEFORE INSERT OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.tg_attendance_guard();

-- ---------- money: transaction validation ----------
CREATE OR REPLACE FUNCTION public.tg_txn_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ptype party_type; alloc numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM money_accounts WHERE id = NEW.account_id AND deleted_at IS NULL AND active) THEN
    RAISE EXCEPTION 'Choose an active bank or petty cash account.';
  END IF;
  IF NEW.party_id IS NOT NULL THEN
    SELECT type INTO ptype FROM parties WHERE id = NEW.party_id;
    IF NEW.category = 'supplier_payment'   AND ptype <> 'supplier'   THEN RAISE EXCEPTION 'Supplier payment must be to a supplier.'; END IF;
    IF NEW.category = 'contractor_payment' AND ptype <> 'contractor' THEN RAISE EXCEPTION 'Contractor payment must be to a contractor.'; END IF;
    IF NEW.category = 'client_receipt'     AND ptype <> 'client'     THEN RAISE EXCEPTION 'Client receipt must be from a client.'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_void AND NEW.is_void AND (NEW.amount, NEW.account_id, NEW.category) IS DISTINCT FROM (OLD.amount, OLD.account_id, OLD.category) THEN
      RAISE EXCEPTION 'A voided entry cannot be edited.';
    END IF;
    SELECT coalesce(sum(amount), 0) INTO alloc FROM payment_allocations WHERE transaction_id = NEW.id;
    IF NEW.amount < alloc THEN
      RAISE EXCEPTION 'Amount cannot be less than the % already applied to bills.', alloc;
    END IF;
    IF alloc > 0 AND NEW.party_id IS DISTINCT FROM OLD.party_id THEN
      RAISE EXCEPTION 'This payment is applied to bills; remove those allocations before changing the party.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER txn_guard BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.tg_txn_guard();

-- Allocation guard: same party, nothing over-applied, nothing on void/deleted docs.
CREATE OR REPLACE FUNCTION public.tg_alloc_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t transactions; b bills; used_txn numeric; used_bill numeric;
BEGIN
  SELECT * INTO t FROM transactions WHERE id = NEW.transaction_id FOR UPDATE;
  SELECT * INTO b FROM bills WHERE id = NEW.bill_id FOR UPDATE;
  IF t.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'Payment or bill not found.'; END IF;
  IF t.is_void OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Cannot apply a voided/deleted payment.'; END IF;
  IF b.is_void OR b.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Cannot pay a voided/deleted bill (%).', b.bill_no; END IF;
  IF t.category NOT IN ('supplier_payment', 'contractor_payment') THEN RAISE EXCEPTION 'Only supplier/contractor payments can be applied to bills.'; END IF;
  IF t.party_id <> b.party_id THEN RAISE EXCEPTION 'Bill % belongs to a different party.', b.bill_no; END IF;
  SELECT coalesce(sum(amount), 0) INTO used_txn  FROM payment_allocations WHERE transaction_id = t.id AND id <> NEW.id;
  SELECT coalesce(sum(pa.amount), 0) INTO used_bill FROM payment_allocations pa JOIN transactions x ON x.id = pa.transaction_id
    WHERE pa.bill_id = b.id AND pa.id <> NEW.id AND NOT x.is_void AND x.deleted_at IS NULL;
  IF used_txn + NEW.amount > t.amount + 0.001 THEN
    RAISE EXCEPTION 'Applied amount (%) is more than the payment (%).', used_txn + NEW.amount, t.amount;
  END IF;
  IF used_bill + NEW.amount > b.total + 0.001 THEN
    RAISE EXCEPTION 'Bill % has only % pending; you tried to apply %.', b.bill_no, b.total - used_bill, NEW.amount;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alloc_guard BEFORE INSERT OR UPDATE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.tg_alloc_guard();

-- Bills: total = subtotal + tax − retention − deductions, recalculated from items.
CREATE OR REPLACE FUNCTION public.recalc_bill(p_bill uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sub numeric; tx numeric; b bills; paid numeric;
BEGIN
  PERFORM set_config('app.system', 'on', true);
  SELECT coalesce(sum(amount), 0), coalesce(sum(tax), 0) INTO sub, tx FROM bill_items WHERE bill_id = p_bill;
  SELECT * INTO b FROM bills WHERE id = p_bill;
  IF b.bill_type = 'contractor' AND b.work_order_id IS NOT NULL THEN
    SELECT round((sub + tx) * w.retention_percent / 100, 2) INTO b.retention FROM work_orders w WHERE w.id = b.work_order_id;
  END IF;
  IF sub + tx - coalesce(b.retention, 0) - b.other_deductions < 0 THEN
    RAISE EXCEPTION 'Deductions cannot be more than the bill amount.';
  END IF;
  SELECT coalesce(sum(pa.amount), 0) INTO paid FROM payment_allocations pa JOIN transactions x ON x.id = pa.transaction_id
   WHERE pa.bill_id = p_bill AND NOT x.is_void AND x.deleted_at IS NULL;
  IF sub + tx - coalesce(b.retention, 0) - b.other_deductions < paid - 0.001 THEN
    RAISE EXCEPTION 'Bill total cannot go below the % already paid.', paid;
  END IF;
  UPDATE bills SET subtotal = sub, tax_amount = tx, retention = coalesce(b.retention, 0),
         total = sub + tx - coalesce(b.retention, 0) - b.other_deductions
   WHERE id = p_bill;
  PERFORM set_config('app.system', 'off', true);
END $$;

CREATE OR REPLACE FUNCTION public.recalc_po(p_po uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ordered numeric; received numeric; st text;
BEGIN
  PERFORM set_config('app.system', 'on', true);
  UPDATE purchase_orders po SET
    subtotal   = coalesce((SELECT sum(amount) FROM po_items WHERE po_id = p_po), 0),
    tax_amount = coalesce((SELECT sum(tax)    FROM po_items WHERE po_id = p_po), 0),
    total      = coalesce((SELECT sum(amount + tax) FROM po_items WHERE po_id = p_po), 0)
  WHERE po.id = p_po;
  SELECT coalesce(sum(qty), 0) INTO ordered FROM po_items WHERE po_id = p_po;
  SELECT coalesce(sum(gi.qty), 0) INTO received FROM grn_items gi JOIN goods_receipts g ON g.id = gi.grn_id
    WHERE g.po_id = p_po AND g.deleted_at IS NULL;
  SELECT status INTO st FROM purchase_orders WHERE id = p_po;
  IF st IN ('issued', 'partial', 'received') THEN
    UPDATE purchase_orders SET status = CASE WHEN received <= 0 THEN 'issued' WHEN received + 0.0005 >= ordered THEN 'received' ELSE 'partial' END
    WHERE id = p_po;
  END IF;
  PERFORM set_config('app.system', 'off', true);
END $$;

-- ---------- views (security_invoker: the caller's RLS applies) ----------
CREATE OR REPLACE VIEW public.v_account_balances WITH (security_invoker = true) AS
SELECT a.id, a.name, a.type, a.bank_name, a.account_last4, a.opening_balance, a.opening_date, a.active,
       coalesce(sum(t.amount) FILTER (WHERE t.direction = 'in'), 0)  AS total_in,
       coalesce(sum(t.amount) FILTER (WHERE t.direction = 'out'), 0) AS total_out,
       a.opening_balance + coalesce(sum(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END), 0) AS balance
FROM money_accounts a
LEFT JOIN transactions t ON t.account_id = a.id AND NOT t.is_void AND t.deleted_at IS NULL AND t.txn_date >= a.opening_date
WHERE a.deleted_at IS NULL
GROUP BY a.id;

CREATE OR REPLACE VIEW public.v_bill_balances WITH (security_invoker = true) AS
SELECT b.*, p.name AS party_name, pr.name AS project_name, pr.code AS project_code,
       w.wo_no, g.grn_no,
       coalesce(pd.paid, 0) AS paid,
       CASE WHEN b.is_void THEN 0 ELSE b.total - coalesce(pd.paid, 0) END AS balance,
       CASE
         WHEN b.is_void THEN 'void'
         WHEN b.total - coalesce(pd.paid, 0) <= 0.001 THEN 'paid'
         WHEN b.due_date IS NOT NULL AND b.due_date < current_date THEN 'overdue'
         WHEN coalesce(pd.paid, 0) > 0 THEN 'partial'
         ELSE 'unpaid'
       END AS status
FROM bills b
JOIN parties p ON p.id = b.party_id
JOIN projects pr ON pr.id = b.project_id
LEFT JOIN work_orders w ON w.id = b.work_order_id
LEFT JOIN goods_receipts g ON g.id = b.grn_id
LEFT JOIN LATERAL (
  SELECT sum(pa.amount) AS paid FROM payment_allocations pa JOIN transactions t ON t.id = pa.transaction_id
  WHERE pa.bill_id = b.id AND NOT t.is_void AND t.deleted_at IS NULL
) pd ON true
WHERE b.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_transactions WITH (security_invoker = true) AS
SELECT t.*, a.name AS account_name, a.type AS account_type,
       pr.name AS project_name, pr.code AS project_code,
       p.name AS party_name, p.type AS party_type,
       e.name AS employee_name, e.code AS employee_code,
       tm.name AS team_name, ec.name AS expense_category,
       coalesce(al.applied, 0) AS applied,
       CASE WHEN t.category IN ('supplier_payment', 'contractor_payment') AND NOT t.is_void
            THEN t.amount - coalesce(al.applied, 0) ELSE 0 END AS unapplied,
       coalesce(pc.full_name, '') AS created_by_name
FROM transactions t
JOIN money_accounts a ON a.id = t.account_id
LEFT JOIN projects pr ON pr.id = t.project_id
LEFT JOIN parties p ON p.id = t.party_id
LEFT JOIN employees e ON e.id = t.employee_id
LEFT JOIN teams tm ON tm.id = t.team_id
LEFT JOIN expense_categories ec ON ec.id = t.expense_category_id
LEFT JOIN profiles pc ON pc.id = t.created_by
LEFT JOIN LATERAL (SELECT sum(amount) AS applied FROM payment_allocations WHERE transaction_id = t.id) al ON true
WHERE t.deleted_at IS NULL;

-- Payables per supplier / contractor (Zoho "Payables" + "Unused credits").
CREATE OR REPLACE VIEW public.v_party_balances WITH (security_invoker = true) AS
SELECT p.id, p.type, p.code, p.name, p.contact_person, p.phone, p.email, p.gstin, p.active,
       coalesce(bl.billed, 0)  AS total_billed,
       coalesce(bl.pending, 0) AS payables,
       coalesce(bl.overdue, 0) AS overdue,
       coalesce(bl.retention, 0) AS retention_held,
       coalesce(py.paid, 0)    AS total_paid,
       coalesce(py.unapplied, 0) AS unused_credits,
       py.last_paid
FROM parties p
LEFT JOIN LATERAL (
  SELECT sum(total) AS billed, sum(balance) AS pending, sum(retention) AS retention,
         sum(balance) FILTER (WHERE status = 'overdue') AS overdue
  FROM v_bill_balances WHERE party_id = p.id AND NOT is_void
) bl ON true
LEFT JOIN LATERAL (
  SELECT sum(t.amount) AS paid, sum(t.unapplied) AS unapplied, max(t.txn_date) AS last_paid
  FROM v_transactions t WHERE t.party_id = p.id AND NOT t.is_void AND t.category IN ('supplier_payment', 'contractor_payment')
) py ON true
WHERE p.deleted_at IS NULL AND p.type IN ('supplier', 'contractor');

-- Rate in force on a given date (finance only through employee_rates RLS).
CREATE OR REPLACE VIEW public.v_wage_lines WITH (security_invoker = true) AS
SELECT a.id, a.employee_id, a.project_id, a.work_date, a.day_value, a.is_leave,
       r.rate,
       CASE WHEN e.wage_type = 'monthly' THEN round(r.rate / s.monthly_divisor, 2) ELSE r.rate END AS daily_rate,
       round(a.day_value * CASE WHEN e.wage_type = 'monthly' THEN r.rate / s.monthly_divisor ELSE r.rate END, 2) AS wage
FROM attendance a
JOIN employees e ON e.id = a.employee_id
CROSS JOIN company_settings s
JOIN LATERAL (
  SELECT rate FROM employee_rates er WHERE er.employee_id = a.employee_id AND er.effective_from <= a.work_date
  ORDER BY er.effective_from DESC LIMIT 1
) r ON true
WHERE a.deleted_at IS NULL AND public.is_fin();

CREATE OR REPLACE VIEW public.v_labour_balances WITH (security_invoker = true) AS
SELECT e.id AS employee_id, e.code, e.name, e.team_id, tm.name AS team_name, e.staff_type, e.wage_type, e.active,
       (SELECT rate FROM employee_rates er WHERE er.employee_id = e.id AND er.effective_from <= current_date ORDER BY effective_from DESC LIMIT 1) AS current_rate,
       coalesce(w.days, 0) AS total_days,
       coalesce(w.earned, 0) AS earned,
       coalesce(adj.allow, 0) AS allowances,
       coalesce(adj.ded, 0) AS deductions,
       coalesce(tx.adv, 0) AS advances,
       coalesce(tx.paid, 0) AS paid,
       coalesce(w.earned, 0) + coalesce(adj.allow, 0) - coalesce(adj.ded, 0) - coalesce(tx.adv, 0) - coalesce(tx.paid, 0) AS balance
FROM employees e
LEFT JOIN teams tm ON tm.id = e.team_id
LEFT JOIN LATERAL (SELECT sum(day_value) AS days, sum(wage) AS earned FROM v_wage_lines WHERE employee_id = e.id) w ON true
LEFT JOIN LATERAL (
  SELECT sum(amount) FILTER (WHERE kind = 'allowance') AS allow, sum(amount) FILTER (WHERE kind = 'deduction') AS ded
  FROM wage_adjustments WHERE employee_id = e.id AND deleted_at IS NULL
) adj ON true
LEFT JOIN LATERAL (
  SELECT sum(amount) FILTER (WHERE category = 'labour_advance') AS adv, sum(amount) FILTER (WHERE category = 'wage_payment') AS paid
  FROM transactions WHERE employee_id = e.id AND NOT is_void AND deleted_at IS NULL
) tx ON true
WHERE e.deleted_at IS NULL AND public.is_fin();

CREATE OR REPLACE VIEW public.v_project_summary WITH (security_invoker = true) AS
SELECT pr.id, pr.code, pr.name, pr.kind, pr.status, pr.progress, pr.start_date, pr.end_date, pr.client_id, c.name AS client_name,
       coalesce(f.contract_value, 0) AS base_contract,
       coalesce(v.approved, 0) AS variations,
       coalesce(f.contract_value, 0) + coalesce(v.approved, 0) AS contract_value,
       coalesce(rc.received, 0) AS received,
       greatest(coalesce(f.contract_value, 0) + coalesce(v.approved, 0) - coalesce(rc.received, 0), 0) AS receivable,
       coalesce(bm.material, 0) AS material_cost,
       coalesce(bm.contractor, 0) AS contractor_cost,
       coalesce(lb.labour, 0) + coalesce(adj.allow, 0) - coalesce(adj.ded, 0) AS labour_cost,
       coalesce(ex.expenses, 0) AS other_expenses,
       coalesce(bm.material, 0) + coalesce(bm.contractor, 0) + coalesce(lb.labour, 0) + coalesce(adj.allow, 0) - coalesce(adj.ded, 0) + coalesce(ex.expenses, 0) AS total_cost,
       coalesce(bm.pending, 0) AS bills_pending,
       coalesce(lb.days, 0) AS labour_days
FROM projects pr
LEFT JOIN parties c ON c.id = pr.client_id
LEFT JOIN project_financials f ON f.project_id = pr.id
LEFT JOIN LATERAL (SELECT sum(amount) AS approved FROM project_variations WHERE project_id = pr.id AND status = 'approved' AND deleted_at IS NULL) v ON true
LEFT JOIN LATERAL (SELECT sum(amount) AS received FROM transactions WHERE project_id = pr.id AND category = 'client_receipt' AND NOT is_void AND deleted_at IS NULL) rc ON true
LEFT JOIN LATERAL (
  SELECT sum(subtotal + tax_amount - other_deductions) FILTER (WHERE bill_type = 'supplier') AS material,
         sum(subtotal + tax_amount - other_deductions) FILTER (WHERE bill_type = 'contractor') AS contractor,
         sum(balance) AS pending
  FROM v_bill_balances WHERE project_id = pr.id AND NOT is_void
) bm ON true
LEFT JOIN LATERAL (SELECT sum(wage) AS labour, sum(day_value) AS days FROM v_wage_lines WHERE project_id = pr.id) lb ON true
LEFT JOIN LATERAL (
  SELECT sum(amount) FILTER (WHERE kind = 'allowance') AS allow, sum(amount) FILTER (WHERE kind = 'deduction') AS ded
  FROM wage_adjustments WHERE project_id = pr.id AND deleted_at IS NULL
) adj ON true
LEFT JOIN LATERAL (SELECT sum(amount) AS expenses FROM transactions WHERE project_id = pr.id AND category = 'expense' AND NOT is_void AND deleted_at IS NULL) ex ON true
WHERE pr.deleted_at IS NULL AND public.is_fin();

-- PO lines with received / pending quantities (no money) — safe for supervisors.
CREATE OR REPLACE FUNCTION public.get_po_lines_for_receipt(p_po uuid)
RETURNS TABLE (po_item_id uuid, material_name text, unit text, ordered numeric, received numeric, pending numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM require_staff();
  RETURN QUERY
  SELECT i.id, i.material_name, i.unit, i.qty,
         coalesce((SELECT sum(gi.qty) FROM grn_items gi JOIN goods_receipts g ON g.id = gi.grn_id WHERE gi.po_item_id = i.id AND g.deleted_at IS NULL), 0),
         i.qty - coalesce((SELECT sum(gi.qty) FROM grn_items gi JOIN goods_receipts g ON g.id = gi.grn_id WHERE gi.po_item_id = i.id AND g.deleted_at IS NULL), 0)
  FROM po_items i JOIN purchase_orders po ON po.id = i.po_id
  WHERE i.po_id = p_po AND po.deleted_at IS NULL
  ORDER BY i.sort_order, i.material_name;
END $$;

-- Open POs (header only, no money) for the receive screen — safe for supervisors.
CREATE OR REPLACE FUNCTION public.get_open_pos()
RETURNS TABLE (id uuid, po_no text, po_date date, project_id uuid, project_name text, supplier_id uuid, supplier_name text, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM require_staff();
  RETURN QUERY
  SELECT po.id, po.po_no, po.po_date, po.project_id, pr.name, po.supplier_id, s.name, po.status
  FROM purchase_orders po JOIN projects pr ON pr.id = po.project_id JOIN parties s ON s.id = po.supplier_id
  WHERE po.deleted_at IS NULL AND po.status IN ('issued', 'partial')
  ORDER BY po.po_date DESC;
END $$;

-- ---------- save documents atomically ----------
CREATE OR REPLACE FUNCTION public.save_purchase_order(p_id uuid, p_header jsonb, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := p_id; it jsonb; n int := 0;
BEGIN
  PERFORM require_fin();
  IF jsonb_array_length(coalesce(p_items, '[]')) = 0 THEN RAISE EXCEPTION 'Add at least one item.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO purchase_orders(project_id, supplier_id, request_id, po_date, expected_date, terms, notes, status)
    VALUES ((p_header->>'project_id')::uuid, (p_header->>'supplier_id')::uuid, nullif(p_header->>'request_id', '')::uuid,
            coalesce((p_header->>'po_date')::date, current_date), nullif(p_header->>'expected_date', '')::date,
            p_header->>'terms', p_header->>'notes', coalesce(nullif(p_header->>'status', ''), 'issued'))
    RETURNING id INTO v_id;
  ELSE
    IF EXISTS (SELECT 1 FROM goods_receipts WHERE po_id = v_id AND deleted_at IS NULL)
       AND (SELECT supplier_id FROM purchase_orders WHERE id = v_id) <> (p_header->>'supplier_id')::uuid THEN
      RAISE EXCEPTION 'Goods were already received on this PO; supplier cannot change.';
    END IF;
    UPDATE purchase_orders SET project_id = (p_header->>'project_id')::uuid, supplier_id = (p_header->>'supplier_id')::uuid,
      po_date = coalesce((p_header->>'po_date')::date, po_date), expected_date = nullif(p_header->>'expected_date', '')::date,
      terms = p_header->>'terms', notes = p_header->>'notes'
    WHERE id = v_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found.'; END IF;
    -- keep items already received against; replace the rest
    DELETE FROM po_items i WHERE i.po_id = v_id AND NOT EXISTS (SELECT 1 FROM grn_items gi WHERE gi.po_item_id = i.id);
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    n := n + 1;
    IF nullif(it->>'id', '') IS NOT NULL AND EXISTS (SELECT 1 FROM po_items WHERE id = (it->>'id')::uuid AND po_id = v_id) THEN
      UPDATE po_items SET material_name = it->>'material_name', unit = coalesce(it->>'unit', 'nos'), qty = (it->>'qty')::numeric,
        rate = (it->>'rate')::numeric, gst_percent = coalesce((it->>'gst_percent')::numeric, 0), sort_order = n
      WHERE id = (it->>'id')::uuid;
    ELSE
      INSERT INTO po_items(po_id, material_name, unit, qty, rate, gst_percent, sort_order)
      VALUES (v_id, it->>'material_name', coalesce(it->>'unit', 'nos'), (it->>'qty')::numeric, (it->>'rate')::numeric,
              coalesce((it->>'gst_percent')::numeric, 0), n);
    END IF;
  END LOOP;
  PERFORM recalc_po(v_id);
  IF (p_header->>'request_id') IS NOT NULL AND p_header->>'request_id' <> '' THEN
    UPDATE material_requests SET status = 'ordered' WHERE id = (p_header->>'request_id')::uuid AND status IN ('pending', 'approved');
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_material_request(p_id uuid, p_header jsonb, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := p_id; it jsonb; r material_requests;
BEGIN
  PERFORM require_staff();
  IF jsonb_array_length(coalesce(p_items, '[]')) = 0 THEN RAISE EXCEPTION 'Add at least one material.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO material_requests(project_id, req_date, required_by, notes)
    VALUES ((p_header->>'project_id')::uuid, coalesce((p_header->>'req_date')::date, current_date),
            nullif(p_header->>'required_by', '')::date, p_header->>'notes')
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO r FROM material_requests WHERE id = v_id AND deleted_at IS NULL;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Indent not found.'; END IF;
    IF NOT is_fin() AND (r.status <> 'pending' OR r.created_by <> auth.uid()) THEN
      RAISE EXCEPTION 'You can only edit your own indents while they are pending.';
    END IF;
    UPDATE material_requests SET project_id = (p_header->>'project_id')::uuid, req_date = coalesce((p_header->>'req_date')::date, req_date),
      required_by = nullif(p_header->>'required_by', '')::date, notes = p_header->>'notes' WHERE id = v_id;
    DELETE FROM material_request_items WHERE request_id = v_id;
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO material_request_items(request_id, material_name, unit, qty, notes)
    VALUES (v_id, it->>'material_name', coalesce(it->>'unit', 'nos'), (it->>'qty')::numeric, it->>'notes');
  END LOOP;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_request_status(p_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_fin();
  IF p_status NOT IN ('pending', 'approved', 'rejected', 'closed', 'ordered') THEN RAISE EXCEPTION 'Invalid status.'; END IF;
  UPDATE material_requests SET status = p_status WHERE id = p_id AND deleted_at IS NULL;
END $$;

-- Receive goods. From a PO: project, supplier and rates always come from the PO and the
-- supplier bill is created at once (unless p_make_bill = false).
CREATE OR REPLACE FUNCTION public.create_goods_receipt(
  p_po_id uuid, p_project_id uuid, p_supplier_id uuid, p_date date, p_challan text, p_vehicle text,
  p_notes text, p_items jsonb, p_make_bill boolean DEFAULT true, p_vendor_ref text DEFAULT NULL, p_due_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po purchase_orders; v_grn uuid; v_bill uuid; it jsonb; pi po_items; pend numeric; gi_id uuid;
        v_proj uuid := p_project_id; v_sup uuid := p_supplier_id; any_rate boolean := false; n int := 0;
BEGIN
  PERFORM require_staff();
  IF jsonb_array_length(coalesce(p_items, '[]')) = 0 THEN RAISE EXCEPTION 'Add at least one received item.'; END IF;
  IF p_po_id IS NOT NULL THEN
    SELECT * INTO po FROM purchase_orders WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
    IF po.id IS NULL THEN RAISE EXCEPTION 'Purchase order not found.'; END IF;
    IF po.status IN ('cancelled', 'closed', 'draft') THEN RAISE EXCEPTION 'PO % is %; it cannot be received.', po.po_no, po.status; END IF;
    v_proj := po.project_id; v_sup := po.supplier_id;
  END IF;
  IF v_proj IS NULL OR v_sup IS NULL THEN RAISE EXCEPTION 'Choose the project and supplier.'; END IF;

  INSERT INTO goods_receipts(po_id, project_id, supplier_id, grn_date, challan_no, vehicle_no, notes)
  VALUES (p_po_id, v_proj, v_sup, coalesce(p_date, current_date), p_challan, p_vehicle, p_notes)
  RETURNING id INTO v_grn;

  -- Against a PO the rates are known, so the bill is created for any role. Direct receipts
  -- by a supervisor wait for the accountant to enter rates (bill_goods_receipt).
  IF p_make_bill AND (p_po_id IS NOT NULL OR is_fin()) THEN
    INSERT INTO bills(bill_type, party_id, project_id, grn_id, bill_date, due_date, vendor_ref, description)
    VALUES ('supplier', v_sup, v_proj, v_grn, coalesce(p_date, current_date), p_due_date, p_vendor_ref,
            CASE WHEN po.id IS NOT NULL THEN 'Against ' || po.po_no ELSE 'Direct purchase' END)
    RETURNING id INTO v_bill;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF coalesce((it->>'qty')::numeric, 0) <= 0 THEN CONTINUE; END IF;
    n := n + 1;
    IF p_po_id IS NOT NULL THEN
      SELECT * INTO pi FROM po_items WHERE id = (it->>'po_item_id')::uuid AND po_id = p_po_id;
      IF pi.id IS NULL THEN RAISE EXCEPTION 'Item does not belong to PO %.', po.po_no; END IF;
      SELECT pi.qty - coalesce(sum(gi.qty), 0) INTO pend FROM grn_items gi JOIN goods_receipts g ON g.id = gi.grn_id
        WHERE gi.po_item_id = pi.id AND g.deleted_at IS NULL AND g.id <> v_grn;
      IF (it->>'qty')::numeric > pend + 0.0005 THEN
        RAISE EXCEPTION '% : only % % pending on the PO, you entered %.', pi.material_name, pend, pi.unit, it->>'qty';
      END IF;
      INSERT INTO grn_items(grn_id, po_item_id, material_name, unit, qty)
      VALUES (v_grn, pi.id, pi.material_name, pi.unit, (it->>'qty')::numeric) RETURNING id INTO gi_id;
      IF v_bill IS NOT NULL THEN
        INSERT INTO bill_items(bill_id, description, unit, qty, rate, gst_percent, grn_item_id, sort_order)
        VALUES (v_bill, pi.material_name, pi.unit, (it->>'qty')::numeric, pi.rate, pi.gst_percent, gi_id, n);
      END IF;
    ELSE
      INSERT INTO grn_items(grn_id, material_name, unit, qty)
      VALUES (v_grn, it->>'material_name', coalesce(it->>'unit', 'nos'), (it->>'qty')::numeric) RETURNING id INTO gi_id;
      IF v_bill IS NOT NULL THEN
        IF nullif(it->>'rate', '') IS NULL THEN RAISE EXCEPTION 'Enter a rate for % (direct purchase).', it->>'material_name'; END IF;
        INSERT INTO bill_items(bill_id, description, unit, qty, rate, gst_percent, grn_item_id, sort_order)
        VALUES (v_bill, it->>'material_name', coalesce(it->>'unit', 'nos'), (it->>'qty')::numeric, (it->>'rate')::numeric,
                coalesce((it->>'gst_percent')::numeric, 0), gi_id, n);
        any_rate := true;
      END IF;
    END IF;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Enter a received quantity for at least one item.'; END IF;
  IF v_bill IS NOT NULL THEN PERFORM recalc_bill(v_bill); END IF;
  IF p_po_id IS NOT NULL THEN PERFORM recalc_po(p_po_id); END IF;
  RETURN v_grn;
END $$;

-- Turn an unbilled goods receipt into a supplier bill (finance).
CREATE OR REPLACE FUNCTION public.bill_goods_receipt(p_grn uuid, p_bill_date date, p_due_date date, p_vendor_ref text, p_rates jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g goods_receipts; v_bill uuid; gi grn_items; r jsonb; pi po_items; n int := 0;
BEGIN
  PERFORM require_fin();
  SELECT * INTO g FROM goods_receipts WHERE id = p_grn AND deleted_at IS NULL;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Goods receipt not found.'; END IF;
  IF EXISTS (SELECT 1 FROM bills WHERE grn_id = p_grn AND deleted_at IS NULL AND NOT is_void) THEN
    RAISE EXCEPTION 'This goods receipt already has a bill.';
  END IF;
  INSERT INTO bills(bill_type, party_id, project_id, grn_id, bill_date, due_date, vendor_ref, description)
  VALUES ('supplier', g.supplier_id, g.project_id, g.id, coalesce(p_bill_date, g.grn_date), p_due_date, p_vendor_ref, 'Goods receipt ' || g.grn_no)
  RETURNING id INTO v_bill;
  FOR gi IN SELECT * FROM grn_items WHERE grn_id = p_grn LOOP
    n := n + 1;
    r := (SELECT e FROM jsonb_array_elements(coalesce(p_rates, '[]')) e WHERE e->>'grn_item_id' = gi.id::text LIMIT 1);
    IF gi.po_item_id IS NOT NULL THEN SELECT * INTO pi FROM po_items WHERE id = gi.po_item_id; END IF;
    INSERT INTO bill_items(bill_id, description, unit, qty, rate, gst_percent, grn_item_id, sort_order)
    VALUES (v_bill, gi.material_name, gi.unit, gi.qty,
            coalesce((r->>'rate')::numeric, pi.rate), coalesce((r->>'gst_percent')::numeric, pi.gst_percent, 0), gi.id, n);
    IF coalesce((r->>'rate')::numeric, pi.rate) IS NULL THEN RAISE EXCEPTION 'Enter a rate for %.', gi.material_name; END IF;
    pi := NULL;
  END LOOP;
  PERFORM recalc_bill(v_bill);
  RETURN v_bill;
END $$;

-- Manual bill: supplier (direct purchase/service) or contractor (work done against a WO).
CREATE OR REPLACE FUNCTION public.save_bill(p_id uuid, p_header jsonb, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := p_id; it jsonb; w work_orders; n int := 0; btype bill_type := (p_header->>'bill_type')::bill_type;
        v_party uuid := (p_header->>'party_id')::uuid; v_proj uuid := (p_header->>'project_id')::uuid; billed numeric; this_total numeric;
BEGIN
  PERFORM require_fin();
  IF jsonb_array_length(coalesce(p_items, '[]')) = 0 THEN RAISE EXCEPTION 'Add at least one line.'; END IF;
  IF nullif(p_header->>'work_order_id', '') IS NOT NULL THEN
    SELECT * INTO w FROM work_orders WHERE id = (p_header->>'work_order_id')::uuid AND deleted_at IS NULL;
    IF w.id IS NULL THEN RAISE EXCEPTION 'Work order not found.'; END IF;
    IF w.status = 'cancelled' THEN RAISE EXCEPTION 'Work order % is cancelled.', w.wo_no; END IF;
    v_party := w.contractor_id; v_proj := w.project_id; btype := 'contractor';
  END IF;
  IF btype = 'contractor' AND w.id IS NULL THEN RAISE EXCEPTION 'A contractor bill must be against a work order.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO bills(bill_type, party_id, project_id, work_order_id, bill_date, due_date, vendor_ref, description, other_deductions)
    VALUES (btype, v_party, v_proj, w.id, coalesce((p_header->>'bill_date')::date, current_date), nullif(p_header->>'due_date', '')::date,
            p_header->>'vendor_ref', p_header->>'description', coalesce((p_header->>'other_deductions')::numeric, 0))
    RETURNING id INTO v_id;
  ELSE
    IF EXISTS (SELECT 1 FROM bills WHERE id = v_id AND (is_void OR deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'This bill is void or deleted.'; END IF;
    IF EXISTS (SELECT 1 FROM bills WHERE id = v_id AND grn_id IS NOT NULL) AND btype = 'supplier' THEN NULL; END IF;
    UPDATE bills SET bill_date = coalesce((p_header->>'bill_date')::date, bill_date), due_date = nullif(p_header->>'due_date', '')::date,
      vendor_ref = p_header->>'vendor_ref', description = p_header->>'description',
      other_deductions = coalesce((p_header->>'other_deductions')::numeric, 0),
      party_id = CASE WHEN EXISTS (SELECT 1 FROM payment_allocations WHERE bill_id = v_id) THEN party_id ELSE v_party END,
      project_id = v_proj
    WHERE id = v_id;
    DELETE FROM bill_items WHERE bill_id = v_id;
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    n := n + 1;
    INSERT INTO bill_items(bill_id, description, unit, qty, rate, gst_percent, sort_order)
    VALUES (v_id, it->>'description', it->>'unit', (it->>'qty')::numeric, (it->>'rate')::numeric, coalesce((it->>'gst_percent')::numeric, 0), n);
  END LOOP;
  PERFORM recalc_bill(v_id);
  IF w.id IS NOT NULL THEN
    SELECT coalesce(sum(subtotal + tax_amount), 0) INTO billed FROM bills WHERE work_order_id = w.id AND NOT is_void AND deleted_at IS NULL;
    IF billed > w.amount * 1.10 THEN
      RAISE EXCEPTION 'Total billed (%) is more than 110%% of work order % value (%). Raise the WO value first.', billed, w.wo_no, w.amount;
    END IF;
  END IF;
  RETURN v_id;
END $$;

-- ---------- payments ----------
-- Supplier / contractor payment with optional allocation to bills. Anything not applied
-- stays as an advance ("unused credit") that can be applied later.
CREATE OR REPLACE FUNCTION public.record_payment(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; a jsonb; v_proj uuid := nullif(p->>'project_id', '')::uuid;
BEGIN
  PERFORM require_fin();
  IF p->>'category' NOT IN ('supplier_payment', 'contractor_payment') THEN RAISE EXCEPTION 'Use this for supplier or contractor payments.'; END IF;
  -- single-project allocations: tag the payment with that project for project cash views
  IF v_proj IS NULL AND jsonb_array_length(coalesce(p->'allocations', '[]')) > 0 THEN
    SELECT CASE WHEN count(DISTINCT b.project_id) = 1 THEN min(b.project_id::text)::uuid END INTO v_proj
    FROM jsonb_array_elements(p->'allocations') e JOIN bills b ON b.id = (e->>'bill_id')::uuid;
  END IF;
  INSERT INTO transactions(txn_date, account_id, direction, category, amount, party_id, project_id, mode, reference, description)
  VALUES (coalesce((p->>'txn_date')::date, current_date), (p->>'account_id')::uuid, 'out', (p->>'category')::txn_category,
          (p->>'amount')::numeric, (p->>'party_id')::uuid, v_proj, coalesce(nullif(p->>'mode', ''), 'cash')::pay_mode,
          p->>'reference', p->>'description')
  RETURNING id INTO v_id;
  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p->'allocations', '[]')) LOOP
    IF coalesce((a->>'amount')::numeric, 0) > 0 THEN
      INSERT INTO payment_allocations(transaction_id, bill_id, amount) VALUES (v_id, (a->>'bill_id')::uuid, (a->>'amount')::numeric);
    END IF;
  END LOOP;
  RETURN v_id;
END $$;

-- Apply an advance / unused credit to bills.
CREATE OR REPLACE FUNCTION public.apply_credit(p_txn uuid, p_allocations jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a jsonb;
BEGIN
  PERFORM require_fin();
  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p_allocations, '[]')) LOOP
    IF coalesce((a->>'amount')::numeric, 0) > 0 THEN
      INSERT INTO payment_allocations(transaction_id, bill_id, amount) VALUES (p_txn, (a->>'bill_id')::uuid, (a->>'amount')::numeric);
    END IF;
  END LOOP;
  UPDATE transactions SET updated_at = now() WHERE id = p_txn;
END $$;

CREATE OR REPLACE FUNCTION public.remove_allocation(p_alloc uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid;
BEGIN
  PERFORM require_fin();
  DELETE FROM payment_allocations WHERE id = p_alloc RETURNING transaction_id INTO t;
  UPDATE transactions SET updated_at = now() WHERE id = t;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_funds(p_from uuid, p_to uuid, p_amount numeric, p_date date, p_mode text, p_reference text, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b uuid := gen_random_uuid(); fa text; ta text;
BEGIN
  PERFORM require_fin();
  IF p_from = p_to THEN RAISE EXCEPTION 'Choose two different accounts.'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Amount must be more than zero.'; END IF;
  SELECT name INTO fa FROM money_accounts WHERE id = p_from; SELECT name INTO ta FROM money_accounts WHERE id = p_to;
  INSERT INTO transactions(txn_date, account_id, direction, category, amount, mode, reference, description, batch_id)
  VALUES (coalesce(p_date, current_date), p_from, 'out', 'transfer_out', p_amount, coalesce(nullif(p_mode, ''), 'cash')::pay_mode, p_reference, coalesce(nullif(p_notes, ''), 'Transfer to ' || ta), b),
         (coalesce(p_date, current_date), p_to, 'in', 'transfer_in', p_amount, coalesce(nullif(p_mode, ''), 'cash')::pay_mode, p_reference, coalesce(nullif(p_notes, ''), 'Transfer from ' || fa), b);
  RETURN b;
END $$;

-- Pay wages for many workers at once (team payment). p_lines: [{employee_id, amount}]
CREATE OR REPLACE FUNCTION public.pay_wages(p_account uuid, p_date date, p_week_start date, p_mode text, p_reference text, p_team uuid, p_lines jsonb, p_kind text DEFAULT 'wage_payment')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b uuid := gen_random_uuid(); l jsonb; n int := 0;
BEGIN
  PERFORM require_fin();
  IF p_kind NOT IN ('wage_payment', 'labour_advance') THEN RAISE EXCEPTION 'Invalid payment kind.'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]')) LOOP
    IF coalesce((l->>'amount')::numeric, 0) > 0 THEN
      INSERT INTO transactions(txn_date, account_id, direction, category, amount, employee_id, team_id, week_start, mode, reference, description, batch_id, project_id)
      VALUES (coalesce(p_date, current_date), p_account, 'out', p_kind::txn_category, (l->>'amount')::numeric, (l->>'employee_id')::uuid, p_team,
              p_week_start, coalesce(nullif(p_mode, ''), 'cash')::pay_mode, p_reference,
              CASE WHEN p_kind = 'wage_payment' THEN 'Wages' ELSE 'Advance' END || CASE WHEN p_week_start IS NOT NULL THEN ' — week of ' || to_char(p_week_start, 'DD Mon YYYY') ELSE '' END,
              b, nullif(l->>'project_id', '')::uuid);
      n := n + 1;
    END IF;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Enter an amount for at least one worker.'; END IF;
  RETURN b;
END $$;

-- ---------- attendance (bulk save, used by grid + "mark all present") ----------
-- p_rows: [{employee_id, project_id, work_date, in_time, out_time, day_value, is_leave, notes}]
-- day_value null → calculated from in/out time. p_overwrite=false keeps existing entries (incl. leave).
CREATE OR REPLACE FUNCTION public.save_attendance(p_rows jsonb, p_overwrite boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; ex attendance; dv numeric; ins int := 0; upd int := 0; skip int := 0;
BEGIN
  PERFORM require_staff();
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_rows, '[]')) LOOP
    dv := CASE WHEN coalesce((r->>'is_leave')::boolean, false) THEN 0
               WHEN nullif(r->>'day_value', '') IS NOT NULL THEN (r->>'day_value')::numeric
               ELSE calc_day_value(r->>'in_time', r->>'out_time') END;
    SELECT * INTO ex FROM attendance WHERE employee_id = (r->>'employee_id')::uuid AND work_date = (r->>'work_date')::date AND deleted_at IS NULL FOR UPDATE;
    IF ex.id IS NOT NULL THEN
      IF NOT p_overwrite THEN skip := skip + 1; CONTINUE; END IF;
      UPDATE attendance SET project_id = (r->>'project_id')::uuid, in_time = nullif(r->>'in_time', ''), out_time = nullif(r->>'out_time', ''),
        day_value = dv, is_leave = coalesce((r->>'is_leave')::boolean, false), notes = r->>'notes'
      WHERE id = ex.id
        AND (project_id, coalesce(in_time, ''), coalesce(out_time, ''), day_value, is_leave, coalesce(notes, ''))
            IS DISTINCT FROM ((r->>'project_id')::uuid, coalesce(r->>'in_time', ''), coalesce(r->>'out_time', ''), dv, coalesce((r->>'is_leave')::boolean, false), coalesce(r->>'notes', ''));
      IF FOUND THEN upd := upd + 1; ELSE skip := skip + 1; END IF;
    ELSE
      INSERT INTO attendance(employee_id, project_id, work_date, in_time, out_time, day_value, is_leave, notes)
      VALUES ((r->>'employee_id')::uuid, (r->>'project_id')::uuid, (r->>'work_date')::date, nullif(r->>'in_time', ''), nullif(r->>'out_time', ''),
              dv, coalesce((r->>'is_leave')::boolean, false), r->>'notes');
      ins := ins + 1;
    END IF;
    ex := NULL;
  END LOOP;
  RETURN jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skip);
END $$;

-- Weekly wage sheet (finance). One row per worker; days from all sites.
CREATE OR REPLACE FUNCTION public.get_wage_sheet(p_week_start date, p_project uuid DEFAULT NULL, p_team uuid DEFAULT NULL)
RETURNS TABLE (
  employee_id uuid, code text, name text, team_id uuid, team_name text, wage_type text, rate numeric,
  days numeric[], day_projects text[], total_days numeric, earned numeric, allowances numeric, deductions numeric,
  advances numeric, paid numeric, prev_balance numeric, balance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE we date := p_week_start + 6;
BEGIN
  PERFORM require_fin();
  RETURN QUERY
  WITH emp AS (
    SELECT e.* FROM employees e
    WHERE e.deleted_at IS NULL
      AND (p_team IS NULL OR e.team_id = p_team)
      AND (
        (p_project IS NULL AND (e.active OR EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.deleted_at IS NULL AND a.work_date BETWEEN p_week_start AND we)))
        OR (p_project IS NOT NULL AND EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.project_id = p_project AND a.deleted_at IS NULL AND a.work_date BETWEEN p_week_start AND we))
      )
  ),
  wl AS (
    SELECT a.employee_id, a.work_date, a.day_value, a.project_id,
           round(a.day_value * CASE WHEN e.wage_type = 'monthly' THEN r.rate / s.monthly_divisor ELSE r.rate END, 2) AS wage
    FROM attendance a JOIN emp e ON e.id = a.employee_id CROSS JOIN company_settings s
    LEFT JOIN LATERAL (SELECT er.rate FROM employee_rates er WHERE er.employee_id = a.employee_id AND er.effective_from <= a.work_date ORDER BY er.effective_from DESC LIMIT 1) r ON true
    WHERE a.deleted_at IS NULL AND a.work_date <= we
  ),
  adj AS (
    SELECT w.employee_id,
      sum(w.amount) FILTER (WHERE w.kind = 'allowance' AND w.adj_date BETWEEN p_week_start AND we) AS allow_w,
      sum(w.amount) FILTER (WHERE w.kind = 'deduction' AND w.adj_date BETWEEN p_week_start AND we) AS ded_w,
      sum(CASE WHEN w.kind = 'allowance' THEN w.amount ELSE -w.amount END) FILTER (WHERE w.adj_date < p_week_start) AS net_before
    FROM wage_adjustments w WHERE w.deleted_at IS NULL AND w.employee_id IN (SELECT id FROM emp) GROUP BY w.employee_id
  ),
  tx AS (
    SELECT t.employee_id,
      sum(t.amount) FILTER (WHERE t.category = 'labour_advance' AND t.txn_date BETWEEN p_week_start AND we) AS adv_w,
      sum(t.amount) FILTER (WHERE t.category = 'wage_payment' AND coalesce(t.week_start, t.txn_date) BETWEEN p_week_start AND we) AS paid_w,
      sum(t.amount) FILTER (WHERE (t.category = 'labour_advance' AND t.txn_date < p_week_start)
                              OR (t.category = 'wage_payment' AND coalesce(t.week_start, t.txn_date) < p_week_start)) AS out_before
    FROM transactions t WHERE NOT t.is_void AND t.deleted_at IS NULL AND t.employee_id IN (SELECT id FROM emp) GROUP BY t.employee_id
  ),
  agg AS (
    SELECT e.id,
      array_agg(coalesce((SELECT sum(w.day_value) FROM wl w WHERE w.employee_id = e.id AND w.work_date = p_week_start + g), NULL) ORDER BY g) AS days,
      array_agg((SELECT string_agg(DISTINCT p.code, ',') FROM wl w JOIN projects p ON p.id = w.project_id WHERE w.employee_id = e.id AND w.work_date = p_week_start + g) ORDER BY g) AS dproj
    FROM emp e CROSS JOIN generate_series(0, 6) g GROUP BY e.id
  )
  SELECT e.id, e.code, e.name, e.team_id, t.name, e.wage_type,
    (SELECT er.rate FROM employee_rates er WHERE er.employee_id = e.id AND er.effective_from <= we ORDER BY er.effective_from DESC LIMIT 1),
    ag.days, ag.dproj,
    coalesce((SELECT sum(day_value) FROM wl WHERE wl.employee_id = e.id AND wl.work_date >= p_week_start), 0),
    coalesce((SELECT sum(wage) FROM wl WHERE wl.employee_id = e.id AND wl.work_date >= p_week_start), 0),
    coalesce(a.allow_w, 0), coalesce(a.ded_w, 0), coalesce(x.adv_w, 0), coalesce(x.paid_w, 0),
    coalesce((SELECT sum(wage) FROM wl WHERE wl.employee_id = e.id AND wl.work_date < p_week_start), 0) + coalesce(a.net_before, 0) - coalesce(x.out_before, 0),
    coalesce((SELECT sum(wage) FROM wl WHERE wl.employee_id = e.id), 0) + coalesce(a.net_before, 0) + coalesce(a.allow_w, 0) - coalesce(a.ded_w, 0)
      - coalesce(x.out_before, 0) - coalesce(x.adv_w, 0) - coalesce(x.paid_w, 0)
  FROM emp e
  LEFT JOIN teams t ON t.id = e.team_id
  LEFT JOIN adj a ON a.employee_id = e.id
  LEFT JOIN tx x ON x.employee_id = e.id
  JOIN agg ag ON ag.id = e.id
  ORDER BY t.name NULLS LAST, e.name;
END $$;

-- ---------- cash count (petty cash closing) ----------
CREATE OR REPLACE FUNCTION public.account_balance_on(p_account uuid, p_date date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.opening_balance + coalesce((
    SELECT sum(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END) FROM transactions t
    WHERE t.account_id = a.id AND NOT t.is_void AND t.deleted_at IS NULL AND t.txn_date >= a.opening_date AND t.txn_date <= p_date), 0)
  FROM money_accounts a WHERE a.id = p_account
$$;

CREATE OR REPLACE FUNCTION public.tg_cash_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.book_balance := public.account_balance_on(NEW.account_id, NEW.count_date);
  RETURN NEW;
END $$;
CREATE TRIGGER cash_count_book BEFORE INSERT ON public.cash_counts FOR EACH ROW EXECUTE FUNCTION public.tg_cash_count();

-- ---------- void / delete / restore ----------
CREATE OR REPLACE FUNCTION public.void_record(p_table text, p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t transactions;
BEGIN
  PERFORM require_fin();
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason for voiding.'; END IF;
  IF p_table = 'transactions' THEN
    SELECT * INTO t FROM transactions WHERE id = p_id AND deleted_at IS NULL;
    IF t.id IS NULL THEN RAISE EXCEPTION 'Entry not found.'; END IF;
    IF t.is_void THEN RAISE EXCEPTION 'Already void.'; END IF;
    PERFORM set_config('app.system', 'on', true);
    DELETE FROM payment_allocations WHERE transaction_id = p_id;
    PERFORM set_config('app.system', 'off', true);
    UPDATE transactions SET is_void = true, void_reason = p_reason, voided_at = now(), voided_by = auth.uid()
     WHERE id = p_id OR (t.batch_id IS NOT NULL AND batch_id = t.batch_id AND category IN ('transfer_in', 'transfer_out') AND t.category IN ('transfer_in', 'transfer_out'));
  ELSIF p_table = 'bills' THEN
    IF EXISTS (SELECT 1 FROM payment_allocations pa JOIN transactions x ON x.id = pa.transaction_id WHERE pa.bill_id = p_id AND NOT x.is_void AND x.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'This bill has payments applied. Remove or void those payments first.';
    END IF;
    UPDATE bills SET is_void = true, void_reason = p_reason, voided_at = now(), voided_by = auth.uid() WHERE id = p_id AND NOT is_void;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found or already void.'; END IF;
  ELSE
    RAISE EXCEPTION 'Only payments/entries and bills can be voided.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.unvoid_record(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t transactions;
BEGIN
  PERFORM require_fin();
  IF p_table = 'transactions' THEN
    SELECT * INTO t FROM transactions WHERE id = p_id;
    UPDATE transactions SET is_void = false, void_reason = NULL, voided_at = NULL, voided_by = NULL
     WHERE id = p_id OR (t.batch_id IS NOT NULL AND batch_id = t.batch_id AND category IN ('transfer_in', 'transfer_out') AND t.category IN ('transfer_in', 'transfer_out'));
  ELSIF p_table = 'bills' THEN
    IF EXISTS (SELECT 1 FROM bills b WHERE b.id = p_id AND b.grn_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM bills b2 WHERE b2.grn_id = b.grn_id AND b2.id <> b.id AND NOT b2.is_void AND b2.deleted_at IS NULL)) THEN
      RAISE EXCEPTION 'Another bill already exists for this goods receipt.';
    END IF;
    UPDATE bills SET is_void = false, void_reason = NULL, voided_at = NULL, voided_by = NULL WHERE id = p_id;
  ELSE RAISE EXCEPTION 'Not voidable.'; END IF;
END $$;

-- Soft delete with dependency checks. Child line items go with their document.
CREATE OR REPLACE FUNCTION public.soft_delete(p_table text, p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; msg text := NULL; v_po uuid; v_bill uuid;
BEGIN
  IF p_table = 'material_requests' THEN
    PERFORM require_staff();
    IF NOT is_fin() AND NOT EXISTS (SELECT 1 FROM material_requests WHERE id = p_id AND created_by = auth.uid() AND status = 'pending') THEN
      RAISE EXCEPTION 'You can only delete your own pending indents.';
    END IF;
  ELSE
    PERFORM require_fin();
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason for deleting.'; END IF;
  IF p_table NOT IN ('parties','teams','employees','machines','materials','job_types','expense_categories','projects','project_variations',
                     'money_accounts','transactions','cash_counts','material_requests','purchase_orders','goods_receipts','work_orders',
                     'bills','attendance','wage_adjustments') THEN
    RAISE EXCEPTION 'Deleting from % is not allowed.', p_table;
  END IF;

  -- dependency checks
  IF p_table = 'parties' THEN
    SELECT count(*) INTO n FROM (
      SELECT 1 FROM transactions WHERE party_id = p_id AND deleted_at IS NULL UNION ALL
      SELECT 1 FROM bills WHERE party_id = p_id AND deleted_at IS NULL UNION ALL
      SELECT 1 FROM purchase_orders WHERE supplier_id = p_id AND deleted_at IS NULL UNION ALL
      SELECT 1 FROM work_orders WHERE contractor_id = p_id AND deleted_at IS NULL UNION ALL
      SELECT 1 FROM projects WHERE client_id = p_id AND deleted_at IS NULL) x;
    IF n > 0 THEN msg := format('it is used in %s record(s). Mark it inactive instead.', n); END IF;
  ELSIF p_table = 'employees' THEN
    SELECT count(*) INTO n FROM (SELECT 1 FROM attendance WHERE employee_id = p_id AND deleted_at IS NULL UNION ALL
                                 SELECT 1 FROM transactions WHERE employee_id = p_id AND deleted_at IS NULL) x;
    IF n > 0 THEN msg := format('this worker has %s attendance/payment record(s). Mark inactive instead.', n); END IF;
  ELSIF p_table = 'teams' THEN
    SELECT count(*) INTO n FROM employees WHERE team_id = p_id AND deleted_at IS NULL;
    IF n > 0 THEN msg := format('%s worker(s) are in this team. Move them first.', n); END IF;
  ELSIF p_table = 'projects' THEN
    SELECT count(*) INTO n FROM (
      SELECT 1 FROM transactions WHERE project_id = p_id AND deleted_at IS NULL UNION ALL
      SELECT 1 FROM bills WHERE project_id = p_id AND deleted_at IS NULL UNION ALL
      SELECT 1 FROM purchase_orders WHERE project_id = p_id AND deleted_at IS NULL UNION ALL
      SELECT 1 FROM work_orders WHERE project_id = p_id AND deleted_at IS NULL UNION ALL
      SELECT 1 FROM attendance WHERE project_id = p_id AND deleted_at IS NULL UNION ALL
      SELECT 1 FROM material_requests WHERE project_id = p_id AND deleted_at IS NULL) x;
    IF n > 0 THEN msg := format('it has %s linked record(s). Mark it completed instead.', n); END IF;
  ELSIF p_table = 'money_accounts' THEN
    SELECT count(*) INTO n FROM transactions WHERE account_id = p_id AND deleted_at IS NULL;
    IF n > 0 THEN msg := format('it has %s entries. Mark it inactive instead.', n); END IF;
  ELSIF p_table = 'purchase_orders' THEN
    SELECT count(*) INTO n FROM goods_receipts WHERE po_id = p_id AND deleted_at IS NULL;
    IF n > 0 THEN msg := format('%s goods receipt(s) are linked. Delete them first or close the PO.', n); END IF;
  ELSIF p_table = 'material_requests' THEN
    SELECT count(*) INTO n FROM purchase_orders WHERE request_id = p_id AND deleted_at IS NULL;
    IF n > 0 THEN msg := format('%s purchase order(s) were raised from it.', n); END IF;
  ELSIF p_table = 'work_orders' THEN
    SELECT count(*) INTO n FROM bills WHERE work_order_id = p_id AND deleted_at IS NULL AND NOT is_void;
    IF n > 0 THEN msg := format('%s bill(s) are linked. Void them first or mark the WO cancelled.', n); END IF;
  ELSIF p_table = 'bills' THEN
    SELECT count(*) INTO n FROM payment_allocations pa JOIN transactions x ON x.id = pa.transaction_id WHERE pa.bill_id = p_id AND NOT x.is_void AND x.deleted_at IS NULL;
    IF n > 0 THEN msg := format('%s payment(s) are applied to it. Remove them first.', n); END IF;
  ELSIF p_table = 'goods_receipts' THEN
    SELECT b.id INTO v_bill FROM bills b WHERE b.grn_id = p_id AND b.deleted_at IS NULL AND NOT b.is_void LIMIT 1;
    IF v_bill IS NOT NULL AND EXISTS (SELECT 1 FROM payment_allocations pa JOIN transactions x ON x.id = pa.transaction_id WHERE pa.bill_id = v_bill AND NOT x.is_void AND x.deleted_at IS NULL) THEN
      msg := 'its bill has payments applied. Remove them first.';
    END IF;
  END IF;
  IF msg IS NOT NULL THEN RAISE EXCEPTION 'Cannot delete: %', msg; END IF;

  -- side effects
  IF p_table = 'transactions' THEN
    PERFORM set_config('app.system', 'on', true);
    DELETE FROM payment_allocations WHERE transaction_id = p_id;
    PERFORM set_config('app.system', 'off', true);
  ELSIF p_table = 'goods_receipts' THEN
    SELECT po_id INTO v_po FROM goods_receipts WHERE id = p_id;
    UPDATE bills SET deleted_at = now(), deleted_by = auth.uid(), delete_reason = 'Goods receipt deleted: ' || p_reason
     WHERE grn_id = p_id AND deleted_at IS NULL;
  END IF;

  EXECUTE format('UPDATE public.%I SET deleted_at = now(), deleted_by = $1, delete_reason = $2 WHERE id = $3 AND deleted_at IS NULL', p_table)
    USING auth.uid(), p_reason, p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Record not found or already deleted.'; END IF;
  IF p_table = 'transactions' THEN   -- transfers go as a pair
    UPDATE transactions t SET deleted_at = now(), deleted_by = auth.uid(), delete_reason = p_reason
    FROM transactions s WHERE s.id = p_id AND s.batch_id IS NOT NULL AND t.batch_id = s.batch_id AND t.id <> s.id
      AND t.category IN ('transfer_in', 'transfer_out') AND t.deleted_at IS NULL;
  END IF;
  IF v_po IS NOT NULL THEN PERFORM recalc_po(v_po); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.restore_record(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; v_po uuid;
BEGIN
  PERFORM require_fin();
  IF p_table NOT IN ('parties','teams','employees','machines','materials','job_types','expense_categories','projects','project_variations',
                     'money_accounts','transactions','cash_counts','material_requests','purchase_orders','goods_receipts','work_orders',
                     'bills','attendance','wage_adjustments') THEN
    RAISE EXCEPTION 'Restoring % is not allowed.', p_table;
  END IF;
  BEGIN
    EXECUTE format('UPDATE public.%I SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE id = $1 AND deleted_at IS NOT NULL', p_table) USING p_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Cannot restore: an active record with the same name/number/date already exists.';
  END;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Record not found or not deleted.'; END IF;
  IF p_table = 'goods_receipts' THEN
    UPDATE bills SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE grn_id = p_id AND delete_reason LIKE 'Goods receipt deleted:%';
    SELECT po_id INTO v_po FROM goods_receipts WHERE id = p_id;
    IF v_po IS NOT NULL THEN PERFORM recalc_po(v_po); END IF;
  ELSIF p_table = 'transactions' THEN
    UPDATE transactions t SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL
    FROM transactions s WHERE s.id = p_id AND s.batch_id IS NOT NULL AND t.batch_id = s.batch_id AND t.category IN ('transfer_in', 'transfer_out');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.list_deleted()
RETURNS TABLE (table_name text, id uuid, label text, deleted_at timestamptz, deleted_by_name text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM require_fin();
  RETURN QUERY
  SELECT x.t, x.id, x.label, x.deleted_at, p.full_name, x.reason FROM (
    SELECT 'parties'::text t, id, type::text || ': ' || name label, deleted_at, deleted_by, delete_reason reason FROM parties WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'employees', id, code || ' ' || name, deleted_at, deleted_by, delete_reason FROM employees WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'teams', id, name, deleted_at, deleted_by, delete_reason FROM teams WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'projects', id, code || ' ' || name, deleted_at, deleted_by, delete_reason FROM projects WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'project_variations', id, var_no || ' ' || description, deleted_at, deleted_by, delete_reason FROM project_variations WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'money_accounts', id, name, deleted_at, deleted_by, delete_reason FROM money_accounts WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'transactions', id, txn_no || ' ' || category::text || ' ₹' || amount, deleted_at, deleted_by, delete_reason FROM transactions WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'material_requests', id, req_no, deleted_at, deleted_by, delete_reason FROM material_requests WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'purchase_orders', id, po_no, deleted_at, deleted_by, delete_reason FROM purchase_orders WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'goods_receipts', id, grn_no, deleted_at, deleted_by, delete_reason FROM goods_receipts WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'work_orders', id, wo_no, deleted_at, deleted_by, delete_reason FROM work_orders WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'bills', id, bill_no || ' ₹' || total, deleted_at, deleted_by, delete_reason FROM bills WHERE deleted_at IS NOT NULL AND coalesce(delete_reason, '') NOT LIKE 'Goods receipt deleted:%'
    UNION ALL SELECT 'attendance', a.id, e.name || ' ' || a.work_date, a.deleted_at, a.deleted_by, a.delete_reason FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.deleted_at IS NOT NULL
    UNION ALL SELECT 'wage_adjustments', id, label || ' ₹' || amount, deleted_at, deleted_by, delete_reason FROM wage_adjustments WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'machines', id, name, deleted_at, deleted_by, delete_reason FROM machines WHERE deleted_at IS NOT NULL
    UNION ALL SELECT 'cash_counts', id, 'Cash count ' || count_date, deleted_at, deleted_by, delete_reason FROM cash_counts WHERE deleted_at IS NOT NULL
  ) x LEFT JOIN profiles p ON p.id = x.deleted_by
  ORDER BY x.deleted_at DESC;
END $$;

-- ---------- users (MD only) ----------
CREATE OR REPLACE FUNCTION public.set_user_role(p_user uuid, p_role app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_md() THEN RAISE EXCEPTION 'Only the MD can change roles.' USING ERRCODE = '42501'; END IF;
  IF p_user = auth.uid() AND p_role IS DISTINCT FROM 'md' THEN RAISE EXCEPTION 'You cannot remove your own MD role.'; END IF;
  IF p_role IS NULL THEN
    DELETE FROM user_roles WHERE user_id = p_user;
  ELSE
    INSERT INTO user_roles(user_id, role, assigned_by) VALUES (p_user, p_role, auth.uid())
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, assigned_by = auth.uid(), assigned_at = now();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_user_active(p_user uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_md() THEN RAISE EXCEPTION 'Only the MD can do this.' USING ERRCODE = '42501'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'You cannot deactivate yourself.'; END IF;
  UPDATE profiles SET active = p_active WHERE id = p_user;
END $$;

CREATE OR REPLACE FUNCTION public.list_users()
RETURNS TABLE (id uuid, full_name text, email text, phone text, active boolean, role app_role, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM require_fin();
  RETURN QUERY SELECT p.id, p.full_name, p.email, p.phone, p.active, ur.role, p.created_at
  FROM profiles p LEFT JOIN user_roles ur ON ur.user_id = p.id ORDER BY p.created_at;
END $$;

-- ---------- notifications ----------
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids bigint[] DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE notifications SET is_read = true
  WHERE (recipient_id = auth.uid() OR recipient_role = my_role()) AND (p_ids IS NULL OR id = ANY(p_ids));
END $$;
