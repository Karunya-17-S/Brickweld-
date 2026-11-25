import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus, ArrowLeft } from "lucide-react";
import { useList, useAction, rpc, type Row } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/perms";
import { inr, inrCompact, n, fmtDate, qty, CATEGORY_LABEL } from "@/lib/format";
import { PageHeader, Tabs, Stat, Section, StatusBadge, Badge, KV, Loading, ReasonDialog, cx, Money } from "@/components/ui";
import { DataTable, type Col } from "@/components/DataTable";
import { useForms } from "@/components/FormHost";
import { useProjects, useParties } from "@/components/pickers";
import { Progress } from "./Dashboard";

export function ProjectsPage() {
  const { role } = useAuth();
  const fin = can.money(role);
  const nav = useNavigate();
  const { openForm } = useForms();
  const [tab, setTab] = useState<"active" | "planning" | "on_hold" | "completed" | "all">("active");
  const projects = useProjects();
  const summary = useList("v_project_summary", { order: [{ col: "name" }], enabled: fin });
  const clients = useParties("client");
  const rows = useMemo(() => {
    const s = new Map((summary.data ?? []).map(x => [x.id, x]));
    const c = new Map((clients.data ?? []).map(x => [x.id, x.name]));
    return (projects.data ?? []).map(p => ({ ...p, ...(s.get(p.id) ?? {}), client_name: c.get(p.client_id) ?? "" } as Row))
      .filter(p => tab === "all" || p.status === tab);
  }, [projects.data, summary.data, clients.data, tab]);
  const count = (s: string) => (projects.data ?? []).filter(p => s === "all" || p.status === s).length;
  const cols: Col[] = [
    { key: "name", header: "Project", value: r => `${r.name} ${r.code}`, render: r => <div><div className="link font-medium">{r.name}</div><div className="text-xs text-ink-500">{r.code}{r.kind === "office" && " · office"}</div></div> },
    { key: "client_name", header: "Client" },
    ...(fin ? [
      { key: "contract_value", header: "Contract", money: true, total: true },
      { key: "received", header: "Received", money: true, total: true },
      { key: "receivable", header: "To receive", money: true, total: true },
      { key: "total_cost", header: "Cost so far", money: true, total: true },
      { key: "profit", header: "Profit", money: true, total: true, value: (r: Row) => n(r.contract_value) - n(r.total_cost),
        render: (r: Row) => r.kind === "office" ? <span className="text-ink-400">—</span> : <Money value={n(r.contract_value) - n(r.total_cost)} signed /> },
    ] as Col[] : []),
    { key: "status", header: "Status", render: r => <StatusBadge status={r.status} /> },
    { key: "progress", header: "Progress", width: "140px", render: r => <Progress v={n(r.progress)} /> },
    { key: "end_date", header: "Target", render: r => fmtDate(r.end_date) },
  ];
  return (
    <div>
      <PageHeader title="Projects" actions={can.editMasters(role) && <button className="btn-primary" onClick={() => openForm("project")}><Plus className="h-4 w-4" /> New project</button>}>
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: "active", label: "Active", count: count("active") }, { key: "planning", label: "Planning", count: count("planning") },
          { key: "on_hold", label: "On hold", count: count("on_hold") }, { key: "completed", label: "Completed", count: count("completed") }, { key: "all", label: "All", count: count("all") },
        ]} />
      </PageHeader>
      <DataTable rows={rows} cols={cols} loading={projects.isLoading} onRowClick={r => nav(`/projects/${r.id}`)} exportName="projects"
        emptyTitle="No projects here" emptyHint="Projects you create appear here with their money position." />
    </div>
  );
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const { role } = useAuth();
  const fin = can.money(role);
  const nav = useNavigate();
  const { openForm } = useForms();
  const [tab, setTab] = useState("overview");
  const projects = useProjects();
  const p = (projects.data ?? []).find(x => x.id === id);
  const s = useList("v_project_summary", { eq: { id }, enabled: fin });
  const sum = s.data?.[0];
  const client = useParties("client").data?.find(c => c.id === p?.client_id);
  if (projects.isLoading) return <Loading />;
  if (!p) return <div className="p-8 text-sm text-ink-500">Project not found. <button className="link" onClick={() => nav("/projects")}>Back to projects</button></div>;
  const profit = n(sum?.contract_value) - n(sum?.total_cost);
  return (
    <div>
      <PageHeader title={<span className="flex items-center gap-3"><button onClick={() => nav("/projects")} className="rounded p-1 text-ink-400 hover:bg-slate-100" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>{p.name} <StatusBadge status={p.status} /></span>}
        subtitle={`${p.code}${client ? ` · ${client.name}` : ""}${p.site_address ? ` · ${p.site_address}` : ""}`}
        actions={<>
          {fin && <button className="btn-secondary" onClick={() => openForm("receipt", { projectId: id })}>Receive payment</button>}
          {fin && <button className="btn-secondary" onClick={() => openForm("expense", { projectId: id })}>+ Expense</button>}
          <button className="btn-secondary" onClick={() => openForm("indent", { projectId: id })}>+ Indent</button>
          {can.editMasters(role) && <button className="btn-secondary" onClick={() => openForm("project", { initial: p })}><Pencil className="h-4 w-4" /> Edit</button>}
        </>}>
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: "overview", label: "Overview" }, { key: "quotations", label: "Quotations", hidden: !fin }, { key: "receipts", label: "Client receipts", hidden: !fin },
          { key: "labour", label: "Labour" }, { key: "materials", label: "Materials" }, { key: "contractors", label: "Contractors", hidden: !fin },
          { key: "expenses", label: "Expenses", hidden: !fin }, { key: "transactions", label: "All money", hidden: !fin },
        ]} />
      </PageHeader>
      {tab === "overview" && (
        <div className="space-y-5 p-6">
          {fin && sum && p.kind === "site" && (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                <Stat label="Contract value" value={inrCompact(sum.contract_value)} sub={n(sum.variations) ? `incl. variations ${inrCompact(sum.variations)}` : "base contract"} />
                <Stat label="Received" value={inrCompact(sum.received)} tone="green" sub={`To receive ${inrCompact(sum.receivable)}`} />
                <Stat label="Cost so far" value={inrCompact(sum.total_cost)} sub={`Bills pending ${inrCompact(sum.bills_pending)}`} />
                <Stat label="Profit (contract − cost)" value={inrCompact(profit)} tone={profit >= 0 ? "green" : "red"} sub={n(sum.contract_value) > 0 ? `${(profit / n(sum.contract_value) * 100).toFixed(1)}% margin` : "Set a contract value"} />
                <Stat label="Cash position" value={inrCompact(n(sum.received) - n(sum.total_cost) + n(sum.bills_pending))} tone="blue" sub="Received − paid out" />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <Section title="Cost breakdown">
                  <CostBars s={sum} />
                </Section>
                <Section title="Project details"><div className="p-4"><KV cols={2} items={[
                  ["Code", p.code], ["Client", client?.name ?? "—"], ["Start", fmtDate(p.start_date)], ["Target", fmtDate(p.end_date)],
                  ["Labour man-days", qty(sum.labour_days)], ["Progress", <Progress key="p" v={n(p.progress)} />],
                ]} /></div></Section>
              </div>
            </>
          )}
          {(!fin || p.kind === "office") && (
            <Section title="Project details"><div className="p-4"><KV items={[["Code", p.code], ["Client", client?.name ?? "—"], ["Status", <StatusBadge key="s" status={p.status} />], ["Start", fmtDate(p.start_date)], ["Target", fmtDate(p.end_date)], ["Progress", `${p.progress}%`]]} /></div></Section>
          )}
        </div>
      )}
      {tab === "quotations" && <VariationsTab projectId={id} />}
      {tab === "receipts" && <TxnTab projectId={id} categories={["client_receipt"]} action={<button className="btn-primary" onClick={() => openForm("receipt", { projectId: id })}>Receive payment</button>} />}
      {tab === "labour" && <LabourTab projectId={id} fin={fin} />}
      {tab === "materials" && <MaterialsTab projectId={id} fin={fin} />}
      {tab === "contractors" && <ContractorsTab projectId={id} />}
      {tab === "expenses" && <TxnTab projectId={id} categories={["expense"]} action={<button className="btn-primary" onClick={() => openForm("expense", { projectId: id })}>+ Expense</button>} />}
      {tab === "transactions" && <TxnTab projectId={id} />}
    </div>
  );
}

