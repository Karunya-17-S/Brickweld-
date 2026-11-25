import { useEffect, useMemo, useState } from "react";
import { Modal, Field, Input, Textarea, MoneyInput, Select, Spinner, Badge } from "../ui";
import { AccountSelect, CategorySelect, ModeSelect, PartySelect, ProjectSelect, EmployeeSelect, useAccounts } from "../pickers";
import { useAction, useList, insertRow, updateRow, rpc, clean, type Row } from "@/lib/data";
import { inr, n, todayISO, fmtDate } from "@/lib/format";
import { toast } from "../toast";

interface Base { open: boolean; onClose: () => void }

function Footer({ onClose, busy, disabled, label = "Save" }: { onClose: () => void; busy?: boolean; disabled?: boolean; label?: string }) {
  return <>
    <button className="btn-secondary" onClick={onClose} type="button">Cancel</button>
    <button className="btn-primary" type="submit" form="mform" disabled={busy || disabled}>{busy && <Spinner className="text-white" />}{label}</button>
  </>;
}

function useBalanceWarning(accountId: string, amount: string, editingAmount = 0) {
  const { data } = useAccounts();
  const acc = (data ?? []).find((a: Row) => a.id === accountId);
  if (!acc || !amount) return null;
  const after = n(acc.balance) + editingAmount - n(amount);
  return after < 0 ? `This takes ${acc.name} below zero (${inr(after)}). Check the account or add funds first.` : null;
}

// ---------------- Expense ----------------
export function ExpenseForm({ open, onClose, initial, projectId }: Base & { initial?: Row; projectId?: string }) {
  const blank = { txn_date: todayISO(), account_id: "", amount: "", expense_category_id: "", project_id: projectId ?? "", mode: "cash", reference: "", description: "" };
  const [f, setF] = useState<Row>(blank);
  useEffect(() => { if (open) setF(initial ? { ...blank, ...initial, amount: String(initial.amount) } : blank); /* eslint-disable-next-line */ }, [open, initial]);
  const warn = useBalanceWarning(f.account_id, f.amount, initial ? n(initial.amount) : 0);
  const save = useAction(async () => {
    const v = clean({ ...f, amount: n(f.amount), direction: "out", category: "expense" });
    if (initial?.id) await updateRow("transactions", initial.id, { txn_date: v.txn_date, account_id: v.account_id, amount: v.amount, expense_category_id: v.expense_category_id, project_id: v.project_id, mode: v.mode, reference: v.reference, description: v.description });
    else await insertRow("transactions", v);
  }, initial ? "Expense updated" : "Expense recorded");
  const ok = f.account_id && n(f.amount) > 0 && f.expense_category_id;
  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit expense" : "Record expense"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="mform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="grid grid-cols-2 gap-4">
        <Field label="Date" required><Input type="date" value={f.txn_date} onChange={e => setF({ ...f, txn_date: e.target.value })} /></Field>
        <Field label="Amount" required><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="Category" required><CategorySelect value={f.expense_category_id} onChange={v => setF({ ...f, expense_category_id: v })} /></Field>
        <Field label="Project / site" hint="Leave empty for company overhead"><ProjectSelect value={f.project_id} onChange={v => setF({ ...f, project_id: v })} placeholder="Company overhead (no project)" /></Field>
        <Field label="Paid from" required error={warn}><AccountSelect value={f.account_id} onChange={v => setF({ ...f, account_id: v })} /></Field>
        <Field label="Mode"><ModeSelect value={f.mode} onChange={v => setF({ ...f, mode: v })} /></Field>
        <Field label="Reference / bill no."><Input value={f.reference ?? ""} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Description"><Input value={f.description ?? ""} onChange={e => setF({ ...f, description: e.target.value })} placeholder="e.g. Diesel for mixer" /></Field>
      </form>
    </Modal>
  );
}

