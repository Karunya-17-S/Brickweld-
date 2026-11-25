// End-to-end business workflow + role security tests against a database built from
// supabase/migrations. Mirrors the 24 Nov CHECK accounting test and adds the rest.
// Usage: PGHOST=/tmp PGPORT=54329 PGDATABASE=bw node tests/db/workflow.test.mjs
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST || "/tmp", port: +(process.env.PGPORT || 54329),
  user: process.env.PGUSER || "postgres", database: process.env.PGDATABASE || "bw",
});
const U = {};
let pass = 0, fail = 0;
const failures = [];

async function admin(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function as(who, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE authenticated");
    await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [U[who] ?? ""]);
    const r = await c.query(sql, params.map(p => Array.isArray(p) ? JSON.stringify(p) : p));
    await c.query("COMMIT");
    return { rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { error: e.message.split("\n")[0] };
  } finally { c.release(); }
}
async function must(who, sql, params = []) {
  const r = await as(who, sql, params);
  if (r.error) throw new Error(`[${who}] ${sql.slice(0, 80)} → ${r.error}`);
  return r.rows;
}
const one = async (who, sql, params) => (await must(who, sql, params))[0];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); console.log("  ✗", name, detail ? "— " + detail : ""); }
}
const num = (x) => Number(x ?? 0);
const J = (x) => JSON.stringify(x);

// ---------- users ----------
for (const [k, email, name] of [["md", "md@bw.test", "Managing Director"], ["acc", "acc@bw.test", "Ravi Accountant"],
  ["sup", "sup@bw.test", "Suresh Supervisor"], ["new", "new@bw.test", "New Signup"]]) {
  const [u] = await admin("INSERT INTO auth.users(email, raw_user_meta_data) VALUES ($1,$2) RETURNING id", [email, { full_name: name }]);
  U[k] = u.id;
}
await admin("INSERT INTO user_roles(user_id, role) VALUES ($1,'md')", [U.md]);

console.log("\n1. Users & roles");
check("New sign-up gets a profile but no role", (await admin("SELECT count(*)::int n FROM user_roles WHERE user_id=$1", [U.new]))[0].n === 0);
await must("md", "SELECT set_user_role($1,'accountant')", [U.acc]);
await must("md", "SELECT set_user_role($1,'supervisor')", [U.sup]);
check("Accountant cannot change roles", !!(await as("acc", "SELECT set_user_role($1,'md')", [U.new])).error);
check("Supervisor cannot change roles", !!(await as("sup", "SELECT set_user_role($1,'md')", [U.sup])).error);
check("MD cannot remove own MD role", !!(await as("md", "SELECT set_user_role($1,'accountant')", [U.md])).error);
check("No-role user sees no projects", (await must("new", "SELECT count(*)::int n FROM projects"))[0].n === 0);
check("No-role user cannot save attendance", !!(await as("new", "SELECT save_attendance('[]'::jsonb)")).error);

console.log("\n2. Masters (Accountant)");
const bank = await one("acc", "SELECT id FROM money_accounts WHERE type='bank' LIMIT 1");
const petty = await one("acc", "SELECT id FROM money_accounts WHERE type='petty_cash' LIMIT 1");
const client = await one("acc", "INSERT INTO parties(type,name,phone) VALUES ('client','CHECK Client','9000000001') RETURNING id");
const sup = await one("acc", "INSERT INTO parties(type,name) VALUES ('supplier','CHECK Supplier') RETURNING id");
const con = await one("acc", "INSERT INTO parties(type,name) VALUES ('contractor','CHECK Contractor') RETURNING id");
const proj = await one("acc", "INSERT INTO projects(code,name,client_id) VALUES ('CHECK-241126','CHECK Project',$1) RETURNING id", [client.id]);
await must("acc", "INSERT INTO project_financials(project_id, contract_value) VALUES ($1, 500000)", [proj.id]);
const team = await one("acc", "INSERT INTO teams(name) VALUES ('CHECK Team 24Nov2026') RETURNING id");
const W = [];
for (let i = 1; i <= 5; i++) {
  const e = await one("acc", "INSERT INTO employees(code,name,team_id) VALUES ($1,$2,$3) RETURNING id", [`CHECK-L0${i}`, `CHECK Labour0${i}`, team.id]);
  await must("acc", "INSERT INTO employee_rates(employee_id, rate, effective_from) VALUES ($1,$2,'2026-11-01')", [e.id, 500 + i * 100]);
  W.push(e.id);
}
check("5 workers with rates 600..1000 saved", W.length === 5);
check("Duplicate worker code blocked", !!(await as("acc", "INSERT INTO employees(code,name) VALUES ('check-l01','dup')")).error);
check("Supervisor cannot add a supplier", !!(await as("sup", "INSERT INTO parties(type,name) VALUES ('supplier','x')")).error);

