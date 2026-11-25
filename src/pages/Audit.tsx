import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RotateCcw, CheckCheck } from "lucide-react";
import { useList, useRpc, useAction, rpc, type Row } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, todayISO, addDays, titleCase } from "@/lib/format";
import { PageHeader, Tabs, Toolbar, MiniField, Select, Input, Badge, Drawer, Loading, Empty, cx } from "@/components/ui";
import { DataTable } from "@/components/DataTable";

type Tab = "log" | "alerts" | "deleted";
const TONE: Record<string, string> = { create: "green", update: "blue", delete: "red", restore: "amber", void: "red", unvoid: "amber" };

export function AuditPage() {
  const { role } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || (role === "md" ? "alerts" : "log");
  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Every create, edit, void and delete — who did it, when, and what changed">
        <Tabs value={tab} onChange={t => setSp({ tab: t })} tabs={[
          { key: "alerts", label: "MD alerts", hidden: role !== "md" }, { key: "log", label: "Activity log" }, { key: "deleted", label: "Deleted items" },
        ]} />
      </PageHeader>
      {tab === "log" && <Log />}
      {tab === "alerts" && role === "md" && <Alerts />}
      {tab === "deleted" && <Deleted />}
    </div>
  );
}

function Changes({ r }: { r: Row }) {
  if (r.action === "update" && r.changes) {
    return <div className="space-y-0.5">{Object.entries(r.changes as Record<string, [unknown, unknown]>).map(([k, [a, b]]) => (
      <div key={k} className="text-xs"><span className="text-ink-500">{k.replace(/_/g, " ")}:</span> <span className="text-red-600 line-through">{String(a ?? "—")}</span> → <span className="text-emerald-700">{String(b ?? "—")}</span></div>))}</div>;
  }
  return r.reason ? <span className="text-xs">Reason: {r.reason}</span> : null;
}

function Log() {
  const [from, setFrom] = useState(addDays(todayISO(), -30));
  const [to, setTo] = useState(todayISO());
  const [action, setAction] = useState("");
  const [who, setWho] = useState("");
  const [table, setTable] = useState("");
  const list = useList("audit_log", { gte: { at: from }, lte: { at: to + "T23:59:59" }, eq: { action: action || undefined, actor_role: who || undefined, table_name: table || undefined }, order: [{ col: "at", asc: false }], limit: 3000 });
  const [open, setOpen] = useState<Row | null>(null);
  const tables = [...new Set((list.data ?? []).map(r => r.table_name))].sort();
  return (
    <div>
      <Toolbar>
        <MiniField label="From"><Input type="date" className="w-40 py-1.5" value={from} onChange={e => setFrom(e.target.value)} /></MiniField>
        <MiniField label="To"><Input type="date" className="w-40 py-1.5" value={to} onChange={e => setTo(e.target.value)} /></MiniField>
        <MiniField label="Action"><Select className="w-36 py-1.5" value={action} onChange={e => setAction(e.target.value)}><option value="">All</option>{Object.keys(TONE).map(a => <option key={a} value={a}>{titleCase(a)}</option>)}</Select></MiniField>
        <MiniField label="By role"><Select className="w-36 py-1.5" value={who} onChange={e => setWho(e.target.value)}><option value="">Everyone</option><option value="md">MD</option><option value="accountant">Accountant</option><option value="supervisor">Supervisor</option></Select></MiniField>
        <MiniField label="Record type"><Select className="w-44 py-1.5" value={table} onChange={e => setTable(e.target.value)}><option value="">All</option>{tables.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></MiniField>
      </Toolbar>
      <DataTable rows={list.data} loading={list.isLoading} onRowClick={setOpen} exportName="audit_log"
        cols={[
          { key: "at", header: "When", render: r => <span className="whitespace-nowrap">{fmtDateTime(r.at)}</span> },
          { key: "actor_name", header: "Who", render: r => <div><div>{r.actor_name ?? "System"}</div><div className="text-xs capitalize text-ink-500">{r.actor_role}</div></div> },
          { key: "action", header: "Action", render: r => <Badge tone={TONE[r.action]}>{titleCase(r.action)}</Badge> },
          { key: "table_name", header: "Record", value: r => `${titleCase(r.table_name)} ${r.record_label ?? ""}`, render: r => <div><div className="font-medium">{r.record_label ?? "—"}</div><div className="text-xs text-ink-500">{titleCase(r.table_name)}</div></div> },
          { key: "changes", header: "What changed", value: r => r.reason ?? JSON.stringify(r.changes ?? ""), render: r => <Changes r={r} /> },
        ]} emptyTitle="No activity in this period" />
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `${titleCase(open.action)} · ${open.record_label ?? ""}` : ""} subtitle={open ? `${open.actor_name ?? "System"} · ${fmtDateTime(open.at)}` : ""}>
        {open && <div className="space-y-4 p-6 text-sm">
          {open.reason && <div><b>Reason:</b> {open.reason}</div>}
          <Changes r={open} />
          {(open.new_data || open.old_data) && <pre className="max-h-[60vh] overflow-auto rounded-md bg-slate-50 p-3 text-xs">{JSON.stringify(open.new_data ?? open.old_data, null, 2)}</pre>}
        </div>}
      </Drawer>
    </div>
  );
}

