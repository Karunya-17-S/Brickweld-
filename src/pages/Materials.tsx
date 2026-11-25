import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Printer, PackageCheck, FileText } from "lucide-react";
import { useList, useRpc, useAction, rpc, updateRow, type Row } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/perms";
import { inr, n, qty, fmtDate } from "@/lib/format";
import { PageHeader, Tabs, Toolbar, MiniField, Select, Drawer, KV, Section, Badge, StatusBadge, ReasonDialog, Stat, cx } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { ProjectSelect, PartySelect, useProjects, useParties } from "@/components/pickers";
import { useForms } from "@/components/FormHost";
import { BillDrawer, History } from "./Accounts";

type Tab = "indents" | "po" | "grn" | "stock";

export function MaterialsPage() {
  const { role } = useAuth();
  const fin = can.money(role);
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || (fin ? "po" : "indents");
  const { openForm } = useForms();
  const [project, setProject] = useState("");
  return (
    <div>
      <PageHeader title="Materials" subtitle="Indent → Purchase order → Goods receipt → Supplier bill → Payment"
        actions={<>
          <button className="btn-secondary" onClick={() => openForm("indent", { projectId: project || undefined })}><Plus className="h-4 w-4" /> Indent</button>
          {fin && <button className="btn-secondary" onClick={() => openForm("po")}><Plus className="h-4 w-4" /> Purchase order</button>}
          <button className="btn-primary" onClick={() => openForm("grn")}><PackageCheck className="h-4 w-4" /> Receive goods</button>
        </>}>
        <Tabs value={tab} onChange={t => setSp({ tab: t })} tabs={[
          { key: "indents", label: "Indents" }, { key: "po", label: "Purchase orders", hidden: !fin },
          { key: "grn", label: "Goods received" }, { key: "stock", label: "Received by site" },
        ]} />
      </PageHeader>
      <Toolbar>
        <MiniField label="Project"><ProjectSelect className="w-64 py-1.5" value={project} onChange={setProject} placeholder="All projects" /></MiniField>
      </Toolbar>
      {tab === "indents" && <Indents project={project} />}
      {tab === "po" && fin && <POs project={project} />}
      {tab === "grn" && <GRNs project={project} />}
      {tab === "stock" && <SiteMaterials project={project} />}
    </div>
  );
}

function useNames() {
  const projects = useProjects();
  const parties = useParties();
  return {
    proj: (id: string) => (projects.data ?? []).find(p => p.id === id),
    party: (id: string) => (parties.data ?? []).find(p => p.id === id)?.name ?? "",
  };
}

