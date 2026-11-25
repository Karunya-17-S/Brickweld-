import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Landmark, Wallet, Plus, ArrowLeftRight, Pencil } from "lucide-react";
import { useList, useAction, rpc, insertRow, type Row } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { inr, n, fmtDate, fmtDateTime, todayISO, monthStart, CATEGORY_LABEL, MODE_LABEL, titleCase } from "@/lib/format";
import { PageHeader, Tabs, Toolbar, MiniField, Select, Input, Drawer, KV, Section, Badge, StatusBadge, Money, ReasonDialog, Modal, Field, MoneyInput, Spinner, Stat, cx } from "@/components/ui";
import { DataTable, type Col } from "@/components/DataTable";
import { ProjectSelect, AccountSelect, useAccounts } from "@/components/pickers";
import { useForms } from "@/components/FormHost";
import { quickEditable } from "@/components/forms/money";
import { BillsTable } from "./Projects";

type Tab = "overview" | "transactions" | "payables" | "bills" | "receivables" | "expenses" | "capital" | "cash";

export function AccountsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "overview";
  const { openForm } = useForms();
  const set = (t: Tab) => setSp({ tab: t });
  return (
    <div>
      <PageHeader title="Accounts & Cash" actions={<>
        <button className="btn-secondary" onClick={() => openForm("transfer")}><ArrowLeftRight className="h-4 w-4" /> Transfer</button>
        <button className="btn-secondary" onClick={() => openForm("receipt")}>Receive payment</button>
        <button className="btn-secondary" onClick={() => openForm("payment", { partyType: "supplier" })}>Pay supplier / contractor</button>
        <button className="btn-primary" onClick={() => openForm("expense")}><Plus className="h-4 w-4" /> Expense</button>
      </>}>
        <Tabs value={tab} onChange={set} tabs={[
          { key: "overview", label: "Bank & cash" }, { key: "transactions", label: "Cash book" }, { key: "payables", label: "Payables" },
          { key: "bills", label: "Bills" }, { key: "receivables", label: "Receivables" }, { key: "expenses", label: "Expenses" },
          { key: "capital", label: "MD capital" }, { key: "cash", label: "Cash count" },
        ]} />
      </PageHeader>
      {tab === "overview" && <Overview />}
      {tab === "transactions" && <CashBook />}
      {tab === "payables" && <Payables />}
      {tab === "bills" && <BillsTab />}
      {tab === "receivables" && <Receivables />}
      {tab === "expenses" && <CashBook fixedCategories={["expense"]} title="expense" />}
      {tab === "capital" && <Capital />}
      {tab === "cash" && <CashCount />}
    </div>
  );
}

function Overview() {
  const accounts = useAccounts();
  const { openForm } = useForms();
  const [, setSp] = useSearchParams();
  const bank = (accounts.data ?? []).filter(a => a.type === "bank").reduce((s, a) => s + n(a.balance), 0);
  const petty = (accounts.data ?? []).filter(a => a.type === "petty_cash").reduce((s, a) => s + n(a.balance), 0);
  return (
    <div className="space-y-5 p-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="All bank accounts" value={inr(bank)} icon={<Landmark className="h-4 w-4" />} sub="Company-wide balance" />
        <Stat label="All petty cash" value={inr(petty)} icon={<Wallet className="h-4 w-4" />} sub="Company-wide balance" />
        <Stat label="Total cash available" value={inr(bank + petty)} tone="blue" sub="Bank + petty cash" />
      </div>
      <Section title="Accounts" actions={<button className="btn-secondary py-1.5" onClick={() => openForm("account")}><Plus className="h-4 w-4" /> Account</button>}>
        <DataTable rows={accounts.data} loading={accounts.isLoading} search={false}
          onRowClick={a => setSp({ tab: "transactions", account: a.id })}
          cols={[
            { key: "name", header: "Account", render: a => <div className="flex items-center gap-2">{a.type === "bank" ? <Landmark className="h-4 w-4 text-ink-400" /> : <Wallet className="h-4 w-4 text-ink-400" />}<div><div className="link font-medium">{a.name}</div><div className="text-xs text-ink-500">{a.type === "bank" ? `Bank${a.bank_name ? " · " + a.bank_name : ""}${a.account_last4 ? " ··" + a.account_last4 : ""}` : "Petty cash"}{!a.active && " · inactive"}</div></div></div> },
            { key: "opening_balance", header: "Opening", money: true, render: a => <span title={`as on ${fmtDate(a.opening_date)}`}>{inr(a.opening_balance)}</span> },
            { key: "total_in", header: "Money in", money: true, total: true }, { key: "total_out", header: "Money out", money: true, total: true },
            { key: "balance", header: "Balance", money: true, total: true, render: a => <Money value={a.balance} className={cx("font-semibold", n(a.balance) < 0 && "text-red-600")} /> },
            { key: "edit", header: "", csv: false, render: a => <button className="link text-xs" onClick={e => { e.stopPropagation(); openForm("account", { initial: a }); }}>Edit</button> },
          ]} />
      </Section>
      <div className="text-xs text-ink-500">Balances here are always company-wide. Project filters on other screens never change these numbers.</div>
    </div>
  );
}