// ---------------- Client receipt ----------------
export function ReceiptForm({ open, onClose, initial, projectId }: Base & { initial?: Row; projectId?: string }) {
  const { data: projects } = useList("projects", { select: "id,client_id" });
  const blank = { txn_date: todayISO(), account_id: "", amount: "", project_id: projectId ?? "", party_id: "", mode: "neft", reference: "", description: "" };
  const [f, setF] = useState<Row>(blank);
  useEffect(() => { if (open) setF(initial ? { ...blank, ...initial, amount: String(initial.amount) } : blank); /* eslint-disable-next-line */ }, [open, initial]);
  useEffect(() => {
    if (!f.project_id || f.party_id) return;
    const c = (projects ?? []).find(p => p.id === f.project_id)?.client_id;
    if (c) setF(x => ({ ...x, party_id: c }));
  }, [f.project_id, f.party_id, projects]);
  const save = useAction(async () => {
    const v = clean({ ...f, amount: n(f.amount), direction: "in", category: "client_receipt" });
    if (initial?.id) await updateRow("transactions", initial.id, { txn_date: v.txn_date, account_id: v.account_id, amount: v.amount, project_id: v.project_id, party_id: v.party_id, mode: v.mode, reference: v.reference, description: v.description });
    else await insertRow("transactions", v);
  }, initial ? "Receipt updated" : "Payment received recorded");
  const ok = f.account_id && n(f.amount) > 0 && f.project_id;
  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit client receipt" : "Receive payment from client"} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="mform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="grid grid-cols-2 gap-4">
        <Field label="Project" required><ProjectSelect includeOffice={false} value={f.project_id} onChange={v => setF({ ...f, project_id: v, party_id: "" })} /></Field>
        <Field label="Client"><PartySelect type="client" value={f.party_id ?? ""} onChange={v => setF({ ...f, party_id: v })} /></Field>
        <Field label="Date" required><Input type="date" value={f.txn_date} onChange={e => setF({ ...f, txn_date: e.target.value })} /></Field>
        <Field label="Amount received" required><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="Deposited to" required><AccountSelect value={f.account_id} onChange={v => setF({ ...f, account_id: v })} /></Field>
        <Field label="Mode"><ModeSelect value={f.mode} onChange={v => setF({ ...f, mode: v })} /></Field>
        <Field label="Reference (UTR / cheque no.)"><Input value={f.reference ?? ""} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Notes"><Input value={f.description ?? ""} onChange={e => setF({ ...f, description: e.target.value })} placeholder="e.g. 2nd stage payment" /></Field>
      </form>
    </Modal>
  );
}