// ---------------- Indents ----------------
function Indents({ project }: { project: string }) {
  const { role } = useAuth();
  const fin = can.money(role);
  const { openForm } = useForms();
  const { proj } = useNames();
  const [status, setStatus] = useState("open");
  const list = useList("material_requests", { eq: { project_id: project || undefined }, order: [{ col: "req_date", asc: false }] });
  const items = useList("material_request_items", { inList: { request_id: (list.data ?? []).map(r => r.id) }, enabled: !!list.data?.length });
  const [open, setOpen] = useState<Row | null>(null);
  const rows = (list.data ?? []).filter(r => status === "all" || (status === "open" ? ["pending", "approved"].includes(r.status) : r.status === status));
  const itemsOf = (id: string) => (items.data ?? []).filter(i => i.request_id === id);
  const setSt = useAction((a: { id: string; s: string }) => rpc("set_request_status", { p_id: a.id, p_status: a.s }), "Indent updated");
  const [del, setDel] = useState(false);
  const delA = useAction((r: string) => rpc("soft_delete", { p_table: "material_requests", p_id: open!.id, p_reason: r }), "Indent deleted");
  return (
    <div>
      <div className="flex items-center gap-2 px-6 pt-3">
        <Select className="w-44 py-1.5" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="open">Pending & approved</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="ordered">Ordered</option><option value="rejected">Rejected</option><option value="all">All</option>
        </Select>
      </div>
      <DataTable rows={rows} loading={list.isLoading} onRowClick={setOpen} exportName="indents"
        cols={[
          { key: "req_no", header: "Indent", render: r => <span className="link">{r.req_no}</span> },
          { key: "req_date", header: "Date", render: r => fmtDate(r.req_date) },
          { key: "project", header: "Project", value: r => proj(r.project_id)?.name },
          { key: "items", header: "Items", value: r => itemsOf(r.id).map(i => i.material_name).join(", "),
            render: r => <span className="text-ink-600">{itemsOf(r.id).map(i => `${i.material_name} ${qty(i.qty)} ${i.unit}`).join(" · ")}</span> },
          { key: "required_by", header: "Needed by", render: r => fmtDate(r.required_by) },
          { key: "status", header: "Status", render: r => <StatusBadge status={r.status} /> },
        ]} emptyTitle="No indents" emptyHint="Site supervisors raise an indent when they need material." />
      {open && (
        <Drawer open onClose={() => setOpen(null)} title={<span>{open.req_no} <StatusBadge status={open.status} /></span>} subtitle={`${proj(open.project_id)?.name ?? ""} · ${fmtDate(open.req_date)}`}
          actions={<>
            {fin && ["pending", "approved"].includes(open.status) && <button className="btn-primary py-1.5" onClick={() => { const r = open; setOpen(null); openForm("po", { fromIndent: { ...r, items: itemsOf(r.id) } }); }}>Create PO</button>}
            {fin && open.status === "pending" && <button className="btn-secondary py-1.5" onClick={() => setSt.mutate({ id: open.id, s: "approved" }, { onSuccess: () => setOpen({ ...open, status: "approved" }) })}>Approve</button>}
            {fin && ["pending", "approved"].includes(open.status) && <button className="btn-secondary py-1.5" onClick={() => setSt.mutate({ id: open.id, s: "rejected" }, { onSuccess: () => setOpen(null) })}>Reject</button>}
            {open.status === "pending" && <button className="btn-secondary py-1.5" onClick={() => { const r = open; setOpen(null); openForm("indent", { initial: { ...r, items: itemsOf(r.id) } }); }}>Edit</button>}
            {fin && <button className="btn-ghost py-1.5 text-red-600" onClick={() => setDel(true)}>Delete</button>}
          </>}>
          <div className="space-y-5 p-6">
            <KV items={[["Needed by", fmtDate(open.required_by)], ["Notes", open.notes]]} />
            <Section title="Items">
              <table className="w-full text-sm"><thead><tr><th className="th">Material</th><th className="th text-right">Qty</th><th className="th">Notes</th></tr></thead>
                <tbody>{itemsOf(open.id).map(i => <tr key={i.id}><td className="td">{i.material_name}</td><td className="td text-right">{qty(i.qty)} {i.unit}</td><td className="td text-ink-500">{i.notes}</td></tr>)}</tbody></table>
            </Section>
          </div>
          <ReasonDialog open={del} onClose={() => setDel(false)} title="Delete indent" message={`Delete ${open.req_no}?`} busy={delA.isPending}
            onConfirm={r => delA.mutate(r, { onSuccess: () => { setDel(false); setOpen(null); } })} />
        </Drawer>
      )}
    </div>
  );
}

// ---------------- Purchase orders ----------------
function POs({ project }: { project: string }) {
  const { proj, party } = useNames();
  const [supplier, setSupplier] = useState("");
  const [status, setStatus] = useState("open");
  const list = useList("purchase_orders", { eq: { project_id: project || undefined, supplier_id: supplier || undefined }, order: [{ col: "po_date", asc: false }] });
  const [sp, setSp] = useSearchParams();
  const rows = (list.data ?? []).filter(r => status === "all" || (status === "open" ? ["issued", "partial"].includes(r.status) : r.status === status));
  const openPo = (list.data ?? []).find(p => p.id === sp.get("id")) ?? null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-6 pt-3">
        <Select className="w-44 py-1.5" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="open">Open (to receive)</option><option value="issued">Issued</option><option value="partial">Partly received</option><option value="received">Received</option><option value="cancelled">Cancelled</option><option value="all">All</option>
        </Select>
        <PartySelect type="supplier" className="w-56 py-1.5" value={supplier} onChange={setSupplier} placeholder="All suppliers" />
      </div>
      <DataTable rows={rows} loading={list.isLoading} onRowClick={r => setSp({ tab: "po", id: r.id })} exportName="purchase_orders"
        cols={[
          { key: "po_no", header: "PO", render: r => <span className="link">{r.po_no}</span> },
          { key: "po_date", header: "Date", render: r => fmtDate(r.po_date) },
          { key: "supplier", header: "Supplier", value: r => party(r.supplier_id) },
          { key: "project", header: "Project", value: r => proj(r.project_id)?.name },
          { key: "expected_date", header: "Expected", render: r => fmtDate(r.expected_date) },
          { key: "total", header: "Amount", money: true, total: true },
          { key: "status", header: "Status", render: r => <StatusBadge status={r.status} /> },
        ]} emptyTitle="No purchase orders" />
      <PODrawer po={openPo} onClose={() => setSp({ tab: "po" })} />
    </div>
  );
}