// ---------------- Cash book ----------------
function CashBook({ fixedCategories, title }: { fixedCategories?: string[]; title?: string }) {
  const [sp, setSp] = useSearchParams();
  const { openForm } = useForms();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [account, setAccount] = useState(sp.get("account") ?? "");
  const [category, setCategory] = useState("");
  const [project, setProject] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [open, setOpen] = useState<Row | null>(null);
  const list = useList("v_transactions", {
    gte: { txn_date: from }, lte: { txn_date: to },
    eq: { account_id: account || undefined, category: category || undefined, project_id: project || undefined },
    inList: fixedCategories ? { category: fixedCategories } : {},
    order: [{ col: "txn_date" }, { col: "created_at" }],
  });
  const accounts = useAccounts();
  const acc = (accounts.data ?? []).find(a => a.id === account);
  // opening balance for running balance (only when one account is selected)
  const opening = useList("v_transactions", { select: "id,amount,direction,is_void", eq: { account_id: account }, lte: { txn_date: from }, enabled: !!account && !category && !project });
  const rows = useMemo(() => {
    let list2 = (list.data ?? []).filter(r => showVoid || !r.is_void);
    if (account && !category && !project && acc) {
      const before = (opening.data ?? []).filter(r => !r.is_void && !(list.data ?? []).some(x => x.id === r.id))
        .reduce((s, r) => s + (r.direction === "in" ? n(r.amount) : -n(r.amount)), 0) + (from >= acc.opening_date ? n(acc.opening_balance) : 0);
      let bal = before;
      list2 = list2.map(r => { if (!r.is_void) bal += r.direction === "in" ? n(r.amount) : -n(r.amount); return { ...r, running: bal }; });
    }
    return [...list2].reverse();
  }, [list.data, opening.data, showVoid, account, category, project, acc, from]);
  useEffect(() => { const id = sp.get("id"); if (id && list.data) { const r = list.data.find(x => x.id === id); if (r) setOpen(r); } }, [sp, list.data]);
  const running = !!account && !category && !project;
  const cols: Col[] = [
    { key: "txn_date", header: "Date", render: r => fmtDate(r.txn_date) },
    { key: "txn_no", header: "No.", render: r => <span className="link">{r.txn_no}</span> },
    { key: "category", header: "Type", value: r => CATEGORY_LABEL[r.category], render: r => <span>{CATEGORY_LABEL[r.category]}{r.is_void && <Badge>Void</Badge>}{n(r.unapplied) > 0 && <Badge tone="amber">Advance {inr(r.unapplied)}</Badge>}</span> },
    { key: "who", header: "Party / detail", value: r => r.party_name ?? r.employee_name ?? r.expense_category ?? r.description,
      render: r => <div><div>{r.party_name ?? r.employee_name ?? r.expense_category ?? r.description ?? "—"}</div>{(r.description && (r.party_name || r.employee_name || r.expense_category)) && <div className="text-xs text-ink-500">{r.description}</div>}</div> },
    { key: "project_code", header: "Project" },
    { key: "account_name", header: "Account" },
    { key: "mode", header: "Mode", value: r => MODE_LABEL[r.mode] },
    { key: "in", header: "In", money: true, total: true, value: r => r.direction === "in" && !r.is_void ? n(r.amount) : 0, render: r => r.direction === "in" ? <span className="text-emerald-700">{inr(r.amount)}</span> : "" },
    { key: "out", header: "Out", money: true, total: true, value: r => r.direction === "out" && !r.is_void ? n(r.amount) : 0, render: r => r.direction === "out" ? inr(r.amount) : "" },
    ...(running ? [{ key: "running", header: "Balance", money: true } as Col] : []),
  ];
  return (
    <div>
      <Toolbar>
        <MiniField label="From"><Input type="date" className="w-40 py-1.5" value={from} onChange={e => setFrom(e.target.value)} /></MiniField>
        <MiniField label="To"><Input type="date" className="w-40 py-1.5" value={to} onChange={e => setTo(e.target.value)} /></MiniField>
        <MiniField label="Account"><AccountSelect className="w-64 py-1.5" value={account} onChange={v => { setAccount(v); setSp(p => { const x = new URLSearchParams(p); if (v) x.set("account", v); else x.delete("account"); return x; }); }} placeholder="All accounts" showBalance={false} /></MiniField>
        {!fixedCategories && <MiniField label="Type"><Select className="w-48 py-1.5" value={category} onChange={e => setCategory(e.target.value)}><option value="">All types</option>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></MiniField>}
        <MiniField label="Project"><ProjectSelect className="w-56 py-1.5" value={project} onChange={setProject} placeholder="All projects" /></MiniField>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-ink-600"><input type="checkbox" checked={showVoid} onChange={e => setShowVoid(e.target.checked)} /> Show void</label>
      </Toolbar>
      {project && <div className="border-b border-amber-100 bg-amber-50 px-6 py-1.5 text-xs text-amber-800">Showing only entries tagged to the selected project. Account balances (Bank & cash tab) are always company-wide.</div>}
      <DataTable rows={rows} cols={cols} loading={list.isLoading} onRowClick={setOpen} exportName={title ?? "cash_book"} rowClass={r => r.is_void ? "opacity-50" : undefined}
        toolbar={fixedCategories && <button className="btn-primary py-1.5" onClick={() => openForm("expense")}><Plus className="h-4 w-4" /> Expense</button>}
        emptyTitle="No entries in this period" />
      <TxnDrawer txn={open} onClose={() => { setOpen(null); if (sp.get("id")) setSp(p => { const x = new URLSearchParams(p); x.delete("id"); return x; }); }} />
    </div>
  );
}

