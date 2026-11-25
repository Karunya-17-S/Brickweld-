import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { cx, Empty, Loading, ErrorBox } from "./ui";
import { inr, n } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import type { Row } from "@/lib/data";

/** Columns whose values are short and should never wrap (dates, document numbers, codes). */
const NOWRAP = /(date|_no|^no$|code|^at$|phone|status|mode|amount|total|balance)/;

export interface Col<T = Row> {
  key: string;
  header: ReactNode;
  render?: (r: T) => ReactNode;
  /** value used for sort, search and CSV */
  value?: (r: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  money?: boolean;
  total?: boolean;
  width?: string;
  hideOnPrint?: boolean;
  csv?: boolean;
}

interface Props<T> {
  rows: T[] | undefined;
  cols: Col<T>[];
  loading?: boolean;
  error?: unknown;
  onRowClick?: (r: T) => void;
  rowKey?: (r: T) => string;
  search?: boolean;
  searchPlaceholder?: string;
  exportName?: string;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  defaultSort?: { key: string; desc?: boolean };
  rowClass?: (r: T) => string | undefined;
  toolbar?: ReactNode;
  dense?: boolean;
}

export function DataTable<T extends Row>({ rows, cols, loading, error, onRowClick, rowKey, search = true, searchPlaceholder = "Search…",
  exportName, emptyTitle = "Nothing here yet", emptyHint, emptyAction, defaultSort, rowClass, toolbar, dense }: Props<T>) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(defaultSort ?? null);

  const valueOf = (c: Col<T>, r: T) => (c.value ? c.value(r) : r[c.key]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => cols.some(c => String(valueOf(c, r) ?? "").toLowerCase().includes(s)));
    if (sort) {
      const c = cols.find(x => x.key === sort.key);
      if (c) {
        list = [...list].sort((a, b) => {
          const va = valueOf(c, a), vb = valueOf(c, b);
          const na = typeof va === "number" || c.money ? n(va) : String(va ?? "").toLowerCase();
          const nb = typeof vb === "number" || c.money ? n(vb) : String(vb ?? "").toLowerCase();
          const r = na < nb ? -1 : na > nb ? 1 : 0;
          return sort.desc ? -r : r;
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, cols]);

  const hasTotals = cols.some(c => c.total);
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of cols) if (c.total) t[c.key] = filtered.reduce((s, r) => s + n(valueOf(c, r)), 0);
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, cols]);

  function exportCsv() {
    const cs = cols.filter(c => c.csv !== false);
    downloadCsv(exportName ?? "export", cs.map(c => typeof c.header === "string" ? c.header : c.key),
      filtered.map(r => cs.map(c => { const v = valueOf(c, r); return v ?? ""; })));
  }

  const pad = dense ? "py-2" : "";
  return (
    <div className="bg-white">
      {(search || exportName || toolbar) && (
        <div className="no-print flex flex-wrap items-center gap-2 px-4 py-2.5">
          {search && (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder} className="input py-1.5 pl-8" />
            </div>
          )}
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {toolbar}
            {exportName && (rows?.length ?? 0) > 0 && (
              <button className="btn-ghost py-1.5" onClick={exportCsv} title="Download for Excel"><Download className="h-4 w-4" /> Export</button>
            )}
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty title={q ? "No matches" : emptyTitle} hint={q ? `Nothing matches “${q}”.` : emptyHint} action={q ? undefined : emptyAction} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-[1]">
              <tr>
                {cols.map(c => (
                  <th key={c.key} style={{ width: c.width }}
                    className={cx("th cursor-pointer select-none hover:text-ink-900", c.align === "right" || c.money ? "text-right" : c.align === "center" ? "text-center" : "", c.hideOnPrint && "no-print")}
                    onClick={() => setSort(s => s?.key === c.key ? (s.desc ? null : { key: c.key, desc: true }) : { key: c.key })}>
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {sort?.key === c.key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={rowKey ? rowKey(r) : (r.id as string) ?? i}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cx("group", onRowClick && "cursor-pointer hover:bg-brand-50/40", rowClass?.(r))}>
                  {cols.map(c => (
                    <td key={c.key} className={cx("td", pad, (c.money || NOWRAP.test(c.key)) && "whitespace-nowrap", c.align === "right" || c.money ? "text-right tabular-nums" : c.align === "center" ? "text-center" : "", c.hideOnPrint && "no-print")}>
                      {c.render ? c.render(r) : c.money ? inr(valueOf(c, r)) : (valueOf(c, r) ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {hasTotals && (
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  {cols.map((c, i) => (
                    <td key={c.key} className={cx("px-4 py-2.5 text-sm", c.align === "right" || c.money ? "text-right tabular-nums" : "", c.hideOnPrint && "no-print")}>
                      {c.total ? (c.money !== false ? inr(totals[c.key]) : totals[c.key]) : i === 0 ? `Total (${filtered.length})` : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
