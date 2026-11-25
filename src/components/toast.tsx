import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type Kind = "success" | "error" | "info";
interface T { id: number; kind: Kind; text: string }
let listeners: ((t: T[]) => void)[] = [];
let items: T[] = [];
let seq = 1;

function push(kind: Kind, text: string) {
  const t = { id: seq++, kind, text };
  items = [...items, t];
  listeners.forEach(l => l(items));
  setTimeout(() => dismiss(t.id), kind === "error" ? 7000 : 3500);
}
function dismiss(id: number) { items = items.filter(i => i.id !== id); listeners.forEach(l => l(items)); }

export const toast = {
  success: (t: string) => push("success", t),
  error: (t: string) => push("error", t),
  info: (t: string) => push("info", t),
};

export function Toaster() {
  const [list, setList] = useState<T[]>([]);
  useEffect(() => { listeners.push(setList); return () => { listeners = listeners.filter(l => l !== setList); }; }, []);
  return (
    <div className="no-print pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[380px] flex-col gap-2">
      {list.map(t => (
        <div key={t.id} role="status"
          className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg ${
            t.kind === "error" ? "border-red-200" : t.kind === "success" ? "border-emerald-200" : "border-slate-200"}`}>
          {t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            : t.kind === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            : <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />}
          <div className="flex-1 text-ink-700">{t.text}</div>
          <button onClick={() => dismiss(t.id)} className="text-ink-400 hover:text-ink-700" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
