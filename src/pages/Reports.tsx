import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Printer, Download, BarChart3, BookOpen, Clock, Users, ShoppingCart, HardHat, Receipt, Wallet, CalendarDays, Package, Landmark } from "lucide-react";
import { useList, type Row } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/perms";
import { inr, n, qty, fmtDate, todayISO, monthStart, monthEnd, addDays, parseISO, toISO, CATEGORY_LABEL, MODE_LABEL } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { Select, Input, MiniField, Loading, Empty, cx } from "@/components/ui";
import { ProjectSelect, PartySelect, AccountSelect, useProjects, useAccounts, useEmployees, useTeams } from "@/components/pickers";

type Key = "pnl" | "daybook" | "account" | "payables" | "receivables" | "wages" | "purchases" | "contractor" | "party" | "expenses" | "attendance" | "materials";
interface Def { key: Key; label: string; icon: ReactNode; fin: boolean; group: string }
const REPORTS: Def[] = [
  { key: "pnl", label: "Profit & loss by project", icon: <BarChart3 className="h-4 w-4" />, fin: true, group: "Business" },
  { key: "receivables", label: "Client receivables", icon: <Landmark className="h-4 w-4" />, fin: true, group: "Business" },
  { key: "daybook", label: "Day book", icon: <BookOpen className="h-4 w-4" />, fin: true, group: "Money" },
  { key: "account", label: "Bank / petty cash statement", icon: <Wallet className="h-4 w-4" />, fin: true, group: "Money" },
  { key: "expenses", label: "Expenses by category", icon: <Receipt className="h-4 w-4" />, fin: true, group: "Money" },
  { key: "payables", label: "Payables ageing", icon: <Clock className="h-4 w-4" />, fin: true, group: "Suppliers & contractors" },
  { key: "party", label: "Supplier / contractor statement", icon: <BookOpen className="h-4 w-4" />, fin: true, group: "Suppliers & contractors" },
  { key: "purchases", label: "Purchase register", icon: <ShoppingCart className="h-4 w-4" />, fin: true, group: "Suppliers & contractors" },
  { key: "contractor", label: "Contractor work orders", icon: <HardHat className="h-4 w-4" />, fin: true, group: "Suppliers & contractors" },
  { key: "wages", label: "Wage register", icon: <Users className="h-4 w-4" />, fin: true, group: "Labour" },
  { key: "attendance", label: "Attendance summary", icon: <CalendarDays className="h-4 w-4" />, fin: false, group: "Labour" },
  { key: "materials", label: "Materials received", icon: <Package className="h-4 w-4" />, fin: false, group: "Site" },
];

const PRESETS: [string, () => [string, string]][] = [
  ["This month", () => [monthStart(), monthEnd()]],
  ["Last month", () => { const d = parseISO(monthStart()); d.setDate(0); const e = toISO(d); return [monthStart(e), e]; }],
  ["This quarter", () => { const d = new Date(); const q = Math.floor(d.getMonth() / 3) * 3; const s = toISO(new Date(d.getFullYear(), q, 1)); const e = toISO(new Date(d.getFullYear(), q + 3, 0)); return [s, e]; }],
  ["This financial year", () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return [`${y}-04-01`, `${y + 1}-03-31`]; }],
  ["Last 7 days", () => [addDays(todayISO(), -6), todayISO()]],
  ["All time", () => ["2000-01-01", "2100-12-31"]],
];