function PODrawer({ po, onClose }: { po: Row | null; onClose: () => void }) {
  const { openForm } = useForms();
  const { proj, party } = useNames();
  const items = useList("po_items", { eq: { po_id: po?.id }, order: [{ col: "sort_order" }], enabled: !!po });
  const lines = useRpc<Row[]>("get_po_lines_for_receipt", { p_po: po?.id }, !!po);
  const grns = useList("goods_receipts", { eq: { po_id: po?.id }, order: [{ col: "grn_date", asc: false }], enabled: !!po });
  const bills = useList("v_bill_balances", { inList: { grn_id: (grns.data ?? []).map(g => g.id) }, enabled: !!grns.data?.length });
  const history = useList("audit_log", { eq: { record_id: po?.id }, order: [{ col: "at", asc: false }], enabled: !!po });
  const [act, setAct] = useState<"cancel" | "delete" | null>(null);
  const cancel = useAction((r: string) => updateRow("purchase_orders", po!.id, { status: "cancelled", notes: [po!.notes, `Cancelled: ${r}`].filter(Boolean).join("\n") }), "PO cancelled");
  const del = useAction((r: string) => rpc("soft_delete", { p_table: "purchase_orders", p_id: po!.id, p_reason: r }), "PO deleted");
  const [bill, setBill] = useState<Row | null>(null);
  if (!po) return null;
  const pend = (id: string) => (lines.data ?? []).find(l => l.po_item_id === id);
  const canReceive = ["issued", "partial"].includes(po.status);
  return (
    <Drawer open onClose={onClose} width="max-w-4xl" title={<span>{po.po_no} <StatusBadge status={po.status} /></span>} subtitle={`${party(po.supplier_id)} · ${proj(po.project_id)?.name ?? ""} · ${fmtDate(po.po_date)}`}
      actions={<>
        {canReceive && <button className="btn-primary py-1.5" onClick={() => { onClose(); openForm("grn", { poId: po.id }); }}><PackageCheck className="h-4 w-4" /> Receive goods</button>}
        <button className="btn-secondary py-1.5" onClick={() => printPO(po, items.data ?? [], party(po.supplier_id), proj(po.project_id))}><Printer className="h-4 w-4" /> Print</button>
        {po.status === "issued" && !(grns.data ?? []).length && <button className="btn-secondary py-1.5" onClick={() => { onClose(); openForm("po", { initial: { ...po, items: items.data } }); }}>Edit</button>}
        {canReceive && <button className="btn-secondary py-1.5" onClick={() => setAct("cancel")}>Cancel PO</button>}
        {!(grns.data ?? []).length && <button className="btn-ghost py-1.5 text-red-600" onClick={() => setAct("delete")}>Delete</button>}
      </>}>
      <div className="space-y-5 p-6">
        <KV items={[["Expected", fmtDate(po.expected_date)], ["Terms", po.terms], ["Notes", po.notes]]} />
        <Section title="Items">
          <table className="w-full text-sm">
            <thead><tr><th className="th">Material</th><th className="th text-right">Ordered</th><th className="th text-right">Received</th><th className="th text-right">Pending</th><th className="th text-right">Rate</th><th className="th text-right">GST</th><th className="th text-right">Amount</th></tr></thead>
            <tbody>{(items.data ?? []).map(i => { const l = pend(i.id); return (
              <tr key={i.id}><td className="td">{i.material_name}</td><td className="td text-right">{qty(i.qty)} {i.unit}</td>
                <td className="td text-right">{qty(l?.received ?? 0)}</td><td className={cx("td text-right", n(l?.pending) > 0 && "font-medium text-amber-700")}>{qty(l?.pending ?? i.qty)}</td>
                <td className="td text-right tabular-nums">{inr(i.rate)}</td><td className="td text-right">{n(i.gst_percent)}%</td><td className="td text-right tabular-nums">{inr(n(i.amount) + n(i.tax))}</td></tr>); })}</tbody>
            <tfoot><tr className="font-semibold"><td colSpan={6} className="px-4 py-2 text-right">Total</td><td className="px-4 py-2 text-right tabular-nums">{inr(po.total)}</td></tr></tfoot>
          </table>
        </Section>
        <Section title="Goods receipts & bills">
          {(grns.data ?? []).length === 0 ? <div className="px-4 py-3 text-sm text-ink-500">Nothing received yet.</div> : (
            <table className="w-full text-sm"><tbody>{(grns.data ?? []).map(g => { const b = (bills.data ?? []).find(x => x.grn_id === g.id); return (
              <tr key={g.id} className="border-t border-slate-100"><td className="px-4 py-2 font-medium">{g.grn_no}</td><td className="px-4 py-2">{fmtDate(g.grn_date)}</td><td className="px-4 py-2 text-ink-500">{g.challan_no ? `Challan ${g.challan_no}` : ""}</td>
                <td className="px-4 py-2 text-right">{b ? <button className="link" onClick={() => setBill(b)}>{b.bill_no} · {inr(b.total)} <StatusBadge status={b.status} /></button> : <Badge tone="amber">Not billed</Badge>}</td></tr>); })}</tbody></table>
          )}
        </Section>
        <History rows={history.data} />
      </div>
      <BillDrawer bill={bill} onClose={() => setBill(null)} />
      <ReasonDialog open={act === "cancel"} onClose={() => setAct(null)} title="Cancel purchase order" confirmLabel="Cancel PO" message="Items not yet received will no longer be expected." busy={cancel.isPending}
        onConfirm={r => cancel.mutate(r, { onSuccess: () => { setAct(null); onClose(); } })} />
      <ReasonDialog open={act === "delete"} onClose={() => setAct(null)} title="Delete purchase order" message={`Delete ${po.po_no}?`} busy={del.isPending}
        onConfirm={r => del.mutate(r, { onSuccess: () => { setAct(null); onClose(); } })} />
    </Drawer>
  );
}

