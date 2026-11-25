-- =====================================================================
-- Brickweld ERP — 0001 schema
-- Fresh database. One cash book (transactions) is the single source of
-- truth for money. Bills are what we owe; payment_allocations link a
-- payment to the bills it settles. Attendance is always tied to a project.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------- enums ----------
CREATE TYPE public.app_role       AS ENUM ('md', 'accountant', 'supervisor');
CREATE TYPE public.party_type     AS ENUM ('client', 'supplier', 'contractor');
CREATE TYPE public.account_type   AS ENUM ('bank', 'petty_cash');
CREATE TYPE public.txn_direction  AS ENUM ('in', 'out');
CREATE TYPE public.txn_category   AS ENUM (
  -- money in
  'client_receipt', 'md_investment', 'other_income', 'transfer_in',
  -- money out
  'supplier_payment', 'contractor_payment', 'wage_payment', 'labour_advance',
  'expense', 'md_drawing', 'transfer_out'
);
CREATE TYPE public.pay_mode       AS ENUM ('cash', 'upi', 'neft', 'imps', 'rtgs', 'cheque', 'card', 'other');
CREATE TYPE public.bill_type      AS ENUM ('supplier', 'contractor');

-- ---------- helper: updated_at ----------
CREATE OR REPLACE FUNCTION public.tg_set_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

-- ---------- users ----------
CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text NOT NULL DEFAULT '',
  email       text,
  phone       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        public.app_role NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.company_settings (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name     text NOT NULL DEFAULT 'Brickweld Private Limited',
  address          text,
  gstin            text,
  phone            text,
  email            text,
  week_start       smallint NOT NULL DEFAULT 0 CHECK (week_start BETWEEN 0 AND 6), -- 0 = Sunday
  full_day_hours   numeric NOT NULL DEFAULT 8,
  ot_day_hours     numeric NOT NULL DEFAULT 12,
  half_day_hours   numeric NOT NULL DEFAULT 4,
  monthly_divisor  numeric NOT NULL DEFAULT 30 CHECK (monthly_divisor > 0),
  low_petty_cash_alert numeric NOT NULL DEFAULT 10000,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);