export function ReportsPage() {
  const { role } = useAuth();
  const fin = can.money(role);
  const [sp, setSp] = useSearchParams();
  const list = REPORTS.filter(r => fin || !r.fin);
  const key = (list.find(r => r.key === sp.get("r"))?.key ?? list[0].key) as Key;
  const def = list.find(r => r.key === key)!;
  const [preset, setPreset] = useState(fin ? "This month" : "This month");
  const [[from, to], setRange] = useState<[string, string]>(() => PRESETS[0][1]());
  const [project, setProject] = useState("");
  const [party, setParty] = useState("");
  const [account, setAccount] = useState("");
  const [team, setTeam] = useState("");
  const [csv, setCsv] = useState<{ headers: string[]; rows: (string | number | null)[][] } | null>(null);
  const needsRange = !["receivables", "payables", "contractor"].includes(key);
  const groups = [...new Set(list.map(r => r.group))];
  const props = { from, to, project, party, account, team, setCsv };
  return (
    <div className="flex min-h-[calc(100vh-56px)]">
      <aside className="no-print w-64 shrink-0 border-r border-slate-200 bg-white py-4">
        <div className="px-5 pb-2 text-lg font-semibold">Reports</div>
        {groups.map(g => (
          <div key={g} className="mt-3">
            <div className="px-5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{g}</div>
            {list.filter(r => r.group === g).map(r => (
              <button key={r.key} onClick={() => setSp({ r: r.key })}
                className={cx("flex w-full items-center gap-2.5 px-5 py-2 text-left text-sm", r.key === key ? "bg-brand-50 font-medium text-brand-700" : "text-ink-700 hover:bg-slate-50")}>
                <span className={r.key === key ? "text-brand-600" : "text-ink-400"}>{r.icon}</span>{r.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <div className="min-w-0 flex-1">
        <div className="no-print flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-6 py-3">
          {needsRange && <>
            <MiniField label="Period"><Select className="w-44 py-1.5" value={preset} onChange={e => { setPreset(e.target.value); const p = PRESETS.find(x => x[0] === e.target.value); if (p) setRange(p[1]()); }}>
              {PRESETS.map(([l]) => <option key={l}>{l}</option>)}<option>Custom</option></Select></MiniField>
            <MiniField label="From"><Input type="date" className="w-40 py-1.5" value={from} onChange={e => { setPreset("Custom"); setRange([e.target.value, to]); }} /></MiniField>
            <MiniField label="To"><Input type="date" className="w-40 py-1.5" value={to} onChange={e => { setPreset("Custom"); setRange([from, e.target.value]); }} /></MiniField>
          </>}
          {["pnl", "daybook", "expenses", "wages", "purchases", "attendance", "materials", "contractor", "payables"].includes(key) && key !== "pnl" &&
            <MiniField label="Project"><ProjectSelect className="w-56 py-1.5" value={project} onChange={setProject} placeholder="All projects" /></MiniField>}
          {key === "party" && <MiniField label="Supplier / contractor"><PartyPick value={party} onChange={setParty} /></MiniField>}
          {key === "account" && <MiniField label="Account"><AccountSelect className="w-60 py-1.5" value={account} onChange={setAccount} placeholder="Choose account" showBalance={false} /></MiniField>}
          {["wages", "attendance"].includes(key) && <MiniField label="Team"><TeamPick value={team} onChange={setTeam} /></MiniField>}
          <div className="flex-1" />
          <button className="btn-secondary" disabled={!csv} onClick={() => csv && downloadCsv(`${key}_${from}_${to}`, csv.headers, csv.rows)}><Download className="h-4 w-4" /> Excel (CSV)</button>
          <button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / PDF</button>
        </div>
        <div className="p-6 print:p-0">
          <div className="rounded-lg border border-slate-200 bg-white print:border-0">
            <div className="border-b border-slate-200 px-6 py-5 text-center">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Brickweld Private Limited</div>
              <div className="mt-1 text-xl font-semibold">{def.label}</div>
              <div className="mt-0.5 text-sm text-ink-500">{needsRange ? (from === "2000-01-01" ? "All time" : `${fmtDate(from)} to ${fmtDate(to)}`) : `As on ${fmtDate(todayISO())}`}</div>
            </div>
            <div className="p-0">
              {key === "pnl" && <PnL {...props} />}
              {key === "receivables" && <ReceivablesR {...props} />}
              {key === "daybook" && <DayBook {...props} />}
              {key === "account" && <AccountStatement {...props} />}
              {key === "expenses" && <ExpensesR {...props} />}
              {key === "payables" && <Ageing {...props} />}
              {key === "party" && <PartyStatement {...props} />}
              {key === "purchases" && <Purchases {...props} />}
              {key === "contractor" && <ContractorWO {...props} />}
              {key === "wages" && <WageRegister {...props} />}
              {key === "attendance" && <AttendanceSummary {...props} />}
              {key === "materials" && <MaterialsR {...props} />}
            </div>
          </div>
          <div className="mt-2 text-right text-xs text-ink-400">Generated {new Date().toLocaleString("en-IN")}</div>
        </div>
      </div>
    </div>
  );
}

function PartyPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [t, setT] = useState<"supplier" | "contractor">("supplier");
  return <div className="flex gap-1"><Select className="w-32 py-1.5" value={t} onChange={e => { setT(e.target.value as "supplier"); onChange(""); }}><option value="supplier">Supplier</option><option value="contractor">Contractor</option></Select><PartySelect type={t} className="w-56 py-1.5" value={value} onChange={onChange} /></div>;
}
function TeamPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const teams = useTeams();
  return <Select className="w-44 py-1.5" value={value} onChange={e => onChange(e.target.value)}><option value="">All teams</option>{(teams.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>;
}

type P = { from: string; to: string; project: string; party: string; account: string; team: string; setCsv: (c: { headers: string[]; rows: (string | number | null)[][] } | null) => void };

// ---- generic report table -------------------------------------------------
interface RCol { h: string; v: (r: Row) => string | number | null | undefined; money?: boolean; num?: boolean; total?: boolean; bold?: boolean; cls?: (r: Row) => string | undefined }
function RTable({ cols, rows, setCsv, empty = "No data for this period", footer, rowCls }: { cols: RCol[]; rows: Row[]; setCsv: P["setCsv"]; empty?: string; footer?: ReactNode; rowCls?: (r: Row) => string | undefined }) {
  const sig = JSON.stringify([cols.map(c => c.h), rows]);
  useEffect(() => { setCsv({ headers: cols.map(c => c.h), rows: rows.map(r => cols.map(c => { const v = c.v(r); return v === undefined ? null : v; })) }); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig]);
  if (!rows.length) return <Empty title={empty} />;
  const right = (c: RCol) => c.money || c.num;
  return (
    <div className="overflow-x-auto print:overflow-visible">
    <table className="w-full text-[13px] print:text-[11px] [&_td]:px-3 [&_th]:px-3">
      <thead><tr className="bg-slate-50">{cols.map(c => <th key={c.h} className={cx("th", right(c) && "text-right")}>{c.h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i} className={cx("border-t border-slate-100 break-inside-avoid", rowCls?.(r))}>
          {cols.map(c => { const v = c.v(r); return <td key={c.h} className={cx("px-4 py-2", right(c) && "whitespace-nowrap text-right tabular-nums", c.bold && "font-semibold", c.cls?.(r))}>{c.money ? (v === null || v === undefined || v === "" ? "" : inr(v as number)) : c.num ? qty(v as number) : (v ?? "")}</td>; })}
        </tr>))}
      </tbody>
      {cols.some(c => c.total) && <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">{cols.map((c, i) => (
        <td key={c.h} className={cx("px-4 py-2.5", right(c) && "text-right tabular-nums")}>{c.total ? (c.money ? inr(rows.reduce((s, r) => s + n(c.v(r)), 0)) : qty(rows.reduce((s, r) => s + n(c.v(r)), 0))) : i === 0 ? "Total" : ""}</td>))}</tr></tfoot>}
      {footer}
    </table>
    </div>
  );
}

// ---- P&L ------------------------------------------------------------------
function PnL({ from, to, setCsv }: P) {
  const projects = useProjects();
  const fin = useList("project_financials", { select: "project_id,contract_value", order: [{ col: "project_id" }] });
  const tx = useList("v_transactions", { select: "id,category,amount,project_id,is_void,txn_date", gte: { txn_date: from }, lte: { txn_date: to }, inList: { category: ["client_receipt", "expense", "other_income"] } });
  const bills = useList("v_bill_balances", { select: "id,bill_type,project_id,subtotal,tax_amount,total,retention,other_deductions,is_void,bill_date,balance", gte: { bill_date: from }, lte: { bill_date: to } });
  const wages = useList("v_wage_lines", { select: "id,project_id,wage,day_value,work_date", gte: { work_date: from }, lte: { work_date: to } });
  const adj = useList("wage_adjustments", { select: "id,project_id,kind,amount,adj_date", gte: { adj_date: from }, lte: { adj_date: to } });
  const loading = [tx, bills, wages, adj, projects].some(q => q.isLoading);
  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    const get = (id: string | null) => { const k = id ?? "none"; if (!m.has(k)) { const p = (projects.data ?? []).find(x => x.id === id); m.set(k, { id: k, name: p ? `${p.name}` : "Company overhead (no project)", code: p?.code ?? "", kind: p?.kind ?? "office", contract: n((fin.data ?? []).find(f => f.project_id === id)?.contract_value), income: 0, material: 0, contractor: 0, labour: 0, expense: 0 }); } return m.get(k)!; };
    for (const t of tx.data ?? []) { if (t.is_void) continue; const r = get(t.project_id); if (t.category === "expense") r.expense += n(t.amount); else r.income += n(t.amount); }
    // costs on accrual: gross bill value (retention is still a cost, just paid later)
    for (const b of bills.data ?? []) { if (b.is_void) continue; const r = get(b.project_id); const v = n(b.subtotal) + n(b.tax_amount) - n(b.other_deductions); if (b.bill_type === "supplier") r.material += v; else r.contractor += v; }
    for (const w of wages.data ?? []) get(w.project_id).labour += n(w.wage);
    for (const a of adj.data ?? []) get(a.project_id).labour += a.kind === "allowance" ? n(a.amount) : -n(a.amount);
    return [...m.values()].map(r => ({ ...r, cost: r.material + r.contractor + r.labour + r.expense, profit: r.income - (r.material + r.contractor + r.labour + r.expense) } as Row))
      .filter(r => r.income || r.material || r.contractor || r.labour || r.expense)
      .sort((a, b) => (a.kind === "office" ? 1 : 0) - (b.kind === "office" ? 1 : 0) || b.income - a.income);
  }, [tx.data, bills.data, wages.data, adj.data, projects.data, fin.data]);
  if (loading) return <Loading />;
  const sites = rows.filter(r => r.kind !== "office");
  const office = rows.filter(r => r.kind === "office");
  const sum = (list: Row[], k: string) => list.reduce((s, r) => s + n(r[k]), 0);
  const siteProfit = sum(sites, "profit"), officeCost = sum(office, "cost") - sum(office, "income");
  return (
    <div>
      <RTable rows={sites} setCsv={setCsv} empty="No income or cost in this period"
        cols={[
          { h: "Project", v: r => r.code ? `${r.name} (${r.code})` : r.name, bold: true },
          { h: "Received from client", v: r => r.income, money: true, total: true },
          { h: "Material", v: r => r.material, money: true, total: true },
          { h: "Contractors", v: r => r.contractor, money: true, total: true },
          { h: "Labour", v: r => r.labour, money: true, total: true },
          { h: "Other expenses", v: r => r.expense, money: true, total: true },
          { h: "Total cost", v: r => r.cost, money: true, total: true },
          { h: "Profit / loss", v: r => r.profit, money: true, total: true, bold: true, cls: r => r.profit < 0 ? "text-red-600" : "text-emerald-700" },
          { h: "Margin", v: r => r.income ? `${Math.round(r.profit / r.income * 100)}%` : "—", num: false },
        ]} />
      <div className="ml-auto max-w-md space-y-1.5 border-t border-slate-200 p-6 text-sm">
        <div className="flex justify-between"><span>Profit from sites</span><span className="tabular-nums">{inr(siteProfit)}</span></div>
        <div className="flex justify-between"><span>Less: Head office & overhead (net)</span><span className="tabular-nums">− {inr(officeCost)}</span></div>
        <div className={cx("flex justify-between border-t border-slate-300 pt-2 text-base font-semibold", siteProfit - officeCost < 0 ? "text-red-600" : "text-emerald-700")}><span>Net profit / loss</span><span className="tabular-nums">{inr(siteProfit - officeCost)}</span></div>
        <div className="pt-2 text-xs text-ink-500">Income is cash received from clients in the period. Material and contractor costs are bills dated in the period (including GST and retention). Labour is wages earned from attendance plus allowances. MD investment, drawings and transfers are not income or cost.</div>
      </div>
    </div>
  );
}

function ReceivablesR({ setCsv }: P) {
  const list = useList("v_project_summary", { eq: { kind: "site" }, order: [{ col: "name" }] });
  if (list.isLoading) return <Loading />;
  return <RTable rows={(list.data ?? []).filter(r => n(r.contract_value) || n(r.received))} setCsv={setCsv}
    cols={[{ h: "Project", v: r => `${r.name} (${r.code})`, bold: true }, { h: "Client", v: r => r.client_name }, { h: "Status", v: r => r.status },
      { h: "Contract", v: r => r.base_contract, money: true, total: true }, { h: "Variations", v: r => r.variations, money: true, total: true },
      { h: "Total value", v: r => r.contract_value, money: true, total: true }, { h: "Received", v: r => r.received, money: true, total: true },
      { h: "To receive", v: r => r.receivable, money: true, total: true, bold: true }]} />;
}

function DayBook({ from, to, project, setCsv }: P) {
  const list = useList("v_transactions", { gte: { txn_date: from }, lte: { txn_date: to }, eq: { project_id: project || undefined }, order: [{ col: "txn_date" }, { col: "created_at" }] });
  if (list.isLoading) return <Loading />;
  const rows = (list.data ?? []).filter(r => !r.is_void);
  return <RTable rows={rows} setCsv={setCsv}
    cols={[{ h: "Date", v: r => fmtDate(r.txn_date) }, { h: "No.", v: r => r.txn_no }, { h: "Type", v: r => CATEGORY_LABEL[r.category] },
      { h: "Party / worker / category", v: r => r.party_name ?? r.employee_name ?? r.expense_category ?? r.team_name ?? "" }, { h: "Project", v: r => r.project_code },
      { h: "Account", v: r => r.account_name }, { h: "Mode", v: r => MODE_LABEL[r.mode] }, { h: "Notes", v: r => r.description },
      { h: "In", v: r => r.direction === "in" ? n(r.amount) : null, money: true, total: true, cls: () => "text-emerald-700" },
      { h: "Out", v: r => r.direction === "out" ? n(r.amount) : null, money: true, total: true }]} />;
}

function AccountStatement({ from, to, account, setCsv }: P) {
  const accounts = useAccounts();
  const acc = (accounts.data ?? []).find(a => a.id === account);
  const all = useList("v_transactions", { select: "id,txn_no,txn_date,category,direction,amount,is_void,party_name,employee_name,expense_category,description,project_code,reference,created_at", eq: { account_id: account }, lte: { txn_date: to }, order: [{ col: "txn_date" }, { col: "created_at" }], enabled: !!account });
  if (!account) return <Empty title="Choose a bank or petty cash account" />;
  if (all.isLoading || !acc) return <Loading />;
  const live = (all.data ?? []).filter(r => !r.is_void);
  const opening = n(acc.opening_balance) + live.filter(r => r.txn_date < from).reduce((s, r) => s + (r.direction === "in" ? n(r.amount) : -n(r.amount)), 0);
  let bal = opening;
  const rows = live.filter(r => r.txn_date >= from).map(r => { bal += r.direction === "in" ? n(r.amount) : -n(r.amount); return { ...r, bal }; });
  return (
    <div>
      <div className="flex justify-between border-b border-slate-100 bg-slate-50 px-6 py-2 text-sm"><span>{acc.name} — opening balance</span><b className="tabular-nums">{inr(opening)}</b></div>
      <RTable rows={rows} setCsv={setCsv} empty="No entries in this period"
        cols={[{ h: "Date", v: r => fmtDate(r.txn_date) }, { h: "No.", v: r => r.txn_no }, { h: "Type", v: r => CATEGORY_LABEL[r.category] },
          { h: "Detail", v: r => [r.party_name ?? r.employee_name ?? r.expense_category, r.description].filter(Boolean).join(" — ") }, { h: "Project", v: r => r.project_code },
          { h: "In", v: r => r.direction === "in" ? n(r.amount) : null, money: true, total: true }, { h: "Out", v: r => r.direction === "out" ? n(r.amount) : null, money: true, total: true },
          { h: "Balance", v: r => r.bal, money: true, bold: true }]} />
      <div className="flex justify-between border-t border-slate-200 px-6 py-3 text-sm font-semibold"><span>Closing balance</span><span className="tabular-nums">{inr(bal)}</span></div>
    </div>
  );
}

function ExpensesR({ from, to, project, setCsv }: P) {
  const list = useList("v_transactions", { select: "id,expense_category,amount,is_void,project_code,project_name", eq: { category: "expense", project_id: project || undefined }, gte: { txn_date: from }, lte: { txn_date: to } });
  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const t of list.data ?? []) { if (t.is_void) continue; const k = t.expense_category ?? "Other"; const r = m.get(k) ?? { cat: k, count: 0, amount: 0 }; r.count++; r.amount += n(t.amount); m.set(k, r); }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [list.data]);
  if (list.isLoading) return <Loading />;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return <RTable rows={rows} setCsv={setCsv} cols={[{ h: "Category", v: r => r.cat, bold: true }, { h: "Entries", v: r => r.count, num: true, total: true },
    { h: "Amount", v: r => r.amount, money: true, total: true }, { h: "Share", v: r => total ? `${(r.amount / total * 100).toFixed(1)}%` : "" }]} />;
}