function CostBars({ s }: { s: Row }) {
  const items = [["Materials", s.material_cost], ["Contractors", s.contractor_cost], ["Labour", s.labour_cost], ["Other expenses", s.other_expenses]] as [string, unknown][];
  const total = Math.max(1, n(s.total_cost));
  return (
    <div className="space-y-3 p-4">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="mb-1 flex justify-between text-sm"><span>{k}</span><span className="tabular-nums">{inr(v)} <span className="text-xs text-ink-400">({(n(v) / total * 100).toFixed(0)}%)</span></span></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${n(v) / total * 100}%` }} /></div>
        </div>
      ))}
      <div className="flex justify-between border-t border-slate-100 pt-2 text-sm font-semibold"><span>Total cost</span><span className="tabular-nums">{inr(s.total_cost)}</span></div>
    </div>
  );
}

function VariationsTab({ projectId }: { projectId: string }) {
  const { openForm } = useForms();
  const list = useList("project_variations", { eq: { project_id: projectId }, order: [{ col: "var_date", asc: false }] });
  const [del, setDel] = useState<Row | null>(null);
  const delA = useAction((reason: string) => rpc("soft_delete", { p_table: "project_variations", p_id: del!.id, p_reason: reason }), "Deleted");
  return (
    <>
      <DataTable rows={list.data} loading={list.isLoading} exportName="quotations"
        toolbar={<button className="btn-primary" onClick={() => openForm("variation", { projectId })}><Plus className="h-4 w-4" /> Add quotation</button>}
        emptyTitle="No quotations / variations" emptyHint="Extra work agreed with the client. Approved amounts are added to the contract value."
        cols={[
          { key: "var_no", header: "No." }, { key: "var_date", header: "Date", render: r => fmtDate(r.var_date) },
          { key: "description", header: "Description" }, { key: "amount", header: "Amount", money: true, total: true },
          { key: "status", header: "Status", render: r => <StatusBadge status={r.status} /> },
          { key: "act", header: "", csv: false, render: r => <div className="flex justify-end gap-2"><button className="link text-xs" onClick={() => openForm("variation", { projectId, initial: r })}>Edit</button><button className="text-xs text-red-600 hover:underline" onClick={() => setDel(r)}>Delete</button></div> },
        ]} />
      <ReasonDialog open={!!del} onClose={() => setDel(null)} title="Delete quotation" message={`Delete ${del?.var_no}?`} busy={delA.isPending} onConfirm={r => delA.mutate(r, { onSuccess: () => setDel(null) })} />
    </>
  );
}

export function TxnTab({ projectId, categories, action }: { projectId?: string; categories?: string[]; action?: React.ReactNode }) {
  const list = useList("v_transactions", { eq: projectId ? { project_id: projectId } : {}, inList: categories ? { category: categories } : {}, order: [{ col: "txn_date", asc: false }, { col: "created_at", asc: false }] });
  return (
    <DataTable rows={list.data} loading={list.isLoading} exportName="transactions" toolbar={action} rowClass={r => r.is_void ? "opacity-50 line-through" : undefined}
      cols={[
        { key: "txn_date", header: "Date", render: r => fmtDate(r.txn_date) }, { key: "txn_no", header: "No." },
        { key: "category", header: "Type", value: r => CATEGORY_LABEL[r.category], render: r => <>{CATEGORY_LABEL[r.category]}{r.is_void && <Badge>Void</Badge>}</> },
        { key: "who", header: "Party / detail", value: r => r.party_name ?? r.employee_name ?? r.expense_category ?? r.description },
        { key: "account_name", header: "Account" },
        { key: "in", header: "In", money: true, total: true, value: r => r.direction === "in" && !r.is_void ? n(r.amount) : 0, render: r => r.direction === "in" ? inr(r.amount) : "" },
        { key: "out", header: "Out", money: true, total: true, value: r => r.direction === "out" && !r.is_void ? n(r.amount) : 0, render: r => r.direction === "out" ? inr(r.amount) : "" },
      ]} />
  );
}

function LabourTab({ projectId, fin }: { projectId: string; fin: boolean }) {
  const att = useList("attendance", { select: "id,employee_id,work_date,day_value,is_leave", eq: { project_id: projectId } });
  const wages = useList("v_wage_lines", { select: "employee_id,wage,day_value", eq: { project_id: projectId }, enabled: fin });
  const emps = useList("employees", { select: "id,code,name,team_id" });
  const teams = useList("teams", { select: "id,name" });
  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const a of att.data ?? []) {
      const r = m.get(a.employee_id) ?? { employee_id: a.employee_id, days: 0, entries: 0, last: "", wage: 0 };
      r.days += n(a.day_value); r.entries++; if (a.work_date > r.last) r.last = a.work_date; m.set(a.employee_id, r);
    }
    for (const w of wages.data ?? []) { const r = m.get(w.employee_id); if (r) r.wage += n(w.wage); }
    const e = new Map((emps.data ?? []).map(x => [x.id, x])); const t = new Map((teams.data ?? []).map(x => [x.id, x.name]));
    return [...m.values()].map(r => ({ ...r, name: e.get(r.employee_id)?.name, code: e.get(r.employee_id)?.code, team: t.get(e.get(r.employee_id)?.team_id) ?? "" } as Row));
  }, [att.data, wages.data, emps.data, teams.data]);
  return (
    <DataTable rows={rows} loading={att.isLoading} rowKey={r => r.employee_id} exportName="project_labour" emptyTitle="No attendance on this project yet"
      cols={[
        { key: "name", header: "Worker", render: r => <div><div className="font-medium">{r.name}</div><div className="text-xs text-ink-500">{r.code}</div></div> },
        { key: "team", header: "Team" }, { key: "days", header: "Man-days", align: "right", total: true, render: r => qty(r.days) },
        { key: "last", header: "Last worked", render: r => fmtDate(r.last) },
        ...(fin ? [{ key: "wage", header: "Wages earned", money: true, total: true } as Col] : []),
      ]} />
  );
}

function MaterialsTab({ projectId, fin }: { projectId: string; fin: boolean }) {
  const grn = useList("goods_receipts", { eq: { project_id: projectId }, order: [{ col: "grn_date", asc: false }] });
  const items = useList("grn_items", { select: "grn_id,material_name,unit,qty" });
  const bills = useList("v_bill_balances", { eq: { project_id: projectId, bill_type: "supplier" }, order: [{ col: "bill_date", asc: false }], enabled: fin });
  const summary = useMemo(() => {
    const ids = new Set((grn.data ?? []).map(g => g.id)); const m = new Map<string, Row>();
    for (const i of items.data ?? []) if (ids.has(i.grn_id)) { const k = i.material_name + "|" + i.unit; const r = m.get(k) ?? { material: i.material_name, unit: i.unit, qty: 0 }; r.qty += n(i.qty); m.set(k, r); }
    return [...m.values()];
  }, [grn.data, items.data]);
  return (
    <div className="space-y-5 p-6">
      <Section title="Material received (total)"><DataTable rows={summary} rowKey={r => r.material + r.unit} search={false} dense cols={[{ key: "material", header: "Material" }, { key: "qty", header: "Quantity", align: "right", render: r => `${qty(r.qty)} ${r.unit}` }]} emptyTitle="No material received yet" /></Section>
      {fin && <Section title="Supplier bills"><BillsTable rows={bills.data} loading={bills.isLoading} /></Section>}
    </div>
  );
}

function ContractorsTab({ projectId }: { projectId: string }) {
  const { openForm } = useForms();
  const wos = useList("work_orders", { eq: { project_id: projectId }, order: [{ col: "wo_date", asc: false }] });
  const bills = useList("v_bill_balances", { eq: { project_id: projectId, bill_type: "contractor" }, order: [{ col: "bill_date", asc: false }] });
  const parties = useParties("contractor");
  const name = (id: string) => (parties.data ?? []).find(p => p.id === id)?.name ?? "";
  const rows = (wos.data ?? []).map(w => {
    const bs = (bills.data ?? []).filter(b => b.work_order_id === w.id && !b.is_void);
    return { ...w, contractor: name(w.contractor_id), billed: bs.reduce((s, b) => s + n(b.subtotal) + n(b.tax_amount), 0), paid: bs.reduce((s, b) => s + n(b.paid), 0), pending: bs.reduce((s, b) => s + n(b.balance), 0) } as Row;
  });
  return (
    <div className="space-y-5 p-6">
      <Section title="Work orders" actions={<button className="btn-primary py-1.5" onClick={() => openForm("wo", { projectId })}><Plus className="h-4 w-4" /> Work order</button>}>
        <DataTable rows={rows} loading={wos.isLoading} search={false} cols={[
          { key: "wo_no", header: "WO" }, { key: "contractor", header: "Contractor" }, { key: "description", header: "Scope" },
          { key: "amount", header: "WO value", money: true, total: true }, { key: "billed", header: "Billed", money: true, total: true },
          { key: "paid", header: "Paid", money: true, total: true }, { key: "pending", header: "Pending", money: true, total: true },
          { key: "status", header: "Status", render: r => <StatusBadge status={r.status} /> },
        ]} emptyTitle="No work orders" />
      </Section>
      <Section title="Contractor bills"><BillsTable rows={bills.data} loading={bills.isLoading} /></Section>
    </div>
  );
}

export function BillsTable({ rows, loading, onOpen }: { rows: Row[] | undefined; loading?: boolean; onOpen?: (r: Row) => void }) {
  return (
    <DataTable rows={rows} loading={loading} onRowClick={onOpen} exportName="bills" rowClass={r => r.is_void ? "opacity-50" : undefined}
      cols={[
        { key: "bill_date", header: "Date", render: r => fmtDate(r.bill_date) },
        { key: "bill_no", header: "Bill", render: r => <div><div className={cx("font-medium", onOpen && "link")}>{r.bill_no}</div>{r.vendor_ref && <div className="text-xs text-ink-500">Ref {r.vendor_ref}</div>}</div> },
        { key: "party_name", header: "Party" }, { key: "project_code", header: "Project" },
        { key: "source", header: "From", value: r => r.grn_no ?? r.wo_no ?? "Manual" },
        { key: "total", header: "Amount", money: true, total: true, value: r => r.is_void ? 0 : n(r.total) },
        { key: "paid", header: "Paid", money: true, total: true },
        { key: "balance", header: "Balance due", money: true, total: true },
        { key: "due_date", header: "Due", render: r => fmtDate(r.due_date) },
        { key: "status", header: "Status", render: r => <StatusBadge status={r.status} /> },
      ]} emptyTitle="No bills" />
  );
}