-- ---------- document numbers ----------
CREATE TABLE public.doc_counters (
  prefix  text PRIMARY KEY,
  last_no int NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.next_doc_no(p_prefix text, p_width int DEFAULT 4)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  INSERT INTO doc_counters(prefix, last_no) VALUES (p_prefix, 1)
  ON CONFLICT (prefix) DO UPDATE SET last_no = doc_counters.last_no + 1
  RETURNING last_no INTO v;
  RETURN p_prefix || '-' || lpad(v::text, p_width, '0');
END $$;

-- ---------- common column block (as a comment for readers) ----------
-- created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, delete_reason

-- ---------- masters ----------
CREATE TABLE public.parties (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           public.party_type NOT NULL,
  code           text,
  name           text NOT NULL CHECK (length(trim(name)) > 0),
  contact_person text,
  phone          text,
  email          text,
  gstin          text,
  address        text,
  notes          text,
  active         boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE UNIQUE INDEX parties_name_uq ON public.parties (type, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(trim(name)) > 0),
  leader_id  uuid,
  notes      text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE UNIQUE INDEX teams_name_uq ON public.teams (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.employees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL CHECK (length(trim(code)) > 0),
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  phone        text,
  team_id      uuid REFERENCES public.teams(id),
  designation  text,
  staff_type   text NOT NULL DEFAULT 'labour' CHECK (staff_type IN ('labour', 'staff')),
  wage_type    text NOT NULL DEFAULT 'daily'  CHECK (wage_type IN ('daily', 'monthly')),
  joined_on    date,
  active       boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE UNIQUE INDEX employees_code_uq ON public.employees (lower(code)) WHERE deleted_at IS NULL;
ALTER TABLE public.teams ADD CONSTRAINT teams_leader_fk FOREIGN KEY (leader_id) REFERENCES public.employees(id);

-- Sensitive employee data: finance roles only.
CREATE TABLE public.employee_private (
  employee_id       uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  aadhaar           text,
  bank_name         text,
  bank_account      text,
  ifsc              text,
  pf_no             text,
  esic_no           text,
  address           text,
  emergency_contact text,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);

-- Wage rate history. A new rate never changes past attendance.
CREATE TABLE public.employee_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  rate           numeric(12,2) NOT NULL CHECK (rate > 0),
  effective_from date NOT NULL,
  notes          text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  UNIQUE (employee_id, effective_from)
);

CREATE TABLE public.expense_categories (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX expense_categories_uq ON public.expense_categories (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.materials (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name     text NOT NULL,
  unit     text NOT NULL DEFAULT 'nos',
  category text,
  active   boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX materials_uq ON public.materials (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.job_types (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX job_types_uq ON public.job_types (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.machines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  reg_no     text,
  ownership  text NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned', 'hired')),
  project_id uuid,
  notes      text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);

-- ---------- projects ----------
CREATE TABLE public.projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL,
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  client_id    uuid REFERENCES public.parties(id),
  kind         text NOT NULL DEFAULT 'site' CHECK (kind IN ('site', 'office')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'on_hold', 'completed')),
  site_address text,
  start_date   date,
  end_date     date,
  progress     smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  notes        text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE UNIQUE INDEX projects_code_uq ON public.projects (lower(code)) WHERE deleted_at IS NULL;
ALTER TABLE public.machines ADD CONSTRAINT machines_project_fk FOREIGN KEY (project_id) REFERENCES public.projects(id);

-- Contract money: finance only.
CREATE TABLE public.project_financials (
  project_id     uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  contract_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  notes          text,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);

-- Quotations / variations on top of the base contract.
CREATE TABLE public.project_variations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id),
  var_no      text,
  var_date    date NOT NULL DEFAULT current_date,
  description text NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount <> 0),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);

-- ---------- money accounts & cash book ----------
CREATE TABLE public.money_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  type            public.account_type NOT NULL,
  bank_name       text,
  account_last4   text,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  opening_date    date NOT NULL DEFAULT current_date,
  active          boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE UNIQUE INDEX money_accounts_uq ON public.money_accounts (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_no              text,
  txn_date            date NOT NULL DEFAULT current_date,
  account_id          uuid NOT NULL REFERENCES public.money_accounts(id),
  direction           public.txn_direction NOT NULL,
  category            public.txn_category NOT NULL,
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),
  project_id          uuid REFERENCES public.projects(id),
  party_id            uuid REFERENCES public.parties(id),
  employee_id         uuid REFERENCES public.employees(id),
  team_id             uuid REFERENCES public.teams(id),
  expense_category_id uuid REFERENCES public.expense_categories(id),
  week_start          date,               -- wage payments: the week paid for
  mode                public.pay_mode NOT NULL DEFAULT 'cash',
  reference           text,
  description         text,
  batch_id            uuid,               -- transfers & team wage payments
  is_void             boolean NOT NULL DEFAULT false,
  void_reason         text, voided_at timestamptz, voided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text,
  CONSTRAINT txn_direction_matches CHECK (
    (direction = 'in'  AND category IN ('client_receipt', 'md_investment', 'other_income', 'transfer_in')) OR
    (direction = 'out' AND category IN ('supplier_payment', 'contractor_payment', 'wage_payment', 'labour_advance', 'expense', 'md_drawing', 'transfer_out'))
  ),
  CONSTRAINT txn_required_links CHECK (
    (category <> 'client_receipt'                         OR project_id IS NOT NULL) AND
    (category NOT IN ('supplier_payment', 'contractor_payment') OR party_id IS NOT NULL) AND
    (category NOT IN ('wage_payment', 'labour_advance')   OR employee_id IS NOT NULL) AND
    (category <> 'expense'                                OR expense_category_id IS NOT NULL)
  )
);
CREATE INDEX transactions_date_idx    ON public.transactions (txn_date DESC);
CREATE INDEX transactions_account_idx ON public.transactions (account_id);
CREATE INDEX transactions_project_idx ON public.transactions (project_id);
CREATE INDEX transactions_party_idx   ON public.transactions (party_id);
CREATE INDEX transactions_emp_idx     ON public.transactions (employee_id);
CREATE UNIQUE INDEX transactions_no_uq ON public.transactions (txn_no);

-- Daily petty cash count (cash closing).
CREATE TABLE public.cash_counts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES public.money_accounts(id),
  count_date   date NOT NULL,
  counted      numeric(14,2) NOT NULL CHECK (counted >= 0),
  book_balance numeric(14,2) NOT NULL,
  difference   numeric(14,2) GENERATED ALWAYS AS (counted - book_balance) STORED,
  notes        text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE UNIQUE INDEX cash_counts_uq ON public.cash_counts (account_id, count_date) WHERE deleted_at IS NULL;

-- ---------- materials ----------
CREATE TABLE public.material_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  req_no      text,
  project_id  uuid NOT NULL REFERENCES public.projects(id),
  req_date    date NOT NULL DEFAULT current_date,
  required_by date,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'ordered', 'rejected', 'closed')),
  notes       text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE TABLE public.material_request_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES public.material_requests(id) ON DELETE CASCADE,
  material_name text NOT NULL,
  unit          text NOT NULL DEFAULT 'nos',
  qty           numeric(14,3) NOT NULL CHECK (qty > 0),
  notes         text
);