function Ageing({ project, setCsv }: P) {
  const list = useList("v_bill_balances", { eq: { project_id: project || undefined }, order: [{ col: "bill_date" }] });
  const rows = useMemo(() => {
    const today = todayISO();
    const m = new Map<string, Row>();
    for (const b of list.data ?? []) {
      if (b.is_void || n(b.balance) <= 0.001) continue;
      const due = b.due_date ?? b.bill_date;
      const days = Math.floor((parseISO(today).getTime() - parseISO(due).getTime()) / 86400000);
      const bucket = days <= 0 ? "current" : days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "d90p";
      const r = m.get(b.party_id) ?? { name: b.party_name, type: b.bill_type, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 };
      r[bucket] += n(b.balance); r.total += n(b.balance); m.set(b.party_id, r);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [list.data]);
  if (list.isLoading) return <Loading />;
  return <RTable rows={rows} setCsv={setCsv} empty="Nothing pending — all bills are paid"
    cols={[{ h: "Supplier / contractor", v: r => r.name, bold: true }, { h: "Type", v: r => r.type }, { h: "Not yet due", v: r => r.current || null, money: true, total: true },
      { h: "1–30 days", v: r => r.d30 || null, money: true, total: true }, { h: "31–60 days", v: r => r.d60 || null, money: true, total: true },
      { h: "61–90 days", v: r => r.d90 || null, money: true, total: true }, { h: "Over 90 days", v: r => r.d90p || null, money: true, total: true, cls: () => "text-red-600" },
      { h: "Total due", v: r => r.total, money: true, total: true, bold: true }]} />;
}

function PartyStatement({ from, to, party, setCsv }: P) {
  const bills = useList("v_bill_balances", { select: "id,bill_no,bill_date,total,is_void,project_code,vendor_ref,party_name", eq: { party_id: party }, lte: { bill_date: to }, enabled: !!party });
  const pays = useList("v_transactions", { select: "id,txn_no,txn_date,amount,is_void,category,account_name,reference,project_code", eq: { party_id: party }, lte: { txn_date: to }, enabled: !!party });
  if (!party) return <Empty title="Choose a supplier or contractor" />;
  if (bills.isLoading || pays.isLoading) return <Loading />;
  const lines = [
    ...(bills.data ?? []).filter(b => !b.is_void).map(b => ({ date: b.bill_date, doc: b.bill_no, detail: `Bill${b.vendor_ref ? " · ref " + b.vendor_ref : ""}`, project: b.project_code, billed: n(b.total), paid: 0 })),
    ...(pays.data ?? []).filter(p => !p.is_void && ["supplier_payment", "contractor_payment"].includes(p.category)).map(p => ({ date: p.txn_date, doc: p.txn_no, detail: `Payment · ${p.account_name}${p.reference ? " · " + p.reference : ""}`, project: p.project_code, billed: 0, paid: n(p.amount) })),
  ].sort((a, b) => a.date.localeCompare(b.date) || b.billed - a.billed);
  const opening = lines.filter(l => l.date < from).reduce((s, l) => s + l.billed - l.paid, 0);
  let bal = opening;
  const rows = lines.filter(l => l.date >= from).map(l => { bal += l.billed - l.paid; return { ...l, bal }; });
  return (
    <div>
      <div className="flex justify-between border-b border-slate-100 bg-slate-50 px-6 py-2 text-sm"><span>{(bills.data ?? [])[0]?.party_name ?? ""} — opening balance</span><b className="tabular-nums">{inr(opening)}</b></div>
      <RTable rows={rows} setCsv={setCsv} empty="No bills or payments in this period"
        cols={[{ h: "Date", v: r => fmtDate(r.date) }, { h: "Document", v: r => r.doc }, { h: "Detail", v: r => r.detail }, { h: "Project", v: r => r.project },
          { h: "Billed", v: r => r.billed || null, money: true, total: true }, { h: "Paid", v: r => r.paid || null, money: true, total: true },
          { h: "Balance", v: r => r.bal, money: true, bold: true }]} />
      <div className="flex justify-between border-t border-slate-200 px-6 py-3 text-sm font-semibold"><span>{bal >= 0 ? "Balance payable" : "Advance with party"}</span><span className="tabular-nums">{inr(Math.abs(bal))}</span></div>
    </div>
  );
}

function Purchases({ from, to, project, setCsv }: P) {
  const list = useList("v_bill_balances", { eq: { bill_type: "supplier", project_id: project || undefined }, gte: { bill_date: from }, lte: { bill_date: to }, order: [{ col: "bill_date" }] });
  if (list.isLoading) return <Loading />;
  return <RTable rows={(list.data ?? []).filter(b => !b.is_void)} setCsv={setCsv}
    cols={[{ h: "Date", v: r => fmtDate(r.bill_date) }, { h: "Bill", v: r => r.bill_no }, { h: "Supplier ref", v: r => r.vendor_ref }, { h: "Supplier", v: r => r.party_name },
      { h: "Project", v: r => r.project_code }, { h: "GRN", v: r => r.grn_no }, { h: "Taxable", v: r => r.subtotal, money: true, total: true }, { h: "GST", v: r => r.tax_amount, money: true, total: true },
      { h: "Total", v: r => r.total, money: true, total: true, bold: true }, { h: "Paid", v: r => r.paid, money: true, total: true }, { h: "Balance", v: r => r.balance, money: true, total: true }]} />;
}

function ContractorWO({ project, setCsv }: P) {
  const wos = useList("work_orders", { eq: { project_id: project || undefined }, order: [{ col: "wo_date" }] });
  const bills = useList("v_bill_balances", { select: "work_order_id,subtotal,tax_amount,paid,balance,retention,is_void", eq: { bill_type: "contractor" } });
  const projects = useProjects();
  const parties = useList("parties", { select: "id,name", eq: { type: "contractor" } });
  if (wos.isLoading || bills.isLoading) return <Loading />;
  const rows = (wos.data ?? []).filter(w => w.status !== "cancelled").map(w => {
    const b = (bills.data ?? []).filter(x => x.work_order_id === w.id && !x.is_void);
    const billed = b.reduce((s, x) => s + n(x.subtotal) + n(x.tax_amount), 0);
    return { ...w, contractor: (parties.data ?? []).find(p => p.id === w.contractor_id)?.name, project: (projects.data ?? []).find(p => p.id === w.project_id)?.code,
      billed, paid: b.reduce((s, x) => s + n(x.paid), 0), due: b.reduce((s, x) => s + n(x.balance), 0), retention: b.reduce((s, x) => s + n(x.retention), 0), unbilled: Math.max(0, n(w.amount) - billed) };
  });
  return <RTable rows={rows} setCsv={setCsv} empty="No work orders"
    cols={[{ h: "WO", v: r => r.wo_no }, { h: "Contractor", v: r => r.contractor, bold: true }, { h: "Project", v: r => r.project }, { h: "Work", v: r => r.description }, { h: "Status", v: r => r.status },
      { h: "WO value", v: r => r.amount, money: true, total: true }, { h: "Billed", v: r => r.billed, money: true, total: true }, { h: "Yet to bill", v: r => r.unbilled, money: true, total: true },
      { h: "Paid", v: r => r.paid, money: true, total: true }, { h: "Retention held", v: r => r.retention, money: true, total: true }, { h: "Due now", v: r => r.due, money: true, total: true, bold: true }]} />;
}

function WageRegister({ from, to, project, team, setCsv }: P) {
  const emps = useEmployees();
  const teams = useTeams();
  const lines = useList("v_wage_lines", { select: "id,employee_id,project_id,day_value,wage,work_date", gte: { work_date: from }, lte: { work_date: to }, eq: { project_id: project || undefined } });
  const adj = useList("wage_adjustments", { select: "id,employee_id,kind,amount,project_id", gte: { adj_date: from }, lte: { adj_date: to } });
  const tx = useList("v_transactions", { select: "id,employee_id,category,amount,is_void", inList: { category: ["wage_payment", "labour_advance"] }, gte: { txn_date: from }, lte: { txn_date: to } });
  const rows = useMemo(() => (emps.data ?? []).filter(e => !team || e.team_id === team).map(e => {
    const l = (lines.data ?? []).filter(x => x.employee_id === e.id);
    const a = (adj.data ?? []).filter(x => x.employee_id === e.id && (!project || x.project_id === project || !x.project_id));
    const t = (tx.data ?? []).filter(x => x.employee_id === e.id && !x.is_void);
    const earned = l.reduce((s, x) => s + n(x.wage), 0), allow = a.filter(x => x.kind === "allowance").reduce((s, x) => s + n(x.amount), 0), ded = a.filter(x => x.kind === "deduction").reduce((s, x) => s + n(x.amount), 0);
    const adv = t.filter(x => x.category === "labour_advance").reduce((s, x) => s + n(x.amount), 0), paid = t.filter(x => x.category === "wage_payment").reduce((s, x) => s + n(x.amount), 0);
    return { code: e.code, name: e.name, team: (teams.data ?? []).find(x => x.id === e.team_id)?.name ?? "", days: l.reduce((s, x) => s + n(x.day_value), 0), earned, allow, ded, adv, paid, net: earned + allow - ded - adv - paid };
  }).filter(r => r.days || r.allow || r.ded || r.adv || r.paid), [emps.data, teams.data, lines.data, adj.data, tx.data, team, project]);
  if (lines.isLoading || emps.isLoading) return <Loading />;
  return (
    <div>
      <RTable rows={rows} setCsv={setCsv} empty="No wages in this period"
        cols={[{ h: "Code", v: r => r.code }, { h: "Worker", v: r => r.name, bold: true }, { h: "Team", v: r => r.team }, { h: "Days", v: r => r.days, num: true, total: true },
          { h: "Earned", v: r => r.earned, money: true, total: true }, { h: "Allowances", v: r => r.allow, money: true, total: true }, { h: "Deductions", v: r => r.ded, money: true, total: true },
          { h: "Advances", v: r => r.adv, money: true, total: true }, { h: "Paid", v: r => r.paid, money: true, total: true },
          { h: "Net for period", v: r => r.net, money: true, total: true, bold: true, cls: r => r.net < 0 ? "text-amber-700" : undefined }]} />
      <div className="px-6 py-3 text-xs text-ink-500">Net for period = earned + allowances − deductions − advances − paid, for this period only. Running balances (including earlier weeks) are on Attendance → Wages.{project ? " Payments and advances are not tagged to sites, so they show company-wide for each worker." : ""}</div>
    </div>
  );
}

function AttendanceSummary({ from, to, project, team, setCsv }: P) {
  const emps = useEmployees();
  const teams = useTeams();
  const projects = useProjects();
  const att = useList("attendance", { select: "id,employee_id,project_id,day_value,is_leave,work_date", gte: { work_date: from }, lte: { work_date: to }, eq: { project_id: project || undefined } });
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const e of emps.data ?? []) {
      if (team && e.team_id !== team) continue;
      const a = (att.data ?? []).filter(x => x.employee_id === e.id);
      if (!a.length) continue;
      const bySite = [...new Set(a.map(x => x.project_id))].map(id => (projects.data ?? []).find(p => p.id === id)?.code).filter(Boolean).join(", ");
      out.push({ code: e.code, name: e.name, team: (teams.data ?? []).find(t => t.id === e.team_id)?.name ?? "", sites: bySite,
        present: a.filter(x => !x.is_leave && n(x.day_value) > 0).length, half: a.filter(x => n(x.day_value) === 0.5).length, ot: a.filter(x => n(x.day_value) > 1).length,
        absent: a.filter(x => !x.is_leave && n(x.day_value) === 0).length, leave: a.filter(x => x.is_leave).length, days: a.reduce((s, x) => s + n(x.day_value), 0) });
    }
    return out;
  }, [emps.data, teams.data, att.data, projects.data, team]);
  if (att.isLoading) return <Loading />;
  return <RTable rows={rows} setCsv={setCsv} empty="No attendance in this period"
    cols={[{ h: "Code", v: r => r.code }, { h: "Worker", v: r => r.name, bold: true }, { h: "Team", v: r => r.team }, { h: "Sites", v: r => r.sites },
      { h: "Days present", v: r => r.present, num: true, total: true }, { h: "Half days", v: r => r.half, num: true, total: true }, { h: "Overtime days", v: r => r.ot, num: true, total: true },
      { h: "Absent", v: r => r.absent, num: true, total: true }, { h: "Leave", v: r => r.leave, num: true, total: true }, { h: "Man-days", v: r => r.days, num: true, total: true, bold: true }]} />;
}

