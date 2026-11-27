import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { UserPlus, KeyRound, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useList, useRpc, useAction, rpc, updateRow, type Row } from "@/lib/data";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fmtDate, inr, n } from "@/lib/format";
import { PageHeader, Tabs, Field, Input, Select, Modal, Spinner, Badge, Section, Textarea, cx } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { useAccounts } from "@/components/pickers";
import { useForms } from "@/components/FormHost";
import { toast } from "@/components/toast";

type Tab = "users" | "company" | "accounts" | "me";

export function SettingsPage() {
  const { role } = useAuth();
  const [sp, setSp] = useSearchParams();
  const md = can.manageUsers(role);
  const tab = (sp.get("tab") as Tab) || (md ? "users" : "company");
  return (
    <div>
      <PageHeader title="Settings">
        <Tabs value={tab} onChange={t => setSp({ tab: t })} tabs={[
          { key: "users", label: "Users & roles" }, { key: "company", label: "Company & wage rules" },
          { key: "accounts", label: "Bank & cash accounts" }, { key: "me", label: "My account" },
        ]} />
      </PageHeader>
      <div className="p-6">
        {tab === "users" && <Users md={md} />}
        {tab === "company" && <Company />}
        {tab === "accounts" && <Accounts />}
        {tab === "me" && <Me />}
      </div>
    </div>
  );
}

async function adminCall(body: Row) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep msg */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = "User management isn't switched on yet: deploy the admin-users Edge Function in Supabase (README → step 5).";
    throw Object.assign(new Error(msg), { userFacing: true });
  }
  if (data?.error) throw Object.assign(new Error(data.error), { userFacing: true });
  return data as Row;
}

function Users({ md }: { md: boolean }) {
  const { session } = useAuth();
  const list = useRpc<Row[]>("list_users");
  const [add, setAdd] = useState(false);
  const [reset, setReset] = useState<Row | null>(null);
  const setRole = useAction((a: { id: string; role: string | null }) => rpc("set_user_role", { p_user: a.id, p_role: a.role }), "Role updated");
  const setActive = useAction((a: { id: string; active: boolean }) => rpc("set_user_active", { p_user: a.id, p_active: a.active }), "Updated");
  const me = session?.user.id;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {(["md", "accountant", "supervisor"] as const).map(r => (
          <div key={r} className="card p-4 text-sm">
            <div className="font-semibold">{ROLE_LABEL[r]}</div>
            <div className="mt-1 text-ink-600">{r === "md" ? "Everything, including the MD dashboard, profit, user management and alerts for every edit or delete by others."
              : r === "accountant" ? "Everything except the MD dashboard and user management: attendance, wages, all money, bills, materials, contractors, masters, reports. Every edit/delete alerts the MD."
              : "Attendance for sites, indents, receiving goods (auto-bills at PO rates), and the attendance/material reports. No money screens."}</div>
          </div>
        ))}
      </div>
      <DataTable rows={list.data} loading={list.isLoading} search={false}
        toolbar={md && <button className="btn-primary py-1.5" onClick={() => setAdd(true)}><UserPlus className="h-4 w-4" /> Add user</button>}
        cols={[
          { key: "full_name", header: "Name", render: r => <div><div className="font-medium">{r.full_name || "—"} {r.id === me && <Badge tone="blue">You</Badge>}</div><div className="text-xs text-ink-500">{r.email}</div></div> },
          { key: "role", header: "Role", render: r => md && r.id !== me ? (
            <Select className="w-44 py-1" value={r.role ?? ""} onChange={e => setRole.mutate({ id: r.id, role: e.target.value || null })}>
              <option value="">No access</option><option value="md">MD</option><option value="accountant">Accountant</option><option value="supervisor">Site supervisor</option>
            </Select>) : r.role ? ROLE_LABEL[r.role as "md"] : <Badge tone="amber">No access</Badge> },
          { key: "active", header: "Status", render: r => r.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge> },
          { key: "created_at", header: "Added", render: r => fmtDate(r.created_at) },
          { key: "x", header: "", render: r => md && r.id !== me && <div className="flex justify-end gap-2">
            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setReset(r)}><KeyRound className="h-3.5 w-3.5" /> Password</button>
            <button className={cx("btn-secondary px-2 py-1 text-xs", r.active && "text-red-600")} onClick={() => setActive.mutate({ id: r.id, active: !r.active })}>{r.active ? "Disable" : "Enable"}</button>
          </div> },
        ]} />
      <AddUser open={add} onClose={() => setAdd(false)} />
      <ResetPw user={reset} onClose={() => setReset(null)} />
    </div>
  );
}