CREATE TABLE public.purchase_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no         text,
  project_id    uuid NOT NULL REFERENCES public.projects(id),
  supplier_id   uuid NOT NULL REFERENCES public.parties(id),
  request_id    uuid REFERENCES public.material_requests(id),
  po_date       date NOT NULL DEFAULT current_date,
  expected_date date,
  status        text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'partial', 'received', 'closed', 'cancelled')),
  subtotal      numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount    numeric(14,2) NOT NULL DEFAULT 0,
  total         numeric(14,2) NOT NULL DEFAULT 0,
  terms         text,
  notes         text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE TABLE public.po_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  material_name text NOT NULL,
  unit          text NOT NULL DEFAULT 'nos',
  qty           numeric(14,3) NOT NULL CHECK (qty > 0),
  rate          numeric(14,2) NOT NULL CHECK (rate >= 0),
  gst_percent   numeric(5,2) NOT NULL DEFAULT 0 CHECK (gst_percent BETWEEN 0 AND 28),
  amount        numeric(14,2) GENERATED ALWAYS AS (round(qty * rate, 2)) STORED,
  tax           numeric(14,2) GENERATED ALWAYS AS (round(qty * rate * gst_percent / 100, 2)) STORED,
  sort_order    int NOT NULL DEFAULT 0
);

-- Goods receipt = quantities only. Money is on the bill it creates.
CREATE TABLE public.goods_receipts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_no      text,
  po_id       uuid REFERENCES public.purchase_orders(id),
  project_id  uuid NOT NULL REFERENCES public.projects(id),
  supplier_id uuid NOT NULL REFERENCES public.parties(id),
  grn_date    date NOT NULL DEFAULT current_date,
  challan_no  text,
  vehicle_no  text,
  notes       text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE TABLE public.grn_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id        uuid NOT NULL REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  po_item_id    uuid REFERENCES public.po_items(id),
  material_name text NOT NULL,
  unit          text NOT NULL DEFAULT 'nos',
  qty           numeric(14,3) NOT NULL CHECK (qty > 0)
);

-- ---------- contractors ----------
CREATE TABLE public.work_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_no             text,
  project_id        uuid NOT NULL REFERENCES public.projects(id),
  contractor_id     uuid NOT NULL REFERENCES public.parties(id),
  job_type_id       uuid REFERENCES public.job_types(id),
  description       text NOT NULL,
  wo_date           date NOT NULL DEFAULT current_date,
  start_date        date,
  end_date          date,
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  retention_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (retention_percent BETWEEN 0 AND 20),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  terms             text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);

