const inrFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

export const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(x) ? x : 0;
};
/** ₹1,23,456.00 */
export const inr = (v: unknown) => `₹${inrFmt.format(n(v))}`;
/** ₹1,23,456 */
export const inrShort = (v: unknown) => `₹${inr0.format(n(v))}`;
/** ₹1.2L / ₹3.4Cr for cards */
export const inrCompact = (v: unknown) => {
  const x = n(v), a = Math.abs(x), s = x < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`;
  return `${s}₹${a.toFixed(0)}`;
};
export const qty = (v: unknown) => qtyFmt.format(n(v));

export const todayISO = () => toISO(new Date());
export function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function parseISO(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(iso: string, days: number) { const d = parseISO(iso); d.setDate(d.getDate() + days); return toISO(d); }
export function weekStartOf(iso: string, weekStart = 0) {
  const d = parseISO(iso); const diff = (d.getDay() - weekStart + 7) % 7; d.setDate(d.getDate() - diff); return toISO(d);
}
export function monthStart(iso = todayISO()) { return iso.slice(0, 8) + "01"; }
export function monthEnd(iso = todayISO()) { const d = parseISO(monthStart(iso)); d.setMonth(d.getMonth() + 1); d.setDate(0); return toISO(d); }
export const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = v.length > 10 ? new Date(v) : parseISO(v);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
export const fmtDateTime = (v?: string | null) => v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const dayName = (iso: string) => parseISO(iso).toLocaleDateString("en-IN", { weekday: "short" });
export const dayNum = (iso: string) => parseISO(iso).getDate();

export const CATEGORY_LABEL: Record<string, string> = {
  client_receipt: "Client receipt", md_investment: "MD investment", other_income: "Other income", transfer_in: "Transfer in",
  supplier_payment: "Supplier payment", contractor_payment: "Contractor payment", wage_payment: "Wage payment",
  labour_advance: "Labour advance", expense: "Expense", md_drawing: "MD drawing", transfer_out: "Transfer out",
};
export const MODE_LABEL: Record<string, string> = {
  cash: "Cash", upi: "UPI", neft: "NEFT", imps: "IMPS", rtgs: "RTGS", cheque: "Cheque", card: "Card", other: "Other",
};
export const titleCase = (s?: string | null) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