console.log("\n3. MD investment ₹5L bank + ₹5L petty (PDF issue 2)");
await must("acc", "INSERT INTO transactions(account_id,direction,category,amount,txn_date,description) VALUES ($1,'in','md_investment',500000,'2026-11-24','MD capital'),($2,'in','md_investment',500000,'2026-11-24','MD capital')", [bank.id, petty.id]);
let bal = await must("acc", "SELECT type, balance FROM v_account_balances ORDER BY type");
check("Bank ₹5,00,000 and Petty ₹5,00,000", num(bal.find(b => b.type === "bank").balance) === 500000 && num(bal.find(b => b.type === "petty_cash").balance) === 500000, J(bal));
check("Investment with wrong direction blocked", !!(await as("acc", "INSERT INTO transactions(account_id,direction,category,amount) VALUES ($1,'out','md_investment',10)", [bank.id])).error);

console.log("\n4. Materials: indent → PO → GRN → bill → payment (PDF: ₹1,20,000 / paid ₹1,00,000 / pending ₹20,000)");
const ind = await one("sup", "SELECT save_material_request(NULL, $1, $2) id", [{ project_id: proj.id, required_by: "2026-11-28" }, [{ material_name: "Cement OPC 53", unit: "bag", qty: 100 }]]);
check("Supervisor raised indent", !!ind.id);
check("Supervisor cannot approve indent", !!(await as("sup", "SELECT set_request_status($1,'approved')", [ind.id])).error);
await must("acc", "SELECT set_request_status($1,'approved')", [ind.id]);
const po = await one("acc", "SELECT save_purchase_order(NULL,$1,$2) id", [{ project_id: proj.id, supplier_id: sup.id, request_id: ind.id, po_date: "2026-11-24" }, [{ material_name: "Cement OPC 53", unit: "bag", qty: 100, rate: 1200, gst_percent: 0 }]]);
const poRow = await one("acc", "SELECT po_no, total, status FROM purchase_orders WHERE id=$1", [po.id]);
check("PO total ₹1,20,000, status issued", num(poRow.total) === 120000 && poRow.status === "issued", J(poRow));
check("Indent marked ordered", (await one("acc", "SELECT status FROM material_requests WHERE id=$1", [ind.id])).status === "ordered");
check("Supervisor cannot read POs (money)", (await must("sup", "SELECT count(*)::int n FROM purchase_orders"))[0].n === 0);
const open = await must("sup", "SELECT * FROM get_open_pos()");
check("Supervisor sees open PO list (no money)", open.length === 1 && !("total" in open[0]));
const lines = await must("sup", "SELECT * FROM get_po_lines_for_receipt($1)", [po.id]);
// PDF issue 3: wrong project/supplier passed in → PO values must win
const otherProj = await one("acc", "INSERT INTO projects(code,name) VALUES ('SHED-DK','Shed - Denkanikottai') RETURNING id");
const otherSup = await one("acc", "INSERT INTO parties(type,name) VALUES ('supplier','Naresh') RETURNING id");
check("Over-receipt (150 of 100) blocked", !!(await as("sup", "SELECT create_goods_receipt($1,$2,$3,'2026-11-25','CH-1',NULL,NULL,$4)", [po.id, otherProj.id, otherSup.id, J([{ po_item_id: lines[0].po_item_id, qty: 150 }])])).error);
const grn1 = await one("sup", "SELECT create_goods_receipt($1,$2,$3,'2026-11-25','CH-1','KA01',NULL,$4) id", [po.id, otherProj.id, otherSup.id, J([{ po_item_id: lines[0].po_item_id, qty: 60 }])]);
const g1 = await one("acc", "SELECT project_id, supplier_id FROM goods_receipts WHERE id=$1", [grn1.id]);
check("GRN from PO uses PO's project & supplier (PDF issue 3)", g1.project_id === proj.id && g1.supplier_id === sup.id);
check("PO status partial after 60/100", (await one("acc", "SELECT status FROM purchase_orders WHERE id=$1", [po.id])).status === "partial");
const grn2 = await one("sup", "SELECT create_goods_receipt($1,NULL,NULL,'2026-11-26','CH-2',NULL,NULL,$2) id", [po.id, J([{ po_item_id: lines[0].po_item_id, qty: 40 }])]);
check("PO status received after 100/100", (await one("acc", "SELECT status FROM purchase_orders WHERE id=$1", [po.id])).status === "received");
let bills = await must("acc", "SELECT id, total, balance, status FROM v_bill_balances WHERE party_id=$1 ORDER BY bill_date", [sup.id]);
check("Two supplier bills auto-created = ₹72,000 + ₹48,000", bills.length === 2 && num(bills[0].total) === 72000 && num(bills[1].total) === 48000, J(bills));
check("Supervisor cannot see bills", (await must("sup", "SELECT count(*)::int n FROM bills"))[0].n === 0);
check("Supervisor can see GRNs (qty only)", (await must("sup", "SELECT count(*)::int n FROM goods_receipts"))[0].n === 2);
const pay1 = await one("acc", "SELECT record_payment($1) id", [{ category: "supplier_payment", account_id: bank.id, txn_date: "2026-11-26", amount: 100000, party_id: sup.id, mode: "neft", reference: "CHECK-SUPPAY", allocations: [{ bill_id: bills[0].id, amount: 72000 }, { bill_id: bills[1].id, amount: 28000 }] }]);
let pb = await one("acc", "SELECT payables, unused_credits, total_billed FROM v_party_balances WHERE id=$1", [sup.id]);
check("Supplier pending ₹20,000 (PDF)", num(pb.payables) === 20000 && num(pb.unused_credits) === 0, J(pb));
const txnProj = await one("acc", "SELECT project_id FROM transactions WHERE id=$1", [pay1.id]);
check("Payment tagged with the bill's project", txnProj.project_id === proj.id);
check("Over-applying to a bill is blocked", !!(await as("acc", "SELECT record_payment($1)", [{ category: "supplier_payment", account_id: bank.id, amount: 30000, party_id: sup.id, allocations: [{ bill_id: bills[1].id, amount: 30000 }] }])).error);
check("Applying to another party's bill is blocked", !!(await as("acc", "SELECT record_payment($1)", [{ category: "contractor_payment", account_id: bank.id, amount: 10, party_id: con.id, allocations: [{ bill_id: bills[1].id, amount: 10 }] }])).error);

