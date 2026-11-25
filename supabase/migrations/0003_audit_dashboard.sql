-- =====================================================================
-- Brickweld ERP — 0003 audit trail, MD notifications, dashboards, search
-- =====================================================================

-- System recalculations (bill totals, PO status) run with app.system = 'on' and are not logged as user edits.

CREATE OR REPLACE FUNCTION public.table_label(p_table text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_table
    WHEN 'parties' THEN 'Party' WHEN 'teams' THEN 'Team' WHEN 'employees' THEN 'Worker' WHEN 'employee_rates' THEN 'Wage rate'
    WHEN 'machines' THEN 'Machine' WHEN 'projects' THEN 'Project' WHEN 'project_financials' THEN 'Contract value'
    WHEN 'project_variations' THEN 'Variation' WHEN 'money_accounts' THEN 'Account' WHEN 'transactions' THEN 'Entry'
    WHEN 'cash_counts' THEN 'Cash count' WHEN 'material_requests' THEN 'Indent' WHEN 'purchase_orders' THEN 'Purchase order'
    WHEN 'goods_receipts' THEN 'Goods receipt' WHEN 'work_orders' THEN 'Work order' WHEN 'bills' THEN 'Bill'
    WHEN 'attendance' THEN 'Attendance' WHEN 'wage_adjustments' THEN 'Wage adjustment' WHEN 'company_settings' THEN 'Settings'
    WHEN 'employee_private' THEN 'Worker private details' WHEN 'payment_allocations' THEN 'Payment allocation'
    ELSE p_table END
$$;

CREATE OR REPLACE FUNCTION public.tg_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; n jsonb; act text; rsn text; diff jsonb := '{}'; k text; lbl text; rid uuid;
        r app_role; nm text; verb text;
BEGIN
  IF current_setting('app.system', true) = 'on' THEN RETURN NULL; END IF;
  n := to_jsonb(NEW);
  IF TG_OP = 'INSERT' THEN
    act := 'create';
  ELSE
    o := to_jsonb(OLD);
    IF (o->>'deleted_at') IS NULL AND (n->>'deleted_at') IS NOT NULL THEN act := 'delete'; rsn := n->>'delete_reason';
    ELSIF (o->>'deleted_at') IS NOT NULL AND (n->>'deleted_at') IS NULL THEN act := 'restore';
    ELSIF NOT coalesce((o->>'is_void')::boolean, false) AND coalesce((n->>'is_void')::boolean, false) THEN act := 'void'; rsn := n->>'void_reason';
    ELSIF coalesce((o->>'is_void')::boolean, false) AND NOT coalesce((n->>'is_void')::boolean, false) THEN act := 'unvoid';
    ELSE
      act := 'update';
      FOR k IN SELECT jsonb_object_keys(n) LOOP
        IF k NOT IN ('updated_at', 'updated_by', 'created_at', 'created_by') AND (o->k) IS DISTINCT FROM (n->k) THEN
          diff := diff || jsonb_build_object(k, jsonb_build_array(o->k, n->k));
        END IF;
      END LOOP;
      IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
    END IF;
  END IF;

  BEGIN rid := coalesce(n->>'id', n->>'project_id', n->>'employee_id')::uuid; EXCEPTION WHEN others THEN rid := NULL; END;
  lbl := coalesce(n->>'txn_no', n->>'po_no', n->>'grn_no', n->>'bill_no', n->>'wo_no', n->>'req_no', n->>'var_no');
  IF lbl IS NULL THEN
    IF TG_TABLE_NAME = 'attendance' THEN
      SELECT e.name || ' · ' || to_char((n->>'work_date')::date, 'DD Mon') INTO lbl FROM employees e WHERE e.id = (n->>'employee_id')::uuid;
    ELSIF TG_TABLE_NAME IN ('project_financials') THEN
      SELECT code || ' ' || name INTO lbl FROM projects WHERE id = rid;
    ELSIF TG_TABLE_NAME IN ('employee_rates', 'employee_private', 'wage_adjustments') THEN
      SELECT name INTO lbl FROM employees WHERE id = (n->>'employee_id')::uuid;
    ELSE
      lbl := trim(coalesce(n->>'code', '') || ' ' || coalesce(n->>'name', n->>'company_name', ''));
    END IF;
  END IF;

  r := my_role();
  SELECT full_name INTO nm FROM profiles WHERE id = auth.uid();

  INSERT INTO audit_log(actor_id, actor_name, actor_role, table_name, record_id, record_label, action, reason, changes, old_data, new_data)
  VALUES (auth.uid(), nm, r::text, TG_TABLE_NAME, rid, lbl, act, rsn,
          CASE WHEN act = 'update' THEN diff END,
          CASE WHEN TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'employee_private' THEN o END,
          CASE WHEN TG_TABLE_NAME <> 'employee_private' THEN n END);

  -- MD is told about every edit / delete / void / restore by Accountant or Supervisor.
  IF r IN ('accountant', 'supervisor') AND act <> 'create' THEN
    verb := CASE act WHEN 'update' THEN 'edited' WHEN 'delete' THEN 'deleted' WHEN 'void' THEN 'voided'
                     WHEN 'unvoid' THEN 'un-voided' WHEN 'restore' THEN 'restored' END;
    INSERT INTO notifications(recipient_role, title, body, table_name, record_id, actor_name)
    VALUES ('md',
      format('%s %s %s %s', coalesce(nm, 'Someone'), verb, lower(table_label(TG_TABLE_NAME)), coalesce(lbl, '')),
      CASE WHEN act = 'update' THEN 'Changed: ' || (SELECT string_agg(replace(x, '_', ' '), ', ') FROM jsonb_object_keys(diff) x)
           ELSE coalesce('Reason: ' || rsn, NULL) END,
      TG_TABLE_NAME, rid, nm);
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parties','teams','employees','employee_private','employee_rates','machines','projects','project_financials',
    'project_variations','money_accounts','transactions','cash_counts','material_requests','purchase_orders','goods_receipts',
    'work_orders','bills','attendance','wage_adjustments','company_settings']
  LOOP
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_audit()', t);
  END LOOP;
