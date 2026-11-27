# Brickweld — Projects · Accounts · Site

A fresh, Zoho-Books-style web app for Brickweld Private Limited. It replaces the old track-site app and uses a **new database**.

Stack: React 18 + TypeScript + Vite + Tailwind on the front end. Supabase (Postgres, Auth, one Edge Function) on the back end. Hosted on Vercel.

---

## 1. What is inside

| Menu | What it does |
|---|---|
| **Dashboard** | **MD:** the whole business at a glance:<br>• cash in bank and petty cash<br>• what clients owe<br>• what we owe suppliers and contractors<br>• profit on each project<br>• 6-month cash flow, biggest dues, things that need attention<br>**Accountant:** a separate work dashboard:<br>• balances and bills to pay<br>• wages due<br>• one-click Pay supplier / contractor / wages, transfers, MD investment<br>• no profit figures |
| **Projects** | Every site plus "Head Office". Each project has:<br>• contract value and variations<br>• client receipts<br>• labour, materials and contractors<br>• expenses and all money<br>• profit (finance roles only) |
| **Attendance** | Weekly grid per site (attendance is always saved against a project).<br>• Mark all present never overwrites leave or absent.<br>• Phone view: one day at a time, with big P / ½ / 1.5 / A / L buttons.<br>• Wage sheet: earned, bus/allowances, advances, paid, previous balance, balance due. Pay one worker or the whole team.<br>• Monthly register. |
| **Accounts & Cash** | Tabs:<br>• Bank & cash (company-wide balances)<br>• Cash book with running balance<br>• Payables (Zoho vendor list with Payables and Unused credits)<br>• Bills<br>• Receivables<br>• Expenses<br>• MD capital<br>• Cash count |
| **Materials** | Indent → Purchase order → Goods receipt (GRN) → Supplier bill → Payment.<br>• A GRN against a PO takes the project, supplier and rates from the PO and creates the bill automatically.<br>• PO print.<br>• Materials received per site. |
| **Contractors** | Work orders (value and retention %) → running bills → payments → balances. Shows billed %, retention held and due now. |
| **Masters** | Workers (with rate history), teams, clients, suppliers, contractors, materials, machines, job types, expense categories. |
| **Reports & P&L** | Profit & loss by project, client receivables, day book, bank/petty cash statement, expenses by category, payables ageing, supplier/contractor statement, purchase register, contractor work orders, wage register, attendance summary, materials received.<br>Every report prints to PDF and exports to Excel (CSV). |
| **Audit Log** | Who did what and when, with old → new values; MD alerts; deleted items with **Restore**. |
| **Settings** | Users & roles (MD adds logins here), company details and wage rules, bank & cash accounts with opening balances, my account / change password. |

### Who can do what

| | MD | Accountant | Site supervisor |
|---|---|---|---|
| MD dashboard (profit, company view) | ✅ | ❌ (own Accounts dashboard) | ❌ |
| Attendance, wages, advances | ✅ | ✅ | Attendance only |
| All money: bank, petty cash, bills, payments | ✅ | ✅ | ❌ |
| Materials | ✅ | ✅ | Indents + receive goods |
| Contractors, Masters, Audit log | ✅ | ✅ | ❌ |
| Edit / void / delete | ✅ | ✅ — **MD is alerted every time** | Own pending indents only |
| Add users, change roles | ✅ | ❌ | ❌ |
| Reports | All | All | Attendance + materials |

Roles are enforced **inside the database** (row-level security and checks in every function), not just by hiding menus. A supervisor cannot read money tables even through the API.

### How the money works (plain words)

- **One cash book.** Every rupee in or out of a bank or petty cash account is one entry in `transactions`. Balances are always calculated from it, so they can't drift.
- **Bills are what we owe.** A supplier bill comes from a GRN; a contractor bill comes from a work order.
- **Payments are applied to bills, like Zoho.** Any part of a payment not applied to a bill stays as **Unused credit** (an advance) and can be applied later.
- **Pending** = bill total − payments applied. It shows on Payables, Bills, each project, the dashboards and the ageing report.
- **Wages** come from attendance × the rate on that date. Rate changes never alter past weeks.
  - Balance due = previous balance + earned + allowances − deductions − advances − paid.
- **Void and delete.**
  - **Void** keeps the record but removes it from all balances. Use it for a wrong payment.
  - **Delete** hides the record. Both need a reason, both go to the audit log, and deleted items can be restored.
  - If the accountant (or a supervisor) edits, voids or deletes anything, the MD gets an alert.

### Fixes for the issues in the CHECK test PDF

1. **Projects missing in attendance.** Attendance is saved against a project ID. Every open project (and Head Office) appears in the site picker the moment it is created.
2. **MD Investment button and the ₹5L + ₹5L split.** MD capital → *MD investment* lets you split one investment across bank and petty cash. Tested: bank +5L, petty +5L.
3. **GRN from a PO showed the wrong project/supplier.** Receiving against a PO now takes the project, supplier, items and rates from the PO itself. The database ignores anything else sent.
4. **Filtered ledger vs Bank/Petty cards.** The balance cards are labelled *company-wide* and never change with filters. When the cash book is filtered by project, a banner says so.

---

## 2. Set up — step by step (first time)

You need: a Supabase account, a Vercel account, Node 18+ on your PC, and this folder.

### Step 1 — Create a new Supabase project
supabase.com → **New project** → name `brickweld`, region **Mumbai (ap-south-1)**, set a strong DB password → Create.