export function TxnDrawer({ txn, onClose }: { txn: Row | null; onClose: () => void }) {
  const { role } = useAuth();
  const { openForm } = useForms();
  const [act, setAct] = useState<"void" | "delete" | null>(null);
  const allocs = useList("payment_allocations", { eq: { transaction_id: txn?.id }, enabled: !!txn });
  const bills = useList("v_bill_balances", { select: "id,bill_no,project_code,total", inList: { id: (allocs.data ?? []).map(a => a.bill_id) }, enabled: !!allocs.data?.length });
  const history = useList("audit_log", { eq: { record_id: txn?.id }, order: [{ col: "at", asc: false }], enabled: !!txn });
  const voidA = useAction((r: string) => rpc("void_record", { p_table: "transactions", p_id: txn!.id, p_reason: r }), "Entry voided");
  const unvoid = useAction(() => rpc("unvoid_record", { p_table: "transactions", p_id: txn!.id }), "Entry restored from void");
  const delA = useAction((r: string) => rpc("soft_delete", { p_table: "transactions", p_id: txn!.id, p_reason: r }), "Entry deleted");
  const rmAlloc = useAction((id: string) => rpc("remove_allocation", { p_alloc: id }), "Allocation removed — amount is now an advance");
  if (!txn) return null;
  const editKind = txn.category === "expense" ? "expense" : txn.category === "client_receipt" ? "receipt" : ["md_investment", "md_drawing", "other_income"].includes(txn.category) ? "capital" : null;
  return (
    <Drawer open={!!txn} onClose={onClose} title={<span>{txn.txn_no} · {CATEGORY_LABEL[txn.category]} {txn.is_void && <Badge tone="red">Void</Badge>}</span>}
      subtitle={`${fmtDate(txn.txn_date)} · ${txn.account_name}`}
      actions={!txn.is_void ? <>
        {editKind && quickEditable(txn) && <button className="btn-secondary py-1.5" onClick={() => { onClose(); openForm(editKind, { initial: txn }); }}><Pencil className="h-4 w-4" /> Edit</button>}
        {n(txn.unapplied) > 0 && <button className="btn-secondary py-1.5" onClick={() => { onClose(); openForm("applycredit", { txn }); }}>Apply to bills</button>}
        <button className="btn-secondary py-1.5" onClick={() => setAct("void")}>Void</button>
        <button className="btn-ghost py-1.5 text-red-600" onClick={() => setAct("delete")}>Delete</button>
      </> : <button className="btn-secondary py-1.5" onClick={() => unvoid.mutate(undefined, { onSuccess: onClose })}>Un-void</button>}>
      <div className="space-y-5 p-6">
        <div className={cx("text-3xl font-semibold tabular-nums", txn.direction === "in" ? "text-emerald-700" : "text-ink-900")}>{txn.direction === "in" ? "+" : "−"}{inr(txn.amount)}</div>
        <KV items={[
          ["Party", txn.party_name], ["Worker", txn.employee_name], ["Team", txn.team_name], ["Project", txn.project_name], ["Category", txn.expense_category],
          ["Mode", MODE_LABEL[txn.mode]], ["Reference", txn.reference], ["For week", txn.week_start ? fmtDate(txn.week_start) : null], ["Entered by", txn.created_by_name],
          ["Notes", txn.description], ["Void reason", txn.void_reason],
        ].filter(([, v]) => v) as [string, React.ReactNode][]} />
        {["supplier_payment", "contractor_payment"].includes(txn.category) && (
          <Section title={`Applied to bills (${inr(txn.applied)} of ${inr(txn.amount)})`}>
            {(allocs.data ?? []).length === 0 ? <div className="px-4 py-3 text-sm text-ink-500">Not applied to any bill — saved as an advance.</div> : (
              <table className="w-full text-sm"><tbody>{(allocs.data ?? []).map(a => { const b = (bills.data ?? []).find(x => x.id === a.bill_id); return (
                <tr key={a.id} className="border-t border-slate-100"><td className="px-4 py-2 font-medium">{b?.bill_no}</td><td className="px-4 py-2 text-ink-500">{b?.project_code}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr(a.amount)}</td>
                  <td className="px-4 py-2 text-right">{!txn.is_void && <button className="text-xs text-red-600 hover:underline" onClick={() => rmAlloc.mutate(a.id)}>Remove</button>}</td></tr>); })}</tbody></table>
            )}
          </Section>
        )}
        <History rows={history.data} />
      </div>
      <ReasonDialog open={act === "void"} onClose={() => setAct(null)} title="Void entry" confirmLabel="Void" danger
        message={<>Voiding keeps the record but removes it from all balances{n(txn.applied) > 0 ? " and un-applies it from bills" : ""}.{role !== "md" && " The MD will be notified."}</>}
        busy={voidA.isPending} onConfirm={r => voidA.mutate(r, { onSuccess: () => { setAct(null); onClose(); } })} />
      <ReasonDialog open={act === "delete"} onClose={() => setAct(null)} title="Delete entry"
        message={<>The entry is hidden everywhere and can be restored from Audit Log → Deleted.{role !== "md" && " The MD will be notified."} Prefer <b>Void</b> for wrong payments.</>}
        busy={delA.isPending} onConfirm={r => delA.mutate(r, { onSuccess: () => { setAct(null); onClose(); } })} />
    </Drawer>
  );
}

