import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil } from "lucide-react";
import { useList, useAction, rpc, updateRow, type Row } from "@/lib/data";
import { inr, n, fmtDate } from "@/lib/format";
import { PageHeader, Tabs, Toolbar, MiniField, Select, Drawer, KV, Section, StatusBadge, ReasonDialog, Stat, cx } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { ProjectSelect, PartySelect, useProjects, useParties, useJobTypes } from "@/components/pickers";
import { useForms } from "@/components/FormHost";
import { BillsTable } from "./Projects";
import { BillDrawer, PartyTable, PartyDrawer, TxnDrawer, History } from "./Accounts";

type Tab = "wo" | "bills" | "payments" | "balances";

export function ContractorsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "wo";
  const { openForm } = useForms();
  const [project, setProject] = useState("");
  const [contractor, setContractor] = useState("");
  return (
    <div>
      <PageHeader title="Contractors" subtitle="Work order → running bills (with retention) → payments"
        actions={<>
          <button className="btn-secondary" onClick={() => openForm("payment", { partyType: "contractor", partyId: contractor || undefined })}>Pay contractor</button>
          <button className="btn-secondary" onClick={() => openForm("bill", { billType: "contractor" })}><Plus className="h-4 w-4" /> Contractor bill</button>
          <button className="btn-primary" onClick={() => openForm("wo", { projectId: project || undefined })}><Plus className="h-4 w-4" /> Work order</button>
        </>}>
        <Tabs value={tab} onChange={t => setSp({ tab: t })} tabs={[{ key: "wo", label: "Work orders" }, { key: "bills", label: "Bills" }, { key: "payments", label: "Payments" }, { key: "balances", label: "Balances" }]} />
      </PageHeader>
      {tab !== "balances" && (
        <Toolbar>
          <MiniField label="Project"><ProjectSelect className="w-60 py-1.5" value={project} onChange={setProject} placeholder="All projects" /></MiniField>
          <MiniField label="Contractor"><PartySelect type="contractor" className="w-60 py-1.5" value={contractor} onChange={setContractor} placeholder="All contractors" /></MiniField>
        </Toolbar>
      )}
      {tab === "wo" && <WorkOrders project={project} contractor={contractor} />}
      {tab === "bills" && <CBills project={project} contractor={contractor} />}
      {tab === "payments" && <CPayments project={project} contractor={contractor} />}
      {tab === "balances" && <CBalances />}
    </div>
  );
}

