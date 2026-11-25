import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Building2, CalendarCheck, Wallet, Package, HardHat, Database, BarChart3, History, Settings,
  Plus, Bell, Search, LogOut, ChevronsLeft, ChevronsRight, CircleUser, Check, Menu, X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { NAV_BY_ROLE, can, type NavKey } from "@/lib/perms";
import { supabase } from "@/lib/supabase";
import { rpc, type Row } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { useForms, type FormKind } from "./FormHost";
import { cx } from "./ui";

const NAV: Record<NavKey, { label: string; to: string; icon: ReactNode }> = {
  dashboard: { label: "Dashboard", to: "/dashboard", icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
  projects: { label: "Projects", to: "/projects", icon: <Building2 className="h-[18px] w-[18px]" /> },
  attendance: { label: "Attendance", to: "/attendance", icon: <CalendarCheck className="h-[18px] w-[18px]" /> },
  accounts: { label: "Accounts & Cash", to: "/accounts", icon: <Wallet className="h-[18px] w-[18px]" /> },
  materials: { label: "Materials", to: "/materials", icon: <Package className="h-[18px] w-[18px]" /> },
  contractors: { label: "Contractors", to: "/contractors", icon: <HardHat className="h-[18px] w-[18px]" /> },
  masters: { label: "Masters", to: "/masters", icon: <Database className="h-[18px] w-[18px]" /> },
  reports: { label: "Reports & P&L", to: "/reports", icon: <BarChart3 className="h-[18px] w-[18px]" /> },
  audit: { label: "Audit Log", to: "/audit", icon: <History className="h-[18px] w-[18px]" /> },
  settings: { label: "Settings", to: "/settings", icon: <Settings className="h-[18px] w-[18px]" /> },
};

export function Layout() {
  const { role } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("bw.nav") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { try { localStorage.setItem("bw.nav", collapsed ? "1" : "0"); } catch { /* ignore */ } }, [collapsed]);
  useEffect(() => setMobileOpen(false), [loc.pathname, loc.search]);
  const items = role ? NAV_BY_ROLE[role] : [];
  const navList = (small: boolean) => (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
      {items.map(k => (
        <NavLink key={k} to={NAV[k].to} title={NAV[k].label}
          className={({ isActive }) => cx("flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-medium transition",
            isActive ? "bg-brand-500 text-white shadow-sm" : "text-ink-700 hover:bg-slate-200/70", small && "justify-center px-0")}>
          {NAV[k].icon}{!small && <span className="truncate">{NAV[k].label}</span>}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="flex h-full flex-col">
      <TopBar onMenu={() => setMobileOpen(true)} />
      <div className="flex min-h-0 flex-1">
        {/* desktop / tablet sidebar */}
        <aside className={cx("no-print hidden shrink-0 flex-col border-r border-slate-200 bg-[#f7f8fb] transition-all md:flex", collapsed ? "w-[60px]" : "w-[228px]")}>
          {navList(collapsed)}
          <button onClick={() => setCollapsed(!collapsed)} className="m-2.5 flex items-center justify-center gap-2 rounded-md py-2 text-xs text-ink-500 hover:bg-slate-200/70" aria-label="Collapse menu">
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </button>
        </aside>
        {/* phone drawer */}
        {mobileOpen && (
          <div className="no-print fixed inset-0 z-50 md:hidden" onClick={() => setMobileOpen(false)}>
            <div className="absolute inset-0 bg-slate-900/40" />
            <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-[#f7f8fb] shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex h-[52px] items-center justify-between bg-navy-900 px-4 text-white">
                <span className="font-semibold">Brickweld</span>
                <button onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
              </div>
              {navList(false)}
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto bg-white print-area"><Outlet /></main>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { fullName, role, signOut, email } = useAuth();
  const nav = useNavigate();
  return (
    <header className="no-print flex h-[52px] shrink-0 items-center gap-2 bg-navy-900 px-3 text-white md:gap-3 md:px-4">
      <button className="rounded-md p-1.5 hover:bg-white/10 md:hidden" onClick={onMenu} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      <div className="flex shrink-0 items-center gap-2 md:w-[200px]">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-500 text-[13px] font-bold">B</div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold">Brickweld</div>
          <div className="hidden text-[10.5px] text-white/50 md:block">Projects · Accounts · Site</div>
        </div>
      </div>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1.5">
        <QuickCreate />
        {role === "md" && <NotificationBell />}
        <div className="group relative">
          <button className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/10">
            <CircleUser className="h-6 w-6 text-white/80" />
            <div className="hidden text-left leading-tight md:block">
              <div className="max-w-[150px] truncate text-[13px] font-medium">{fullName}</div>
              <div className="text-[11px] text-white/50">{role ? ROLE_LABEL[role] : ""}</div>
            </div>
          </button>
          <div className="invisible absolute right-0 top-full z-50 w-60 rounded-lg border border-slate-200 bg-white py-1 text-ink-700 opacity-0 shadow-xl transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
            <div className="border-b border-slate-100 px-4 py-2.5"><div className="text-sm font-medium">{fullName}</div><div className="truncate text-xs text-ink-500">{email}</div></div>
            <button onClick={async () => { await signOut(); nav("/login"); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50"><LogOut className="h-4 w-4" /> Sign out</button>
          </div>
        </div>
      </div>
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery({ queryKey: ["search", q], queryFn: () => rpc<Row[]>("search_all", { q }), enabled: q.trim().length >= 2 });
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "/" && !(e.target as HTMLElement).closest("input,textarea,select")) { e.preventDefault(); ref.current?.querySelector("input")?.focus(); } };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, []);
  const go = (r: Row) => {
    setOpen(false); setQ("");
    const to: Record<string, string> = {
      project: `/projects/${r.id}`, employee: `/masters?tab=workers&id=${r.id}`, client: `/masters?tab=clients&id=${r.id}`,
      supplier: `/accounts?tab=payables&party=${r.id}`, contractor: `/contractors?tab=balances&party=${r.id}`, indent: `/materials?tab=indents&id=${r.id}`,
      grn: `/materials?tab=grn&id=${r.id}`, po: `/materials?tab=po&id=${r.id}`, bill: `/accounts?tab=bills&id=${r.id}`,
      work_order: `/contractors?tab=wo&id=${r.id}`, transaction: `/accounts?tab=transactions&id=${r.id}`,
    };
    nav(to[r.kind] ?? "/");
  };
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Search…  ( / )"
        className="w-full rounded-md border border-white/15 bg-white/10 py-1.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/45 focus:border-white/40 focus:bg-white/15" />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-ink-800 shadow-xl">
          {(data ?? []).length === 0 ? <div className="px-4 py-3 text-sm text-ink-500">No results</div> : (data ?? []).map(r => (
            <button key={r.kind + r.id} onClick={() => go(r)} className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50">
              <div className="min-w-0"><div className="truncate text-sm font-medium">{r.title}</div><div className="truncate text-xs text-ink-500">{r.subtitle}</div></div>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] capitalize text-ink-500">{String(r.kind).replace("_", " ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickCreate() {
  const { role } = useAuth();
  const { openForm } = useForms();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const fin = can.money(role);
  const groups: { title: string; items: { label: string; kind: FormKind; props?: Row }[] }[] = fin ? [
    { title: "Money", items: [
      { label: "Expense", kind: "expense" }, { label: "Pay supplier", kind: "payment", props: { partyType: "supplier" } },
      { label: "Pay contractor", kind: "payment", props: { partyType: "contractor" } }, { label: "Receive from client", kind: "receipt" },
      { label: "Wage / advance", kind: "wagepay" }, { label: "Transfer", kind: "transfer" }, { label: "MD investment / drawing", kind: "capital" },
    ] },
    { title: "Purchases & work", items: [
      { label: "Material indent", kind: "indent" }, { label: "Purchase order", kind: "po" }, { label: "Goods receipt", kind: "grn" },
      { label: "Work order", kind: "wo" }, { label: "Contractor bill", kind: "bill", props: { billType: "contractor" } },
      { label: "Supplier bill", kind: "bill", props: { billType: "supplier" } },
    ] },
    { title: "Masters", items: [
      { label: "Project", kind: "project" }, { label: "Worker", kind: "employee" }, { label: "Supplier", kind: "party", props: { type: "supplier" } },
      { label: "Contractor", kind: "party", props: { type: "contractor" } }, { label: "Client", kind: "party", props: { type: "client" } },
    ] },
  ] : [{ title: "Site", items: [{ label: "Material indent", kind: "indent" }, { label: "Goods receipt", kind: "grn" }] }];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 hover:bg-brand-600" aria-label="Quick create" title="Quick create"><Plus className="h-5 w-5" /></button>
      {open && (
        <div className={cx("absolute right-0 top-full z-50 mt-2 grid gap-4 rounded-lg border border-slate-200 bg-white p-4 text-ink-800 shadow-xl", fin ? "w-[620px] grid-cols-3" : "w-56 grid-cols-1")}>
          {groups.map(g => (
            <div key={g.title}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{g.title}</div>
              {g.items.map(i => (
                <button key={i.label} onClick={() => { setOpen(false); openForm(i.kind, i.props); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-brand-50 hover:text-brand-700">
                  <Plus className="h-3.5 w-3.5 text-ink-400" />{i.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ["notifications"], refetchInterval: 60_000,
    queryFn: async () => { const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(40); return (data ?? []) as Row[]; },
  });
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const unread = (data ?? []).filter(x => !x.is_read).length;
  const markAll = async () => { await rpc("mark_notifications_read", { p_ids: null }); qc.invalidateQueries({ queryKey: ["notifications"] }); };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="relative grid h-8 w-8 place-items-center rounded-md hover:bg-white/10" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[400px] rounded-lg border border-slate-200 bg-white text-ink-800 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <div className="text-sm font-semibold">Changes by your team</div>
            {unread > 0 && <button onClick={markAll} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"><Check className="h-3.5 w-3.5" /> Mark all read</button>}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {(data ?? []).length === 0 ? <div className="px-4 py-8 text-center text-sm text-ink-500">No notifications. You'll see every edit and delete made by the Accountant or Supervisor here.</div> :
              (data ?? []).map(x => (
                <div key={x.id} className={cx("border-b border-slate-100 px-4 py-2.5", !x.is_read && "bg-brand-50/50")}>
                  <div className="text-sm font-medium">{x.title}</div>
                  {x.body && <div className="mt-0.5 text-xs text-ink-600">{x.body}</div>}
                  <div className="mt-1 text-[11px] text-ink-400">{fmtDateTime(x.created_at)}</div>
                </div>
              ))}
          </div>
          <NavLink to="/audit" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2 text-center text-xs font-medium text-brand-600 hover:bg-slate-50">Open full audit log</NavLink>
        </div>
      )}
    </div>
  );
}