export function History({ rows }: { rows?: Row[] }) {
  if (!rows?.length) return null;
  return (
    <Section title="History">
      <div className="divide-y divide-slate-100">
        {rows.map(h => (
          <div key={h.id} className="px-4 py-2 text-sm">
            <div><b className="capitalize">{h.action}</b> by {h.actor_name ?? "system"} <span className="text-xs text-ink-400">({titleCase(h.actor_role)}) · {fmtDateTime(h.at)}</span></div>
            {h.reason && <div className="text-xs text-ink-600">Reason: {h.reason}</div>}
            {h.changes && <div className="mt-0.5 text-xs text-ink-500">{Object.entries(h.changes as Record<string, [unknown, unknown]>).map(([k, [a, b]]) => `${k.replace(/_/g, " ")}: ${a ?? "—"} → ${b ?? "—"}`).join(" · ")}</div>}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------- Payables (Zoho vendor list) ----------------
function Payables() {
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState<"" | "supplier" | "contractor">("");
  const [onlyDue, setOnlyDue] = useState(true);
  const list = useList("v_party_balances", { eq: type ? { type } : {}, order: [{ col: "name" }] });
  const rows = (list.data ?? []).filter(r => !onlyDue || n(r.payables) > 0 || n(r.unused_credits) > 0);
  const partyId = sp.get("party");
  return (
    <div>
      <Toolbar>
        <MiniField label="Show"><Select className="w-44 py-1.5" value={type} onChange={e => setType(e.target.value as "")}><option value="">Suppliers & contractors</option><option value="supplier">Suppliers</option><option value="contractor">Contractors</option></Select></MiniField>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-ink-600"><input type="checkbox" checked={onlyDue} onChange={e => setOnlyDue(e.target.checked)} /> Only with pending or advance</label>
      </Toolbar>
      <PartyTable rows={rows} loading={list.isLoading} onOpen={r => setSp({ tab: "payables", party: r.id })} />
      <PartyDrawer partyId={partyId} onClose={() => setSp({ tab: "payables" })} />
    </div>
  );
}

export function PartyTable({ rows, loading, onOpen }: { rows: Row[]; loading?: boolean; onOpen: (r: Row) => void }) {
  return (
    <DataTable rows={rows} loading={loading} onRowClick={onOpen} exportName="payables" defaultSort={{ key: "payables", desc: true }}
      cols={[
        { key: "name", header: "Name", render: r => <span className="link font-medium">{r.name}</span> },
        { key: "type", header: "Type", render: r => <span className="capitalize">{r.type}</span> },
        { key: "phone", header: "Phone" },
        { key: "total_billed", header: "Total billed", money: true, total: true },
        { key: "total_paid", header: "Total paid", money: true, total: true },
        { key: "payables", header: "Payables", money: true, total: true, render: r => <Money value={r.payables} className={n(r.payables) > 0 ? "font-semibold" : "text-ink-400"} /> },
        { key: "overdue", header: "Overdue", money: true, total: true, render: r => n(r.overdue) > 0 ? <span className="text-red-600">{inr(r.overdue)}</span> : <span className="text-ink-300">—</span> },
        { key: "unused_credits", header: "Unused credits", money: true, total: true },
        { key: "last_paid", header: "Last paid", render: r => fmtDate(r.last_paid) },
      ]} emptyTitle="Nothing pending" emptyHint="Suppliers and contractors with unpaid bills or advances appear here." />
  );
}

export function PartyDrawer({ partyId, onClose }: { partyId: string | null; onClose: () => void }) {
  const { openForm } = useForms();
  const p = useList("v_party_balances", { eq: { id: partyId }, enabled: !!partyId }).data?.[0];
  const bills = useList("v_bill_balances", { eq: { party_id: partyId }, order: [{ col: "bill_date", asc: false }], enabled: !!partyId });
  const pays = useList("v_transactions", { eq: { party_id: partyId }, order: [{ col: "txn_date", asc: false }], enabled: !!partyId });
  const [txn, setTxn] = useState<Row | null>(null);
  if (!partyId || !p) return null;
  return (
    <Drawer open onClose={onClose} width="max-w-5xl" title={p.name} subtitle={<span className="capitalize">{p.type}{p.phone ? ` · ${p.phone}` : ""}{p.gstin ? ` · GSTIN ${p.gstin}` : ""}</span>}
      actions={<button className="btn-primary py-1.5" onClick={() => openForm("payment", { partyType: p.type, partyId: p.id })}>Record payment</button>}>
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Payables" value={inr(p.payables)} tone={n(p.payables) > 0 ? "red" : undefined} />
          <Stat label="Overdue" value={inr(p.overdue)} tone={n(p.overdue) > 0 ? "red" : undefined} />
          <Stat label="Unused credits (advance)" value={inr(p.unused_credits)} tone={n(p.unused_credits) > 0 ? "amber" : undefined} />
          <Stat label="Retention held" value={inr(p.retention_held)} />
        </div>
        <Section title="Bills"><BillsTable rows={bills.data} loading={bills.isLoading} /></Section>
        <Section title="Payments">
          <DataTable rows={(pays.data ?? []).filter(x => ["supplier_payment", "contractor_payment"].includes(x.category))} search={false} onRowClick={setTxn} rowClass={r => r.is_void ? "opacity-50" : undefined}
            cols={[
              { key: "txn_date", header: "Date", render: r => fmtDate(r.txn_date) }, { key: "txn_no", header: "No.", render: r => <span className="link">{r.txn_no}</span> },
              { key: "account_name", header: "From" }, { key: "reference", header: "Ref" },
              { key: "amount", header: "Amount", money: true, total: true, value: r => r.is_void ? 0 : n(r.amount) },
              { key: "applied", header: "Applied", money: true }, { key: "unapplied", header: "Advance left", money: true, render: r => n(r.unapplied) > 0 ? <Badge tone="amber">{inr(r.unapplied)}</Badge> : "—" },
            ]} emptyTitle="No payments yet" />
        </Section>
      </div>
      <TxnDrawer txn={txn} onClose={() => setTxn(null)} />
    </Drawer>
  );
}

// ---------------- Bills ----------------
function BillsTab() {
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState("open");
  const [type, setType] = useState("");
  const list = useList("v_bill_balances", { eq: type ? { bill_type: type } : {}, order: [{ col: "bill_date", asc: false }] });
  const rows = (list.data ?? []).filter(b => status === "all" || (status === "open" ? ["unpaid", "partial", "overdue"].includes(b.status) : b.status === status));
  const open = (list.data ?? []).find(b => b.id === sp.get("id")) ?? null;
  const { openForm } = useForms();
  return (
    <div>
      <Toolbar>
        <MiniField label="Status"><Select className="w-44 py-1.5" value={status} onChange={e => setStatus(e.target.value)}><option value="open">Unpaid & partial</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Void</option><option value="all">All</option></Select></MiniField>
        <MiniField label="Type"><Select className="w-40 py-1.5" value={type} onChange={e => setType(e.target.value)}><option value="">All bills</option><option value="supplier">Supplier</option><option value="contractor">Contractor</option></Select></MiniField>
        <div className="flex-1" />
        <button className="btn-secondary" onClick={() => openForm("bill", { billType: "supplier" })}><Plus className="h-4 w-4" /> Supplier bill</button>
        <button className="btn-secondary" onClick={() => openForm("bill", { billType: "contractor" })}><Plus className="h-4 w-4" /> Contractor bill</button>
      </Toolbar>
      <BillsTable rows={rows} loading={list.isLoading} onOpen={b => setSp({ tab: "bills", id: b.id })} />
      <BillDrawer bill={open} onClose={() => setSp({ tab: "bills" })} />
    </div>
  );
}

export function BillDrawer({ bill, onClose }: { bill: Row | null; onClose: () => void }) {
  const { openForm } = useForms();
  const { role } = useAuth();
  const items = useList("bill_items", { eq: { bill_id: bill?.id }, order: [{ col: "sort_order" }], enabled: !!bill });
  const allocs = useList("payment_allocations", { eq: { bill_id: bill?.id }, enabled: !!bill });
  const pays = useList("v_transactions", { select: "id,txn_no,txn_date,account_name,is_void", inList: { id: (allocs.data ?? []).map(a => a.transaction_id) }, enabled: !!allocs.data?.length });
  const history = useList("audit_log", { eq: { record_id: bill?.id }, order: [{ col: "at", asc: false }], enabled: !!bill });
  const [act, setAct] = useState<"void" | "delete" | null>(null);
  const voidA = useAction((r: string) => rpc("void_record", { p_table: "bills", p_id: bill!.id, p_reason: r }), "Bill voided");
  const unvoid = useAction(() => rpc("unvoid_record", { p_table: "bills", p_id: bill!.id }), "Bill restored");
  const delA = useAction((r: string) => rpc("soft_delete", { p_table: "bills", p_id: bill!.id, p_reason: r }), "Bill deleted");
  if (!bill) return null;
  return (
    <Drawer open onClose={onClose} width="max-w-4xl" title={<span>{bill.bill_no} <StatusBadge status={bill.status} /></span>} subtitle={`${bill.party_name} · ${bill.project_name} · ${fmtDate(bill.bill_date)}`}
      actions={bill.is_void ? <button className="btn-secondary py-1.5" onClick={() => unvoid.mutate(undefined, { onSuccess: onClose })}>Un-void</button> : <>
        {n(bill.balance) > 0 && <button className="btn-primary py-1.5" onClick={() => { onClose(); openForm("payment", { partyType: bill.bill_type, partyId: bill.party_id, billId: bill.id }); }}>Pay {inr(bill.balance)}</button>}
        {!bill.grn_id && <button className="btn-secondary py-1.5" onClick={() => { onClose(); openForm("bill", { initial: bill }); }}><Pencil className="h-4 w-4" /> Edit</button>}
        <button className="btn-secondary py-1.5" onClick={() => setAct("void")}>Void</button>
        <button className="btn-ghost py-1.5 text-red-600" onClick={() => setAct("delete")}>Delete</button>
      </>}>
      <div className="space-y-5 p-6">
        <KV cols={4} items={[["Supplier ref", bill.vendor_ref], ["Due date", fmtDate(bill.due_date)], ["From", bill.grn_no ? `GRN ${bill.grn_no}` : bill.wo_no ? `WO ${bill.wo_no}` : "Manual"], ["Notes", bill.description]]} />
        <div className="rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">GST</th><th className="th text-right">Amount</th></tr></thead>
            <tbody>{(items.data ?? []).map(i => <tr key={i.id}><td className="td">{i.description}</td><td className="td text-right">{i.qty} {i.unit}</td><td className="td text-right tabular-nums">{inr(i.rate)}</td><td className="td text-right">{n(i.gst_percent)}%</td><td className="td text-right tabular-nums">{inr(n(i.amount) + n(i.tax))}</td></tr>)}</tbody>
          </table>
          <div className="ml-auto w-72 space-y-1 p-4 text-sm">
            <div className="flex justify-between"><span className="text-ink-500">Sub total</span><span className="tabular-nums">{inr(bill.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-ink-500">GST</span><span className="tabular-nums">{inr(bill.tax_amount)}</span></div>
            {n(bill.retention) > 0 && <div className="flex justify-between"><span className="text-ink-500">Retention</span><span className="tabular-nums">− {inr(bill.retention)}</span></div>}
            {n(bill.other_deductions) > 0 && <div className="flex justify-between"><span className="text-ink-500">Deductions</span><span className="tabular-nums">− {inr(bill.other_deductions)}</span></div>}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Net payable</span><span className="tabular-nums">{inr(bill.total)}</span></div>
            <div className="flex justify-between text-emerald-700"><span>Paid</span><span className="tabular-nums">{inr(bill.paid)}</span></div>
            <div className="flex justify-between font-semibold"><span>Balance due</span><span className="tabular-nums">{inr(bill.balance)}</span></div>
          </div>
        </div>
        {(allocs.data ?? []).length > 0 && (
          <Section title="Payments">
            <table className="w-full text-sm"><tbody>{(allocs.data ?? []).map(a => { const t = (pays.data ?? []).find(x => x.id === a.transaction_id); return (
              <tr key={a.id} className={cx("border-t border-slate-100", t?.is_void && "opacity-50 line-through")}><td className="px-4 py-2">{t?.txn_no}</td><td className="px-4 py-2">{fmtDate(t?.txn_date)}</td><td className="px-4 py-2">{t?.account_name}</td><td className="px-4 py-2 text-right tabular-nums">{inr(a.amount)}</td></tr>); })}</tbody></table>
          </Section>
        )}
        <History rows={history.data} />
      </div>
      <ReasonDialog open={act === "void"} onClose={() => setAct(null)} title="Void bill" confirmLabel="Void" message={<>The bill stays on record but no longer counts as payable.{role !== "md" && " The MD will be notified."}</>}
        busy={voidA.isPending} onConfirm={r => voidA.mutate(r, { onSuccess: () => { setAct(null); onClose(); } })} />
      <ReasonDialog open={act === "delete"} onClose={() => setAct(null)} title="Delete bill" message={<>Delete {bill.bill_no}?{role !== "md" && " The MD will be notified."}</>}
        busy={delA.isPending} onConfirm={r => delA.mutate(r, { onSuccess: () => { setAct(null); onClose(); } })} />
    </Drawer>
  );
}

// ---------------- Receivables ----------------
function Receivables() {
  const { openForm } = useForms();
  const list = useList("v_project_summary", { eq: { kind: "site" }, order: [{ col: "name" }] });
  return (
    <DataTable rows={(list.data ?? []).filter(p => n(p.contract_value) > 0 || n(p.received) > 0)} loading={list.isLoading} exportName="receivables" defaultSort={{ key: "receivable", desc: true }}
      cols={[
        { key: "name", header: "Project", render: r => <div><div className="font-medium">{r.name}</div><div className="text-xs text-ink-500">{r.code}</div></div> },
        { key: "client_name", header: "Client" }, { key: "status", header: "Status", render: r => <StatusBadge status={r.status} /> },
        { key: "contract_value", header: "Contract (incl. variations)", money: true, total: true },
        { key: "received", header: "Received", money: true, total: true },
        { key: "receivable", header: "To receive", money: true, total: true, render: r => <span className="font-semibold">{inr(r.receivable)}</span> },
        { key: "pct", header: "Collected", align: "right", value: r => n(r.contract_value) ? Math.round(n(r.received) / n(r.contract_value) * 100) : 0, render: r => n(r.contract_value) ? `${Math.round(n(r.received) / n(r.contract_value) * 100)}%` : "—" },
        { key: "act", header: "", csv: false, render: r => <button className="btn-secondary px-2 py-1 text-xs" onClick={() => openForm("receipt", { projectId: r.id })}>Receive</button> },
      ]} emptyTitle="No contract values yet" emptyHint="Set the contract value on each project to track what clients owe." />
  );
}

// ---------------- MD capital ----------------
function Capital() {
  const { openForm } = useForms();
  const list = useList("v_transactions", { inList: { category: ["md_investment", "md_drawing", "other_income"] }, order: [{ col: "txn_date", asc: false }] });
  const [open, setOpen] = useState<Row | null>(null);
  const rows = list.data ?? [];
  const inv = rows.filter(r => r.category === "md_investment" && !r.is_void).reduce((s, r) => s + n(r.amount), 0);
  const draw = rows.filter(r => r.category === "md_drawing" && !r.is_void).reduce((s, r) => s + n(r.amount), 0);
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 p-6 pb-2 md:grid-cols-3">
        <Stat label="Total MD investment" value={inr(inv)} tone="green" />
        <Stat label="Total MD drawings" value={inr(draw)} tone="red" />
        <Stat label="Net capital in business" value={inr(inv - draw)} tone="blue" />
      </div>
      <DataTable rows={rows} loading={list.isLoading} onRowClick={setOpen} exportName="md_capital" rowClass={r => r.is_void ? "opacity-50" : undefined}
        toolbar={<><button className="btn-secondary py-1.5" onClick={() => openForm("capital", { kind: "md_drawing" })}>Record drawing</button><button className="btn-primary py-1.5" onClick={() => openForm("capital", { kind: "md_investment" })}><Plus className="h-4 w-4" /> MD investment</button></>}
        cols={[
          { key: "txn_date", header: "Date", render: r => fmtDate(r.txn_date) }, { key: "txn_no", header: "No." },
          { key: "category", header: "Type", value: r => CATEGORY_LABEL[r.category], render: r => <>{CATEGORY_LABEL[r.category]}{r.is_void && <Badge>Void</Badge>}</> },
          { key: "account_name", header: "Account" }, { key: "description", header: "Notes" },
          { key: "in", header: "In", money: true, total: true, value: r => r.direction === "in" && !r.is_void ? n(r.amount) : 0, render: r => r.direction === "in" ? inr(r.amount) : "" },
          { key: "out", header: "Out", money: true, total: true, value: r => r.direction === "out" && !r.is_void ? n(r.amount) : 0, render: r => r.direction === "out" ? inr(r.amount) : "" },
        ]} emptyTitle="No MD investments or drawings yet" emptyHint="Record capital the MD puts into the business — split across bank and petty cash if needed." />
      <TxnDrawer txn={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ---------------- Cash count ----------------
function CashCount() {
  const list = useList("cash_counts", { order: [{ col: "count_date", asc: false }] });
  const accounts = useAccounts();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Row>({ account_id: "", count_date: todayISO(), counted: "", notes: "" });
  const save = useAction(() => insertRow("cash_counts", { account_id: f.account_id, count_date: f.count_date, counted: n(f.counted), book_balance: 0, notes: f.notes || null }), "Cash count saved");
  const del = useAction((id: string) => rpc("soft_delete", { p_table: "cash_counts", p_id: id, p_reason: "Removed cash count" }), "Removed");
  const name = (id: string) => (accounts.data ?? []).find(a => a.id === id)?.name ?? "";
  return (
    <div>
      <DataTable rows={list.data} loading={list.isLoading} exportName="cash_counts"
        toolbar={<button className="btn-primary py-1.5" onClick={() => { setF({ account_id: (accounts.data ?? []).find(a => a.type === "petty_cash")?.id ?? "", count_date: todayISO(), counted: "", notes: "" }); setOpen(true); }}><Plus className="h-4 w-4" /> Count cash</button>}
        cols={[
          { key: "count_date", header: "Date", render: r => fmtDate(r.count_date) }, { key: "account", header: "Account", value: r => name(r.account_id) },
          { key: "book_balance", header: "As per book", money: true }, { key: "counted", header: "Counted", money: true },
          { key: "difference", header: "Difference", money: true, render: r => <span className={n(r.difference) === 0 ? "text-emerald-700" : "font-semibold text-red-600"}>{n(r.difference) === 0 ? "Matches" : inr(r.difference)}</span> },
          { key: "notes", header: "Notes" },
          { key: "x", header: "", csv: false, render: r => <button className="text-xs text-red-600 hover:underline" onClick={() => del.mutate(r.id)}>Remove</button> },
        ]} emptyTitle="No cash counts yet" emptyHint="Count the petty cash at day end. The app compares it with the book balance and flags any difference." />
      <Modal open={open} onClose={() => setOpen(false)} width="max-w-md" title="Count cash"
        footer={<><button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={!f.account_id || f.counted === "" || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => setOpen(false) })}>{save.isPending && <Spinner className="text-white" />}Save</button></>}>
        <div className="space-y-4">
          <Field label="Account"><AccountSelect value={f.account_id} onChange={v => setF({ ...f, account_id: v })} /></Field>
          <Field label="Date"><Input type="date" value={f.count_date} onChange={e => setF({ ...f, count_date: e.target.value })} /></Field>
          <Field label="Cash counted"><MoneyInput value={f.counted} onChange={v => setF({ ...f, counted: v })} /></Field>
          <Field label="Notes"><Input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