-- ---------- bills (what we owe) ----------
CREATE TABLE public.bills (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no       text,
  bill_type     public.bill_type NOT NULL,
  party_id      uuid NOT NULL REFERENCES public.parties(id),
  project_id    uuid NOT NULL REFERENCES public.projects(id),
  vendor_ref    text,              -- supplier's own invoice number
  bill_date     date NOT NULL DEFAULT current_date,
  due_date      date,
  grn_id        uuid REFERENCES public.goods_receipts(id),
  work_order_id uuid REFERENCES public.work_orders(id),
  description   text,
  subtotal      numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount    numeric(14,2) NOT NULL DEFAULT 0,
  retention     numeric(14,2) NOT NULL DEFAULT 0 CHECK (retention >= 0),
  other_deductions numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  total         numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),   -- net payable
  is_void       boolean NOT NULL DEFAULT false,
  void_reason   text, voided_at timestamptz, voided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE UNIQUE INDEX bills_grn_uq ON public.bills (grn_id) WHERE grn_id IS NOT NULL AND deleted_at IS NULL AND NOT is_void;

CREATE TABLE public.bill_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id     uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  description text NOT NULL,
  unit        text,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  rate        numeric(14,2) NOT NULL CHECK (rate >= 0),
  gst_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (gst_percent BETWEEN 0 AND 28),
  amount      numeric(14,2) GENERATED ALWAYS AS (round(qty * rate, 2)) STORED,
  tax         numeric(14,2) GENERATED ALWAYS AS (round(qty * rate * gst_percent / 100, 2)) STORED,
  grn_item_id uuid REFERENCES public.grn_items(id),
  sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE public.payment_allocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  bill_id        uuid NOT NULL REFERENCES public.bills(id),
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid()
);
CREATE INDEX payment_allocations_bill_idx ON public.payment_allocations (bill_id);
CREATE INDEX payment_allocations_txn_idx  ON public.payment_allocations (transaction_id);

-- ---------- labour ----------
CREATE TABLE public.attendance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  project_id  uuid NOT NULL REFERENCES public.projects(id),
  work_date   date NOT NULL,
  in_time     text,
  out_time    text,
  day_value   numeric(3,1) NOT NULL CHECK (day_value IN (0, 0.5, 1, 1.5, 2)),
  is_leave    boolean NOT NULL DEFAULT false,
  notes       text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);
CREATE UNIQUE INDEX attendance_emp_day_uq ON public.attendance (employee_id, work_date) WHERE deleted_at IS NULL;
CREATE INDEX attendance_date_idx ON public.attendance (work_date);
CREATE INDEX attendance_project_idx ON public.attendance (project_id);

-- Bus/petrol, food etc. (allowance adds to pay) or fines (deduction).
CREATE TABLE public.wage_adjustments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  project_id  uuid REFERENCES public.projects(id),
  adj_date    date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('allowance', 'deduction')),
  label       text NOT NULL DEFAULT 'Bus/Petrol',
  amount      numeric(12,2) NOT NULL CHECK (amount > 0),
  notes       text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  deleted_at timestamptz, deleted_by uuid, delete_reason text
);

-- ---------- audit & notifications ----------
CREATE TABLE public.audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_name  text,
  actor_role  text,
  table_name  text NOT NULL,
  record_id   uuid,
  record_label text,
  action      text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore', 'void', 'unvoid')),
  reason      text,
  changes     jsonb,       -- {field: [old, new]} for updates
  old_data    jsonb,
  new_data    jsonb
);
CREATE INDEX audit_log_at_idx ON public.audit_log (at DESC);
CREATE INDEX audit_log_record_idx ON public.audit_log (table_name, record_id);

CREATE TABLE public.notifications (
  id             bigserial PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  recipient_role public.app_role,
  recipient_id   uuid,
  title          text NOT NULL,
  body           text,
  table_name     text,
  record_id      uuid,
  actor_name     text,
  is_read        boolean NOT NULL DEFAULT false,
  CHECK (recipient_role IS NOT NULL OR recipient_id IS NOT NULL)
);
CREATE INDEX notifications_role_idx ON public.notifications (recipient_role, is_read, created_at DESC);

-- ---------- updated_at triggers ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parties','teams','employees','employee_private','machines','projects','project_financials',
    'project_variations','money_accounts','transactions','material_requests','purchase_orders','goods_receipts',
    'work_orders','bills','attendance','wage_adjustments']
  LOOP
    EXECUTE format('CREATE TRIGGER set_updated BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated()', t);
  END LOOP;
END $$;