console.log("\n5. Contractors: WO → bill → payment (PDF: ₹20,000 / paid ₹15,000 / pending ₹5,000)");
const jt = await one("acc", "SELECT id FROM job_types LIMIT 1");
const wo = await one("acc", "INSERT INTO work_orders(project_id,contractor_id,job_type_id,description,amount) VALUES ($1,$2,$3,'Centering work',20000) RETURNING id", [proj.id, con.id, jt.id]);
const cb = await one("acc", "SELECT save_bill(NULL,$1,$2) id", [{ bill_type: "contractor", work_order_id: wo.id, bill_date: "2026-11-26", due_date: "2026-12-05" }, [{ description: "Centering 200 sqft", unit: "sqft", qty: 200, rate: 100 }]]);
const cbRow = await one("acc", "SELECT total, party_id, project_id FROM bills WHERE id=$1", [cb.id]);
check("Contractor bill ₹20,000 linked to WO's contractor & project", num(cbRow.total) === 20000 && cbRow.party_id === con.id && cbRow.project_id === proj.id, J(cbRow));
check("Billing over 110% of WO blocked", !!(await as("acc", "SELECT save_bill(NULL,$1,$2)", [{ bill_type: "contractor", work_order_id: wo.id }, [{ description: "extra", qty: 1, rate: 5000 }]])).error);
check("Negative bill line blocked", !!(await as("acc", "SELECT save_bill(NULL,$1,$2)", [{ bill_type: "supplier", party_id: sup.id, project_id: proj.id }, [{ description: "x", qty: 1, rate: -5 }]])).error);
await must("acc", "SELECT record_payment($1)", [{ category: "contractor_payment", account_id: bank.id, txn_date: "2026-11-27", amount: 15000, party_id: con.id, allocations: [{ bill_id: cb.id, amount: 15000 }] }]);
let cbal = await one("acc", "SELECT payables FROM v_party_balances WHERE id=$1", [con.id]);
check("Contractor pending ₹5,000 (PDF)", num(cbal.payables) === 5000, J(cbal));
const adv = await one("acc", "SELECT record_payment($1) id", [{ category: "contractor_payment", account_id: petty.id, amount: 8000, party_id: con.id, description: "Advance" }]);
cbal = await one("acc", "SELECT payables, unused_credits FROM v_party_balances WHERE id=$1", [con.id]);
check("Advance without bill shows as unused credit ₹8,000", num(cbal.unused_credits) === 8000, J(cbal));
check("Applying ₹8,000 credit to ₹5,000 due is blocked", !!(await as("acc", "SELECT apply_credit($1,$2)", [adv.id, J([{ bill_id: cb.id, amount: 8000 }])])).error);
await must("acc", "SELECT apply_credit($1,$2)", [adv.id, J([{ bill_id: cb.id, amount: 5000 }])]);
cbal = await one("acc", "SELECT payables, unused_credits FROM v_party_balances WHERE id=$1", [con.id]);
check("After applying credit: pending 0, credit ₹3,000", num(cbal.payables) === 0 && num(cbal.unused_credits) === 3000, J(cbal));