function MaterialsR({ from, to, project, setCsv }: P) {
  const grns = useList("goods_receipts", { select: "id,grn_no,grn_date,project_id,supplier_id,challan_no", gte: { grn_date: from }, lte: { grn_date: to }, eq: { project_id: project || undefined }, order: [{ col: "grn_date" }] });
  const items = useList("grn_items", { inList: { grn_id: (grns.data ?? []).map(g => g.id) }, enabled: !!grns.data?.length });
  const projects = useProjects();
  const parties = useList("parties", { select: "id,name", eq: { type: "supplier" } });
  if (grns.isLoading) return <Loading />;
  const rows = (items.data ?? []).map(i => { const g = (grns.data ?? []).find(x => x.id === i.grn_id)!; return { date: g.grn_date, grn: g.grn_no, project: (projects.data ?? []).find(p => p.id === g.project_id)?.code, supplier: (parties.data ?? []).find(p => p.id === g.supplier_id)?.name, challan: g.challan_no, material: i.material_name, qty: n(i.qty), unit: i.unit }; })
    .sort((a, b) => a.date.localeCompare(b.date));
  return <RTable rows={rows} setCsv={setCsv} empty="No materials received in this period"
    cols={[{ h: "Date", v: r => fmtDate(r.date) }, { h: "GRN", v: r => r.grn }, { h: "Project", v: r => r.project }, { h: "Supplier", v: r => r.supplier }, { h: "Challan", v: r => r.challan },
      { h: "Material", v: r => r.material, bold: true }, { h: "Qty", v: r => r.qty, num: true }, { h: "Unit", v: r => r.unit }]} />;
}