END $$;

-- Allocations are logged against their payment.
CREATE OR REPLACE FUNCTION public.tg_audit_alloc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a payment_allocations; t transactions; b bills; r app_role; nm text; txt text;
BEGIN
  a := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT * INTO t FROM transactions WHERE id = a.transaction_id;
  SELECT * INTO b FROM bills WHERE id = a.bill_id;
  IF t.id IS NULL OR current_setting('app.system', true) = 'on' THEN RETURN NULL; END IF;
  r := my_role(); SELECT full_name INTO nm FROM profiles WHERE id = auth.uid();
  txt := CASE WHEN TG_OP = 'DELETE' THEN 'Removed ₹' ELSE 'Applied ₹' END || a.amount || CASE WHEN TG_OP = 'DELETE' THEN ' from bill ' ELSE ' to bill ' END || b.bill_no;
  -- creation-time allocations (same transaction as the payment) are part of the "create"
  IF TG_OP = 'INSERT' AND t.created_at = now() THEN RETURN NULL; END IF;
  INSERT INTO audit_log(actor_id, actor_name, actor_role, table_name, record_id, record_label, action, changes)
  VALUES (auth.uid(), nm, r::text, 'transactions', t.id, t.txn_no, 'update', jsonb_build_object('allocation', jsonb_build_array(NULL, txt)));
  IF r IN ('accountant', 'supervisor') AND t.is_void = false THEN
    INSERT INTO notifications(recipient_role, title, body, table_name, record_id, actor_name)
    VALUES ('md', format('%s changed payment %s', coalesce(nm, 'Someone'), t.txn_no), txt, 'transactions', t.id, nm);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER audit_alloc AFTER INSERT OR DELETE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.tg_audit_alloc();