function AddUser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (open) setF({ full_name: "", email: "", phone: "", role: "supervisor", password: "" }); }, [open]);
  const save = useAction(async () => {
    // 1) create (or re-use) the login, 2) attach the role as the MD through the database
    const r = await adminCall({ action: "create", full_name: f.full_name, email: f.email, phone: f.phone, password: f.password });
    await rpc("set_user_role", { p_user: r.id, p_role: f.role });
    return r;
  }, (r: Row) => r.existed ? "This email already had a login — password and role updated" : "User created — share the email and password with them");
  return (
    <Modal open={open} onClose={onClose} width="max-w-md" title="Add user"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending || !f.full_name || !f.email || (f.password ?? "").length < 8} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{save.isPending && <Spinner className="text-white" />}Create</button></>}>
      <div className="space-y-3">
        <Field label="Full name" required><Input value={f.full_name ?? ""} onChange={e => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Email (login)" required><Input type="email" value={f.email ?? ""} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone ?? ""} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Role" required><Select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="supervisor">Site supervisor</option><option value="accountant">Accountant</option><option value="md">MD</option></Select></Field>
        <Field label="Temporary password" required hint="At least 8 characters. Ask them to change it from My account after first login."><Input type="text" autoComplete="new-password" value={f.password ?? ""} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ResetPw({ user, onClose }: { user: Row | null; onClose: () => void }) {
  const [pw, setPw] = useState("");
  useEffect(() => setPw(""), [user]);
  const save = useAction(() => adminCall({ action: "reset_password", user_id: user!.id, password: pw }), "Password changed");
  return (
    <Modal open={!!user} onClose={onClose} width="max-w-md" title={`Set new password · ${user?.full_name ?? ""}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={pw.length < 8 || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Save</button></>}>
      <Field label="New password" hint="At least 8 characters"><Input type="text" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
    </Modal>
  );
}

function Company() {
  const { role } = useAuth();
  const fin = can.money(role);
  const s = useList("company_settings", { order: [{ col: "id" }] });
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (s.data?.[0]) setF(s.data[0]); }, [s.data]);
  const save = useAction(() => updateRow("company_settings", "1", {
    company_name: f.company_name, address: f.address || null, gstin: f.gstin || null, phone: f.phone || null, email: f.email || null,
    week_start: n(f.week_start), full_day_hours: n(f.full_day_hours), ot_day_hours: n(f.ot_day_hours), half_day_hours: n(f.half_day_hours),
    monthly_divisor: n(f.monthly_divisor), low_petty_cash_alert: n(f.low_petty_cash_alert),
  }), "Settings saved");
  if (!s.data) return null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <Section title="Company">
        <div className="space-y-3 p-4">
          <Field label="Company name"><Input disabled={!fin} value={f.company_name ?? ""} onChange={e => setF({ ...f, company_name: e.target.value })} /></Field>
          <Field label="Address"><Textarea disabled={!fin} rows={2} value={f.address ?? ""} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GSTIN"><Input disabled={!fin} value={f.gstin ?? ""} onChange={e => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Field>
            <Field label="Phone"><Input disabled={!fin} value={f.phone ?? ""} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <Field label="Email"><Input disabled={!fin} value={f.email ?? ""} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        </div>
      </Section>
      <Section title="Attendance & wage rules">
        <div className="space-y-3 p-4">
          <Field label="Wage week starts on"><Select disabled={!fin} value={String(f.week_start ?? 0)} onChange={e => setF({ ...f, week_start: e.target.value })}>{days.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Half day from (hrs)"><Input disabled={!fin} type="number" value={f.half_day_hours ?? ""} onChange={e => setF({ ...f, half_day_hours: e.target.value })} /></Field>
            <Field label="Full day from (hrs)"><Input disabled={!fin} type="number" value={f.full_day_hours ?? ""} onChange={e => setF({ ...f, full_day_hours: e.target.value })} /></Field>
            <Field label="1.5 days from (hrs)"><Input disabled={!fin} type="number" value={f.ot_day_hours ?? ""} onChange={e => setF({ ...f, ot_day_hours: e.target.value })} /></Field>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-ink-600">With these rules: 9→6 ({9}h) = 1 day · 6→6 (12h) = 1.5 days · 9→1 (4h) = ½ day. Changing rules only affects entries saved after the change.</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly salary ÷ days" hint="Per-day rate for monthly staff"><Input disabled={!fin} type="number" value={f.monthly_divisor ?? ""} onChange={e => setF({ ...f, monthly_divisor: e.target.value })} /></Field>
            <Field label="Low petty cash alert below" hint={`Currently ${inr(f.low_petty_cash_alert)}`}><Input disabled={!fin} type="number" value={f.low_petty_cash_alert ?? ""} onChange={e => setF({ ...f, low_petty_cash_alert: e.target.value })} /></Field>
          </div>
        </div>
      </Section>
      {fin && <div className="lg:col-span-2"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending && <Spinner className="text-white" />}Save settings</button></div>}
    </div>
  );
}

function Accounts() {
  const accounts = useAccounts();
  const { openForm } = useForms();
  return (
    <DataTable rows={accounts.data} loading={accounts.isLoading} search={false} onRowClick={a => openForm("account", { initial: a })}
      toolbar={<button className="btn-primary py-1.5" onClick={() => openForm("account")}><Plus className="h-4 w-4" /> Add account</button>}
      cols={[
        { key: "name", header: "Account", render: a => <span className="link font-medium">{a.name}</span> },
        { key: "type", header: "Type", render: a => a.type === "bank" ? "Bank" : "Petty cash" },
        { key: "bank_name", header: "Bank" },
        { key: "opening_balance", header: "Opening balance", money: true }, { key: "opening_date", header: "As on", render: a => fmtDate(a.opening_date) },
        { key: "balance", header: "Current balance", money: true, total: true },
        { key: "active", header: "Status", render: a => a.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge> },
      ]} emptyHint="Set the opening balance on the day you start using the app." />
  );
}

function Me() {
  const { session, fullName, role } = useAuth();
  const [name, setName] = useState(fullName ?? "");
  const [pw, setPw] = useState({ a: "", b: "" });
  const [busy, setBusy] = useState(false);
  const saveName = useAction(() => updateRow("profiles", session!.user.id, { full_name: name }), "Name updated");
  const changePw = async () => {
    if (pw.a.length < 8) return toast.error("Password must be at least 8 characters.");
    if (pw.a !== pw.b) return toast.error("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.a });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Password changed"); setPw({ a: "", b: "" }); }
  };
  return (
    <div className="grid max-w-4xl gap-5 md:grid-cols-2">
      <Section title="Profile">
        <div className="space-y-3 p-4">
          <Field label="Email"><Input disabled value={session?.user.email ?? ""} /></Field>
          <Field label="Role"><Input disabled value={role ? ROLE_LABEL[role] : ""} /></Field>
          <Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
          <button className="btn-primary" disabled={!name.trim() || saveName.isPending} onClick={() => saveName.mutate(undefined)}>Save</button>
        </div>
      </Section>
      <Section title="Change password">
        <div className="space-y-3 p-4">
          <Field label="New password"><Input type="password" autoComplete="new-password" value={pw.a} onChange={e => setPw({ ...pw, a: e.target.value })} /></Field>
          <Field label="Confirm"><Input type="password" autoComplete="new-password" value={pw.b} onChange={e => setPw({ ...pw, b: e.target.value })} /></Field>
          <button className="btn-primary" disabled={busy} onClick={changePw}>{busy && <Spinner className="text-white" />}Change password</button>
        </div>
      </Section>
    </div>
  );
}
