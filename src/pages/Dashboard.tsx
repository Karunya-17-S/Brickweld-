import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Banknote, Building2, Landmark, PackageCheck, Receipt, Users, Wallet, ClipboardList, Bell } from "lucide-react";
import { useRpc, type Row } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { inr, inrCompact, n, todayISO, monthStart, monthEnd, addDays, fmtDate, CATEGORY_LABEL } from "@/lib/format";
import { PageHeader, Stat, Section, Loading, ErrorBox, Select, Badge, cx, Empty } from "@/components/ui";
import { useForms } from "@/components/FormHost";

function periods() {
  const t = todayISO();
  const lastStart = monthStart(addDays(monthStart(t), -1));
  const fyStartYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  return {
    this_month: { label: "This month", from: monthStart(t), to: t },
    last_month: { label: "Last month", from: lastStart, to: monthEnd(lastStart) },
    last_90: { label: "Last 90 days", from: addDays(t, -89), to: t },
    this_fy: { label: `FY ${fyStartYear}-${String(fyStartYear + 1).slice(2)}`, from: `${fyStartYear}-04-01`, to: t },
  } as Record<string, { label: string; from: string; to: string }>;
}

export function DashboardPage() {
  const { role, fullName } = useAuth();
  const P = useMemo(periods, []);
  const [period, setPeriod] = useState("this_month");
  const { data, isLoading, error } = useRpc<Row>("get_dashboard", { p_from: P[period].from, p_to: P[period].to });
  const { openForm } = useForms();
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
  return (
    <div>
      <PageHeader title={role === "md" ? "Business dashboard" : "Accounts dashboard"} subtitle={`${greeting}, ${fullName.split(" ")[0]} · ${fmtDate(todayISO())}`}
        actions={<>
          <Select className="w-40 py-1.5" value={period} onChange={e => setPeriod(e.target.value)}>
            {Object.entries(P).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <button className="btn-secondary" onClick={() => openForm("receipt")}>Receive payment</button>
          <button className="btn-primary" onClick={() => openForm("expense")}>+ Expense</button>
        </>} />
      <ErrorBox error={error} />
      {isLoading || !data ? <Loading /> : role === "md" ? <MdDashboard d={data} periodLabel={P[period].label} /> : <AccountantDashboard d={data} periodLabel={P[period].label} />}
    </div>
  );
}

function MdDashboard({ d, periodLabel }: { d: Row; periodLabel: string }) {
  const nav = useNavigate();
  const payTotal = n(d.payables.supplier) + n(d.payables.contractor) + n(d.labour.due);
  return (
    <div className="space-y-5 p-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Cash available" value={inrCompact(d.cash.total)} icon={<Wallet className="h-4 w-4" />} sub={`Bank ${inrCompact(d.cash.bank)} · Petty ${inrCompact(d.cash.petty)}`} onClick={() => nav("/accounts")} />
        <Stat label="To receive from clients" value={inrCompact(d.receivables.total)} tone="blue" icon={<Receipt className="h-4 w-4" />} sub={`Received ${inrCompact(d.receivables.received)} of ${inrCompact(d.receivables.contract)}`} onClick={() => nav("/accounts?tab=receivables")} />
        <Stat label="To pay (all pending)" value={inrCompact(payTotal)} tone="red" icon={<Banknote className="h-4 w-4" />} sub={`Overdue ${inrCompact(d.payables.overdue)}`} onClick={() => nav("/accounts?tab=payables")} />
        <Stat label={`Money in · ${periodLabel}`} value={inrCompact(d.period_totals.money_in)} tone="green" sub={`Out ${inrCompact(d.period_totals.money_out)}`} />
        <Stat label="Profit on running projects" value={inrCompact(d.company.profit)} tone={n(d.company.profit) >= 0 ? "green" : "red"} icon={<Building2 className="h-4 w-4" />}
          sub={`Contract ${inrCompact(d.company.contract_value)} · Cost ${inrCompact(d.company.cost)}`} onClick={() => nav("/reports?r=pnl")} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Bank & cash accounts" actions={<button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => nav("/accounts")}>Open</button>}>
          <AccountList accounts={d.accounts} />
        </Section>
        <Section title="Cash flow — last 6 months" className="lg:col-span-2"><CashFlow data={d.cashflow} /></Section>
      </div>

      <Section title="Projects at a glance" actions={<button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => nav("/projects")}>All projects</button>}>
        {d.projects.length === 0 ? <Empty title="No running projects" hint="Create a project to start tracking its money." /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{["Project", "Contract", "Received", "To receive", "Material", "Contractor", "Labour", "Other", "Total cost", "Profit", "Progress"].map((h, i) =>
                <th key={h} className={cx("th", i > 0 && i < 10 && "text-right")}>{h}</th>)}</tr></thead>
              <tbody>
                {d.projects.map((p: Row) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => nav(`/projects/${p.id}`)}>
                    <td className="td"><div className="font-medium text-brand-600">{p.name}</div><div className="text-xs text-ink-500">{p.code}{p.client ? ` · ${p.client}` : ""}</div></td>
                    {[p.contract_value, p.received, p.receivable, p.material, p.contractor, p.labour, p.expenses, p.cost].map((v, i) => <td key={i} className="td text-right tabular-nums">{inrCompact(v)}</td>)}
                    <td className={cx("td text-right font-semibold tabular-nums", n(p.profit) < 0 ? "text-red-600" : "text-emerald-700")}>
                      {inrCompact(p.profit)}{p.margin !== null && <div className="text-xs font-normal text-ink-500">{p.margin}%</div>}
                    </td>
                    <td className="td w-32"><Progress v={n(p.progress)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {n(d.office_cost) > 0 && <div className="border-t border-slate-100 px-4 py-2 text-xs text-ink-500">Head office / overhead cost so far: <b>{inr(d.office_cost)}</b> (not included above)</div>}
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="What we owe">
          <div className="divide-y divide-slate-100 text-sm">
            <Line label="Suppliers (materials)" v={d.payables.supplier} onClick={() => nav("/accounts?tab=payables")} />
            <Line label="Contractors" v={d.payables.contractor} onClick={() => nav("/contractors?tab=balances")} />
            <Line label="Labour wages due" v={d.labour.due} sub={`${d.labour.workers_due} workers`} onClick={() => nav("/attendance?view=wages")} />
            <Line label="Retention held" v={d.payables.retention} sub="Payable after defect period" />
            <Line label="Advances given (to adjust)" v={n(d.payables.advances_given) + n(d.labour.advance_outstanding)} sub="Suppliers, contractors & labour" />
          </div>
        </Section>
        <Section title="Biggest pending payments">
          {d.top_payables.length === 0 ? <div className="px-4 py-6 text-sm text-ink-500">Nothing pending.</div> : (
            <div className="divide-y divide-slate-100">
              {d.top_payables.map((p: Row) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div><div className="font-medium">{p.name}</div><div className="text-xs capitalize text-ink-500">{p.type}{n(p.overdue) > 0 && <span className="ml-2 text-red-600">overdue {inrCompact(p.overdue)}</span>}</div></div>
                  <div className="font-semibold tabular-nums">{inr(p.payables)}</div>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Alerts d={d} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={`Where money went · ${periodLabel}`}><SpendBars data={d.spend_by_category} /></Section>
        <Section title="Labour this week" className="lg:col-span-1">
          <div className="grid grid-cols-3 gap-3 p-4 text-center">
            <div><div className="text-xl font-semibold">{n(d.labour_week.workers)}</div><div className="text-xs text-ink-500">workers</div></div>
            <div><div className="text-xl font-semibold">{n(d.labour_week.days)}</div><div className="text-xs text-ink-500">man-days</div></div>
            <div><div className="text-xl font-semibold">{inrCompact(d.labour_week.earned)}</div><div className="text-xs text-ink-500">wages earned</div></div>
          </div>
          <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-ink-500">Today: {d.today_attendance.present} present · {d.today_attendance.leave} on leave</div>
        </Section>
        <Section title={`Capital · ${periodLabel}`}>
          <div className="divide-y divide-slate-100 text-sm">
            <Line label="MD investment" v={d.period_totals.md_investment} />
            <Line label="MD drawings" v={d.period_totals.md_drawing} />
            <Line label="Client receipts" v={d.period_totals.client_receipts} />
          </div>
        </Section>
      </div>

      <Section title="Latest entries" actions={<button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => nav("/accounts?tab=transactions")}>All transactions</button>}>
        <Recent rows={d.recent} />
      </Section>
    </div>
  );
}

function AccountantDashboard({ d, periodLabel }: { d: Row; periodLabel: string }) {
  const nav = useNavigate();
  const { openForm } = useForms();
  return (
    <div className="space-y-5 p-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Bank balance" value={inrCompact(d.cash.bank)} icon={<Landmark className="h-4 w-4" />} onClick={() => nav("/accounts")} />
        <Stat label="Petty cash" value={inrCompact(d.cash.petty)} icon={<Wallet className="h-4 w-4" />} tone={d.alerts.low_petty.length ? "amber" : undefined} onClick={() => nav("/accounts")} />
        <Stat label="Suppliers to pay" value={inrCompact(d.payables.supplier)} tone="red" onClick={() => nav("/accounts?tab=payables")} />
        <Stat label="Contractors to pay" value={inrCompact(d.payables.contractor)} tone="red" onClick={() => nav("/contractors?tab=balances")} />
        <Stat label="Wages due" value={inrCompact(d.labour.due)} tone="amber" sub={`${d.labour.workers_due} workers`} icon={<Users className="h-4 w-4" />} onClick={() => nav("/attendance?view=wages")} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={() => openForm("payment", { partyType: "supplier" })}>Pay supplier</button>
        <button className="btn-secondary" onClick={() => openForm("payment", { partyType: "contractor" })}>Pay contractor</button>
        <button className="btn-secondary" onClick={() => nav("/attendance?view=wages")}>Pay wages</button>
        <button className="btn-secondary" onClick={() => openForm("transfer")}>Bank ⇄ petty cash</button>
        <button className="btn-secondary" onClick={() => openForm("grn")}>Receive goods</button>
        <button className="btn-secondary" onClick={() => openForm("capital")}>MD investment</button>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Bills to pay" className="lg:col-span-2" actions={<button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => nav("/accounts?tab=bills")}>All bills</button>}>
          {d.overdue_bills.length === 0 ? <div className="px-4 py-6 text-sm text-ink-500">No pending bills. 🎉</div> : (
            <table className="w-full">
              <thead><tr><th className="th">Bill</th><th className="th">Party</th><th className="th">Due</th><th className="th text-right">Pending</th><th className="th" /></tr></thead>
              <tbody>{d.overdue_bills.map((b: Row) => (
                <tr key={b.id}>
                  <td className="td font-medium">{b.bill_no}</td><td className="td">{b.party}</td>
                  <td className={cx("td", b.due_date && b.due_date < todayISO() && "text-red-600")}>{fmtDate(b.due_date)}</td>
                  <td className="td text-right tabular-nums">{inr(b.balance)}</td>
                  <td className="td text-right"><button className="btn-secondary py-1 text-xs" onClick={() => openForm("payment", { partyType: b.bill_type, billId: b.id, partyId: b.party_id })}>Pay</button></td>
                </tr>))}
              </tbody>
            </table>
          )}
        </Section>
        <Alerts d={d} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Workers with wages due" actions={<button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => nav("/attendance?view=wages")}>Wage sheet</button>}>
          {d.workers_due.length === 0 ? <div className="px-4 py-6 text-sm text-ink-500">All wages paid.</div> : (
            <div className="divide-y divide-slate-100">{d.workers_due.map((w: Row) => (
              <div key={w.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div><div className="font-medium">{w.name}</div><div className="text-xs text-ink-500">{w.team ?? "No team"}</div></div>
                <div className="tabular-nums">{inr(w.balance)}</div>
              </div>))}
            </div>
          )}
        </Section>
        <Section title={`Spending · ${periodLabel}`}><SpendBars data={d.spend_by_category} /></Section>
        <Section title="Accounts"><AccountList accounts={d.accounts} /></Section>
      </div>
      <Section title="Cash flow — last 6 months"><CashFlow data={d.cashflow} /></Section>
      <Section title="Latest entries"><Recent rows={d.recent} /></Section>
    </div>
  );
}

function Alerts({ d }: { d: Row }) {
  const nav = useNavigate();
  const a = d.alerts;
  const items = [
    a.grn_unbilled > 0 && { icon: <PackageCheck className="h-4 w-4" />, text: `${a.grn_unbilled} goods receipt(s) waiting for a bill`, to: "/materials?tab=grn" },
    a.pending_indents > 0 && { icon: <ClipboardList className="h-4 w-4" />, text: `${a.pending_indents} material indent(s) to approve`, to: "/materials?tab=indents" },
    a.overdue_bills > 0 && { icon: <AlertTriangle className="h-4 w-4 text-red-500" />, text: `${a.overdue_bills} bill(s) overdue`, to: "/accounts?tab=bills" },
    ...a.low_petty.map((p: Row) => ({ icon: <Wallet className="h-4 w-4 text-amber-500" />, text: `${p.name} is low: ${inr(p.balance)}`, to: "/accounts" })),
    a.cash_mismatch > 0 && { icon: <AlertTriangle className="h-4 w-4 text-amber-500" />, text: `${a.cash_mismatch} cash count(s) didn't match the book (30 days)`, to: "/accounts?tab=cash" },
    a.unread_notifications > 0 && { icon: <Bell className="h-4 w-4 text-brand-500" />, text: `${a.unread_notifications} unread change notification(s)`, to: "/audit" },
    a.open_pos > 0 && { icon: <PackageCheck className="h-4 w-4" />, text: `${a.open_pos} purchase order(s) awaiting delivery`, to: "/materials?tab=po" },
  ].filter(Boolean) as { icon: JSX.Element; text: string; to: string }[];
  return (
    <Section title="Needs attention">
      {items.length === 0 ? <div className="px-4 py-6 text-sm text-ink-500">All clear.</div> : (
        <div className="divide-y divide-slate-100">
          {items.map((x, i) => (
            <button key={i} onClick={() => nav(x.to)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
              <span className="text-ink-500">{x.icon}</span><span className="flex-1">{x.text}</span><span className="text-ink-400">›</span>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

function AccountList({ accounts }: { accounts: Row[] }) {
  return (
    <div className="divide-y divide-slate-100">
      {accounts.map(a => (
        <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2">{a.type === "bank" ? <Landmark className="h-4 w-4 text-ink-400" /> : <Wallet className="h-4 w-4 text-ink-400" />}{a.name}</div>
          <div className={cx("font-semibold tabular-nums", n(a.balance) < 0 && "text-red-600")}>{inr(a.balance)}</div>
        </div>
      ))}
      {accounts.length === 0 && <div className="px-4 py-6 text-sm text-ink-500">Add your bank and petty cash accounts in Settings.</div>}
    </div>
  );
}

function CashFlow({ data }: { data: Row[] }) {
  return (
    <div className="h-64 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={v => inrCompact(v)} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} width={64} />
          <Tooltip formatter={(v: number) => inr(v)} cursor={{ fill: "#f5f7fb" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="in" name="Money in" fill="#22a06b" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="out" name="Money out" fill="#f06a5d" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SpendBars({ data }: { data: Row[] }) {
  const max = Math.max(1, ...data.map(x => n(x.amount)));
  if (!data.length) return <div className="px-4 py-6 text-sm text-ink-500">No spending in this period.</div>;
  return (
    <div className="space-y-2.5 p-4">
      {data.slice(0, 8).map(x => (
        <div key={x.label}>
          <div className="mb-1 flex justify-between text-sm"><span>{x.label}</span><span className="tabular-nums text-ink-600">{inr(x.amount)}</span></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(n(x.amount) / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Recent({ rows }: { rows: Row[] }) {
  if (!rows.length) return <div className="px-4 py-6 text-sm text-ink-500">No entries yet.</div>;
  return (
    <table className="w-full">
      <thead><tr><th className="th">Date</th><th className="th">No.</th><th className="th">Type</th><th className="th">Party / detail</th><th className="th">Account</th><th className="th text-right">Amount</th></tr></thead>
      <tbody>{rows.map(r => (
        <tr key={r.id} className={r.is_void ? "opacity-50" : ""}>
          <td className="td">{fmtDate(r.date)}</td><td className="td text-ink-500">{r.txn_no}</td>
          <td className="td">{CATEGORY_LABEL[r.category] ?? r.category}{r.is_void && <Badge>Void</Badge>}</td>
          <td className="td">{r.who ?? "—"}{r.project && <span className="ml-1 text-xs text-ink-400">· {r.project}</span>}</td>
          <td className="td text-ink-600">{r.account}</td>
          <td className={cx("td text-right font-medium tabular-nums", r.direction === "in" ? "text-emerald-700" : "text-ink-900")}>{r.direction === "in" ? "+" : "−"}{inr(r.amount)}</td>
        </tr>))}
      </tbody>
    </table>
  );
}

function Line({ label, v, sub, onClick }: { label: string; v: unknown; sub?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cx("flex items-center justify-between px-4 py-2.5", onClick && "cursor-pointer hover:bg-slate-50")}>
      <div><div>{label}</div>{sub && <div className="text-xs text-ink-500">{sub}</div>}</div>
      <div className="font-semibold tabular-nums">{inr(v)}</div>
    </div>
  );
}

export function Progress({ v }: { v: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-slate-100"><div className={cx("h-1.5 rounded-full", v >= 100 ? "bg-emerald-500" : "bg-brand-500")} style={{ width: `${Math.min(100, v)}%` }} /></div>
      <span className="w-9 text-right text-xs tabular-nums text-ink-500">{v}%</span>
    </div>
  );
}
