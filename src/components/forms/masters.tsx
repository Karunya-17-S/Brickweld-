import { useEffect, useState } from "react";
import { Modal, Field, Input, Textarea, MoneyInput, Select, Spinner } from "../ui";
import { PartySelect, TeamSelect, ProjectSelect, UnitSelect, EmployeeSelect } from "../pickers";
import { useAction, insertRow, updateRow, upsertRow, fetchAll, clean, type Row } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/perms";
import { n, todayISO, inr, fmtDate } from "@/lib/format";

interface Base { open: boolean; onClose: () => void; initial?: Row }
function Footer({ onClose, busy, disabled }: { onClose: () => void; busy?: boolean; disabled?: boolean }) {
  return <>
    <button className="btn-secondary" onClick={onClose} type="button">Cancel</button>
    <button className="btn-primary" type="submit" form="xform" disabled={busy || disabled}>{busy && <Spinner className="text-white" />}Save</button>
  </>;
}

export function ProjectForm({ open, onClose, initial }: Base) {
  const { role } = useAuth();
  const [f, setF] = useState<Row>({});
  useEffect(() => {
    if (!open) return;
    const blank = { code: "", name: "", client_id: "", kind: "site", status: "active", site_address: "", start_date: todayISO(), end_date: "", progress: "0", notes: "", contract_value: "" };
    if (initial?.id) {
      setF({ ...blank, ...initial, progress: String(initial.progress ?? 0) });
      if (can.money(role)) supabase.from("project_financials").select("contract_value").eq("project_id", initial.id).maybeSingle()
        .then(({ data }) => setF(x => ({ ...x, contract_value: data ? String((data as Row).contract_value) : "" })));
    } else setF(blank);
  }, [open, initial, role]);
  const save = useAction(async () => {
    const v = clean({ code: f.code.trim(), name: f.name.trim(), client_id: f.client_id, kind: f.kind, status: f.status, site_address: f.site_address, start_date: f.start_date, end_date: f.end_date, progress: Math.min(100, Math.max(0, n(f.progress))), notes: f.notes });
    let id = initial?.id as string | undefined;
    if (id) await updateRow("projects", id, v); else id = (await insertRow("projects", v)).id;
    if (can.money(role)) await upsertRow("project_financials", { project_id: id, contract_value: n(f.contract_value) }, "project_id");
  }, initial ? "Project updated" : "Project created");
  const ok = f.code?.trim() && f.name?.trim();
  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.code}` : "New project"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="xform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="grid grid-cols-2 gap-4">
        <Field label="Project code" required hint="Short unique code, e.g. HSR-VILLA-07"><Input value={f.code ?? ""} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Project name" required><Input value={f.name ?? ""} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Client"><PartySelect type="client" value={f.client_id ?? ""} onChange={v => setF({ ...f, client_id: v })} /></Field>
        {can.money(role) && <Field label="Contract value" hint="Base value. Add quotations/variations on the project page."><MoneyInput value={f.contract_value ?? ""} onChange={v => setF({ ...f, contract_value: v })} /></Field>}
        <Field label="Type"><Select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="site">Construction site</option><option value="office">Office / yard (no P&L)</option></Select></Field>
        <Field label="Status"><Select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="planning">Planning</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option></Select></Field>
        <Field label="Start date"><Input type="date" value={f.start_date ?? ""} onChange={e => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="Target completion"><Input type="date" value={f.end_date ?? ""} onChange={e => setF({ ...f, end_date: e.target.value })} /></Field>
        <Field label="Progress %"><Input type="number" min="0" max="100" value={f.progress ?? "0"} onChange={e => setF({ ...f, progress: e.target.value })} /></Field>
        <Field label="Site address"><Input value={f.site_address ?? ""} onChange={e => setF({ ...f, site_address: e.target.value })} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea value={f.notes ?? ""} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

export function PartyForm({ open, onClose, initial, type = "supplier" }: Base & { type?: "client" | "supplier" | "contractor" }) {
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (open) setF(initial ?? { type, name: "", code: "", contact_person: "", phone: "", email: "", gstin: "", address: "", notes: "", active: true }); }, [open, initial, type]);
  const save = useAction(async () => {
    const v = clean({ type: f.type, name: f.name.trim(), code: f.code, contact_person: f.contact_person, phone: f.phone, email: f.email, gstin: f.gstin?.toUpperCase(), address: f.address, notes: f.notes, active: f.active });
    if (initial?.id) await updateRow("parties", initial.id, v); else await insertRow("parties", v);
  }, "Saved");
  const label = f.type === "client" ? "client" : f.type === "contractor" ? "contractor" : "supplier";
  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.name}` : `New ${label}`} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!f.name?.trim()} />}>
      <form id="xform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="grid grid-cols-2 gap-4">
        <Field label="Name" required className="col-span-2"><Input value={f.name ?? ""} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        {!initial && <Field label="Type"><Select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="supplier">Supplier</option><option value="contractor">Contractor</option><option value="client">Client</option></Select></Field>}
        <Field label="Contact person"><Input value={f.contact_person ?? ""} onChange={e => setF({ ...f, contact_person: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone ?? ""} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={f.email ?? ""} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="GSTIN"><Input value={f.gstin ?? ""} onChange={e => setF({ ...f, gstin: e.target.value })} /></Field>
        <Field label="Code"><Input value={f.code ?? ""} onChange={e => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Address" className="col-span-2"><Textarea value={f.address ?? ""} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Notes" className="col-span-2"><Input value={f.notes ?? ""} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="Bank details, payment terms…" /></Field>
        {initial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Active</label>}
      </form>
    </Modal>
  );
}

export function EmployeeForm({ open, onClose, initial }: Base) {
  const { role } = useAuth();
  const fin = can.money(role);
  const [f, setF] = useState<Row>({});
  const [p, setP] = useState<Row>({});
  const [rates, setRates] = useState<Row[]>([]);
  useEffect(() => {
    if (!open) return;
    setF(initial ?? { code: "", name: "", phone: "", team_id: "", designation: "", staff_type: "labour", wage_type: "daily", joined_on: todayISO(), active: true, rate: "", rate_from: todayISO() });
    setP({}); setRates([]);
    if (initial?.id && fin) {
      supabase.from("employee_private").select("*").eq("employee_id", initial.id).maybeSingle().then(({ data }) => setP((data as Row) ?? {}));
      fetchAll("employee_rates", { eq: { employee_id: initial.id }, order: [{ col: "effective_from", asc: false }] }).then(setRates);
    }
    if (initial?.id) setF((x: Row) => ({ ...x, rate: "", rate_from: todayISO() }));
  }, [open, initial, fin]);
  const save = useAction(async () => {
    const v = clean({ code: f.code.trim(), name: f.name.trim(), phone: f.phone, team_id: f.team_id, designation: f.designation, staff_type: f.staff_type, wage_type: f.wage_type, joined_on: f.joined_on, active: f.active });
    let id = initial?.id as string | undefined;
    if (id) await updateRow("employees", id, v); else id = (await insertRow("employees", v)).id;
    if (fin && n(f.rate) > 0) await upsertRow("employee_rates", { employee_id: id, rate: n(f.rate), effective_from: f.rate_from || todayISO() }, "employee_id,effective_from");
    if (fin && Object.keys(p).length) await upsertRow("employee_private", clean({ employee_id: id, aadhaar: p.aadhaar, bank_name: p.bank_name, bank_account: p.bank_account, ifsc: p.ifsc, pf_no: p.pf_no, esic_no: p.esic_no, address: p.address, emergency_contact: p.emergency_contact }), "employee_id");
  }, initial ? "Worker updated" : "Worker added");
  const ok = f.code?.trim() && f.name?.trim() && (!fin || initial?.id || n(f.rate) > 0);
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title={initial ? `Edit ${initial.name}` : "New worker / staff"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="xform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-5">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label="Code" required><Input value={f.code ?? ""} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="L-001" /></Field>
          <Field label="Name" required className="md:col-span-2"><Input value={f.name ?? ""} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.phone ?? ""} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Team"><TeamSelect value={f.team_id ?? ""} onChange={v => setF({ ...f, team_id: v })} placeholder="No team" /></Field>
          <Field label="Designation"><Input value={f.designation ?? ""} onChange={e => setF({ ...f, designation: e.target.value })} placeholder="Mason / Helper / Engineer" /></Field>
          <Field label="Staff type"><Select value={f.staff_type} onChange={e => setF({ ...f, staff_type: e.target.value })}><option value="labour">Labour</option><option value="staff">Staff</option></Select></Field>
          <Field label="Paid"><Select value={f.wage_type} onChange={e => setF({ ...f, wage_type: e.target.value })}><option value="daily">Daily wage</option><option value="monthly">Monthly salary</option></Select></Field>
          <Field label="Joined on"><Input type="date" value={f.joined_on ?? ""} onChange={e => setF({ ...f, joined_on: e.target.value })} /></Field>
          {initial && <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={!!f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Active</label>}
        </div>
        {fin && (
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-ink-700">Wage rate</div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label={f.wage_type === "monthly" ? (initial ? "New monthly salary" : "Monthly salary") : (initial ? "New daily rate" : "Daily rate")} required={!initial}
                hint={initial ? "Leave empty to keep the current rate" : undefined}><MoneyInput value={f.rate ?? ""} onChange={v => setF({ ...f, rate: v })} /></Field>
              <Field label="Effective from" hint="Past attendance keeps the old rate"><Input type="date" value={f.rate_from ?? ""} onChange={e => setF({ ...f, rate_from: e.target.value })} /></Field>
            </div>
            {rates.length > 0 && (
              <div className="mt-3 text-sm">
                <div className="mb-1 text-xs font-medium uppercase text-ink-400">Rate history</div>
                {rates.map(r => <div key={r.id} className="flex justify-between border-t border-slate-100 py-1"><span>{fmtDate(r.effective_from)}</span><span className="tabular-nums">{inr(r.rate)}</span></div>)}
              </div>
            )}
          </div>
        )}
        {fin && (
          <details className="rounded-lg border border-slate-200 p-4" open={!!initial && Object.keys(p).length > 1}>
            <summary className="cursor-pointer text-sm font-semibold text-ink-700">ID & bank details (visible to MD / Accountant only)</summary>
            <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Aadhaar"><Input value={p.aadhaar ?? ""} onChange={e => setP({ ...p, aadhaar: e.target.value })} /></Field>
              <Field label="Bank name"><Input value={p.bank_name ?? ""} onChange={e => setP({ ...p, bank_name: e.target.value })} /></Field>
              <Field label="Account no."><Input value={p.bank_account ?? ""} onChange={e => setP({ ...p, bank_account: e.target.value })} /></Field>
              <Field label="IFSC"><Input value={p.ifsc ?? ""} onChange={e => setP({ ...p, ifsc: e.target.value.toUpperCase() })} /></Field>
              <Field label="PF no."><Input value={p.pf_no ?? ""} onChange={e => setP({ ...p, pf_no: e.target.value })} /></Field>
              <Field label="ESIC no."><Input value={p.esic_no ?? ""} onChange={e => setP({ ...p, esic_no: e.target.value })} /></Field>
              <Field label="Address" className="md:col-span-2"><Input value={p.address ?? ""} onChange={e => setP({ ...p, address: e.target.value })} /></Field>
              <Field label="Emergency contact"><Input value={p.emergency_contact ?? ""} onChange={e => setP({ ...p, emergency_contact: e.target.value })} /></Field>
            </div>
          </details>
        )}
      </form>
    </Modal>
  );
}

export function TeamForm({ open, onClose, initial }: Base) {
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (open) setF(initial ?? { name: "", leader_id: "", notes: "", active: true }); }, [open, initial]);
  const save = useAction(async () => {
    const v = clean({ name: f.name.trim(), leader_id: f.leader_id, notes: f.notes, active: f.active });
    if (initial?.id) await updateRow("teams", initial.id, v); else await insertRow("teams", v);
  }, "Team saved");
  return (
    <Modal open={open} onClose={onClose} width="max-w-lg" title={initial ? `Edit ${initial.name}` : "New team"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!f.name?.trim()} />}>
      <form id="xform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-4">
        <Field label="Team name" required><Input value={f.name ?? ""} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Murugan Mason Team" /></Field>
        <Field label="Team leader"><EmployeeSelect value={f.leader_id ?? ""} onChange={v => setF({ ...f, leader_id: v })} placeholder="—" teamId={initial?.id} /></Field>
        <Field label="Notes"><Input value={f.notes ?? ""} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

