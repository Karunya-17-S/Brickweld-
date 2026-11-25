"""Business flows driven through the real UI, checked against the database.
Usage: python3 tests/e2e/flows.py   (shim on :54321, DB 'bw' seeded by tests/db/workflow.test.mjs)"""
import os, re, subprocess
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://localhost:54321")
OUT = os.environ.get("OUT", "/tmp/e2e")
PW = "Test@12345"
passed, failed = 0, []

def sql(q):
    r = subprocess.run(["psql", "-h", "/tmp", "-p", "54329", "-U", "postgres", "-d", os.environ.get("PGDATABASE", "bw"), "-tAc", q], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()

def check(name, cond, detail=""):
    global passed
    if cond: passed += 1; print("  ✓", name)
    else: failed.append(name + (f" — {detail}" if detail else "")); print("  ✗", name, detail)

def pick(sel, text):
    """Choose the <option> whose label contains text."""
    val = sel.evaluate("(s, t) => { const o = [...s.options].find(o => o.text.includes(t)); return o ? o.value : null }", text)
    assert val is not None, f"no option containing {text!r}"
    sel.select_option(val)

def login(ctx, email):
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/login")
    page.fill("input[type=email]", email); page.fill("input[type=password]", PW)
    page.get_by_role("button", name=re.compile("sign in", re.I)).click()
    page.wait_for_url(re.compile(r"/(dashboard|attendance)"), timeout=15000)
    page.wait_for_load_state("networkidle")
    page._errs = errors
    return page

def dialog(page): return page.get_by_role("dialog")
def field(scope, label): return scope.locator("label", has_text=label).locator("input, select, textarea").first
def toast_ok(page, text):
    try: page.get_by_text(re.compile(text, re.I)).first.wait_for(timeout=6000); return True
    except Exception: return False

bal = lambda name: float(sql(f"SELECT balance FROM v_account_balances_admin WHERE name='{name}'") or 0)

with sync_playwright() as p:
    sql("""CREATE OR REPLACE VIEW v_account_balances_admin AS
           SELECT a.name, a.opening_balance + coalesce(sum(CASE WHEN t.direction='in' THEN t.amount ELSE -t.amount END) FILTER (WHERE NOT t.is_void AND t.deleted_at IS NULL),0) balance
           FROM money_accounts a LEFT JOIN transactions t ON t.account_id=a.id GROUP BY a.id""")
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    acc = login(b.new_context(viewport={"width": 1440, "height": 900}), "acc@bw.test")

    # ---- PDF #2: MD investment split 5L bank + 5L petty --------------------------------
    print("\nPDF 2 · MD investment split across bank and petty cash")
    bank0, petty0 = bal("Main Bank Account"), bal("Petty Cash")
    acc.goto(BASE + "/accounts?tab=capital"); acc.wait_for_load_state("networkidle")
    acc.get_by_role("button", name="MD investment").click()
    d = dialog(acc); expect(d).to_be_visible()
    d.get_by_text("+ Add another account").click()
    sels = d.locator("select").all(); amts = d.locator("input[inputmode=decimal], input[type=number]").all()
    pick(sels[0], "Main Bank"); amts[0].fill("500000")
    pick(sels[1], "Petty Cash"); amts[1].fill("500000")
    check("Total shows ₹10,00,000", "10,00,000" in d.inner_text())
    d.get_by_role("button", name="Save").click()
    check("Investment toast", toast_ok(acc, "Investment recorded"))
    acc.wait_for_load_state("networkidle")
    check("Bank +5L", abs(bal("Main Bank Account") - bank0 - 500000) < 0.01, f"{bank0}→{bal('Main Bank Account')}")
    check("Petty +5L", abs(bal("Petty Cash") - petty0 - 500000) < 0.01)
    acc.screenshot(path=f"{OUT}/flow_capital.png")

    # ---- PDF #3: GRN from a PO carries the PO's project & supplier ---------------------
    print("\nPDF 3 · Receive goods from a PO")
    po = sql("SELECT po.id||'|'||po.po_no||'|'||pr.name||'|'||s.name FROM purchase_orders po JOIN projects pr ON pr.id=po.project_id JOIN parties s ON s.id=po.supplier_id WHERE po.status IN ('issued','partial') AND po.deleted_at IS NULL LIMIT 1").split("|")
    if len(po) == 4:
        po_id, po_no, pname, sname = po
        bills0 = int(sql("SELECT count(*) FROM bills WHERE deleted_at IS NULL"))
        acc.goto(BASE + f"/materials?tab=po&id={po_id}"); acc.wait_for_load_state("networkidle")
        acc.get_by_role("button", name=re.compile("Receive goods")).last.click()
        d = dialog(acc); expect(d).to_be_visible(); acc.wait_for_load_state("networkidle"); acc.wait_for_timeout(400)
        txt = d.inner_text()
        check("GRN form shows the PO's project", pname in txt, pname)
        check("GRN form shows the PO's supplier", sname in txt, sname)
        qty_inputs = d.locator("tbody input").all()
        check("Pending lines listed", len(qty_inputs) > 0)
        if qty_inputs:
            qty_inputs[0].fill("1")
            d.locator("label", has_text="Challan").locator("input").fill("E2E-77") if d.locator("label", has_text="Challan").count() else None
            d.get_by_role("button", name="Save receipt").click()
            check("GRN saved toast", toast_ok(acc, "supplier bill created"))
            acc.wait_for_timeout(500)
            g = sql(f"SELECT g.project_id=po.project_id AND g.supplier_id=po.supplier_id FROM goods_receipts g JOIN purchase_orders po ON po.id=g.po_id WHERE g.po_id='{po_id}' ORDER BY g.created_at DESC LIMIT 1")
            check("Saved GRN has PO project & supplier", g == "t", g)
            check("Bill auto-created at PO rate", int(sql("SELECT count(*) FROM bills WHERE deleted_at IS NULL")) == bills0 + 1)
        acc.screenshot(path=f"{OUT}/flow_grn.png")
    else:
        check("An open PO exists for the GRN test", False)

    # ---- PDF #4: project filter never changes company-wide balances ---------------------
    print("\nPDF 4 · Filtered ledger vs company-wide balances")
    acc.goto(BASE + "/accounts?tab=overview"); acc.wait_for_load_state("networkidle")
    check("Cards labelled company-wide", acc.get_by_text("Company-wide balance").count() >= 2)
    acc.goto(BASE + "/accounts?tab=transactions"); acc.wait_for_load_state("networkidle")
    pick(acc.locator("label", has_text="Project").locator("select"), "CHECK Project")
    acc.wait_for_load_state("networkidle")
    check("Filter banner explains scope", acc.get_by_text(re.compile("always company-wide")).count() > 0)

    # ---- PDF #1: attendance tied to project; new projects appear ------------------------
    print("\nPDF 1 · Attendance against a newly created project")
    acc.goto(BASE + "/projects"); acc.wait_for_load_state("networkidle")
    acc.get_by_role("button", name=re.compile("New project|Project")).last.click()
    d = dialog(acc); expect(d).to_be_visible()
    field(d, "Project name").fill("E2E Villa Bagalur")
    if d.locator("label", has_text="Code").count(): field(d, "Code").fill("E2E-VB")
    if d.locator("label", has_text="Status").count():
        s = field(d, "Status"); s.select_option("active") if s.evaluate("e => e.tagName") == "SELECT" else None
    d.get_by_role("button", name="Save").click(); acc.wait_for_timeout(800)
    pid = sql("SELECT id FROM projects WHERE name='E2E Villa Bagalur'")
    check("Project created", bool(pid))
    acc.goto(BASE + "/attendance?view=sheet"); acc.wait_for_load_state("networkidle")
    site = acc.locator("label", has_text="Marking for site").locator("select")
    check("New project offered in attendance", site.evaluate("(s) => [...s.options].some(o => o.text.includes('E2E Villa'))"))
    pick(site, "E2E Villa"); acc.wait_for_load_state("networkidle")
    cell = acc.locator("tbody button[title='Click to mark']").first
    cell.click(); d = dialog(acc)
    d.get_by_role("button", name="Full", exact=True).click(); acc.wait_for_timeout(700)
    check("Attendance saved to the new project", int(sql(f"SELECT count(*) FROM attendance WHERE project_id='{pid}' AND deleted_at IS NULL")) == 1)
    # mark-all must not overwrite leave
    emp = sql("SELECT id FROM employees WHERE active AND deleted_at IS NULL ORDER BY name OFFSET 1 LIMIT 1")
    today = sql("SELECT current_date")
    sql(f"UPDATE attendance SET deleted_at=now(), delete_reason='e2e' WHERE employee_id='{emp}' AND work_date='{today}' AND deleted_at IS NULL")
    sql(f"INSERT INTO attendance(employee_id, project_id, work_date, day_value, is_leave) VALUES ('{emp}','{pid}','{today}',0,true)")
    acc.reload(); acc.wait_for_load_state("networkidle")
    acc.get_by_role("button", name="Mark all present").click()
    d = dialog(acc); d.get_by_role("button", name=re.compile(r"Mark \d+ worker")).click(); acc.wait_for_timeout(900)
    check("Leave kept after Mark all present", sql(f"SELECT is_leave FROM attendance WHERE employee_id='{emp}' AND work_date='{today}' AND deleted_at IS NULL") == "t")
    acc.screenshot(path=f"{OUT}/flow_attendance.png", full_page=True)

    # ---- Supplier payment from Payables reduces the bill ---------------------------------
    print("\nPay a supplier bill")
    bill = sql("SELECT id||'|'||bill_no||'|'||balance FROM v_bill_balances WHERE bill_type='supplier' AND balance>0 AND NOT is_void ORDER BY bill_date LIMIT 1").split("|")
    acc.goto(BASE + f"/accounts?tab=bills&id={bill[0]}"); acc.wait_for_load_state("networkidle")
    acc.get_by_role("button", name=re.compile(r"^Pay ₹")).click()
    d = dialog(acc); expect(d).to_be_visible(); acc.wait_for_timeout(400)
    pick(field(d, "Paid from"), "Main Bank")
    amt = field(d, "Amount"); amt.fill("1000")
    d.get_by_role("button", name=re.compile("^Save|Record")).last.click(); acc.wait_for_timeout(900)
    newbal = float(sql(f"SELECT balance FROM v_bill_balances WHERE id='{bill[0]}'"))
    check("Bill balance reduced by ₹1,000", abs(float(bill[2]) - newbal - 1000) < 0.01, f"{bill[2]} → {newbal}")
    acc.screenshot(path=f"{OUT}/flow_payment.png")

    # ---- Accountant delete → MD alert ----------------------------------------------------
    print("\nAccountant delete notifies MD")
    n0 = int(sql("SELECT count(*) FROM notifications WHERE recipient_role='md'"))
    acc.goto(BASE + "/accounts?tab=expenses"); acc.wait_for_load_state("networkidle")
    acc.get_by_role("button", name="Expense").last.click()
    d = dialog(acc)
    field(d, "Amount").fill("750"); pick(field(d, "Category"), ""); field(d, "Category").select_option(index=1)
    pick(field(d, "Paid from"), "Petty Cash"); field(d, "Description").fill("E2E tea & snacks")
    d.get_by_role("button", name="Save").click(); acc.wait_for_timeout(900)
    acc.get_by_text("E2E tea & snacks").first.click()
    acc.get_by_role("button", name="Delete").first.click()
    rd = dialog(acc).last; rd.locator("textarea, input").first.fill("Entered twice")
    rd.get_by_role("button", name="Delete").click(); acc.wait_for_timeout(900)
    check("Expense soft-deleted", sql("SELECT count(*) FROM transactions WHERE description='E2E tea & snacks' AND deleted_at IS NOT NULL") == "1")
    check("MD got a new alert", int(sql("SELECT count(*) FROM notifications WHERE recipient_role='md'")) > n0)
    check("No JS errors for accountant", not acc._errs, "; ".join(acc._errs[:3]))

    # ---- MD sees alert, restores, creates a user ----------------------------------------
    print("\nMD: alerts, restore, add user")
    md = login(b.new_context(viewport={"width": 1440, "height": 900}), "md@bw.test")
    md.goto(BASE + "/audit?tab=alerts"); md.wait_for_load_state("networkidle")
    check("Alert visible to MD", md.get_by_text(re.compile("E2E tea|deleted", re.I)).count() > 0)
    md.screenshot(path=f"{OUT}/flow_md_alerts.png")
    md.goto(BASE + "/audit?tab=deleted"); md.wait_for_load_state("networkidle")
    txn_no = sql("SELECT txn_no FROM transactions WHERE description='E2E tea & snacks'")
    md.locator("tr", has_text=txn_no).get_by_role("button", name="Restore").click(); md.wait_for_timeout(800)
    check("MD restored the expense", sql("SELECT count(*) FROM transactions WHERE description='E2E tea & snacks' AND deleted_at IS NULL") == "1")
    md.goto(BASE + "/settings?tab=users"); md.wait_for_load_state("networkidle")
    md.get_by_role("button", name="Add user").click()
    d = dialog(md)
    field(d, "Full name").fill("Murugan Site"); field(d, "Email").fill("murugan@bw.test")
    field(d, "Role").select_option("supervisor"); field(d, "Temporary password").fill(PW)
    d.get_by_role("button", name="Create").click(); md.wait_for_timeout(900)
    check("New supervisor created with role", sql("SELECT r.role FROM auth.users u JOIN user_roles r ON r.user_id=u.id WHERE u.email='murugan@bw.test'") == "supervisor")
    check("No JS errors for MD", not md._errs, "; ".join(md._errs[:3]))

    # ---- New supervisor logs in, marks attendance, can't reach money ---------------------
    print("\nSupervisor")
    sup = login(b.new_context(viewport={"width": 1440, "height": 900}), "murugan@bw.test")
    check("Supervisor lands on attendance", "/attendance" in sup.url)
    check("Site pre-selected for supervisor", sup.locator("tbody button").count() > 0)
    check("No wages tab for supervisor", sup.get_by_role("button", name="Wages & payments").count() == 0)
    sup.goto(BASE + "/accounts"); sup.wait_for_load_state("networkidle")
    check("Supervisor blocked from Accounts", "/accounts" not in sup.url or sup.get_by_text("Accounts & Cash").count() == 0)
    check("Supervisor reads no transactions (RLS)", sql("SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','" + sql("SELECT id FROM auth.users WHERE email='murugan@bw.test'") + "',false); SELECT count(*) FROM transactions").splitlines()[-1] == "0")
    sup.screenshot(path=f"{OUT}/flow_supervisor.png")
    check("No JS errors for supervisor", not sup._errs, "; ".join(sup._errs[:3]))
    b.close()

print(f"\n{passed} passed, {len(failed)} failed")
for f in failed: print("  ✗", f)