function WorkOrders({ project, contractor }: { project: string; contractor: string }) {
  const projects = useProjects();
  const parties = useParties("contractor");
  const jobs = useJobTypes();
  const [status, setStatus] = useState("active");
  const list = useList("work_orders", { eq: { project_id: project || undefined, contractor_id: contractor || undefined, status: status === "all" ? undefined : status }, order: [{ col: "wo_date", asc: false }] });
  const bills = useList("v_bill_balances", { select: "id,work_order_id,total,paid,balance,retention,subtotal,tax_amount,is_void", eq: { bill_type: "contractor" } });
  const [open, setOpen] = useState<Row | null>(null);
  const agg = (wo: string) => {
    const b = (bills.data ?? []).filter(x => x.work_order_id === wo && !x.is_void);
    return { billed: b.reduce((s, x) => s + n(x.subtotal) + n(x.tax_amount), 0), paid: b.reduce((s, x) => s + n(x.paid), 0), due: b.reduce((s, x) => s + n(x.balance), 0), retention: b.reduce((s, x) => s + n(x.retention), 0) };
  };
  const pname = (id: string) => (projects.data ?? []).find(p => p.id === id)?.name ?? "";
  const cname = (id: string) => (parties.data ?? []).find(p => p.id === id)?.name ?? "";
  const jname = (id: string) => (jobs.data ?? []).find(p => p.id === id)?.name ?? "";
  return (
    <div>
      <div className="px-6 pt-3"><Select className="w-40 py-1.5" value={status} onChange={e => setStatus(e.target.value)}><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All</option></Select></div>
      <DataTable rows={list.data} loading={list.isLoading} onRowClick={setOpen} exportName="work_orders"
        cols={[
          { key: "wo_no", header: "WO", render: r => <span className="link">{r.wo_no}</span> },
          { key: "wo_date", header: "Date", render: r => fmtDate(r.wo_date) },
          { key: "contractor", header: "Contractor", value: r => cname(r.contractor_id) },
          { key: "project", header: "Project", value: r => pname(r.project_id) },
          { key: "description", header: "Work", render: r => <div><div>{r.description}</div><div className="text-xs text-ink-500">{jname(r.job_type_id)}</div></div> },
          { key: "amount", header: "WO value", money: true, total: true },
          { key: "billed", header: "Billed", money: true, total: true, value: r => agg(r.id).billed },
          { key: "progress", header: "Billed %", align: "right", value: r => n(r.amount) ? agg(r.id).billed / n(r.amount) * 100 : 0,
            render: r => { const p = n(r.amount) ? agg(r.id).billed / n(r.amount) * 100 : 0; return <div className="flex items-center justify-end gap-2"><div className="h-1.5 w-16 rounded bg-slate-100"><div className={cx("h-1.5 rounded", p > 100 ? "bg-red-500" : "bg-brand-500")} style={{ width: `${Math.min(100, p)}%` }} /></div><span className="w-10 text-right tabular-nums">{Math.round(p)}%</span></div>; } },
          { key: "paid", header: "Paid", money: true, total: true, value: r => agg(r.id).paid },
          { key: "due", header: "Due", money: true, total: true, value: r => agg(r.id).due, render: r => <span className={agg(r.id).due > 0 ? "font-semibold" : "text-ink-400"}>{inr(agg(r.id).due)}</span> },
          { key: "status", header: "Status", render: r => <StatusBadge status={r.status} /> },
        ]} emptyTitle="No work orders" emptyHint="Create a work order for each contractor job. Bills are raised against it." />
      <WODrawer wo={open} onClose={() => setOpen(null)} names={{ pname, cname, jname }} agg={open ? agg(open.id) : null} />
    </div>
  );
}

function WODrawer({ wo, onClose, names, agg }: { wo: Row | null; onClose: () => void; names: { pname: (i: string) => string; cname: (i: string) => string; jname: (i: string) => string }; agg: { billed: number; paid: number; due: number; retention: number } | null }) {
  const { openForm } = useForms();
  const bills = useList("v_bill_balances", { eq: { work_order_id: wo?.id }, order: [{ col: "bill_date", asc: false }], enabled: !!wo });
  const history = useList("audit_log", { eq: { record_id: wo?.id }, order: [{ col: "at", asc: false }], enabled: !!wo });
  const [bill, setBill] = useState<Row | null>(null);
  const [act, setAct] = useState<"delete" | null>(null);
  const setStatus = useAction((s: string) => updateRow("work_orders", wo!.id, { status: s }), "Work order updated");
  const del = useAction((r: string) => rpc("soft_delete", { p_table: "work_orders", p_id: wo!.id, p_reason: r }), "Work order deleted");
  if (!wo || !agg) return null;
  return (
    <Drawer open onClose={onClose} width="max-w-4xl" title={<span>{wo.wo_no} <StatusBadge status={wo.status} /></span>} subtitle={`${names.cname(wo.contractor_id)} · ${names.pname(wo.project_id)}`}
      actions={<>
        {wo.status === "active" && <button className="btn-primary py-1.5" onClick={() => { onClose(); openForm("bill", { billType: "contractor", workOrderId: wo.id }); }}>Raise bill</button>}
        {agg.due > 0 && <button className="btn-secondary py-1.5" onClick={() => { onClose(); openForm("payment", { partyType: "contractor", partyId: wo.contractor_id }); }}>Pay</button>}
        <button className="btn-secondary py-1.5" onClick={() => { onClose(); openForm("wo", { initial: wo }); }}><Pencil className="h-4 w-4" /> Edit</button>
        {wo.status === "active" ? <button className="btn-secondary py-1.5" onClick={() => setStatus.mutate("completed", { onSuccess: onClose })}>Mark completed</button>
          : <button className="btn-secondary py-1.5" onClick={() => setStatus.mutate("active", { onSuccess: onClose })}>Re-open</button>}
        {!(bills.data ?? []).length && <button className="btn-ghost py-1.5 text-red-600" onClick={() => setAct("delete")}>Delete</button>}
      </>}>
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="WO value" value={inr(wo.amount)} />
          <Stat label="Billed" value={inr(agg.billed)} sub={`${n(wo.amount) ? Math.round(agg.billed / n(wo.amount) * 100) : 0}% of WO`} />
          <Stat label="Paid" value={inr(agg.paid)} tone="green" />
          <Stat label="Due now" value={inr(agg.due)} tone={agg.due > 0 ? "red" : undefined} />
          <Stat label="Retention held" value={inr(agg.retention)} sub={`${n(wo.retention_percent)}% per bill`} />
        </div>
        <KV cols={4} items={[["Work", wo.description], ["Job type", names.jname(wo.job_type_id)], ["Start", fmtDate(wo.start_date)], ["End", fmtDate(wo.end_date)], ["Terms", wo.terms]]} />
        <Section title="Bills against this work order"><BillsTable rows={bills.data} loading={bills.isLoading} onOpen={setBill} /></Section>
        <History rows={history.data} />
      </div>
      <BillDrawer bill={bill} onClose={() => setBill(null)} />
      <ReasonDialog open={act === "delete"} onClose={() => setAct(null)} title="Delete work order" message={`Delete ${wo.wo_no}?`} busy={del.isPending}
        onConfirm={r => del.mutate(r, { onSuccess: () => { setAct(null); onClose(); } })} />
    </Drawer>
  );
}