// ---------------- Supplier / contractor payment ----------------
export function PaymentForm({ open, onClose, partyType: initialType = "supplier", partyId, billId }: Base & { partyType?: "supplier" | "contractor"; partyId?: string; billId?: string }) {
  const [type, setType] = useState<"supplier" | "contractor">(initialType);
  const [f, setF] = useState<Row>({});
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setType(initialType);
    setF({ txn_date: todayISO(), account_id: "", amount: "", party_id: partyId ?? "", mode: "neft", reference: "", description: "" });
    setAlloc({});
  }, [open, initialType, partyId]);
  const bills = useList("v_bill_balances", { eq: { party_id: f.party_id }, order: [{ col: "bill_date" }], enabled: open && !!f.party_id });
  const open_bills = useMemo(() => (bills.data ?? []).filter(b => !b.is_void && n(b.balance) > 0.001), [bills.data]);
  useEffect(() => {
    if (billId && open_bills.length) {
      const b = open_bills.find(x => x.id === billId);
      if (b) { setAlloc({ [b.id]: String(n(b.balance)) }); setF(x => ({ ...x, amount: String(n(b.balance)) })); }
    }
  }, [billId, open_bills]);
  const applied = Object.values(alloc).reduce((s, v) => s + n(v), 0);
  const advance = n(f.amount) - applied;
  const warn = useBalanceWarning(f.account_id, f.amount);
  const overBill = open_bills.find(b => n(alloc[b.id]) > n(b.balance) + 0.001);

  function autoAllocate(total: number) {
    let left = total; const a: Record<string, string> = {};
    for (const b of open_bills) { if (left <= 0) break; const x = Math.min(left, n(b.balance)); a[b.id] = String(Math.round(x * 100) / 100); left -= x; }
    setAlloc(a);
  }
  const save = useAction(() => rpc("record_payment", {
    p: {
      category: type === "supplier" ? "supplier_payment" : "contractor_payment", account_id: f.account_id, txn_date: f.txn_date,
      amount: n(f.amount), party_id: f.party_id, mode: f.mode, reference: f.reference || null, description: f.description || null,
      allocations: Object.entries(alloc).filter(([, v]) => n(v) > 0).map(([bill_id, v]) => ({ bill_id, amount: n(v) })),
    },
  }), "Payment recorded");
  const ok = f.account_id && f.party_id && n(f.amount) > 0 && advance >= -0.001 && !overBill;
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title={`Pay ${type}`} footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} label="Record payment" />}>
      <form id="mform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Pay to">
            <div className="flex gap-2">
              <Select className="w-36" value={type} onChange={e => { setType(e.target.value as "supplier" | "contractor"); setF({ ...f, party_id: "" }); setAlloc({}); }}>
                <option value="supplier">Supplier</option><option value="contractor">Contractor</option>
              </Select>
              <PartySelect type={type} value={f.party_id ?? ""} onChange={v => { setF({ ...f, party_id: v }); setAlloc({}); }} />
            </div>
          </Field>
          <Field label="Date" required><Input type="date" value={f.txn_date ?? ""} onChange={e => setF({ ...f, txn_date: e.target.value })} /></Field>
          <Field label="Amount paid" required>
            <MoneyInput value={f.amount ?? ""} onChange={v => { setF({ ...f, amount: v }); autoAllocate(n(v)); }} />
          </Field>
          <Field label="Paid from" required error={warn}><AccountSelect value={f.account_id ?? ""} onChange={v => setF({ ...f, account_id: v })} /></Field>
          <Field label="Mode"><ModeSelect value={f.mode ?? "neft"} onChange={v => setF({ ...f, mode: v })} /></Field>
          <Field label="Reference (UTR / cheque no.)"><Input value={f.reference ?? ""} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        {f.party_id && (
          <div className="rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <div className="text-sm font-semibold text-ink-700">Apply to pending bills</div>
              {open_bills.length > 0 && <button type="button" className="text-xs font-medium text-brand-600 hover:underline"
                onClick={() => { const t = open_bills.reduce((s, b) => s + n(b.balance), 0); setF({ ...f, amount: String(t) }); autoAllocate(t); }}>Pay all pending ({inr(open_bills.reduce((s, b) => s + n(b.balance), 0))})</button>}
            </div>
            {bills.isLoading ? <div className="p-4"><Spinner /></div> : open_bills.length === 0 ? (
              <div className="px-3 py-4 text-sm text-ink-500">No pending bills. The full amount will be saved as an <b>advance</b> you can apply to future bills.</div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-ink-500">
                  <th className="px-3 py-1.5">Bill</th><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5">Project</th>
                  <th className="px-3 py-1.5 text-right">Pending</th><th className="w-40 px-3 py-1.5 text-right">Apply now</th></tr></thead>
                <tbody>
                  {open_bills.map(b => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-medium">{b.bill_no}{b.vendor_ref && <span className="ml-1 text-xs text-ink-400">({b.vendor_ref})</span>}</td>
                      <td className="px-3 py-1.5">{fmtDate(b.bill_date)}{b.status === "overdue" && <Badge tone="red">Overdue</Badge>}</td>
                      <td className="px-3 py-1.5 text-ink-600">{b.project_code}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{inr(b.balance)}</td>
                      <td className="px-3 py-1"><MoneyInput value={alloc[b.id] ?? ""} onChange={v => setAlloc({ ...alloc, [b.id]: v })} className={n(alloc[b.id]) > n(b.balance) + 0.001 ? "border-red-400" : ""} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex flex-wrap justify-end gap-6 border-t border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <span>Applied to bills: <b className="tabular-nums">{inr(applied)}</b></span>
              <span className={advance < -0.001 ? "text-red-600" : ""}>{advance < -0.001 ? "Applied more than amount paid" : <>Saved as advance: <b className="tabular-nums">{inr(Math.max(advance, 0))}</b></>}</span>
            </div>
          </div>
        )}
        <Field label="Notes"><Textarea value={f.description ?? ""} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

// ---------------- Apply an advance to bills ----------------
export function ApplyCreditForm({ open, onClose, txn }: Base & { txn: Row | null }) {
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  useEffect(() => { if (open) setAlloc({}); }, [open]);
  const bills = useList("v_bill_balances", { eq: { party_id: txn?.party_id }, order: [{ col: "bill_date" }], enabled: open && !!txn });
  const list = (bills.data ?? []).filter(b => !b.is_void && n(b.balance) > 0.001);
  const applied = Object.values(alloc).reduce((s, v) => s + n(v), 0);
  const save = useAction(() => rpc("apply_credit", { p_txn: txn!.id, p_allocations: Object.entries(alloc).filter(([, v]) => n(v) > 0).map(([bill_id, v]) => ({ bill_id, amount: n(v) })) }), "Advance applied to bills");
  const avail = n(txn?.unapplied);
  return (
    <Modal open={open} onClose={onClose} title={`Apply advance ${txn?.txn_no ?? ""}`} footer={<Footer onClose={onClose} busy={save.isPending} disabled={applied <= 0 || applied > avail + 0.001} label="Apply" />}>
      <form id="mform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <div className="mb-3 text-sm text-ink-600">Available to apply: <b>{inr(avail)}</b> · Applying: <b className={applied > avail ? "text-red-600" : ""}>{inr(applied)}</b></div>
        {list.length === 0 ? <div className="text-sm text-ink-500">No pending bills for this party.</div> : (
          <table className="w-full text-sm"><tbody>
            {list.map(b => (
              <tr key={b.id} className="border-t border-slate-100">
                <td className="py-1.5 font-medium">{b.bill_no}</td><td className="py-1.5">{fmtDate(b.bill_date)}</td>
                <td className="py-1.5 text-right tabular-nums">{inr(b.balance)}</td>
                <td className="w-40 py-1 pl-3"><MoneyInput value={alloc[b.id] ?? ""} onChange={v => setAlloc({ ...alloc, [b.id]: v })} /></td>
              </tr>
            ))}
          </tbody></table>
        )}
      </form>
    </Modal>
  );
}

// ---------------- Transfer between accounts ----------------
export function TransferForm({ open, onClose }: Base) {
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (open) setF({ from: "", to: "", amount: "", date: todayISO(), mode: "cash", reference: "", notes: "" }); }, [open]);
  const warn = useBalanceWarning(f.from, f.amount);
  const save = useAction(() => rpc("transfer_funds", { p_from: f.from, p_to: f.to, p_amount: n(f.amount), p_date: f.date, p_mode: f.mode, p_reference: f.reference || null, p_notes: f.notes || null }), "Transfer saved");
  const ok = f.from && f.to && f.from !== f.to && n(f.amount) > 0;
  return (
    <Modal open={open} onClose={onClose} title="Transfer between accounts" width="max-w-lg" footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} label="Transfer" />}>
      <form id="mform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="grid grid-cols-2 gap-4">
        <Field label="From" required error={warn} className="col-span-2"><AccountSelect value={f.from ?? ""} onChange={v => setF({ ...f, from: v })} placeholder="Take money from" /></Field>
        <Field label="To" required className="col-span-2" error={f.from && f.from === f.to ? "Choose a different account" : null}><AccountSelect value={f.to ?? ""} onChange={v => setF({ ...f, to: v })} placeholder="Put money into" /></Field>
        <Field label="Amount" required><MoneyInput value={f.amount ?? ""} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="Date" required><Input type="date" value={f.date ?? ""} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Mode"><ModeSelect value={f.mode ?? "cash"} onChange={v => setF({ ...f, mode: v })} /></Field>
        <Field label="Reference"><Input value={f.reference ?? ""} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Notes" className="col-span-2"><Input value={f.notes ?? ""} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="e.g. Cash withdrawn for site expenses" /></Field>
      </form>
    </Modal>
  );
}