console.log("\n6. Attendance linked to project (PDF issue 1) & wages");
const wk = "2026-11-22"; // Sunday
const rows = [];
for (const d of ["2026-11-23", "2026-11-24", "2026-11-25"]) for (const e of W) rows.push({ employee_id: e, project_id: proj.id, work_date: d, in_time: "9", out_time: "6" });
rows[0].in_time = "6"; // worker1 Mon 6→6 = 1.5
let res = await one("sup", "SELECT save_attendance($1) r", [J(rows)]);
check("Supervisor saved 15 attendance rows", res.r.inserted === 15, J(res.r));
check("6→6 = 1.5 days", num((await one("sup", "SELECT day_value FROM attendance WHERE employee_id=$1 AND work_date='2026-11-23'", [W[0]])).day_value) === 1.5);
check("9→6 = 1 day", num((await one("sup", "SELECT day_value FROM attendance WHERE employee_id=$1 AND work_date='2026-11-24'", [W[0]])).day_value) === 1);
check("6.30 parsed as 6:30 (8:00→4.30 = 0.5? no → 8.5h = 1)", num((await one("acc", "SELECT calc_day_value('8','4.30') v")).v) === 1);
check("6→2 = 1 day", num((await one("acc", "SELECT calc_day_value('6','2') v")).v) === 1);
res = await one("sup", "SELECT save_attendance($1) r", [J([{ employee_id: W[1], project_id: proj.id, work_date: "2026-11-24", day_value: 1 }])]);
check("Re-saving same worker/day updates, no duplicate", (await one("acc", "SELECT count(*)::int n FROM attendance WHERE employee_id=$1 AND work_date='2026-11-24'", [W[1]])).n === 1);
await must("sup", "SELECT save_attendance($1)", [J([{ employee_id: W[4], project_id: proj.id, work_date: "2026-11-26", is_leave: true }])]);
res = await one("sup", "SELECT save_attendance($1, false) r", [J(W.map(e => ({ employee_id: e, project_id: proj.id, work_date: "2026-11-26", day_value: 1 })))]);
check("Mark-all without overwrite keeps the leave entry", res.r.skipped === 1 && res.r.inserted === 4, J(res.r));
check("Duplicate attendance blocked by DB", !!(await as("sup", "INSERT INTO attendance(employee_id,project_id,work_date,day_value) VALUES ($1,$2,'2026-11-26',1)", [W[0], proj.id])).error);
check("Supervisor cannot read wage rates", (await must("sup", "SELECT count(*)::int n FROM employee_rates"))[0].n === 0);
check("Supervisor gets no wage lines", (await must("sup", "SELECT count(*)::int n FROM v_wage_lines"))[0].n === 0);
check("Supervisor cannot open wage sheet", !!(await as("sup", "SELECT * FROM get_wage_sheet('2026-11-22')")).error);
let sheet = await must("acc", "SELECT * FROM get_wage_sheet($1,$2)", [wk, proj.id]);
const w1 = sheet.find(r => r.employee_id === W[0]);
// worker1: Mon 1.5 + Tue 1 + Wed 1 + Thu 1 = 4.5 days × 600 = 2700
check("Wage sheet: worker1 4.5 days × ₹600 = ₹2,700", num(w1.total_days) === 4.5 && num(w1.earned) === 2700, J({ d: w1.days, e: w1.earned }));
const w5 = sheet.find(r => r.employee_id === W[4]);
check("Worker on leave Thursday: 3 days × ₹1,000", num(w5.total_days) === 3 && num(w5.earned) === 3000, J(w5.days));
// rate change effective next week must not change this week
await must("acc", "INSERT INTO employee_rates(employee_id, rate, effective_from) VALUES ($1, 650, '2026-11-29')", [W[0]]);
sheet = await must("acc", "SELECT * FROM get_wage_sheet($1,$2)", [wk, proj.id]);
check("New rate from next week leaves this week at ₹2,700", num(sheet.find(r => r.employee_id === W[0]).earned) === 2700);
await must("acc", "INSERT INTO wage_adjustments(employee_id, project_id, adj_date, kind, label, amount) VALUES ($1,$2,'2026-11-25','allowance','Bus/Petrol',100)", [W[0], proj.id]);
await must("acc", "SELECT pay_wages($1,'2026-11-24',NULL,'cash',NULL,$2,$3,'labour_advance')", [petty.id, team.id, J([{ employee_id: W[0], amount: 500 }])]);
sheet = await must("acc", "SELECT * FROM get_wage_sheet($1,$2)", [wk, proj.id]);
let r1 = sheet.find(r => r.employee_id === W[0]);
check("Balance = 2700 + 100 bus − 500 advance = ₹2,300", num(r1.balance) === 2300, J(r1));
const teamPay = sheet.map(r => ({ employee_id: r.employee_id, amount: num(r.balance) }));
await must("acc", "SELECT pay_wages($1,'2026-11-29',$2,'cash','WK48',$3,$4)", [petty.id, wk, team.id, J(teamPay)]);
sheet = await must("acc", "SELECT * FROM get_wage_sheet($1,$2)", [wk, proj.id]);
check("After team payment every balance is 0", sheet.every(r => Math.abs(num(r.balance)) < 0.01), J(sheet.map(r => r.balance)));
const nextWeek = await must("acc", "SELECT * FROM get_wage_sheet('2026-11-29')");
check("Next week starts with previous balance 0", nextWeek.filter(r => W.includes(r.employee_id)).every(r => Math.abs(num(r.prev_balance)) < 0.01));
const totalLabour = teamPay.reduce((s, r) => s + r.amount, 0) + 500;
console.log("    (labour paid this week incl. advance: ₹" + totalLabour + ")");