function Alerts() {
  const [onlyUnread, setOnlyUnread] = useState(true);
  const list = useList("notifications", { order: [{ col: "created_at", asc: false }], limit: 500 });
  const mark = useAction((ids: number[] | null) => rpc("mark_notifications_read", { p_ids: ids }), "Marked as read");
  const rows = (list.data ?? []).filter(r => !onlyUnread || !r.is_read);
  if (list.isLoading) return <Loading />;
  return (
    <div className="p-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-ink-600">You are alerted whenever the accountant or a supervisor edits, voids or deletes something.</div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyUnread} onChange={e => setOnlyUnread(e.target.checked)} /> Unread only</label>
          <button className="btn-secondary py-1.5" disabled={!rows.some(r => !r.is_read)} onClick={() => mark.mutate(null)}><CheckCheck className="h-4 w-4" /> Mark all read</button>
        </div>
      </div>
      {rows.length === 0 ? <Empty title={onlyUnread ? "No unread alerts" : "No alerts yet"} /> : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {rows.map(r => (
            <div key={r.id} className={cx("flex items-start gap-3 px-4 py-3", !r.is_read && "bg-brand-50/40")}>
              <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", r.is_read ? "bg-transparent" : "bg-brand-500")} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{r.title}</div>
                {r.body && <div className="text-sm text-ink-600">{r.body}</div>}
                <div className="mt-0.5 text-xs text-ink-400">{fmtDateTime(r.created_at)}</div>
              </div>
              {!r.is_read && <button className="text-xs text-brand-600 hover:underline" onClick={() => mark.mutate([r.id])}>Mark read</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Deleted() {
  const list = useRpc<Row[]>("list_deleted");
  const restore = useAction((r: Row) => rpc("restore_record", { p_table: r.table_name, p_id: r.id }), "Restored");
  return (
    <DataTable rows={list.data} loading={list.isLoading} exportName="deleted_items" rowKey={r => r.table_name + r.id}
      cols={[
        { key: "deleted_at", header: "Deleted on", render: r => fmtDateTime(r.deleted_at) },
        { key: "table_name", header: "Type", value: r => titleCase(r.table_name) },
        { key: "label", header: "Record", render: r => <span className="font-medium">{r.label}</span> },
        { key: "deleted_by_name", header: "Deleted by" },
        { key: "reason", header: "Reason" },
        { key: "x", header: "", csv: false, render: r => <button className="btn-secondary px-2 py-1 text-xs" disabled={restore.isPending} onClick={() => restore.mutate(r)}><RotateCcw className="h-3.5 w-3.5" /> Restore</button> },
      ]} emptyTitle="Nothing deleted" emptyHint="Deleted entries can be restored from here." />
  );
}