function CBills({ project, contractor }: { project: string; contractor: string }) {
  const [status, setStatus] = useState("open");
  const [open, setOpen] = useState<Row | null>(null);
  const list = useList("v_bill_balances", { eq: { bill_type: "contractor", project_id: project || undefined, party_id: contractor || undefined }, order: [{ col: "bill_date", asc: false }] });
  const rows = (list.data ?? []).filter(b => status === "all" || (status === "open" ? ["unpaid", "partial", "overdue"].includes(b.status) : b.status === status));
  return (
    <div>
      <div className="px-6 pt-3"><Select className="w-44 py-1.5" value={status} onChange={e => setStatus(e.target.value)}><option value="open">Unpaid & partial</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Void</option><option value="all">All</option></Select></div>
      <BillsTable rows={rows} loading={list.isLoading} onOpen={setOpen} />
      <BillDrawer bill={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function CPayments({ project, contractor }: { project: string; contractor: string }) {
  const [open, setOpen] = useState<Row | null>(null);
  const list = useList("v_transactions", { eq: { category: "contractor_payment", project_id: project || undefined, party_id: contractor || undefined }, order: [{ col: "txn_date", asc: false }] });
  return (
    <div>
      <DataTable rows={list.data} loading={list.isLoading} onRowClick={setOpen} exportName="contractor_payments" rowClass={r => r.is_void ? "opacity-50" : undefined}
        cols={[
          { key: "txn_date", header: "Date", render: r => fmtDate(r.txn_date) }, { key: "txn_no", header: "No.", render: r => <span className="link">{r.txn_no}</span> },
          { key: "party_name", header: "Contractor" }, { key: "project_code", header: "Project" }, { key: "account_name", header: "From" }, { key: "reference", header: "Ref" },
          { key: "amount", header: "Amount", money: true, total: true, value: r => r.is_void ? 0 : n(r.amount) },
          { key: "unapplied", header: "Advance left", money: true, total: true },
        ]} emptyTitle="No contractor payments" />
      <TxnDrawer txn={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function CBalances() {
  const list = useList("v_party_balances", { eq: { type: "contractor" }, order: [{ col: "name" }] });
  const [id, setId] = useState<string | null>(null);
  return <>
    <PartyTable rows={list.data ?? []} loading={list.isLoading} onOpen={r => setId(r.id)} />
    <PartyDrawer partyId={id} onClose={() => setId(null)} />
  </>;
}