export function AccountForm({ open, onClose, initial }: Base) {
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (open) setF(initial ? { ...initial, opening_balance: String(initial.opening_balance) } : { name: "", type: "bank", bank_name: "", account_last4: "", opening_balance: "0", opening_date: todayISO(), active: true }); }, [open, initial]);
  const save = useAction(async () => {
    const v = clean({ name: f.name.trim(), type: f.type, bank_name: f.bank_name, account_last4: f.account_last4, opening_balance: n(f.opening_balance), opening_date: f.opening_date, active: f.active });
    if (initial?.id) await updateRow("money_accounts", initial.id, v); else await insertRow("money_accounts", v);
  }, "Account saved");
  return (
    <Modal open={open} onClose={onClose} width="max-w-lg" title={initial ? `Edit ${initial.name}` : "New bank / cash account"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!f.name?.trim()} />}>
      <form id="xform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="grid grid-cols-2 gap-4">
        <Field label="Account name" required className="col-span-2"><Input value={f.name ?? ""} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. HDFC Current A/c" /></Field>
        <Field label="Type"><Select value={f.type} onChange={e => setF({ ...f, type: e.target.value })} disabled={!!initial}><option value="bank">Bank</option><option value="petty_cash">Petty cash</option></Select></Field>
        {f.type === "bank" && <Field label="Last 4 digits"><Input maxLength={4} value={f.account_last4 ?? ""} onChange={e => setF({ ...f, account_last4: e.target.value.replace(/\D/g, "") })} /></Field>}
        {f.type === "bank" && <Field label="Bank" className="col-span-2"><Input value={f.bank_name ?? ""} onChange={e => setF({ ...f, bank_name: e.target.value })} /></Field>}
        <Field label="Opening balance" hint="Balance on the date you start using this app"><MoneyInput value={f.opening_balance ?? "0"} onChange={v => setF({ ...f, opening_balance: v })} /></Field>
        <Field label="As on date"><Input type="date" value={f.opening_date ?? ""} onChange={e => setF({ ...f, opening_date: e.target.value })} /></Field>
        {initial && <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Active</label>}
      </form>
    </Modal>
  );
}