console.log("\n7. Expenses, client receipt, transfer");
const fuel = await one("acc", "SELECT id FROM expense_categories WHERE name ILIKE 'Fuel%'");
const exp = await one("acc", "INSERT INTO transactions(account_id,direction,category,amount,project_id,expense_category_id,txn_date,description) VALUES ($1,'out','expense',2000,$2,$3,'2026-11-26','Diesel for mixer') RETURNING id", [petty.id, proj.id, fuel.id]);
check("Expense without category blocked", !!(await as("acc", "INSERT INTO transactions(account_id,direction,category,amount) VALUES ($1,'out','expense',50)", [petty.id])).error);
check("Supervisor cannot record expenses", !!(await as("sup", "INSERT INTO transactions(account_id,direction,category,amount,expense_category_id) VALUES ($1,'out','expense',50,$2)", [petty.id, fuel.id])).error);
await must("acc", "INSERT INTO transactions(account_id,direction,category,amount,project_id,party_id,txn_date,mode) VALUES ($1,'in','client_receipt',200000,$2,$3,'2026-11-27','neft')", [bank.id, proj.id, client.id]);
const before = await must("acc", "SELECT sum(balance) s FROM v_account_balances");
await must("acc", "SELECT transfer_funds($1,$2,10000,'2026-11-27','cash',NULL,NULL)", [bank.id, petty.id]);
const after = await must("acc", "SELECT sum(balance) s FROM v_account_balances");
check("Transfer keeps total cash unchanged", num(before[0].s) === num(after[0].s));

