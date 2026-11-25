import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useList, useAction, rpc, type Row } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/perms";
import { inr, n } from "@/lib/format";
import { PageHeader, Tabs, Badge, ReasonDialog } from "@/components/ui";
import { DataTable, type Col } from "@/components/DataTable";
import { useParties, useEmployees, useTeams, useMaterials, useJobTypes, useCategories, useProjects } from "@/components/pickers";
import { useForms } from "@/components/FormHost";
import { PartyDrawer } from "./Accounts";

type Tab = "clients" | "suppliers" | "contractors" | "workers" | "teams" | "materials" | "machines" | "jobs" | "categories";

export function MastersPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "workers";
  const { openForm } = useForms();
  const add: Record<Tab, () => void> = {
    clients: () => openForm("party", { type: "client" }), suppliers: () => openForm("party", { type: "supplier" }), contractors: () => openForm("party", { type: "contractor" }),
    workers: () => openForm("employee"), teams: () => openForm("team"),
    materials: () => openForm("simple", { table: "materials", title: "Material" }), machines: () => openForm("simple", { table: "machines", title: "Machine" }),
    jobs: () => openForm("simple", { table: "job_types", title: "Job type" }), categories: () => openForm("simple", { table: "expense_categories", title: "Expense category" }),
  };
  const label: Record<Tab, string> = { clients: "Client", suppliers: "Supplier", contractors: "Contractor", workers: "Worker", teams: "Team", materials: "Material", machines: "Machine", jobs: "Job type", categories: "Category" };
  return (
    <div>
      <PageHeader title="Masters" subtitle="People, parties and lists used across the app" actions={<button className="btn-primary" onClick={add[tab]}><Plus className="h-4 w-4" /> {label[tab]}</button>}>
        <Tabs value={tab} onChange={t => setSp({ tab: t })} tabs={[
          { key: "workers", label: "Workers" }, { key: "teams", label: "Teams" }, { key: "clients", label: "Clients" }, { key: "suppliers", label: "Suppliers" },
          { key: "contractors", label: "Contractors" }, { key: "materials", label: "Materials" }, { key: "machines", label: "Machines" },
          { key: "jobs", label: "Job types" }, { key: "categories", label: "Expense categories" },
        ]} />
      </PageHeader>
      {tab === "workers" && <Workers />}
      {tab === "teams" && <Teams />}
      {tab === "clients" && <Parties type="client" />}
      {tab === "suppliers" && <Parties type="supplier" />}
      {tab === "contractors" && <Parties type="contractor" />}
      {tab === "materials" && <Simple table="materials" title="Material" extra={[{ key: "unit", header: "Unit" }, { key: "category", header: "Category" }]} />}
      {tab === "machines" && <Machines />}
      {tab === "jobs" && <Simple table="job_types" title="Job type" />}
      {tab === "categories" && <Simple table="expense_categories" title="Expense category" />}
    </div>
  );
}

function useDelete(table: string, label: string) {
  const [row, setRow] = useState<Row | null>(null);
  const del = useAction((r: string) => rpc("soft_delete", { p_table: table, p_id: row!.id, p_reason: r }), `${label} deleted`);
  const dialog = <ReasonDialog open={!!row} onClose={() => setRow(null)} title={`Delete ${label.toLowerCase()}`} busy={del.isPending}
    message={<>Delete <b>{row?.name}</b>? If it is already used in entries, mark it inactive instead.</>}
    onConfirm={r => del.mutate(r, { onSuccess: () => setRow(null) })} />;
  return { ask: setRow, dialog };
}

const activeCol: Col = { key: "active", header: "Status", value: r => r.active ? "Active" : "Inactive", render: r => r.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge> };

function Workers() {
  const { role } = useAuth();
  const fin = can.money(role);
  const { openForm } = useForms();
  const emps = useEmployees();
  const teams = useTeams();
  const bal = useList("v_labour_balances", { order: [{ col: "name" }], enabled: fin });
  const [showInactive, setShowInactive] = useState(false);
  const { ask, dialog } = useDelete("employees", "Worker");
  const b = (id: string) => (bal.data ?? []).find(x => x.employee_id === id);
  const team = (id: string) => (teams.data ?? []).find(t => t.id === id)?.name ?? "";
  return <>
    <DataTable rows={(emps.data ?? []).filter(e => showInactive || e.active)} loading={emps.isLoading} exportName="workers" onRowClick={e => openForm("employee", { initial: e })}
      toolbar={<label className="flex items-center gap-1.5 text-sm text-ink-600"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive</label>}
      cols={[
        { key: "code", header: "Code" }, { key: "name", header: "Name", render: r => <span className="link font-medium">{r.name}</span> },
        { key: "team", header: "Team", value: r => team(r.team_id) }, { key: "designation", header: "Designation" },
        { key: "staff_type", header: "Type", value: r => `${r.staff_type} · ${r.wage_type}`, render: r => <span className="capitalize">{r.staff_type} · {r.wage_type}</span> },
        { key: "phone", header: "Phone" },
        ...(fin ? [
          { key: "rate", header: "Current rate", money: true, value: (r: Row) => n(b(r.id)?.current_rate), render: (r: Row) => b(r.id)?.current_rate ? inr(b(r.id)!.current_rate) : <span className="text-red-600">Not set</span> },
          { key: "bal", header: "Balance due", money: true, total: true, value: (r: Row) => n(b(r.id)?.balance), render: (r: Row) => { const v = n(b(r.id)?.balance); return <span className={v > 0 ? "font-semibold" : v < 0 ? "text-amber-700" : "text-ink-400"}>{inr(v)}{v < 0 ? " adv" : ""}</span>; } },
        ] as Col[] : []),
        activeCol,
        ...(fin ? [{ key: "x", header: "", csv: false, render: (r: Row) => <button className="text-xs text-red-600 hover:underline" onClick={e => { e.stopPropagation(); ask(r); }}>Delete</button> } as Col] : []),
      ]} emptyTitle="No workers yet" />
    {dialog}
  </>;
}