-- ---------- dashboards ----------
CREATE OR REPLACE FUNCTION public.get_dashboard(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to   date := coalesce(p_to, current_date);
  v_md   boolean := is_md();
  wk     date;
  s      company_settings;
  res    jsonb;
BEGIN
  PERFORM require_fin();
  SELECT * INTO s FROM company_settings WHERE id = 1;
  wk := current_date - ((extract(dow FROM current_date)::int - s.week_start + 7) % 7);

  res := jsonb_build_object(
    'role', CASE WHEN v_md THEN 'md' ELSE 'accountant' END,
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'week_start', wk,
    'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type, 'balance', balance) ORDER BY type, name)
                          FROM v_account_balances WHERE active), '[]'),
    'cash', (SELECT jsonb_build_object(
               'bank', coalesce(sum(balance) FILTER (WHERE type = 'bank'), 0),
               'petty', coalesce(sum(balance) FILTER (WHERE type = 'petty_cash'), 0),
               'total', coalesce(sum(balance), 0)) FROM v_account_balances WHERE active),
    'payables', (SELECT jsonb_build_object(
               'supplier', coalesce(sum(payables) FILTER (WHERE type = 'supplier'), 0),
               'contractor', coalesce(sum(payables) FILTER (WHERE type = 'contractor'), 0),
               'overdue', coalesce(sum(overdue), 0),
               'retention', coalesce(sum(retention_held), 0),
               'advances_given', coalesce(sum(unused_credits), 0)) FROM v_party_balances),
    'labour', (SELECT jsonb_build_object(
               'due', coalesce(sum(balance) FILTER (WHERE balance > 0), 0),
               'advance_outstanding', coalesce(-sum(balance) FILTER (WHERE balance < 0), 0),
               'workers_due', count(*) FILTER (WHERE balance > 0)) FROM v_labour_balances),
    'labour_week', (SELECT jsonb_build_object(
               'days', coalesce(sum(day_value), 0), 'earned', coalesce(sum(wage), 0), 'workers', count(DISTINCT employee_id))
               FROM v_wage_lines WHERE work_date BETWEEN wk AND wk + 6),
    'today_attendance', (SELECT jsonb_build_object('present', count(*) FILTER (WHERE day_value > 0), 'leave', count(*) FILTER (WHERE is_leave))
               FROM attendance WHERE work_date = current_date AND deleted_at IS NULL),
    'receivables', (SELECT jsonb_build_object('total', coalesce(sum(receivable) FILTER (WHERE status <> 'completed' OR receivable > 0), 0),
               'contract', coalesce(sum(contract_value), 0), 'received', coalesce(sum(received), 0)) FROM v_project_summary WHERE kind = 'site'),
    'period_totals', (SELECT jsonb_build_object(
               'money_in',  coalesce(sum(amount) FILTER (WHERE direction = 'in'  AND category NOT IN ('transfer_in')), 0),
               'money_out', coalesce(sum(amount) FILTER (WHERE direction = 'out' AND category NOT IN ('transfer_out')), 0),
               'client_receipts', coalesce(sum(amount) FILTER (WHERE category = 'client_receipt'), 0),
               'md_investment', coalesce(sum(amount) FILTER (WHERE category = 'md_investment'), 0),
               'md_drawing', coalesce(sum(amount) FILTER (WHERE category = 'md_drawing'), 0))
               FROM transactions WHERE NOT is_void AND deleted_at IS NULL AND txn_date BETWEEN v_from AND v_to),
    'spend_by_category', coalesce((SELECT jsonb_agg(jsonb_build_object('label', label, 'amount', amt) ORDER BY amt DESC) FROM (
               SELECT CASE category
                        WHEN 'supplier_payment' THEN 'Suppliers' WHEN 'contractor_payment' THEN 'Contractors'
                        WHEN 'wage_payment' THEN 'Wages' WHEN 'labour_advance' THEN 'Labour advances'
                        WHEN 'expense' THEN coalesce((SELECT name FROM expense_categories c WHERE c.id = t.expense_category_id), 'Expenses')
                        WHEN 'md_drawing' THEN 'MD drawings' END AS label, sum(amount) AS amt
               FROM transactions t WHERE direction = 'out' AND category <> 'transfer_out' AND NOT is_void AND deleted_at IS NULL
                 AND txn_date BETWEEN v_from AND v_to GROUP BY 1) z), '[]'),
    'cashflow', coalesce((SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon YY'), 'in', coalesce(i, 0), 'out', coalesce(o, 0)) ORDER BY m) FROM (
               SELECT gs AS m,
                 (SELECT sum(amount) FROM transactions WHERE direction = 'in' AND category <> 'transfer_in' AND NOT is_void AND deleted_at IS NULL AND date_trunc('month', txn_date) = gs) i,
                 (SELECT sum(amount) FROM transactions WHERE direction = 'out' AND category <> 'transfer_out' AND NOT is_void AND deleted_at IS NULL AND date_trunc('month', txn_date) = gs) o
               FROM generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') gs) z), '[]'),
    'top_payables', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', id, 'name', name, 'type', type, 'payables', payables, 'overdue', overdue) x
               FROM v_party_balances WHERE payables > 0 ORDER BY payables DESC LIMIT 6) z), '[]'),
    'recent', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', id, 'txn_no', txn_no, 'date', txn_date, 'category', category,
               'direction', direction, 'amount', amount, 'account', account_name,
               'who', coalesce(party_name, employee_name, team_name, expense_category, description), 'project', project_code, 'is_void', is_void) x
               FROM v_transactions ORDER BY txn_date DESC, created_at DESC LIMIT 8) z), '[]'),
    'alerts', jsonb_build_object(
               'grn_unbilled', (SELECT count(*) FROM goods_receipts g WHERE g.deleted_at IS NULL
                                 AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.grn_id = g.id AND b.deleted_at IS NULL AND NOT b.is_void)),
               'pending_indents', (SELECT count(*) FROM material_requests WHERE status = 'pending' AND deleted_at IS NULL),
               'open_pos', (SELECT count(*) FROM purchase_orders WHERE status IN ('issued', 'partial') AND deleted_at IS NULL),
               'overdue_bills', (SELECT count(*) FROM v_bill_balances WHERE status = 'overdue'),
               'low_petty', coalesce((SELECT jsonb_agg(jsonb_build_object('name', name, 'balance', balance)) FROM v_account_balances
                                       WHERE type = 'petty_cash' AND active AND balance < s.low_petty_cash_alert), '[]'),
               'cash_mismatch', (SELECT count(*) FROM cash_counts WHERE deleted_at IS NULL AND difference <> 0 AND count_date >= current_date - 30),
               'unread_notifications', (SELECT count(*) FROM notifications WHERE NOT is_read AND (recipient_role = my_role() OR recipient_id = auth.uid())))
  );

  IF v_md THEN
    res := res || jsonb_build_object(
      'projects', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'contract_value')::numeric DESC) FROM (
          SELECT jsonb_build_object('id', id, 'code', code, 'name', name, 'status', status, 'progress', progress, 'client', client_name,
            'contract_value', contract_value, 'received', received, 'receivable', receivable, 'material', material_cost,
            'contractor', contractor_cost, 'labour', labour_cost, 'expenses', other_expenses, 'cost', total_cost,
            'profit', contract_value - total_cost,
            'margin', CASE WHEN contract_value > 0 THEN round((contract_value - total_cost) / contract_value * 100, 1) END,
            'cash_position', received - total_cost + bills_pending) x
          FROM v_project_summary WHERE kind = 'site' AND status IN ('active', 'planning', 'on_hold')) z), '[]'),
      'office_cost', (SELECT coalesce(sum(total_cost), 0) FROM v_project_summary WHERE kind = 'office'),
      'company', (SELECT jsonb_build_object(
          'contract_value', coalesce(sum(contract_value), 0), 'cost', coalesce(sum(total_cost), 0),
          'profit', coalesce(sum(contract_value - total_cost), 0)) FROM v_project_summary WHERE kind = 'site' AND status <> 'completed')
    );
  ELSE
    res := res || jsonb_build_object(
      'overdue_bills', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', id, 'bill_no', bill_no, 'party', party_name, 'party_id', party_id,
          'due_date', due_date, 'balance', balance, 'bill_type', bill_type) x FROM v_bill_balances
          WHERE status IN ('overdue', 'unpaid', 'partial') ORDER BY due_date NULLS LAST, bill_date LIMIT 8) z), '[]'),
      'workers_due', coalesce((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('id', employee_id, 'name', name, 'team', team_name, 'balance', balance) x
          FROM v_labour_balances WHERE balance > 0 ORDER BY balance DESC LIMIT 8) z), '[]')
    );
  END IF;
  RETURN res;