### Step 2 — Create the database (run the 6 migration files in order)

**Option A — SQL Editor (no tools needed):**
Supabase → **SQL Editor** → New query. Paste and **Run** each file in this exact order:

```
supabase/migrations/0001_schema.sql
supabase/migrations/0002_logic.sql
supabase/migrations/0003_audit_dashboard.sql
supabase/migrations/0004_security.sql
supabase/migrations/0005_seed.sql
supabase/migrations/0006_user_setup_fix.sql
```

Each one should say *Success*.

**Option B — Supabase CLI (PowerShell, inside this folder):**

```powershell
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

### Step 3 — Turn off public sign-up
Supabase → **Authentication → Providers → Email** → switch **off** "Allow new users to sign up" → Save.
Only the MD will create logins, from inside the app.

### Step 4 — Create the first MD login
1. Supabase → **Authentication → Users → Add user → Create new user**. Enter the MD's email and a password, and tick **Auto confirm user**.
2. **SQL Editor** → run this, with the MD's email in place of the example:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'md' FROM auth.users WHERE email = 'md@brickweld.in';
```

### Step 5 — Deploy the user-management function (needed for Settings → Add user)
This lets the MD add users and reset passwords from **Settings → Users**. It needs no secrets of your own, because Supabase provides them to the function automatically.

**Option A — Supabase dashboard (no tools needed):**
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Function name: `admin-users`. It must be exactly this.
3. Delete the sample code and paste the whole of `supabase/functions/admin-users/index.ts`.
4. Click **Deploy function**. Leave "Verify JWT" **on**.

**Option B — CLI (PowerShell, inside this folder):**
```powershell
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase functions deploy admin-users
```

### Step 6 — Put it on Vercel
1. Push this folder to a new GitHub repo, for example in `GraySolutions-org`:

```powershell
cd D:\GS\brickweld
git init
git add .
git commit -m "Brickweld v2 - fresh build"
git branch -M main
git remote add origin https://github.com/GraySolutions-org/brickweld.git
git push -u origin main
```

2. Vercel → **Add New → Project** → import the repo. The framework is detected as **Vite**.
3. **Environment Variables.** Add these from Supabase → Settings → API. They go **only here, never in code or chat**:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = the **anon public** key (never the service_role key)
4. **Deploy.** `vercel.json` already sends every route to the app, so refreshing `/accounts` works.
5. Supabase → **Authentication → URL Configuration** → set **Site URL** to your Vercel URL (needed for "Forgot password" emails).

### Step 7 — First login and setup (as MD)
1. **Settings → Company & wage rules:** company details, wage week start day, half/full/1.5-day hours.
2. **Settings → Bank & cash accounts:** set the **opening balance and date** for Main Bank Account and Petty Cash. Add more bank accounts if needed.
3. **Settings → Users & roles → Add user:** create the accountant and supervisor logins.
4. **Masters:** teams → workers (with daily rate) → clients, suppliers, contractors.
5. **Projects → New project:** for each running site, with contract value.

### Moving data from the old app
This is a new database, so nothing is copied automatically. The cleanest cut-over:
- Pick a start date, e.g. the 1st of next month.
- Enter opening bank and petty cash balances as on that date.
- Enter unpaid supplier and contractor bills as **opening bills**.
- Add masters and running projects (with amount already received as a client receipt).

If you want, the old data can be exported and loaded with a script. Ask before go-live.

---

## 3. Everyday use — quick guide

- **Supervisor (phone):** Attendance → site is pre-selected → tap the day → tap **P / ½ / 1.5 / A / L** for each worker, or **Mark all present**. Materials → **Indent** when material is needed → **Receive goods** when a lorry arrives (pick the PO; the bill is created automatically).
- **Accountant:**
  - Dashboard shows what to pay today.
  - **Pay wages:** Attendance → Wages & payments → *Pay wages* (whole team) or *Pay* (one worker).
  - **Pay a supplier:** Accounts → Payables → open the supplier → *Record payment* → choose bills (or leave unapplied as an advance).
  - **Petty cash top-up:** *Transfer* bank → petty cash.
  - **End of day:** Accounts → Cash count.
- **MD:**
  - Dashboard for the full picture; bell icon for alerts on edits and deletes.
  - Reports → *Profit & loss by project* for any period.
  - Audit Log → Deleted items to restore anything.

---

## 4. For developers

```powershell
npm install
copy .env.example .env      # fill in your Supabase URL + anon key
npm run dev                 # http://localhost:5173
npm run build               # type-check + production build
npm test                    # unit tests (day-value rules)
```

Tests that were run on this build (Linux, local Postgres 16):
- `tests/db/workflow.test.mjs` — **92 checks**: the whole CHECK scenario from the PDF plus role security, run against the real migrations.
- `tests/e2e/flows.py` — **30 checks** through the real UI in Chrome. Covers:
  - all four PDF issues;
  - attendance and leave;
  - paying a bill;
  - an accountant delete raising an MD alert, then the MD restoring it;
  - the MD adding a user;
  - that user's supervisor access and RLS.
- `tests/e2e/pages.py` — opens **every page and tab for every role** and fails on any JS error, failed API call or access leak.

`tests/e2e/shim.mjs` is a small local stand-in for Supabase, used **only for testing**. Never deploy it.

Folder map: `src/pages` (one file per menu), `src/components/forms` (all entry forms), `src/lib` (data access, formatting, roles), `supabase/migrations` (database), `supabase/functions/admin-users` (user management).