function Teams() {
  const { openForm } = useForms();
  const teams = useTeams();
  const emps = useEmployees();
  const { ask, dialog } = useDelete("teams", "Team");
  const ename = (id: string) => (emps.data ?? []).find(e => e.id === id)?.name ?? "";
  return <>
    <DataTable rows={teams.data} loading={teams.isLoading} exportName="teams" onRowClick={t => openForm("team", { initial: t })}
      cols={[
        { key: "name", header: "Team", render: r => <span className="link font-medium">{r.name}</span> },
        { key: "leader", header: "Leader / maistry", value: r => ename(r.leader_id) },
        { key: "members", header: "Members", align: "right", value: r => (emps.data ?? []).filter(e => e.team_id === r.id && e.active).length },
        { key: "notes", header: "Notes" }, activeCol,
        { key: "x", header: "", csv: false, render: r => <button className="text-xs text-red-600 hover:underline" onClick={e => { e.stopPropagation(); ask(r); }}>Delete</button> },
      ]} emptyTitle="No teams" />
    {dialog}
  </>;
}

function Parties({ type }: { type: "client" | "supplier" | "contractor" }) {
  const { role } = useAuth();
  const fin = can.money(role);
  const { openForm } = useForms();
  const list = useParties(type);
  const bal = useList("v_party_balances", { eq: { type }, enabled: fin && type !== "client" });
  const [view, setView] = useState<string | null>(null);
  const { ask, dialog } = useDelete("parties", type[0].toUpperCase() + type.slice(1));
  const b = (id: string) => (bal.data ?? []).find(x => x.id === id);
  return <>
    <DataTable rows={list.data} loading={list.isLoading} exportName={type + "s"} onRowClick={r => fin && type !== "client" ? setView(r.id) : openForm("party", { initial: r, type })}
      cols={[
        { key: "name", header: "Name", render: r => <div><div className="link font-medium">{r.name}</div>{r.contact_person && <div className="text-xs text-ink-500">{r.contact_person}</div>}</div> },
        { key: "phone", header: "Phone" }, { key: "email", header: "Email" }, { key: "gstin", header: "GSTIN" },
        ...(fin && type !== "client" ? [
          { key: "payables", header: "Payables", money: true, total: true, value: (r: Row) => n(b(r.id)?.payables) },
          { key: "credit", header: "Unused credits", money: true, total: true, value: (r: Row) => n(b(r.id)?.unused_credits) },
        ] as Col[] : []),
        activeCol,
        { key: "x", header: "", csv: false, render: r => <span className="flex justify-end gap-3"><button className="link text-xs" onClick={e => { e.stopPropagation(); openForm("party", { initial: r, type }); }}>Edit</button>{fin && <button className="text-xs text-red-600 hover:underline" onClick={e => { e.stopPropagation(); ask(r); }}>Delete</button>}</span> },
      ]} emptyTitle={`No ${type}s yet`} />
    <PartyDrawer partyId={view} onClose={() => setView(null)} />
    {dialog}
  </>;
}

function Machines() {
  const { openForm } = useForms();
  const list = useList("machines", { order: [{ col: "name" }] });
  const projects = useProjects();
  const { ask, dialog } = useDelete("machines", "Machine");
  return <>
    <DataTable rows={list.data} loading={list.isLoading} exportName="machines" onRowClick={r => openForm("simple", { table: "machines", title: "Machine", initial: r })}
      cols={[
        { key: "name", header: "Machine", render: r => <span className="link font-medium">{r.name}</span> }, { key: "reg_no", header: "Reg. no." },
        { key: "ownership", header: "Owned / hired", render: r => <span className="capitalize">{r.ownership}</span> },
        { key: "site", header: "Current site", value: r => (projects.data ?? []).find(p => p.id === r.project_id)?.name ?? "" },
        { key: "notes", header: "Notes" }, activeCol,
        { key: "x", header: "", csv: false, render: r => <button className="text-xs text-red-600 hover:underline" onClick={e => { e.stopPropagation(); ask(r); }}>Delete</button> },
      ]} emptyTitle="No machines" />
    {dialog}
  </>;
}

function Simple({ table, title, extra = [] }: { table: "materials" | "job_types" | "expense_categories"; title: string; extra?: Col[] }) {
  const { openForm } = useForms();
  const hooks = { materials: useMaterials, job_types: useJobTypes, expense_categories: useCategories };
  const list = hooks[table]();
  const { ask, dialog } = useDelete(table, title);
  return <>
    <DataTable rows={list.data} loading={list.isLoading} exportName={table} onRowClick={r => openForm("simple", { table, title, initial: r })}
      cols={[{ key: "name", header: "Name", render: r => <span className="link font-medium">{r.name}</span> }, ...extra, activeCol,
        
        { key: "x", header: "", csv: false, render: r => <button className="text-xs text-red-600 hover:underline" onClick={e => { e.stopPropagation(); ask(r); }}>Delete</button> }]} />
    {dialog}
  </>;
}