console.log("\n8. Balances reconcile");
bal = await must("acc", "SELECT type, opening_balance, total_in, total_out, balance FROM v_account_balances ORDER BY type");
const bankB = bal.find(b => b.type === "bank"), pettyB = bal.find(b => b.type === "petty_cash");
// bank: +500000 +200000 −100000 −15000 −10000 = 575000
check("Bank = ₹5,75,000", num(bankB.balance) === 575000, J(bankB));
// petty: +500000 +10000 −8000 −2000 −500 − wages
const wagesPaid = teamPay.reduce((s, r) => s + r.amount, 0);
check(`Petty = ₹${500000 + 10000 - 8000 - 2000 - 500 - wagesPaid}`, num(pettyB.balance) === 500000 + 10000 - 8000 - 2000 - 500 - wagesPaid, J(pettyB));
const ps = await one("acc", "SELECT * FROM v_project_summary WHERE id=$1", [proj.id]);
const expectLabour = sheet.reduce((s, r) => s + num(r.earned), 0) + 100;
check("Project cost = material ₹1,20,000 + contractor ₹20,000 + labour + ₹2,000 expense",
  num(ps.material_cost) === 120000 && num(ps.contractor_cost) === 20000 && Math.abs(num(ps.labour_cost) - expectLabour) < 0.01 && num(ps.other_expenses) === 2000,
  J({ m: ps.material_cost, c: ps.contractor_cost, l: ps.labour_cost, exp: expectLabour, e: ps.other_expenses }));
check("Project received ₹2,00,000, receivable ₹3,00,000", num(ps.received) === 200000 && num(ps.receivable) === 300000);
check("Supervisor cannot read project summary", (await must("sup", "SELECT count(*)::int n FROM v_project_summary"))[0].n === 0);
check("Supervisor cannot read contract value", (await must("sup", "SELECT count(*)::int n FROM project_financials"))[0].n === 0);
const cc = await one("acc", "INSERT INTO cash_counts(account_id, count_date, counted, book_balance) VALUES ($1, '2026-11-30', 100, 0) RETURNING book_balance, difference", [petty.id]);
check("Cash count computes book balance & difference", num(cc.book_balance) === num(pettyB.balance) && num(cc.difference) === 100 - num(pettyB.balance));

console.log("\n9. Dashboards");
const dmd = (await one("md", "SELECT get_dashboard() d")).d;
check("MD dashboard has projects with profit", Array.isArray(dmd.projects) && dmd.projects.some(p => p.code === "CHECK-241126" && "profit" in p));
check("MD dashboard cash total = bank + petty", num(dmd.cash.total) === num(bankB.balance) + num(pettyB.balance));
check("MD dashboard payables supplier ₹20,000", num(dmd.payables.supplier) === 20000, J(dmd.payables));
const dacc = (await one("acc", "SELECT get_dashboard() d")).d;
check("Accountant dashboard has no project profit section", dacc.role === "accountant" && !("projects" in dacc) && Array.isArray(dacc.workers_due));
check("Supervisor cannot open finance dashboard", !!(await as("sup", "SELECT get_dashboard()")).error);
check("Supervisor site summary works", !!(await one("sup", "SELECT get_site_summary() s")).s);