END $$;

-- Supervisor home: site counts only, no money.
CREATE OR REPLACE FUNCTION public.get_site_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_staff();
  RETURN jsonb_build_object(
    'today_present', (SELECT count(*) FROM attendance WHERE work_date = current_date AND day_value > 0 AND deleted_at IS NULL),
    'today_leave', (SELECT count(*) FROM attendance WHERE work_date = current_date AND is_leave AND deleted_at IS NULL),
    'active_workers', (SELECT count(*) FROM employees WHERE active AND deleted_at IS NULL),
    'my_pending_indents', (SELECT count(*) FROM material_requests WHERE status = 'pending' AND deleted_at IS NULL AND created_by = auth.uid()),
    'open_pos', (SELECT count(*) FROM purchase_orders WHERE status IN ('issued', 'partial') AND deleted_at IS NULL));
END $$;

-- ---------- global search ----------
CREATE OR REPLACE FUNCTION public.search_all(q text)
RETURNS TABLE (kind text, id uuid, title text, subtitle text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE pat text := '%' || lower(trim(coalesce(q, ''))) || '%'; fin boolean := is_fin();
BEGIN
  PERFORM require_staff();
  IF length(trim(coalesce(q, ''))) < 2 THEN RETURN; END IF;
  RETURN QUERY
  (SELECT 'project', p.id, p.code || ' · ' || p.name, p.status FROM projects p WHERE p.deleted_at IS NULL AND (lower(p.name) LIKE pat OR lower(p.code) LIKE pat) LIMIT 5)
  UNION ALL
  (SELECT 'employee', e.id, e.name, e.code FROM employees e WHERE e.deleted_at IS NULL AND (lower(e.name) LIKE pat OR lower(e.code) LIKE pat) LIMIT 5)
  UNION ALL
  (SELECT x.type::text, x.id, x.name, coalesce(x.phone, '') FROM parties x WHERE x.deleted_at IS NULL AND lower(x.name) LIKE pat LIMIT 5)
  UNION ALL
  (SELECT 'indent', m.id, m.req_no, m.status FROM material_requests m WHERE m.deleted_at IS NULL AND lower(m.req_no) LIKE pat LIMIT 3)
  UNION ALL
  (SELECT 'grn', g.id, g.grn_no, to_char(g.grn_date, 'DD Mon YYYY') FROM goods_receipts g WHERE g.deleted_at IS NULL AND (lower(g.grn_no) LIKE pat OR lower(coalesce(g.challan_no, '')) LIKE pat) LIMIT 3)
  UNION ALL
  (SELECT 'po', po.id, po.po_no, po.status FROM purchase_orders po WHERE fin AND po.deleted_at IS NULL AND lower(po.po_no) LIKE pat LIMIT 3)
  UNION ALL
  (SELECT 'bill', b.id, b.bill_no, coalesce(b.vendor_ref, '') FROM bills b WHERE fin AND b.deleted_at IS NULL AND (lower(b.bill_no) LIKE pat OR lower(coalesce(b.vendor_ref, '')) LIKE pat) LIMIT 3)
  UNION ALL
  (SELECT 'work_order', w.id, w.wo_no, w.description FROM work_orders w WHERE fin AND w.deleted_at IS NULL AND (lower(w.wo_no) LIKE pat OR lower(w.description) LIKE pat) LIMIT 3)
  UNION ALL
  (SELECT 'transaction', t.id, t.txn_no, t.category::text || ' ₹' || t.amount FROM transactions t WHERE fin AND t.deleted_at IS NULL AND (lower(t.txn_no) LIKE pat OR lower(coalesce(t.reference, '')) LIKE pat) LIMIT 3);
END $$;