/** Small masters: expense categories, job types, materials, machines. */
export function SimpleForm({ open, onClose, initial, table, title }: Base & { table: "expense_categories" | "job_types" | "materials" | "machines"; title: string }) {
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (open) setF(initial ?? { name: "", unit: "nos", category: "", reg_no: "", ownership: "owned", project_id: "", notes: "", active: true }); }, [open, initial]);
  const save = useAction(async () => {
    const v: Row = { name: f.name.trim(), active: f.active ?? true };
    if (table === "materials") Object.assign(v, { unit: f.unit, category: f.category || null });
    if (table === "machines") Object.assign(v, clean({ reg_no: f.reg_no, ownership: f.ownership, project_id: f.project_id, notes: f.notes }));
    if (initial?.id) await updateRow(table, initial.id, v); else await insertRow(table, v);
  }, "Saved");
  return (
    <Modal open={open} onClose={onClose} width="max-w-md" title={initial ? `Edit ${initial.name}` : `New ${title}`} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!f.name?.trim()} />}>
      <form id="xform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-4">
        <Field label="Name" required><Input value={f.name ?? ""} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        {table === "materials" && <div className="grid grid-cols-2 gap-4"><Field label="Unit"><UnitSelect value={f.unit ?? "nos"} onChange={v => setF({ ...f, unit: v })} /></Field><Field label="Category"><Input value={f.category ?? ""} onChange={e => setF({ ...f, category: e.target.value })} /></Field></div>}
        {table === "machines" && <>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Reg. no."><Input value={f.reg_no ?? ""} onChange={e => setF({ ...f, reg_no: e.target.value })} /></Field>
            <Field label="Ownership"><Select value={f.ownership} onChange={e => setF({ ...f, ownership: e.target.value })}><option value="owned">Owned</option><option value="hired">Hired</option></Select></Field>
          </div>
          <Field label="Currently at"><ProjectSelect value={f.project_id ?? ""} onChange={v => setF({ ...f, project_id: v })} placeholder="Yard / not assigned" /></Field>
          <Field label="Notes"><Input value={f.notes ?? ""} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        </>}
        {initial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Active</label>}
      </form>
    </Modal>
  );
}