// ---------------- MD investment / drawing / other income ----------------
export function CapitalForm({ open, onClose, kind = "md_investment", initial }: Base & { kind?: "md_investment" | "md_drawing" | "other_income"; initial?: Row }) {
  const [k, setK] = useState(kind);
  const [lines, setLines] = useState<{ account_id: string; amount: string }[]>([{ account_id: "", amount: "" }]);
  const [f, setF] = useState<Row>({});
  useEffect(() => {
    if (!open) return;
    setK(initial?.category ?? kind);
    setLines(initial ? [{ account_id: initial.account_id, amount: String(initial.amount) }] : [{ account_id: "", amount: "" }]);
    setF({ txn_date: initial?.txn_date ?? todayISO(), mode: initial?.mode ?? "neft", reference: initial?.reference ?? "", description: initial?.description ?? "" });
  }, [open, kind, initial]);
  const total = lines.reduce((s, l) => s + n(l.amount), 0);
  const save = useAction(async () => {
    const dir = k === "md_drawing" ? "out" : "in";
    if (initial?.id) {
      await updateRow("transactions", initial.id, { account_id: lines[0].account_id, amount: n(lines[0].amount), txn_date: f.txn_date, mode: f.mode, reference: f.reference || null, description: f.description || null });
      return;
    }
    for (const l of lines.filter(l => l.account_id && n(l.amount) > 0)) {
      await insertRow("transactions", { account_id: l.account_id, amount: n(l.amount), direction: dir, category: k, txn_date: f.txn_date, mode: f.mode, reference: f.reference || null, description: f.description || null });
    }
  }, k === "md_drawing" ? "Drawing recorded" : k === "md_investment" ? "Investment recorded" : "Income recorded");
  const ok = lines.every(l => !l.amount || l.account_id) && total > 0;
  const title = k === "md_investment" ? "MD investment (capital in)" : k === "md_drawing" ? "MD drawing (capital out)" : "Other income";
  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit " + title.toLowerCase() : title} width="max-w-xl" footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="mform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="space-y-4">
        {!initial && (
          <div className="flex gap-2">
            {(["md_investment", "md_drawing", "other_income"] as const).map(x => (
              <button type="button" key={x} onClick={() => setK(x)} className={`rounded-full border px-3 py-1 text-sm ${k === x ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-ink-600"}`}>
                {x === "md_investment" ? "Investment" : x === "md_drawing" ? "Drawing" : "Other income"}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <div className="label">{k === "md_drawing" ? "Taken from" : "Put into"} <span className="text-ink-400">(split across bank and petty cash if needed)</span></div>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <AccountSelect className="flex-1" value={l.account_id} onChange={v => setLines(lines.map((x, j) => j === i ? { ...x, account_id: v } : x))} />
              <MoneyInput className="w-40" value={l.amount} onChange={v => setLines(lines.map((x, j) => j === i ? { ...x, amount: v } : x))} />
              {lines.length > 1 && <button type="button" className="btn-ghost px-2" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          {!initial && lines.length < 4 && <button type="button" className="text-sm font-medium text-brand-600 hover:underline" onClick={() => setLines([...lines, { account_id: "", amount: "" }])}>+ Add another account</button>}
          <div className="text-right text-sm text-ink-600">Total: <b>{inr(total)}</b></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" required><Input type="date" value={f.txn_date ?? ""} onChange={e => setF({ ...f, txn_date: e.target.value })} /></Field>
          <Field label="Mode"><ModeSelect value={f.mode ?? "neft"} onChange={v => setF({ ...f, mode: v })} /></Field>
          <Field label="Reference"><Input value={f.reference ?? ""} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Notes"><Input value={f.description ?? ""} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Wage payment / advance for one worker ----------------
export function WagePayForm({ open, onClose, employeeId, kind = "wage_payment", weekStart, suggested }: Base & { employeeId?: string; kind?: "wage_payment" | "labour_advance"; weekStart?: string; suggested?: number }) {
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (open) setF({ employee_id: employeeId ?? "", kind, amount: suggested ? String(suggested) : "", account_id: "", date: todayISO(), mode: "cash", reference: "", week_start: weekStart ?? "" }); }, [open, employeeId, kind, weekStart, suggested]);
  const warn = useBalanceWarning(f.account_id, f.amount);
  const save = useAction(() => rpc("pay_wages", {
    p_account: f.account_id, p_date: f.date, p_week_start: f.kind === "wage_payment" && f.week_start ? f.week_start : null, p_mode: f.mode,
    p_reference: f.reference || null, p_team: null, p_lines: [{ employee_id: f.employee_id, amount: n(f.amount) }], p_kind: f.kind,
  }), f.kind === "wage_payment" ? "Wage paid" : "Advance given");
  const ok = f.employee_id && f.account_id && n(f.amount) > 0;
  return (
    <Modal open={open} onClose={onClose} title={f.kind === "wage_payment" ? "Pay wages" : "Give advance"} width="max-w-lg" footer={<Footer onClose={onClose} busy={save.isPending} disabled={!ok} />}>
      <form id="mform" onSubmit={e => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }} className="grid grid-cols-2 gap-4">
        <Field label="Type" className="col-span-2">
          <Select value={f.kind ?? "wage_payment"} onChange={e => setF({ ...f, kind: e.target.value })}>
            <option value="wage_payment">Wage payment (settles earned wages)</option>
            <option value="labour_advance">Advance (deducted from future wages)</option>
          </Select>
        </Field>
        <Field label="Worker" required className="col-span-2"><EmployeeSelect value={f.employee_id ?? ""} onChange={v => setF({ ...f, employee_id: v })} /></Field>
        <Field label="Amount" required hint={suggested ? `Balance due ${inr(suggested)}` : undefined}><MoneyInput value={f.amount ?? ""} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="Date" required><Input type="date" value={f.date ?? ""} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid from" required error={warn} className="col-span-2"><AccountSelect value={f.account_id ?? ""} onChange={v => setF({ ...f, account_id: v })} /></Field>
        <Field label="Mode"><ModeSelect value={f.mode ?? "cash"} onChange={v => setF({ ...f, mode: v })} /></Field>
        {f.kind === "wage_payment" && <Field label="For week starting"><Input type="date" value={f.week_start ?? ""} onChange={e => setF({ ...f, week_start: e.target.value })} /></Field>}
      </form>
    </Modal>
  );
}

// ---------------- Edit any simple entry (date/amount/account/notes) ----------------
export function quickEditable(t: Row) {
  return ["expense", "client_receipt", "md_investment", "md_drawing", "other_income"].includes(t.category);
}
export { toast };
