import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal, Field, Input, Textarea, MoneyInput, Select, Spinner } from "../ui";
import { MaterialInput, PartySelect, ProjectSelect, UnitSelect, useJobTypes } from "../pickers";
import { useAction, useList, useRpc, rpc, insertRow, updateRow, clean, fetchAll, type Row } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/perms";
import { inr, n, qty, todayISO, addDays } from "@/lib/format";

interface Base { open: boolean; onClose: () => void }
function Footer({ onClose, busy, disabled, label = "Save" }: { onClose: () => void; busy?: boolean; disabled?: boolean; label?: string }) {
  return <>
    <button className="btn-secondary" onClick={onClose} type="button">Cancel</button>
    <button className="btn-primary" type="submit" form="dform" disabled={busy || disabled}>{busy && <Spinner className="text-white" />}{label}</button>
  </>;
}
const th = "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500";

// ---------------- Indent (material request) ----------------
export function IndentForm({ open, onClose, initial, projectId }: Base & { initial?: Row; projectId?: string }) {
  const [h, setH] = useState<Row>({});
  const [items, setItems] = useState<Row[]>([]);
  useEffect(() => {
    if (!open) return;
    setH({ project_id: initial?.project_id ?? projectId ?? "", req_date: initial?.req_date ?? todayISO(), required_by: initial?.required_by ?? "", notes: initial?.notes ?? "" });
    if (initial?.id) fetchAll("material_request_items", { eq: { request_id: initial.id } }).then(setItems);
    else setItems([{ material_name: "", unit: "bag", qty: "" }]);
  }, [open, initial, projectId]);
  const save = useAction(() => rpc("save_material_request", { p_id: initial?.id ?? null, p_header: h, p_items: items.filter(i => i.material_name && n(i.qty) > 0).map(i => ({ material_name: i.material_name, unit: i.unit, qty: n(i.qty), notes: i.notes ?? null })) }), initial ? "Indent updated" : "Indent raised");
  const ok = h.project_id && items.some(i => i.material_name && n(i.qty) > 0);
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title={initial ? `Edit indent ${initial.req_no}` : "New material indent"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="dform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Project / site" required className="col-span-3 md:col-span-1"><ProjectSelect value={h.project_id ?? ""} onChange={v => setH({ ...h, project_id: v })} onlyOpen /></Field>
          <Field label="Date"><Input type="date" value={h.req_date ?? ""} onChange={e => setH({ ...h, req_date: e.target.value })} /></Field>
          <Field label="Needed by"><Input type="date" value={h.required_by ?? ""} onChange={e => setH({ ...h, required_by: e.target.value })} /></Field>
        </div>
        <ItemsTable items={items} setItems={setItems} />
        <Field label="Notes"><Textarea value={h.notes ?? ""} onChange={e => setH({ ...h, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

function ItemsTable({ items, setItems }: { items: Row[]; setItems: (r: Row[]) => void }) {
  return (
    <div className="rounded-lg border border-slate-200">
      <table className="w-full">
        <thead className="border-b border-slate-200 bg-slate-50"><tr><th className={th}>Material</th><th className={th + " w-32"}>Unit</th><th className={th + " w-32"}>Qty</th><th className="w-10" /></tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="p-1.5"><MaterialInput value={it.material_name ?? ""} onChange={v => setItems(items.map((x, j) => j === i ? { ...x, material_name: v } : x))} onPick={m => setItems(items.map((x, j) => j === i ? { ...x, material_name: m.name, unit: m.unit } : x))} /></td>
              <td className="p-1.5"><UnitSelect value={it.unit ?? "nos"} onChange={v => setItems(items.map((x, j) => j === i ? { ...x, unit: v } : x))} /></td>
              <td className="p-1.5"><Input type="number" min="0" step="any" value={it.qty ?? ""} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} className="text-right" /></td>
              <td className="p-1.5 text-center"><button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-ink-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="m-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline" onClick={() => setItems([...items, { material_name: "", unit: "nos", qty: "" }])}><Plus className="h-4 w-4" /> Add line</button>
    </div>
  );
}

// ---------------- Purchase order ----------------
export function POForm({ open, onClose, initial, fromIndent }: Base & { initial?: Row; fromIndent?: Row }) {
  const [h, setH] = useState<Row>({});
  const [items, setItems] = useState<Row[]>([]);
  useEffect(() => {
    if (!open) return;
    if (initial?.id) {
      setH({ project_id: initial.project_id, supplier_id: initial.supplier_id, po_date: initial.po_date, expected_date: initial.expected_date ?? "", terms: initial.terms ?? "", notes: initial.notes ?? "", request_id: initial.request_id ?? "" });
      fetchAll("po_items", { eq: { po_id: initial.id }, order: [{ col: "sort_order" }] }).then(r => setItems(r.map(x => ({ ...x, qty: String(x.qty), rate: String(x.rate), gst_percent: String(x.gst_percent) }))));
    } else {
      setH({ project_id: fromIndent?.project_id ?? "", supplier_id: "", po_date: todayISO(), expected_date: fromIndent?.required_by ?? "", terms: "Delivery at site. Payment within 30 days of delivery.", notes: "", request_id: fromIndent?.id ?? "" });
      if (fromIndent?.id) fetchAll("material_request_items", { eq: { request_id: fromIndent.id } }).then(r => setItems(r.map(x => ({ material_name: x.material_name, unit: x.unit, qty: String(x.qty), rate: "", gst_percent: "18" }))));
      else setItems([{ material_name: "", unit: "bag", qty: "", rate: "", gst_percent: "18" }]);
    }
  }, [open, initial, fromIndent]);
  const totals = useMemo(() => {
    const sub = items.reduce((s, i) => s + n(i.qty) * n(i.rate), 0);
    const tax = items.reduce((s, i) => s + n(i.qty) * n(i.rate) * n(i.gst_percent) / 100, 0);
    return { sub, tax, total: sub + tax };
  }, [items]);
  const save = useAction(() => rpc<string>("save_purchase_order", {
    p_id: initial?.id ?? null, p_header: h,
    p_items: items.filter(i => i.material_name && n(i.qty) > 0).map(i => ({ id: i.id ?? null, material_name: i.material_name, unit: i.unit, qty: n(i.qty), rate: n(i.rate), gst_percent: n(i.gst_percent) })),
  }), initial ? "Purchase order updated" : "Purchase order created");
  const ok = h.project_id && h.supplier_id && items.some(i => i.material_name && n(i.qty) > 0) && items.every(i => !i.material_name || n(i.rate) >= 0);
  const set = (i: number, k: string, v: string) => setItems(items.map((x, j) => j === i ? { ...x, [k]: v } : x));
  return (
    <Modal open={open} onClose={onClose} width="max-w-5xl" title={initial ? `Edit ${initial.po_no}` : fromIndent ? `Purchase order from ${fromIndent.req_no}` : "New purchase order"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="dform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Supplier" required className="col-span-2"><PartySelect type="supplier" value={h.supplier_id ?? ""} onChange={v => setH({ ...h, supplier_id: v })} /></Field>
          <Field label="Project / site" required className="col-span-2"><ProjectSelect value={h.project_id ?? ""} onChange={v => setH({ ...h, project_id: v })} onlyOpen /></Field>
          <Field label="PO date"><Input type="date" value={h.po_date ?? ""} onChange={e => setH({ ...h, po_date: e.target.value })} /></Field>
          <Field label="Expected delivery"><Input type="date" value={h.expected_date ?? ""} onChange={e => setH({ ...h, expected_date: e.target.value })} /></Field>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr>
              <th className={th}>Item</th><th className={th + " w-28"}>Unit</th><th className={th + " w-24"}>Qty</th><th className={th + " w-32"}>Rate</th>
              <th className={th + " w-24"}>GST %</th><th className={th + " w-32 text-right"}>Amount</th><th className="w-9" /></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="p-1.5"><MaterialInput id="po-mat" value={it.material_name ?? ""} onChange={v => set(i, "material_name", v)} onPick={m => setItems(items.map((x, j) => j === i ? { ...x, material_name: m.name, unit: m.unit } : x))} /></td>
                  <td className="p-1.5"><UnitSelect value={it.unit ?? "nos"} onChange={v => set(i, "unit", v)} /></td>
                  <td className="p-1.5"><Input type="number" step="any" min="0" value={it.qty ?? ""} onChange={e => set(i, "qty", e.target.value)} className="text-right" /></td>
                  <td className="p-1.5"><MoneyInput value={it.rate ?? ""} onChange={v => set(i, "rate", v)} /></td>
                  <td className="p-1.5"><Select value={it.gst_percent ?? "0"} onChange={e => set(i, "gst_percent", e.target.value)}>{["0", "5", "12", "18", "28"].map(g => <option key={g} value={g}>{g}%</option>)}</Select></td>
                  <td className="p-1.5 text-right text-sm tabular-nums">{inr(n(it.qty) * n(it.rate) * (1 + n(it.gst_percent) / 100))}</td>
                  <td className="p-1.5 text-center"><button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-ink-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-start justify-between gap-4 p-2">
            <div className="flex gap-3">
              <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline" onClick={() => setItems([...items, { material_name: "", unit: "nos", qty: "", rate: "", gst_percent: "18" }])}><Plus className="h-4 w-4" /> Add line</button>
              <button type="button" className="text-sm font-medium text-brand-600 hover:underline" onClick={() => setItems([...items, { material_name: "Transport charges", unit: "trip", qty: "1", rate: "", gst_percent: "0" }])}>+ Transport charges</button>
            </div>
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-ink-500">Sub total</span><span className="tabular-nums">{inr(totals.sub)}</span></div>
              <div className="flex justify-between"><span className="text-ink-500">GST</span><span className="tabular-nums">{inr(totals.tax)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{inr(totals.total)}</span></div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Terms"><Textarea value={h.terms ?? ""} onChange={e => setH({ ...h, terms: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={h.notes ?? ""} onChange={e => setH({ ...h, notes: e.target.value })} /></Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Goods receipt (GRN) ----------------
// Opened from a PO, everything (project, supplier, items) comes from that PO — fixes the wrong-defaults bug.
export function GRNForm({ open, onClose, poId: poIdProp }: Base & { poId?: string }) {
  const { role } = useAuth();
  const fin = can.money(role);
  const [mode, setMode] = useState<"po" | "direct">("po");
  const [poId, setPoId] = useState("");
  const [h, setH] = useState<Row>({});
  const [lines, setLines] = useState<Row[]>([]);
  const openPos = useRpc<Row[]>("get_open_pos", {}, open);
  const poLines = useRpc<Row[]>("get_po_lines_for_receipt", { p_po: poId }, open && !!poId);
  useEffect(() => {
    if (!open) return;
    setMode("po"); setPoId(poIdProp ?? "");
    setH({ grn_date: todayISO(), challan_no: "", vehicle_no: "", notes: "", project_id: "", supplier_id: "", vendor_ref: "", due_date: addDays(todayISO(), 30) });
    setLines([{ material_name: "", unit: "nos", qty: "", rate: "", gst_percent: "0" }]);
  }, [open, poIdProp]);
  const po = (openPos.data ?? []).find(p => p.id === poId);
  const [recv, setRecv] = useState<Record<string, string>>({});
  useEffect(() => { // fill pending quantities when the PO lines load
    if (!poLines.data) return;
    setRecv(Object.fromEntries(poLines.data.map(l => [l.po_item_id, n(l.pending) > 0 ? String(n(l.pending)) : ""])));
  }, [poLines.data]);
  const save = useAction(async () => {
    if (mode === "po") {
      return rpc("create_goods_receipt", {
        p_po_id: poId, p_project_id: null, p_supplier_id: null, p_date: h.grn_date, p_challan: h.challan_no || null, p_vehicle: h.vehicle_no || null,
        p_notes: h.notes || null, p_items: Object.entries(recv).filter(([, v]) => n(v) > 0).map(([po_item_id, v]) => ({ po_item_id, qty: n(v) })),
        p_make_bill: true, p_vendor_ref: h.vendor_ref || null, p_due_date: h.due_date || null,
      });
    }
    return rpc("create_goods_receipt", {
      p_po_id: null, p_project_id: h.project_id, p_supplier_id: h.supplier_id, p_date: h.grn_date, p_challan: h.challan_no || null, p_vehicle: h.vehicle_no || null,
      p_notes: h.notes || null, p_items: lines.filter(l => l.material_name && n(l.qty) > 0).map(l => ({ material_name: l.material_name, unit: l.unit, qty: n(l.qty), rate: fin ? n(l.rate) : null, gst_percent: n(l.gst_percent) })),
      p_make_bill: fin, p_vendor_ref: h.vendor_ref || null, p_due_date: h.due_date || null,
    });
  }, mode === "po" ? "Goods received — supplier bill created" : fin ? "Goods received and billed" : "Goods received — accountant will add the bill");
  const overPending = (poLines.data ?? []).some(l => n(recv[l.po_item_id]) > n(l.pending) + 0.0005);
  const ok = mode === "po" ? !!poId && Object.values(recv).some(v => n(v) > 0) && !overPending
    : h.project_id && h.supplier_id && lines.some(l => l.material_name && n(l.qty) > 0) && (!fin || lines.filter(l => l.material_name).every(l => n(l.rate) > 0));
  return (
    <Modal open={open} onClose={onClose} width="max-w-4xl" title="Receive goods (GRN)" footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} label="Save receipt" />}>
      <form id="dform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-4">
        {!poIdProp && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode("po")} className={`rounded-full border px-3 py-1 text-sm ${mode === "po" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-ink-600"}`}>Against purchase order</button>
            <button type="button" onClick={() => setMode("direct")} className={`rounded-full border px-3 py-1 text-sm ${mode === "direct" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-ink-600"}`}>Direct purchase (no PO)</button>
          </div>
        )}
        {mode === "po" ? (
          <>
            <Field label="Purchase order" required>
              <Select value={poId} onChange={e => setPoId(e.target.value)} disabled={!!poIdProp}>
                <option value="">Select an open PO</option>
                {(openPos.data ?? []).map(p => <option key={p.id} value={p.id}>{p.po_no} · {p.supplier_name} · {p.project_name}</option>)}
              </Select>
            </Field>
            {po && (
              <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-3 text-sm">
                <div><div className="text-xs text-ink-500">Project (from PO)</div><div className="font-medium">{po.project_name}</div></div>
                <div><div className="text-xs text-ink-500">Supplier (from PO)</div><div className="font-medium">{po.supplier_name}</div></div>
              </div>
            )}
            {poId && (poLines.isLoading ? <Spinner /> : (
              <div className="rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50"><tr><th className={th}>Item</th><th className={th + " text-right"}>Ordered</th><th className={th + " text-right"}>Received so far</th><th className={th + " text-right"}>Pending</th><th className={th + " w-36"}>Receiving now</th></tr></thead>
                  <tbody>
                    {(poLines.data ?? []).map(l => (
                      <tr key={l.po_item_id} className="border-b border-slate-100">
                        <td className="px-2 py-1.5 font-medium">{l.material_name} <span className="text-xs text-ink-400">({l.unit})</span></td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{qty(l.ordered)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{qty(l.received)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{qty(l.pending)}</td>
                        <td className="px-2 py-1"><Input type="number" step="any" min="0" value={recv[l.po_item_id] ?? ""} disabled={n(l.pending) <= 0}
                          onChange={e => setRecv({ ...recv, [l.po_item_id]: e.target.value })} className={`text-right ${n(recv[l.po_item_id]) > n(l.pending) + 0.0005 ? "border-red-400" : ""}`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {overPending && <div className="px-3 py-2 text-xs text-red-600">You can't receive more than the pending quantity. Raise a new PO for extra material.</div>}
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Project / site" required><ProjectSelect value={h.project_id ?? ""} onChange={v => setH({ ...h, project_id: v })} onlyOpen /></Field>
              <Field label="Supplier" required><PartySelect type="supplier" value={h.supplier_id ?? ""} onChange={v => setH({ ...h, supplier_id: v })} /></Field>
            </div>
            <div className="rounded-lg border border-slate-200">
              <table className="w-full">
                <thead className="border-b border-slate-200 bg-slate-50"><tr><th className={th}>Material</th><th className={th + " w-28"}>Unit</th><th className={th + " w-24"}>Qty</th>{fin && <><th className={th + " w-32"}>Rate</th><th className={th + " w-24"}>GST</th></>}<th className="w-9" /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="p-1.5"><MaterialInput id="grn-mat" value={l.material_name} onChange={v => setLines(lines.map((x, j) => j === i ? { ...x, material_name: v } : x))} onPick={m => setLines(lines.map((x, j) => j === i ? { ...x, material_name: m.name, unit: m.unit } : x))} /></td>
                      <td className="p-1.5"><UnitSelect value={l.unit} onChange={v => setLines(lines.map((x, j) => j === i ? { ...x, unit: v } : x))} /></td>
                      <td className="p-1.5"><Input type="number" step="any" min="0" value={l.qty} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} className="text-right" /></td>
                      {fin && <>
                        <td className="p-1.5"><MoneyInput value={l.rate} onChange={v => setLines(lines.map((x, j) => j === i ? { ...x, rate: v } : x))} /></td>
                        <td className="p-1.5"><Select value={l.gst_percent} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, gst_percent: e.target.value } : x))}>{["0", "5", "12", "18", "28"].map(g => <option key={g} value={g}>{g}%</option>)}</Select></td>
                      </>}
                      <td className="p-1.5 text-center"><button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-ink-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="m-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline" onClick={() => setLines([...lines, { material_name: "", unit: "nos", qty: "", rate: "", gst_percent: "0" }])}><Plus className="h-4 w-4" /> Add line</button>
            </div>
            {!fin && <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">The accountant will add rates and create the supplier bill.</div>}
          </>
        )}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Received on" required><Input type="date" value={h.grn_date ?? ""} onChange={e => setH({ ...h, grn_date: e.target.value })} /></Field>
          <Field label="Challan / DC no."><Input value={h.challan_no ?? ""} onChange={e => setH({ ...h, challan_no: e.target.value })} /></Field>
          <Field label="Vehicle no."><Input value={h.vehicle_no ?? ""} onChange={e => setH({ ...h, vehicle_no: e.target.value })} /></Field>
          {fin && <Field label="Supplier invoice no."><Input value={h.vendor_ref ?? ""} onChange={e => setH({ ...h, vendor_ref: e.target.value })} /></Field>}
          {fin && <Field label="Bill due date"><Input type="date" value={h.due_date ?? ""} onChange={e => setH({ ...h, due_date: e.target.value })} /></Field>}
          <Field label="Notes" className={fin ? "col-span-2 md:col-span-3" : "col-span-2 md:col-span-4"}><Input value={h.notes ?? ""} onChange={e => setH({ ...h, notes: e.target.value })} /></Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Bill a direct goods receipt (rates) ----------------
export function BillGrnForm({ open, onClose, grn }: Base & { grn: Row | null }) {
  const [rates, setRates] = useState<Record<string, { rate: string; gst: string }>>({});
  const [h, setH] = useState<Row>({});
  const items = useList("grn_items", { eq: { grn_id: grn?.id }, enabled: open && !!grn });
  useEffect(() => { if (open) { setRates({}); setH({ bill_date: grn?.grn_date ?? todayISO(), due_date: addDays(todayISO(), 30), vendor_ref: "" }); } }, [open, grn]);
  const total = (items.data ?? []).reduce((s, it) => s + n(it.qty) * n(rates[it.id]?.rate) * (1 + n(rates[it.id]?.gst) / 100), 0);
  const save = useAction(() => rpc("bill_goods_receipt", { p_grn: grn!.id, p_bill_date: h.bill_date, p_due_date: h.due_date || null, p_vendor_ref: h.vendor_ref || null,
    p_rates: (items.data ?? []).map(it => ({ grn_item_id: it.id, rate: n(rates[it.id]?.rate), gst_percent: n(rates[it.id]?.gst) })) }), "Supplier bill created");
  const ok = (items.data ?? []).length > 0 && (items.data ?? []).every(it => n(rates[it.id]?.rate) > 0);
  return (
    <Modal open={open} onClose={onClose} title={`Create bill for ${grn?.grn_no ?? ""}`} width="max-w-3xl" footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} label="Create bill" />}>
      <form id="dform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-4">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200"><tr><th className={th}>Material</th><th className={th + " text-right"}>Qty</th><th className={th + " w-36"}>Rate</th><th className={th + " w-24"}>GST</th><th className={th + " text-right"}>Amount</th></tr></thead>
          <tbody>
            {(items.data ?? []).map(it => (
              <tr key={it.id} className="border-b border-slate-100">
                <td className="px-2 py-1.5">{it.material_name}</td><td className="px-2 py-1.5 text-right">{qty(it.qty)} {it.unit}</td>
                <td className="p-1"><MoneyInput value={rates[it.id]?.rate ?? ""} onChange={v => setRates({ ...rates, [it.id]: { gst: rates[it.id]?.gst ?? "0", rate: v } })} /></td>
                <td className="p-1"><Select value={rates[it.id]?.gst ?? "0"} onChange={e => setRates({ ...rates, [it.id]: { rate: rates[it.id]?.rate ?? "", gst: e.target.value } })}>{["0", "5", "12", "18", "28"].map(g => <option key={g} value={g}>{g}%</option>)}</Select></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{inr(n(it.qty) * n(rates[it.id]?.rate) * (1 + n(rates[it.id]?.gst) / 100))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-right text-sm">Bill total: <b>{inr(total)}</b></div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Bill date"><Input type="date" value={h.bill_date ?? ""} onChange={e => setH({ ...h, bill_date: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={h.due_date ?? ""} onChange={e => setH({ ...h, due_date: e.target.value })} /></Field>
          <Field label="Supplier invoice no."><Input value={h.vendor_ref ?? ""} onChange={e => setH({ ...h, vendor_ref: e.target.value })} /></Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Bill (supplier service bill or contractor RA bill) ----------------
export function BillForm({ open, onClose, initial, billType = "contractor", workOrderId }: Base & { initial?: Row; billType?: "supplier" | "contractor"; workOrderId?: string }) {
  const [h, setH] = useState<Row>({});
  const [items, setItems] = useState<Row[]>([]);
  const wos = useList("work_orders", { select: "id,wo_no,description,amount,retention_percent,contractor_id,project_id,status", order: [{ col: "wo_date", asc: false }], enabled: open });
  const parties = useList("parties", { select: "id,name", eq: { type: "contractor" }, enabled: open });
  const billedSoFar = useList("v_bill_balances", { select: "id,subtotal,tax_amount,work_order_id,is_void", eq: { work_order_id: h.work_order_id }, enabled: open && !!h.work_order_id });
  const type: "supplier" | "contractor" = initial?.bill_type ?? billType;
  useEffect(() => {
    if (!open) return;
    if (initial?.id) {
      setH({ ...initial, due_date: initial.due_date ?? "", vendor_ref: initial.vendor_ref ?? "", description: initial.description ?? "", other_deductions: String(initial.other_deductions ?? 0) });
      fetchAll("bill_items", { eq: { bill_id: initial.id }, order: [{ col: "sort_order" }] }).then(r => setItems(r.map(x => ({ ...x, qty: String(x.qty), rate: String(x.rate), gst_percent: String(x.gst_percent) }))));
    } else {
      setH({ work_order_id: workOrderId ?? "", party_id: "", project_id: "", bill_date: todayISO(), due_date: addDays(todayISO(), 15), vendor_ref: "", description: "", other_deductions: "0" });
      setItems([{ description: "", unit: type === "contractor" ? "sqft" : "nos", qty: "", rate: "", gst_percent: "0" }]);
    }
  }, [open, initial, workOrderId, type]);
  const wo = (wos.data ?? []).find(w => w.id === h.work_order_id);
  const sub = items.reduce((s, i) => s + n(i.qty) * n(i.rate), 0);
  const tax = items.reduce((s, i) => s + n(i.qty) * n(i.rate) * n(i.gst_percent) / 100, 0);
  const retention = wo ? Math.round((sub + tax) * n(wo.retention_percent)) / 100 : 0;
  const net = sub + tax - retention - n(h.other_deductions);
  const prevBilled = (billedSoFar.data ?? []).filter(b => b.id !== initial?.id && !b.is_void).reduce((s, b) => s + n(b.subtotal) + n(b.tax_amount), 0);
  const save = useAction(() => rpc("save_bill", {
    p_id: initial?.id ?? null,
    p_header: { bill_type: type, work_order_id: h.work_order_id || null, party_id: h.party_id || null, project_id: h.project_id || null, bill_date: h.bill_date, due_date: h.due_date || null, vendor_ref: h.vendor_ref || null, description: h.description || null, other_deductions: n(h.other_deductions) },
    p_items: items.filter(i => i.description && n(i.qty) > 0).map(i => ({ description: i.description, unit: i.unit, qty: n(i.qty), rate: n(i.rate), gst_percent: n(i.gst_percent) })),
  }), initial ? "Bill updated" : "Bill saved");
  const ok = (type === "contractor" ? !!h.work_order_id : h.party_id && h.project_id) && items.some(i => i.description && n(i.qty) > 0) && net >= 0;
  const set = (i: number, k: string, v: string) => setItems(items.map((x, j) => j === i ? { ...x, [k]: v } : x));
  return (
    <Modal open={open} onClose={onClose} width="max-w-4xl" title={initial ? `Edit bill ${initial.bill_no}` : type === "contractor" ? "Contractor bill (measurement)" : "Supplier bill (no goods receipt)"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="dform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-4">
        {type === "contractor" ? (
          <Field label="Work order" required>
            <Select value={h.work_order_id ?? ""} onChange={e => setH({ ...h, work_order_id: e.target.value })} disabled={!!initial?.id}>
              <option value="">Select work order</option>
              {(wos.data ?? []).filter(w => w.status !== "cancelled" || w.id === h.work_order_id).map(w => <option key={w.id} value={w.id}>{w.wo_no} · {(parties.data ?? []).find(p => p.id === w.contractor_id)?.name} · {w.description}</option>)}
            </Select>
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Supplier" required><PartySelect type="supplier" value={h.party_id ?? ""} onChange={v => setH({ ...h, party_id: v })} /></Field>
            <Field label="Project / site" required><ProjectSelect value={h.project_id ?? ""} onChange={v => setH({ ...h, project_id: v })} /></Field>
          </div>
        )}
        {wo && (
          <div className="grid grid-cols-4 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
            <div><div className="text-xs text-ink-500">WO value</div><div className="font-medium tabular-nums">{inr(wo.amount)}</div></div>
            <div><div className="text-xs text-ink-500">Billed before</div><div className="font-medium tabular-nums">{inr(prevBilled)}</div></div>
            <div><div className="text-xs text-ink-500">This bill (gross)</div><div className="font-medium tabular-nums">{inr(sub + tax)}</div></div>
            <div><div className="text-xs text-ink-500">Balance of WO after</div><div className={`font-medium tabular-nums ${n(wo.amount) - prevBilled - sub - tax < 0 ? "text-red-600" : ""}`}>{inr(n(wo.amount) - prevBilled - sub - tax)}</div></div>
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[680px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className={th}>Work / item</th><th className={th + " w-24"}>Unit</th><th className={th + " w-24"}>Qty</th><th className={th + " w-32"}>Rate</th><th className={th + " w-24"}>GST</th><th className={th + " w-32 text-right"}>Amount</th><th className="w-9" /></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="p-1.5"><Input value={it.description ?? ""} onChange={e => set(i, "description", e.target.value)} placeholder={type === "contractor" ? "e.g. Centering — 1st floor slab" : "Item / service"} /></td>
                  <td className="p-1.5"><UnitSelect value={it.unit ?? "nos"} onChange={v => set(i, "unit", v)} /></td>
                  <td className="p-1.5"><Input type="number" step="any" min="0" value={it.qty ?? ""} onChange={e => set(i, "qty", e.target.value)} className="text-right" /></td>
                  <td className="p-1.5"><MoneyInput value={it.rate ?? ""} onChange={v => set(i, "rate", v)} /></td>
                  <td className="p-1.5"><Select value={it.gst_percent ?? "0"} onChange={e => set(i, "gst_percent", e.target.value)}>{["0", "5", "12", "18", "28"].map(g => <option key={g} value={g}>{g}%</option>)}</Select></td>
                  <td className="p-1.5 text-right text-sm tabular-nums">{inr(n(it.qty) * n(it.rate) * (1 + n(it.gst_percent) / 100))}</td>
                  <td className="p-1.5 text-center"><button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-ink-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-start justify-between gap-4 p-2">
            <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline" onClick={() => setItems([...items, { description: "", unit: "nos", qty: "", rate: "", gst_percent: "0" }])}><Plus className="h-4 w-4" /> Add line</button>
            <div className="w-72 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-ink-500">Gross</span><span className="tabular-nums">{inr(sub + tax)}</span></div>
              {wo && n(wo.retention_percent) > 0 && <div className="flex justify-between"><span className="text-ink-500">Retention {n(wo.retention_percent)}%</span><span className="tabular-nums">− {inr(retention)}</span></div>}
              <div className="flex items-center justify-between gap-2"><span className="text-ink-500">Other deductions</span><MoneyInput className="w-32 py-1" value={h.other_deductions ?? "0"} onChange={v => setH({ ...h, other_deductions: v })} /></div>
              <div className={`flex justify-between border-t border-slate-200 pt-1 font-semibold ${net < 0 ? "text-red-600" : ""}`}><span>Net payable</span><span className="tabular-nums">{inr(net)}</span></div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Bill date"><Input type="date" value={h.bill_date ?? ""} onChange={e => setH({ ...h, bill_date: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={h.due_date ?? ""} onChange={e => setH({ ...h, due_date: e.target.value })} /></Field>
          <Field label={type === "contractor" ? "Contractor's bill no." : "Supplier invoice no."}><Input value={h.vendor_ref ?? ""} onChange={e => setH({ ...h, vendor_ref: e.target.value })} /></Field>
          <Field label="Notes"><Input value={h.description ?? ""} onChange={e => setH({ ...h, description: e.target.value })} /></Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Work order ----------------
export function WOForm({ open, onClose, initial, projectId }: Base & { initial?: Row; projectId?: string }) {
  const jobs = useJobTypes();
  const [f, setF] = useState<Row>({});
  useEffect(() => {
    if (!open) return;
    setF(initial ? { ...initial, amount: String(initial.amount), retention_percent: String(initial.retention_percent), start_date: initial.start_date ?? "", end_date: initial.end_date ?? "", terms: initial.terms ?? "", job_type_id: initial.job_type_id ?? "" }
      : { project_id: projectId ?? "", contractor_id: "", job_type_id: "", description: "", wo_date: todayISO(), start_date: "", end_date: "", amount: "", retention_percent: "0", status: "active", terms: "" });
  }, [open, initial, projectId]);
  const save = useAction(async () => {
    const v = clean({ project_id: f.project_id, contractor_id: f.contractor_id, job_type_id: f.job_type_id, description: f.description, wo_date: f.wo_date, start_date: f.start_date, end_date: f.end_date, amount: n(f.amount), retention_percent: n(f.retention_percent), status: f.status, terms: f.terms });
    if (initial?.id) await updateRow("work_orders", initial.id, v); else await insertRow("work_orders", v);
  }, initial ? "Work order updated" : "Work order created");
  const ok = f.project_id && f.contractor_id && f.description && n(f.amount) > 0;
  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.wo_no}` : "New work order"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="dform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="grid grid-cols-2 gap-4">
        <Field label="Contractor" required><PartySelect type="contractor" value={f.contractor_id ?? ""} onChange={v => setF({ ...f, contractor_id: v })} /></Field>
        <Field label="Project / site" required><ProjectSelect value={f.project_id ?? ""} onChange={v => setF({ ...f, project_id: v })} includeOffice={false} onlyOpen /></Field>
        <Field label="Job type"><Select value={f.job_type_id ?? ""} onChange={e => setF({ ...f, job_type_id: e.target.value })}><option value="">—</option>{(jobs.data ?? []).map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</Select></Field>
        <Field label="Work order value" required><MoneyInput value={f.amount ?? ""} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="Scope of work" required className="col-span-2"><Textarea value={f.description ?? ""} onChange={e => setF({ ...f, description: e.target.value })} placeholder="e.g. Centering for ground + 1st floor slabs, 2,400 sqft @ ₹45" /></Field>
        <Field label="WO date"><Input type="date" value={f.wo_date ?? ""} onChange={e => setF({ ...f, wo_date: e.target.value })} /></Field>
        <Field label="Retention %" hint="Held back from each bill"><Input type="number" min="0" max="20" step="0.5" value={f.retention_percent ?? "0"} onChange={e => setF({ ...f, retention_percent: e.target.value })} /></Field>
        <Field label="Start"><Input type="date" value={f.start_date ?? ""} onChange={e => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="Finish"><Input type="date" value={f.end_date ?? ""} onChange={e => setF({ ...f, end_date: e.target.value })} /></Field>
        {initial && <Field label="Status"><Select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></Select></Field>}
        <Field label="Terms" className="col-span-2"><Textarea value={f.terms ?? ""} onChange={e => setF({ ...f, terms: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

// ---------------- Variation / quotation ----------------
export function VariationForm({ open, onClose, initial, projectId }: Base & { initial?: Row; projectId: string }) {
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (open) setF(initial ? { ...initial, amount: String(initial.amount) } : { var_date: todayISO(), description: "", amount: "", status: "pending" }); }, [open, initial]);
  const save = useAction(async () => {
    const v = { project_id: projectId, var_date: f.var_date, description: f.description, amount: n(f.amount), status: f.status };
    if (initial?.id) await updateRow("project_variations", initial.id, v); else await insertRow("project_variations", v);
  }, "Saved");
  return (
    <Modal open={open} onClose={onClose} width="max-w-lg" title={initial ? `Edit ${initial.var_no}` : "Add quotation / variation"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!f.description || n(f.amount) === 0} />}>
      <form id="dform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="grid grid-cols-2 gap-4">
        <Field label="Description" required className="col-span-2"><Input value={f.description ?? ""} onChange={e => setF({ ...f, description: e.target.value })} placeholder="e.g. Extra compound wall" /></Field>
        <Field label="Amount" required hint="Use a negative amount for a reduction"><Input type="number" step="0.01" value={f.amount ?? ""} onChange={e => setF({ ...f, amount: e.target.value })} className="text-right" /></Field>
        <Field label="Date"><Input type="date" value={f.var_date ?? ""} onChange={e => setF({ ...f, var_date: e.target.value })} /></Field>
        <Field label="Status" className="col-span-2" hint="Only approved amounts are added to the contract value"><Select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="pending">Pending client approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select></Field>
      </form>
    </Modal>
  );
}
