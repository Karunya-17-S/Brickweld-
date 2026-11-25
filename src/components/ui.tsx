import { useEffect, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { X, Loader2, Inbox } from "lucide-react";
import { inr, n } from "@/lib/format";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={cx("h-4 w-4 animate-spin text-brand-500", className)} />;
}

export function Loading({ text = "Loading…" }: { text?: string }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500"><Spinner /> {text}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="m-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{(error as Error).message ?? String(error)}</div>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <Inbox className="mb-3 h-10 w-10 text-slate-300" />
      <div className="text-[15px] font-medium text-ink-700">{title}</div>
      {hint && <div className="mt-1 max-w-md text-sm text-ink-500">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Page header like Zoho: big title on the left, actions on the right. */
export function PageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-4">
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-semibold text-ink-900 md:text-[22px]">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-ink-500">{subtitle}</div>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode; count?: number; hidden?: boolean }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="no-print flex gap-1 overflow-x-auto px-4">
      {tabs.filter(t => !t.hidden).map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={cx("whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition",
            value === t.key ? "border-brand-500 text-brand-600" : "border-transparent text-ink-500 hover:text-ink-900")}>
          {t.label}{t.count !== undefined && <span className={cx("ml-1.5 rounded-full px-1.5 py-px text-xs", value === t.key ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-ink-500")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = "max-w-2xl" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={cx("w-full rounded-xl bg-white shadow-2xl", width)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-[16px] font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-slate-100 hover:text-ink-700" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 rounded-b-xl border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Right-side panel for record details (Zoho style). */
export function Drawer({ open, onClose, title, subtitle, actions, children, width = "max-w-3xl" }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx("flex h-full w-full flex-col bg-white shadow-2xl", width)}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-ink-900">{title}</div>
            {subtitle && <div className="mt-0.5 text-sm text-ink-500">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-slate-100 hover:text-ink-700" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, required, hint, error, children, className }: { label: string; required?: boolean; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="label">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}
export function Input(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={cx("input", p.className)} />; }
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={2} {...p} className={cx("input", p.className)} />; }
export function Select({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={cx("input pr-8", p.className)}>{children}</select>; }

export function MoneyInput({ value, onChange, ...p }: { value: string | number; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">₹</span>
      <input type="number" step="0.01" min="0" inputMode="decimal" {...p} value={value} onChange={e => onChange(e.target.value)} className={cx("input pl-7 text-right tabular-nums", p.className)} />
    </div>
  );
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15",
  red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/15",
  amber: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
  blue: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/15",
  gray: "bg-slate-100 text-ink-600 ring-1 ring-inset ring-slate-500/10",
  violet: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/15",
};
export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONES | string; children: ReactNode }) {
  return <span className={cx("chip", TONES[tone] ?? TONES.gray)}>{children}</span>;
}

const STATUS_TONE: Record<string, string> = {
  paid: "green", received: "green", completed: "green", approved: "green", active: "blue",
  partial: "amber", pending: "amber", issued: "blue", ordered: "violet", planning: "gray", on_hold: "amber",
  unpaid: "red", overdue: "red", rejected: "red", cancelled: "gray", closed: "gray", void: "gray", draft: "gray",
  unbilled: "amber", billed: "green",
};
export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{status.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())}</Badge>;
}

export function Money({ value, className, signed, muted }: { value: unknown; className?: string; signed?: boolean; muted?: boolean }) {
  const v = n(value);
  return <span className={cx("tabular-nums", signed && v < 0 && "text-red-600", signed && v > 0 && "text-emerald-700", muted && v === 0 && "text-ink-400", className)}>{inr(v)}</span>;
}

export function Stat({ label, value, sub, tone, icon, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "green" | "amber" | "blue"; icon?: ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cx("card px-4 py-3.5", onClick && "cursor-pointer transition hover:border-brand-200 hover:shadow-md")}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-medium text-ink-500">{label}</div>
        {icon && <div className="text-ink-400">{icon}</div>}
      </div>
      <div className={cx("mt-1.5 text-[22px] font-semibold tabular-nums leading-tight",
        tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : tone === "blue" ? "text-brand-600" : "text-ink-900")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function KV({ items, cols = 3 }: { items: [string, ReactNode][]; cols?: number }) {
  return (
    <dl className={cx("grid gap-x-6 gap-y-3", cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3")}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-ink-500">{k}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink-900">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card", className)}>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-[14px] font-semibold text-ink-900">{title}</h3>
        {actions}
      </div>
      <div>{children}</div>
    </section>
  );
}

/** Ask for a reason before delete / void. */
export function ReasonDialog({ open, title, message, confirmLabel = "Delete", danger = true, onClose, onConfirm, busy }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean;
  onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className={danger ? "btn-danger" : "btn-primary"} disabled={!reason.trim() || busy} onClick={() => onConfirm(reason.trim())}>
          {busy && <Spinner className="text-white" />}{confirmLabel}
        </button>
      </>}>
      <div className="space-y-3">
        <div className="text-sm text-ink-700">{message}</div>
        <Field label="Reason" required hint="Saved in the audit log and sent to the MD.">
          <Textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Entered twice by mistake" />
        </Field>
      </div>
    </Modal>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="no-print flex flex-wrap items-end gap-2 border-b border-slate-200 bg-white px-4 py-3 md:px-6">{children}</div>;
}

export function MiniField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-0.5 block text-[11.5px] font-medium uppercase tracking-wide text-ink-400">{label}</span>{children}</label>;
}