console.log("\n10. Edit / delete / void → MD notifications & audit");
await admin("DELETE FROM notifications");
await must("acc", "UPDATE transactions SET amount = 2500 WHERE id=$1", [exp.id]);
let nt = await admin("SELECT title, body FROM notifications");
check("Accountant edit → 1 MD notification", nt.length === 1 && /edited/.test(nt[0].title), J(nt));
await must("sup", "SELECT save_attendance($1)", [J([{ employee_id: W[2], project_id: proj.id, work_date: "2026-11-23", day_value: 0.5 }])]);
nt = await admin("SELECT title FROM notifications ORDER BY id");
check("Supervisor attendance edit → MD notified", nt.length === 2 && /attendance/.test(nt[1].title), J(nt));
check("MD reads notifications", (await must("md", "SELECT count(*)::int n FROM notifications"))[0].n === 2);
check("Accountant does not read MD notifications", (await must("acc", "SELECT count(*)::int n FROM notifications"))[0].n === 0);
check("Delete needs a reason", !!(await as("acc", "SELECT soft_delete('transactions',$1,'')", [exp.id])).error);
await must("acc", "SELECT soft_delete('transactions',$1,'Duplicate entry')", [exp.id]);
nt = await admin("SELECT title, body FROM notifications ORDER BY id");
check("Accountant delete → MD notified with reason", nt.length === 3 && /deleted/.test(nt[2].title) && /Duplicate/.test(nt[2].body), J(nt[2]));
check("Deleted entry hidden", (await must("acc", "SELECT count(*)::int n FROM transactions WHERE id=$1", [exp.id]))[0].n === 0);
check("Deleted entry listed for restore", (await must("acc", "SELECT * FROM list_deleted()")).some(d => d.id === exp.id));
await must("acc", "SELECT restore_record('transactions',$1)", [exp.id]);
check("Restored entry visible again", (await must("acc", "SELECT count(*)::int n FROM transactions WHERE id=$1", [exp.id]))[0].n === 1);
await admin("DELETE FROM notifications");
await must("acc", "SELECT void_record('transactions',$1,'Wrong bank')", [pay1.id]);
nt = await admin("SELECT title FROM notifications");
check("Void → exactly 1 MD notification", nt.length === 1 && /voided/.test(nt[0].title), J(nt));
pb = await one("acc", "SELECT payables FROM v_party_balances WHERE id=$1", [sup.id]);
check("Voided payment puts ₹1,20,000 back to pending", num(pb.payables) === 120000);
bal = await must("acc", "SELECT balance FROM v_account_balances WHERE type='bank'");
check("Voided payment returns ₹1,00,000 to bank", num(bal[0].balance) === 675000);
const audit = await must("acc", "SELECT action FROM audit_log WHERE record_id=$1 ORDER BY id", [pay1.id]);
check("Audit trail: create → void", J(audit.map(a => a.action)) === J(["create", "void"]), J(audit));
check("Bill with payments cannot be voided", !!(await as("acc", "SELECT void_record('bills',$1,'x')", [cb.id])).error);
check("PO with receipts cannot be deleted", !!(await as("acc", "SELECT soft_delete('purchase_orders',$1,'x')", [po.id])).error);
await must("acc", "SELECT soft_delete('goods_receipts',$1,'Wrong challan')", [grn2.id]);
check("Deleting unpaid GRN removes its bill & reopens PO", (await one("acc", "SELECT status FROM purchase_orders WHERE id=$1", [po.id])).status === "partial"
  && (await must("acc", "SELECT count(*)::int n FROM bills WHERE grn_id=$1", [grn2.id]))[0].n === 0);
check("Supervisor cannot delete payments", !!(await as("sup", "SELECT soft_delete('transactions',$1,'x')", [adv.id])).error);
check("Project with records cannot be deleted", !!(await as("acc", "SELECT soft_delete('projects',$1,'x')", [proj.id])).error);
check("Supervisor deletes own pending indent only", !!(await as("sup", "SELECT soft_delete('material_requests',$1,'x')", [ind.id])).error);

console.log("\n11. Direct purchase by supervisor waits for bill");
const dg = await one("sup", "SELECT create_goods_receipt(NULL,$1,$2,'2026-11-27','CH-9',NULL,NULL,$3) id", [proj.id, sup.id, J([{ material_name: "M-Sand", unit: "unit", qty: 2 }])]);
check("No bill yet for supervisor direct receipt", (await must("acc", "SELECT count(*)::int n FROM bills WHERE grn_id=$1", [dg.id]))[0].n === 0);
const gi = await must("acc", "SELECT id FROM grn_items WHERE grn_id=$1", [dg.id]);
await must("acc", "SELECT bill_goods_receipt($1,'2026-11-27',NULL,'INV-55',$2)", [dg.id, J([{ grn_item_id: gi[0].id, rate: 4500, gst_percent: 5 }])]);
check("Accountant bills it: 2 × 4500 + 5% = ₹9,450", num((await one("acc", "SELECT total FROM bills WHERE grn_id=$1", [dg.id])).total) === 9450);
check("Cannot bill the same receipt twice", !!(await as("acc", "SELECT bill_goods_receipt($1,NULL,NULL,NULL,'[]')", [dg.id])).error);

console.log("\n12. Search");
check("Search finds project by code", (await must("sup", "SELECT * FROM search_all('check-24')")).some(r => r.kind === "project"));
check("Supervisor search does not return bills", !(await must("sup", "SELECT * FROM search_all('BILL')")).some(r => r.kind === "bill"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + failures.join("\n - ")); }
await pool.end();
process.exit(fail ? 1 : 0);