function esc(s: unknown) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
function printPO(po: Row, items: Row[], supplier: string, project?: Row) {
  const w = window.open("", "_blank");
  if (!w) return;
  const rows = items.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.material_name)}</td><td class=r>${qty(i.qty)} ${esc(i.unit)}</td><td class=r>${inr(i.rate)}</td><td class=r>${n(i.gst_percent)}%</td><td class=r>${inr(n(i.amount) + n(i.tax))}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><title>${esc(po.po_no)}</title><style>
    body{font-family:Inter,Arial,sans-serif;color:#1e2235;margin:40px;font-size:13px}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin-top:20px}
    th,td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left}th{background:#f8fafc;font-size:11px;text-transform:uppercase;color:#64748b}.r{text-align:right}
    .top{display:flex;justify-content:space-between}.muted{color:#64748b}</style></head><body>
    <div class=top><div><h1>Brickweld Private Limited</h1><div class=muted>Purchase Order</div></div><div class=r><b>${esc(po.po_no)}</b><br>${fmtDate(po.po_date)}</div></div>
    <p><b>To:</b> ${esc(supplier)}<br><b>Deliver to:</b> ${esc(project?.name)} ${esc(project?.site_address ?? "")}${po.expected_date ? `<br><b>Expected by:</b> ${fmtDate(po.expected_date)}` : ""}</p>
    <table><thead><tr><th>#</th><th>Material</th><th class=r>Qty</th><th class=r>Rate</th><th class=r>GST</th><th class=r>Amount</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan=5 class=r>Sub total</td><td class=r>${inr(po.subtotal)}</td></tr><tr><td colspan=5 class=r>GST</td><td class=r>${inr(po.tax_amount)}</td></tr><tr><td colspan=5 class=r><b>Total</b></td><td class=r><b>${inr(po.total)}</b></td></tr></tfoot></table>
    ${po.terms ? `<p><b>Terms:</b> ${esc(po.terms)}</p>` : ""}<p style="margin-top:60px" class=r>Authorised signatory</p>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

// ---------------- GRNs ----------------
function GRNs({ project }: { project: string }) {
  const { role } = useAuth();
  const fin = can.money(role);
  const { openForm } = useForms();
  const { proj, party } = useNames();
  const list = useList("goods_receipts", { eq: { project_id: project || undefined }, order: [{ col: "grn_date", asc: false }] });
  const items = useList("grn_items", { inList: { grn_id: (list.data ?? []).map(g => g.id) }, enabled: !!list.data?.length });
  const bills = useList("v_bill_balances", { select: "id,bill_no,grn_id,total,status,balance,party_id,bill_type,project_name,party_name,bill_date,is_void", inList: { grn_id: (list.data ?? []).map(g => g.id) }, enabled: fin && !!list.data?.length });
  const [onlyUnbilled, setOnlyUnbilled] = useState(false);
  const [open, setOpen] = useState<Row | null>(null);
  const billOf = (id: string) => (bills.data ?? []).find(b => b.grn_id === id && !b.is_void);
  const itemsOf = (id: string) => (items.data ?? []).filter(i => i.grn_id === id);
  const rows = (list.data ?? []).filter(g => !onlyUnbilled || !billOf(g.id));
  const unbilled = fin ? (list.data ?? []).filter(g => !billOf(g.id)).length : 0;
  return (
    <div>
      {fin && unbilled > 0 && (
        <div className="mx-6 mt-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span><b>{unbilled}</b> goods receipt{unbilled > 1 ? "s are" : " is"} not billed yet — the supplier payable isn't recorded until you bill it.</span>
          <button className="btn-secondary py-1" onClick={() => setOnlyUnbilled(!onlyUnbilled)}>{onlyUnbilled ? "Show all" : "Show unbilled"}</button>
        </div>
      )}
      <DataTable rows={rows} loading={list.isLoading} onRowClick={setOpen} exportName="goods_receipts"
        cols={[
          { key: "grn_no", header: "GRN", render: r => <span className="link">{r.grn_no}</span> },
          { key: "grn_date", header: "Date", render: r => fmtDate(r.grn_date) },
          { key: "supplier", header: "Supplier", value: r => party(r.supplier_id) },
          { key: "project", header: "Project", value: r => proj(r.project_id)?.name },
          { key: "items", header: "Items", value: r => itemsOf(r.id).map(i => i.material_name).join(", "), render: r => <span className="text-ink-600">{itemsOf(r.id).map(i => `${i.material_name} ${qty(i.qty)} ${i.unit}`).join(" · ")}</span> },
          { key: "challan_no", header: "Challan" },
          ...(fin ? [{ key: "bill", header: "Bill", value: (r: Row) => billOf(r.id)?.bill_no ?? "Not billed",
            render: (r: Row) => { const b = billOf(r.id); return b ? <span>{b.bill_no} <StatusBadge status={b.status} /></span> : <button className="btn-secondary px-2 py-1 text-xs" onClick={e => { e.stopPropagation(); openForm("billgrn", { grn: r }); }}><FileText className="h-3.5 w-3.5" /> Create bill</button>; } }] : []),
        ]} emptyTitle="No goods received yet" />
      <GRNDrawer grn={open} bill={open ? billOf(open.id) : undefined} items={open ? itemsOf(open.id) : []} onClose={() => setOpen(null)} />
    </div>
  );
}

function GRNDrawer({ grn, bill, items, onClose }: { grn: Row | null; bill?: Row; items: Row[]; onClose: () => void }) {
  const { role } = useAuth();
  const fin = can.money(role);
  const { openForm } = useForms();
  const { proj, party } = useNames();
  const po = useList("purchase_orders", { select: "id,po_no", eq: { id: grn?.po_id }, enabled: fin && !!grn?.po_id }).data?.[0];
  const history = useList("audit_log", { eq: { record_id: grn?.id }, order: [{ col: "at", asc: false }], enabled: fin && !!grn });
  const [del, setDel] = useState(false);
  const [bd, setBd] = useState<Row | null>(null);
  const delA = useAction((r: string) => rpc("soft_delete", { p_table: "goods_receipts", p_id: grn!.id, p_reason: r }), "Goods receipt deleted");
  if (!grn) return null;
  return (
    <Drawer open onClose={onClose} title={grn.grn_no} subtitle={`${party(grn.supplier_id)} · ${proj(grn.project_id)?.name ?? ""} · ${fmtDate(grn.grn_date)}`}
      actions={fin && <>
        {!bill && <button className="btn-primary py-1.5" onClick={() => { onClose(); openForm("billgrn", { grn }); }}>Create bill</button>}
        {bill && <button className="btn-secondary py-1.5" onClick={() => setBd(bill)}>Open bill {bill.bill_no}</button>}
        <button className="btn-ghost py-1.5 text-red-600" onClick={() => setDel(true)}>Delete</button>
      </>}>
      <div className="space-y-5 p-6">
        <KV items={[["Against PO", po?.po_no ?? (grn.po_id ? "PO" : "Direct purchase")], ["Challan", grn.challan_no], ["Vehicle", grn.vehicle_no], ["Notes", grn.notes]]} />
        <Section title="Received">
          <table className="w-full text-sm"><tbody>{items.map(i => <tr key={i.id} className="border-t border-slate-100"><td className="px-4 py-2">{i.material_name}</td><td className="px-4 py-2 text-right">{qty(i.qty)} {i.unit}</td></tr>)}</tbody></table>
        </Section>
        {fin && bill && <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">Bill <b>{bill.bill_no}</b> · {inr(bill.total)} · balance {inr(bill.balance)} <StatusBadge status={bill.status} /></div>}
        <History rows={history.data} />
      </div>
      <BillDrawer bill={bd} onClose={() => setBd(null)} />
      <ReasonDialog open={del} onClose={() => setDel(false)} title="Delete goods receipt" busy={delA.isPending}
        message={<>Delete {grn.grn_no}?{bill ? <> Its bill <b>{bill.bill_no}</b> will be deleted too (only allowed if it has no payments).</> : null} The PO's received quantity is recalculated.</>}
        onConfirm={r => delA.mutate(r, { onSuccess: () => { setDel(false); onClose(); } })} />
    </Drawer>
  );
}

// ---------------- Received by site (material summary) ----------------
function SiteMaterials({ project }: { project: string }) {
  const { role } = useAuth();
  const fin = can.money(role);
  const { proj } = useNames();
  const grns = useList("goods_receipts", { select: "id,project_id,grn_date", eq: { project_id: project || undefined } });
  const items = useList("grn_items", { inList: { grn_id: (grns.data ?? []).map(g => g.id) }, enabled: !!grns.data?.length });
  const bills = useList("v_bill_balances", { select: "project_id,total,bill_type,is_void", eq: { bill_type: "supplier", project_id: project || undefined }, enabled: fin });
  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const i of items.data ?? []) {
      const g = (grns.data ?? []).find(x => x.id === i.grn_id); if (!g) continue;
      const k = g.project_id + "|" + i.material_name.toLowerCase() + "|" + i.unit;
      const r = m.get(k) ?? { key: k, project_id: g.project_id, material_name: i.material_name, unit: i.unit, qty: 0, receipts: 0, last: "" };
      r.qty += n(i.qty); r.receipts += 1; if (g.grn_date > r.last) r.last = g.grn_date; m.set(k, r);
    }
    return [...m.values()];
  }, [items.data, grns.data]);
  const spend = (bills.data ?? []).filter(b => !b.is_void).reduce((s, b) => s + n(b.total), 0);
  return (
    <div>
      {fin && <div className="grid grid-cols-1 gap-4 px-6 pt-4 md:grid-cols-3"><Stat label={project ? "Material cost (this project)" : "Material cost (all projects)"} value={inr(spend)} sub="Total of supplier bills" /></div>}
      <DataTable rows={rows} loading={grns.isLoading || items.isLoading} exportName="materials_received" rowKey={r => r.key}
        cols={[
          { key: "project", header: "Project", value: r => proj(r.project_id)?.name },
          { key: "material_name", header: "Material" },
          { key: "qty", header: "Total received", align: "right", value: r => r.qty, render: r => `${qty(r.qty)} ${r.unit}` },
          { key: "receipts", header: "Deliveries", align: "right" },
          { key: "last", header: "Last received", render: r => fmtDate(r.last) },
        ]} emptyTitle="No materials received yet" />
    </div>
  );
}
