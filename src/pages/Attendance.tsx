import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CheckCheck, Printer, Users, Plus } from "lucide-react";
import { useList, useRpc, useAction, rpc, insertRow, type Row } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/perms";
import { addDays, dayName, dayNum, fmtDate, inr, n, qty, todayISO, weekStartOf, monthStart, monthEnd, parseISO, toISO } from "@/lib/format";
import { dayValue, timeWarning } from "@/lib/dayValue";
import { PageHeader, Tabs, Toolbar, MiniField, Select, Input, Modal, Field, Spinner, Loading, Empty, Badge, cx, MoneyInput, ReasonDialog } from "@/components/ui";
import { ProjectSelect, TeamSelect, useProjects, useEmployees, useTeams, AccountSelect, ModeSelect } from "@/components/pickers";
import { useForms } from "@/components/FormHost";
import { toast } from "@/components/toast";

type View = "sheet" | "wages" | "month";

export function AttendancePage() {
  const { role } = useAuth();
  const fin = can.money(role);
  const [sp, setSp] = useSearchParams();
  const view = (sp.get("view") as View) || "sheet";
  const settings = useList("company_settings", { select: "week_start,full_day_hours,ot_day_hours,half_day_hours", order: [{ col: "week_start" }] });
  const ws = n(settings.data?.[0]?.week_start ?? 0);
  const [week, setWeek] = useState(() => weekStartOf(todayISO(), 0));
  useEffect(() => { setWeek(w => weekStartOf(w, ws)); }, [ws]);
  const [projectId, setProjectId] = useState(() => localStorage.getItem("bw.att.project") ?? "");
  const projectsQ = useProjects();
  useEffect(() => {
    // Default to the first running site so supervisors land on a usable sheet.
    if (view !== "sheet" || projectId || !projectsQ.data) return;
    const first = projectsQ.data.find(p => p.kind === "site" && p.status === "active") ?? projectsQ.data.find(p => p.kind === "site" && p.status !== "completed");
    if (first) setProjectId(first.id);
  }, [projectsQ.data, projectId, view]);
  useEffect(() => { try { localStorage.setItem("bw.att.project", projectId); } catch { /* ignore */ } }, [projectId]);
  const [filterProject, setFilterProject] = useState(""); // wages & monthly views: all sites unless chosen
  const [teamId, setTeamId] = useState("");
  const [month, setMonth] = useState(todayISO().slice(0, 7));

  return (
    <div>
      <PageHeader title="Attendance" subtitle={view === "month" ? undefined : `Week of ${fmtDate(week)} – ${fmtDate(addDays(week, 6))}`}
        actions={view !== "month" && <button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>}>
        <Tabs value={view} onChange={v => setSp({ view: v })} tabs={[
          { key: "sheet", label: "Weekly attendance" }, { key: "wages", label: "Wages & payments", hidden: !fin }, { key: "month", label: "Monthly register" },
        ]} />
      </PageHeader>
      <Toolbar>
        {view !== "month" ? (
          <MiniField label="Week">
            <div className="flex items-center gap-1">
              <button className="btn-secondary px-2 py-1.5" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button>
              <Input type="date" className="w-40 py-1.5" value={week} onChange={e => e.target.value && setWeek(weekStartOf(e.target.value, ws))} />
              <button className="btn-secondary px-2 py-1.5" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
              <button className="btn-ghost py-1.5" onClick={() => setWeek(weekStartOf(todayISO(), ws))}>This week</button>
            </div>
          </MiniField>
        ) : (
          <MiniField label="Month"><Input type="month" className="w-44 py-1.5" value={month} onChange={e => setMonth(e.target.value)} /></MiniField>
        )}
        <MiniField label={view === "sheet" ? "Marking for site" : "Site filter"}>
          {view === "sheet"
            ? <ProjectSelect className="w-72 py-1.5" value={projectId} onChange={setProjectId} onlyOpen placeholder="Choose a site first" />
            : <ProjectSelect className="w-72 py-1.5" value={filterProject} onChange={setFilterProject} placeholder="All sites" />}
        </MiniField>
        <MiniField label="Team"><TeamSelect className="w-52 py-1.5" value={teamId} onChange={setTeamId} /></MiniField>
      </Toolbar>
      {view === "sheet" && <WeekSheet week={week} projectId={projectId} teamId={teamId} rules={settings.data?.[0]} />}
      {view === "wages" && fin && <WageSheet week={week} projectId={filterProject} teamId={teamId} />}
      {view === "month" && <MonthRegister month={month} projectId={filterProject} teamId={teamId} fin={fin} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function WeekSheet({ week, projectId, teamId, rules }: { week: string; projectId: string; teamId: string; rules?: Row }) {
  const { role } = useAuth();
  const fin = can.money(role);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const emps = useEmployees();
  const teams = useTeams();
  const projects = useProjects();
  const att = useList("attendance", { select: "id,employee_id,project_id,work_date,in_time,out_time,day_value,is_leave,notes", gte: { work_date: week }, lte: { work_date: addDays(week, 6) } });
  const [q, setQ] = useState("");
  const [cell, setCell] = useState<{ emp: Row; date: string; rec?: Row } | null>(null);
  const [markAll, setMarkAll] = useState(false);
  const projCode = (id: string) => (projects.data ?? []).find(p => p.id === id)?.code ?? "";
  const teamName = (id: string) => (teams.data ?? []).find(t => t.id === id)?.name ?? "No team";
  const map = useMemo(() => { const m = new Map<string, Row>(); for (const a of att.data ?? []) m.set(a.employee_id + a.work_date, a); return m; }, [att.data]);
  const workers = useMemo(() => (emps.data ?? [])
    .filter(e => (e.active || (att.data ?? []).some(a => a.employee_id === e.id)) && (!teamId || e.team_id === teamId)
      && (!q || `${e.name} ${e.code}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => teamName(a.team_id).localeCompare(teamName(b.team_id)) || a.name.localeCompare(b.name)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [emps.data, att.data, teamId, q, teams.data]);
  if (emps.isLoading || att.isLoading) return <Loading />;
  if (!projectId) return <Empty title="Choose the site you are marking attendance for" hint="Every attendance entry is saved against a project / site so labour cost goes to the right project. Use “Head Office” for office staff." />;
  const grouped: [string, Row[]][] = [];
  for (const w of workers) { const t = teamName(w.team_id); const g = grouped.find(x => x[0] === t); if (g) g[1].push(w); else grouped.push([t, [w]]); }
  const dayTotal = (d: string) => workers.reduce((s, w) => s + n(map.get(w.id + d)?.day_value), 0);
  return (
    <div>
      <div className="no-print flex flex-wrap items-center gap-2 px-4 py-3 md:px-6">
        <Input className="w-full py-1.5 md:w-64" placeholder="Search worker…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="hidden flex-1 md:block" />
        <div className="hidden md:block"><Legend /></div>
        <button className="btn-primary w-full justify-center md:w-auto" onClick={() => setMarkAll(true)}><CheckCheck className="h-4 w-4" /> Mark all present</button>
      </div>
      {workers.length > 0 && <MobileDay days={days} workers={workers} map={map} projectId={projectId} teamName={teamName} projCode={projCode} onOpen={(emp, date, rec) => setCell({ emp, date, rec })} />}
      {workers.length === 0 ? <Empty title="No workers" hint="Add workers in Masters → Workers." /> : (
        <div className="hidden overflow-x-auto px-6 pb-8 md:block">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 rounded-lg border border-slate-200">
            <thead>
              <tr>
                <th className="th sticky left-0 z-[2] w-64 rounded-tl-lg">Worker</th>
                {days.map(d => (
                  <th key={d} className={cx("th text-center", d === todayISO() && "bg-brand-50 text-brand-700")}>
                    <div>{dayName(d)}</div><div className="text-[15px] font-semibold normal-case tracking-normal text-ink-900">{dayNum(d)}</div>
                  </th>
                ))}
                <th className="th text-right">Days</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([team, list]) => (
                <FragmentRows key={team} team={team} count={list.length}>
                  {list.map(w => {
                    const total = days.reduce((s, d) => s + n(map.get(w.id + d)?.day_value), 0);
                    return (
                      <tr key={w.id} className="hover:bg-slate-50/60">
                        <td className="td sticky left-0 z-[1] bg-white py-2"><div className="font-medium">{w.name}</div><div className="text-xs text-ink-500">{w.code}{w.designation ? ` · ${w.designation}` : ""}{!w.active && " · inactive"}</div></td>
                        {days.map(d => {
                          const r = map.get(w.id + d);
                          const other = r && r.project_id !== projectId;
                          return (
                            <td key={d} className="td p-1 text-center">
                              <button onClick={() => setCell({ emp: w, date: d, rec: r })}
                                title={r ? `${projCode(r.project_id)} ${r.in_time ?? ""}${r.out_time ? "–" + r.out_time : ""}${r.notes ? " · " + r.notes : ""}` : "Click to mark"}
                                className={cx("h-11 w-full rounded-md border text-sm font-semibold transition",
                                  !r ? "border-dashed border-slate-200 text-ink-300 hover:border-brand-300 hover:bg-brand-50"
                                    : r.is_leave ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : n(r.day_value) === 0 ? "border-red-200 bg-red-50 text-red-600"
                                    : other ? "border-slate-200 bg-slate-100 text-ink-600"
                                    : n(r.day_value) > 1 ? "border-violet-200 bg-violet-50 text-violet-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                                {!r ? "+" : r.is_leave ? "L" : n(r.day_value) === 0 ? "A" : n(r.day_value) === 0.5 ? "½" : qty(r.day_value)}
                                {other && <div className="-mt-0.5 truncate px-0.5 text-[9.5px] font-normal">{projCode(r.project_id)}</div>}
                              </button>
                            </td>
                          );
                        })}
                        <td className="td text-right font-semibold tabular-nums">{qty(total)}</td>
                      </tr>
                    );
                  })}
                </FragmentRows>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 text-sm font-semibold">
                <td className="sticky left-0 bg-slate-50 px-4 py-2.5">Man-days</td>
                {days.map(d => <td key={d} className="px-2 py-2.5 text-center tabular-nums">{qty(dayTotal(d))}</td>)}
                <td className="px-4 py-2.5 text-right tabular-nums">{qty(days.reduce((s, d) => s + dayTotal(d), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <CellEditor cell={cell} projectId={projectId} onClose={() => setCell(null)} fin={fin} rules={rules} />
      <MarkAllDialog open={markAll} onClose={() => setMarkAll(false)} days={days} workers={workers} projectId={projectId} existing={map} />
    </div>
  );
}

/** Phone view: one day at a time, big tap targets. Same save_attendance RPC as the grid. */
function MobileDay({ days, workers, map, projectId, teamName, projCode, onOpen }: {
  days: string[]; workers: Row[]; map: Map<string, Row>; projectId: string; teamName: (id: string) => string; projCode: (id: string) => string;
  onOpen: (emp: Row, date: string, rec?: Row) => void;
}) {
  const [day, setDay] = useState(() => days.includes(todayISO()) ? todayISO() : days[0]);
  useEffect(() => { if (!days.includes(day)) setDay(days.includes(todayISO()) ? todayISO() : days[0]); }, [days, day]);
  const save = useAction((a: { emp: string; dv: number; leave?: boolean }) => rpc("save_attendance", {
    p_rows: [{ employee_id: a.emp, project_id: projectId, work_date: day, day_value: a.dv, is_leave: !!a.leave, in_time: null, out_time: null }], p_overwrite: true }));
  const marked = workers.filter(w => map.has(w.id + day)).length;
  const opts: [string, number, boolean, string][] = [["P", 1, false, "bg-emerald-600"], ["½", 0.5, false, "bg-sky-600"], ["1.5", 1.5, false, "bg-violet-600"], ["A", 0, false, "bg-red-600"], ["L", 0, true, "bg-amber-500"]];
  return (
    <div className="px-4 pb-8 md:hidden">
      <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {days.map(d => (
          <button key={d} onClick={() => setDay(d)} className={cx("flex w-12 shrink-0 flex-col items-center rounded-lg border py-1.5 text-xs", d === day ? "border-brand-500 bg-brand-500 text-white" : "border-slate-200 text-ink-600", d === todayISO() && d !== day && "border-brand-300")}>
            <span>{dayName(d)}</span><span className="text-base font-semibold">{dayNum(d)}</span>
          </button>
        ))}
      </div>
      <div className="mb-2 text-xs text-ink-500">{marked} of {workers.length} marked for {fmtDate(day)}</div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {workers.map(w => {
          const r = map.get(w.id + day);
          const cur = !r ? null : r.is_leave ? "L" : n(r.day_value) === 0 ? "A" : n(r.day_value) === 0.5 ? "½" : n(r.day_value) > 1 ? "1.5" : "P";
          const other = r && r.project_id !== projectId;
          return (
            <div key={w.id} className="px-3 py-2.5">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <button className="min-w-0 truncate text-left text-sm font-medium" onClick={() => onOpen(w, day, r)}>{w.name}</button>
                <span className="shrink-0 text-[11px] text-ink-400">{other ? `at ${projCode(r!.project_id)}` : teamName(w.team_id)}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {opts.map(([l, dv, leave, bg]) => (
                  <button key={l} disabled={save.isPending} onClick={() => save.mutate({ emp: w.id, dv, leave })}
                    className={cx("h-10 rounded-md border text-sm font-semibold", cur === l ? `${bg} border-transparent text-white` : "border-slate-300 bg-white text-ink-600 active:bg-slate-100")}>{l}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-ink-400">P = present · ½ = half day · 1.5 = overtime · A = absent · L = leave. Tap a name to enter in/out time or a note.</div>
    </div>
  );
}

function FragmentRows({ team, count, children }: { team: string; count: number; children: React.ReactNode }) {
  return <>
    <tr><td colSpan={9} className="border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500"><Users className="mr-1.5 inline h-3.5 w-3.5" />{team} · {count}</td></tr>
    {children}
  </>;
}

function Legend() {
  const x = (c: string, t: string, l: string) => <span className="flex items-center gap-1"><span className={cx("grid h-5 w-6 place-items-center rounded border text-[11px] font-semibold", c)}>{t}</span>{l}</span>;
  return <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
    {x("border-emerald-200 bg-emerald-50 text-emerald-700", "1", "Present")}{x("border-violet-200 bg-violet-50 text-violet-700", "1.5", "Overtime")}
    {x("border-red-200 bg-red-50 text-red-600", "A", "Absent")}{x("border-amber-200 bg-amber-50 text-amber-700", "L", "Leave")}{x("border-slate-200 bg-slate-100 text-ink-600", "1", "Other site")}
  </div>;
}

function CellEditor({ cell, projectId, onClose, fin, rules }: { cell: { emp: Row; date: string; rec?: Row } | null; projectId: string; onClose: () => void; fin: boolean; rules?: Row }) {
  const [f, setF] = useState<Row>({});
  const [del, setDel] = useState(false);
  useEffect(() => {
    if (!cell) return;
    const r = cell.rec;
    setF({ project_id: r?.project_id ?? projectId, in_time: r?.in_time ?? "", out_time: r?.out_time ?? "", day_value: r ? String(r.day_value) : "1", is_leave: r?.is_leave ?? false, notes: r?.notes ?? "" });
  }, [cell, projectId]);
  const r = { fullDay: n(rules?.full_day_hours ?? 8), otDay: n(rules?.ot_day_hours ?? 12), halfDay: n(rules?.half_day_hours ?? 4) };
  const computed = f.in_time && f.out_time ? dayValue(f.in_time, f.out_time, r) : null;
  const warn = timeWarning(f.in_time, f.out_time);
  const save = useAction((v: Row) => rpc("save_attendance", { p_rows: [{ employee_id: cell!.emp.id, work_date: cell!.date, ...v }], p_overwrite: true }));
  const remove = useAction((reason: string) => rpc("soft_delete", { p_table: "attendance", p_id: cell!.rec!.id, p_reason: reason }), "Entry removed");
  if (!cell) return null;
  const quick = (dv: number, leave = false) => save.mutate({ project_id: f.project_id, day_value: dv, is_leave: leave, in_time: null, out_time: null, notes: f.notes || null }, { onSuccess: onClose });
  return (
    <>
      <Modal open={!!cell} onClose={onClose} width="max-w-md" title={<span>{cell.emp.name} <span className="font-normal text-ink-500">· {dayName(cell.date)} {fmtDate(cell.date)}</span></span>}
        footer={<>
          {fin && cell.rec && <button className="btn-ghost mr-auto text-red-600" onClick={() => setDel(true)}>Remove entry</button>}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={save.isPending || !f.project_id || !!(f.in_time && f.out_time && warn && /must be after|not understood/.test(warn))}
            onClick={() => save.mutate({ project_id: f.project_id, in_time: f.in_time || null, out_time: f.out_time || null, day_value: f.in_time && f.out_time ? null : n(f.day_value), is_leave: !!f.is_leave, notes: f.notes || null }, { onSuccess: onClose })}>
            {save.isPending && <Spinner className="text-white" />}Save
          </button>
        </>}>
        <div className="space-y-4">
          <Field label="Site"><ProjectSelect value={f.project_id ?? ""} onChange={v => setF({ ...f, project_id: v })} onlyOpen /></Field>
          <div>
            <div className="label">Quick mark</div>
            <div className="grid grid-cols-6 gap-1.5">
              {[["Absent", 0], ["½ day", 0.5], ["Full", 1], ["1.5", 1.5], ["2", 2]].map(([l, v]) => (
                <button key={l} disabled={save.isPending} onClick={() => quick(v as number)} className={cx("rounded-md border px-1 py-2 text-xs font-semibold hover:border-brand-500 hover:bg-brand-50", !f.is_leave && n(f.day_value) === v && !f.in_time ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300")}>{l}</button>
              ))}
              <button disabled={save.isPending} onClick={() => quick(0, true)} className={cx("rounded-md border px-1 py-2 text-xs font-semibold hover:border-amber-500 hover:bg-amber-50", f.is_leave ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-300")}>Leave</button>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 text-xs font-medium text-ink-500">Or enter time (6 → 6 = 1.5 · 9 → 6 = 1 · 6 → 2 = 1)</div>
            <div className="grid grid-cols-3 items-end gap-2">
              <Field label="In"><Input value={f.in_time ?? ""} onChange={e => setF({ ...f, in_time: e.target.value, is_leave: false })} placeholder="9" /></Field>
              <Field label="Out"><Input value={f.out_time ?? ""} onChange={e => setF({ ...f, out_time: e.target.value, is_leave: false })} placeholder="6" /></Field>
              <div className="pb-2 text-center text-sm">{computed !== null ? <>= <b className="text-lg">{computed}</b> day</> : <span className="text-ink-400">—</span>}</div>
            </div>
            {warn && <div className="mt-2 text-xs text-amber-700">{warn}</div>}
          </div>
          <Field label="Note"><Input value={f.notes ?? ""} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="optional" /></Field>
        </div>
      </Modal>
      <ReasonDialog open={del} onClose={() => setDel(false)} title="Remove attendance entry" message={`Remove ${cell.emp.name}'s entry for ${fmtDate(cell.date)}?`} confirmLabel="Remove"
        busy={remove.isPending} onConfirm={rs => remove.mutate(rs, { onSuccess: () => { setDel(false); onClose(); } })} />
    </>
  );
}

function MarkAllDialog({ open, onClose, days, workers, projectId, existing }: { open: boolean; onClose: () => void; days: string[]; workers: Row[]; projectId: string; existing: Map<string, Row> }) {
  const [sel, setSel] = useState<string[]>([]);
  const [dv, setDv] = useState("1");
  const [inT, setIn] = useState("");
  const [outT, setOut] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [who, setWho] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!open) return;
    const t = todayISO(); setSel(days.includes(t) ? [t] : [days[1] ?? days[0]]);
    setDv("1"); setIn(""); setOut(""); setOverwrite(false);
    setWho(Object.fromEntries(workers.filter(w => w.active).map(w => [w.id, true])));
  }, [open, days, workers]);
  const picked = workers.filter(w => who[w.id]);
  const newCells = sel.reduce((s, d) => s + picked.filter(w => !existing.has(w.id + d)).length, 0);
  const existCells = sel.reduce((s, d) => s + picked.filter(w => existing.has(w.id + d)).length, 0);
  const save = useAction(() => rpc<Row>("save_attendance", {
    p_rows: sel.flatMap(d => picked.map(w => ({ employee_id: w.id, project_id: projectId, work_date: d, in_time: inT || null, out_time: outT || null, day_value: inT && outT ? null : n(dv), is_leave: false }))),
    p_overwrite: overwrite,
  }), (r: Row) => `Saved: ${r.inserted} new, ${r.updated} updated, ${r.skipped} kept as they were`);
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title="Mark all present"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!sel.length || !picked.length || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{save.isPending && <Spinner className="text-white" />}Mark {picked.length} worker(s)</button>
      </>}>
      <div className="space-y-4">
        <div>
          <div className="label">Days</div>
          <div className="flex flex-wrap gap-1.5">{days.map(d => (
            <button key={d} onClick={() => setSel(sel.includes(d) ? sel.filter(x => x !== d) : [...sel, d])}
              className={cx("rounded-md border px-3 py-1.5 text-sm", sel.includes(d) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-ink-600")}>{dayName(d)} {dayNum(d)}</button>))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Day value"><Select value={dv} onChange={e => setDv(e.target.value)} disabled={!!(inT && outT)}><option value="1">Full day (1)</option><option value="1.5">Overtime (1.5)</option><option value="0.5">Half day (½)</option></Select></Field>
          <Field label="or In time"><Input value={inT} onChange={e => setIn(e.target.value)} placeholder="9" /></Field>
          <Field label="Out time"><Input value={outT} onChange={e => setOut(e.target.value)} placeholder="6" /></Field>
        </div>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
          <label className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium">
            <input type="checkbox" checked={picked.length === workers.length} onChange={e => setWho(Object.fromEntries(workers.map(w => [w.id, e.target.checked])))} /> All workers ({workers.length})
          </label>
          {workers.map(w => <label key={w.id} className="flex items-center gap-2 px-3 py-1.5 text-sm"><input type="checkbox" checked={!!who[w.id]} onChange={e => setWho({ ...who, [w.id]: e.target.checked })} />{w.name} <span className="text-xs text-ink-400">{w.code}</span></label>)}
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
          <span>Overwrite existing entries <span className="block text-xs text-ink-500">Off = leave, absent and other-site entries already marked are kept as they are.</span></span></label>
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-ink-600">{newCells} new entr{newCells === 1 ? "y" : "ies"} · {existCells} already marked {overwrite ? <b className="text-amber-700">will be overwritten</b> : "will be kept"}</div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function WageSheet({ week, projectId, teamId }: { week: string; projectId: string; teamId: string }) {
  const { openForm } = useForms();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const sheet = useRpc<Row[]>("get_wage_sheet", { p_week_start: week, p_project: projectId || null, p_team: teamId || null });
  const [teamPay, setTeamPay] = useState(false);
  const [adj, setAdj] = useState<Row | null>(null);
  const rows = sheet.data ?? [];
  const tot = (k: string) => rows.reduce((s, r) => s + n(r[k]), 0);
  if (sheet.isLoading) return <Loading />;
  return (
    <div className="pb-8">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 px-6 py-3">
        <div className="text-sm text-ink-600">Balance due = previous balance + earned + allowances − deductions − advances − paid. {projectId && <Badge tone="blue">Showing workers who worked on the selected site</Badge>}</div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => openForm("wagepay", { kind: "labour_advance" })}>Give advance</button>
          <button className="btn-primary" disabled={!rows.some(r => n(r.balance) > 0)} onClick={() => setTeamPay(true)}>Pay wages ({inr(rows.reduce((s, r) => s + Math.max(0, n(r.balance)), 0))})</button>
        </div>
      </div>
      {rows.length === 0 ? <Empty title="No workers for this week" hint="Mark attendance first, or clear the site/team filter." /> : (
        <div className="overflow-x-auto px-6">
          <table className="w-full min-w-[1000px] border border-slate-200 text-[13px] [&_td]:px-2 [&_th]:px-2">
            <thead><tr>
              <th className="th">Worker</th>
              {days.map(d => <th key={d} className="th text-center">{dayName(d)}<br /><span className="normal-case">{dayNum(d)}</span></th>)}
              <th className="th text-right">Days</th><th className="th text-right">Earned</th><th className="th text-right">Bus/Allow.</th><th className="th text-right">Advance</th>
              <th className="th text-right">Paid</th><th className="th text-right">Prev. bal.</th><th className="th text-right">Balance</th><th className="th no-print" />
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.employee_id} className="hover:bg-slate-50/60">
                  <td className="td whitespace-nowrap py-2" title={r.team_name ?? "No team"}><div className="font-medium">{r.name}</div><div className="text-xs text-ink-500">{r.code} · {r.rate ? <>{inr(r.rate)}/{r.wage_type === "monthly" ? "month" : "day"}</> : <span className="text-red-600">no rate set</span>}</div></td>
                                    {(r.days as (number | null)[]).map((v, i) => <td key={i} className="td py-2 text-center tabular-nums" title={r.day_projects?.[i] ?? ""}>{v === null ? <span className="text-ink-300">·</span> : qty(v)}</td>)}
                  <td className="td py-2 text-right font-medium tabular-nums">{qty(r.total_days)}</td>
                  <td className="td py-2 text-right tabular-nums">{inr(r.earned)}</td>
                  <td className="td py-2 text-right tabular-nums"><button className="link no-print" onClick={() => setAdj(r)}>{n(r.allowances) - n(r.deductions) ? inr(n(r.allowances) - n(r.deductions)) : "+ add"}</button><span className="hidden print:inline">{inr(n(r.allowances) - n(r.deductions))}</span></td>
                  <td className="td py-2 text-right tabular-nums">{n(r.advances) ? inr(r.advances) : "—"}</td>
                  <td className="td py-2 text-right tabular-nums">{n(r.paid) ? inr(r.paid) : "—"}</td>
                  <td className="td py-2 text-right tabular-nums text-ink-500">{inr(r.prev_balance)}</td>
                  <td className={cx("td py-2 text-right font-semibold tabular-nums", n(r.balance) > 0 ? "text-ink-900" : n(r.balance) < 0 ? "text-amber-700" : "text-emerald-700")}>{inr(r.balance)}{n(r.balance) < 0 && <div className="text-[10px] font-normal">advance</div>}</td>
                  <td className="td no-print py-2 text-right"><div className="flex justify-end gap-1">
                    <button className="btn-secondary px-2 py-1 text-xs" disabled={n(r.balance) <= 0} onClick={() => openForm("wagepay", { employeeId: r.employee_id, weekStart: week, suggested: Math.max(0, n(r.balance)) })}>Pay</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-slate-50 font-semibold">
              <td className="px-2.5 py-2.5">Total ({rows.length})</td>
              {days.map((d, i) => <td key={d} className="px-2 py-2.5 text-center tabular-nums">{qty(rows.reduce((s, r) => s + n(r.days[i]), 0))}</td>)}
              <td className="px-4 py-2.5 text-right tabular-nums">{qty(tot("total_days"))}</td>
              {["earned"].map(k => <td key={k} className="px-4 py-2.5 text-right tabular-nums">{inr(tot(k))}</td>)}
              <td className="px-4 py-2.5 text-right tabular-nums">{inr(tot("allowances") - tot("deductions"))}</td>
              {["advances", "paid", "prev_balance", "balance"].map(k => <td key={k} className="px-4 py-2.5 text-right tabular-nums">{inr(tot(k))}</td>)}
              <td className="no-print" />
            </tr></tfoot>
          </table>
        </div>
      )}
      <TeamPayDialog open={teamPay} onClose={() => setTeamPay(false)} rows={rows} week={week} teamId={teamId} />
      <AdjustmentDialog row={adj} week={week} projectId={projectId} onClose={() => setAdj(null)} />
    </div>
  );
}

function TeamPayDialog({ open, onClose, rows, week, teamId }: { open: boolean; onClose: () => void; rows: Row[]; week: string; teamId: string }) {
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [f, setF] = useState<Row>({});
  useEffect(() => {
    if (!open) return;
    setAmt(Object.fromEntries(rows.filter(r => n(r.balance) > 0).map(r => [r.employee_id, String(Math.round(n(r.balance) * 100) / 100)])));
    setF({ account_id: "", date: todayISO(), mode: "cash", reference: "" });
  }, [open, rows]);
  const total = Object.values(amt).reduce((s, v) => s + n(v), 0);
  const save = useAction(() => rpc("pay_wages", { p_account: f.account_id, p_date: f.date, p_week_start: week, p_mode: f.mode, p_reference: f.reference || null, p_team: teamId || null,
    p_lines: Object.entries(amt).filter(([, v]) => n(v) > 0).map(([employee_id, v]) => ({ employee_id, amount: n(v) })) }), `Wages paid: ${inr(total)}`);
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title={`Pay wages · week of ${fmtDate(week)}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!f.account_id || total <= 0 || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{save.isPending && <Spinner className="text-white" />}Pay {inr(total)}</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Paid from" required className="col-span-3"><AccountSelect value={f.account_id ?? ""} onChange={v => setF({ ...f, account_id: v })} /></Field>
          <Field label="Date"><Input type="date" value={f.date ?? ""} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Mode"><ModeSelect value={f.mode ?? "cash"} onChange={v => setF({ ...f, mode: v })} /></Field>
          <Field label="Reference"><Input value={f.reference ?? ""} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm"><thead><tr className="bg-slate-50"><th className="th">Worker</th><th className="th text-right">Due</th><th className="th w-40">Pay now</th></tr></thead>
            <tbody>{rows.filter(r => n(r.balance) > 0).map(r => (
              <tr key={r.employee_id} className="border-t border-slate-100"><td className="px-4 py-1.5">{r.name}</td><td className="px-4 py-1.5 text-right tabular-nums">{inr(r.balance)}</td>
                <td className="px-2 py-1"><MoneyInput value={amt[r.employee_id] ?? ""} onChange={v => setAmt({ ...amt, [r.employee_id]: v })} /></td></tr>))}
            </tbody></table>
        </div>
      </div>
    </Modal>
  );
}

function AdjustmentDialog({ row, week, projectId, onClose }: { row: Row | null; week: string; projectId: string; onClose: () => void }) {
  const [f, setF] = useState<Row>({});
  useEffect(() => { if (row) setF({ kind: "allowance", label: "Bus/Petrol", amount: "", adj_date: addDays(week, 6) > todayISO() ? todayISO() : addDays(week, 6), notes: "" }); }, [row, week]);
  const list = useList("wage_adjustments", { eq: { employee_id: row?.employee_id }, gte: { adj_date: week }, lte: { adj_date: addDays(week, 6) }, enabled: !!row });
  const save = useAction(() => insertRow("wage_adjustments", { employee_id: row!.employee_id, project_id: projectId || null, adj_date: f.adj_date, kind: f.kind, label: f.label, amount: n(f.amount), notes: f.notes || null }), "Saved");
  const del = useAction((id: string) => rpc("soft_delete", { p_table: "wage_adjustments", p_id: id, p_reason: "Removed from wage sheet" }), "Removed");
  if (!row) return null;
  return (
    <Modal open={!!row} onClose={onClose} width="max-w-md" title={`Allowance / deduction · ${row.name}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Close</button><button className="btn-primary" disabled={n(f.amount) <= 0 || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => setF({ ...f, amount: "" }) })}><Plus className="h-4 w-4" /> Add</button></>}>
      <div className="space-y-3">
        {(list.data ?? []).map(a => (
          <div key={a.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span>{fmtDate(a.adj_date)} · {a.label} <Badge tone={a.kind === "allowance" ? "green" : "red"}>{a.kind}</Badge></span>
            <span className="flex items-center gap-3 tabular-nums">{inr(a.amount)}<button className="text-xs text-red-600 hover:underline" onClick={() => del.mutate(a.id)}>remove</button></span>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="allowance">Allowance (adds to pay)</option><option value="deduction">Deduction (reduces pay)</option></Select></Field>
          <Field label="For"><Input value={f.label ?? ""} onChange={e => setF({ ...f, label: e.target.value })} list="adj-labels" /><datalist id="adj-labels"><option value="Bus/Petrol" /><option value="Food" /><option value="Room rent" /><option value="Fine" /><option value="Tools damage" /></datalist></Field>
          <Field label="Amount"><MoneyInput value={f.amount ?? ""} onChange={v => setF({ ...f, amount: v })} /></Field>
          <Field label="Date"><Input type="date" value={f.adj_date ?? ""} min={week} max={addDays(week, 6)} onChange={e => setF({ ...f, adj_date: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function MonthRegister({ month, projectId, teamId, fin }: { month: string; projectId: string; teamId: string; fin: boolean }) {
  const start = monthStart(month + "-01"), end = monthEnd(month + "-01");
  const days = useMemo(() => { const out: string[] = []; for (let d = parseISO(start); toISO(d) <= end; d.setDate(d.getDate() + 1)) out.push(toISO(d)); return out; }, [start, end]);
  const att = useList("attendance", { select: "employee_id,project_id,work_date,day_value,is_leave", gte: { work_date: start }, lte: { work_date: end }, eq: projectId ? { project_id: projectId } : {} });
  const wages = useList("v_wage_lines", { select: "employee_id,wage,work_date,project_id", gte: { work_date: start }, lte: { work_date: end }, eq: projectId ? { project_id: projectId } : {}, enabled: fin });
  const emps = useEmployees();
  const map = useMemo(() => { const m = new Map<string, Row>(); for (const a of att.data ?? []) m.set(a.employee_id + a.work_date, a); return m; }, [att.data]);
  const wageBy = useMemo(() => { const m = new Map<string, number>(); for (const w of wages.data ?? []) m.set(w.employee_id, (m.get(w.employee_id) ?? 0) + n(w.wage)); return m; }, [wages.data]);
  const list = (emps.data ?? []).filter(e => (!teamId || e.team_id === teamId) && (att.data ?? []).some(a => a.employee_id === e.id));
  if (att.isLoading) return <Loading />;
  if (!list.length) return <Empty title="No attendance this month" hint={projectId ? "Nothing marked for this site in the month." : undefined} />;
  return (
    <div className="overflow-x-auto px-6 py-4">
      <table className="w-full border border-slate-200 text-xs">
        <thead><tr><th className="th sticky left-0 bg-white">Worker</th>{days.map(d => <th key={d} className={cx("border-l border-slate-100 px-1 py-2 text-center font-semibold text-ink-500", parseISO(d).getDay() === 0 && "bg-slate-50")}>{dayNum(d)}</th>)}<th className="th text-right">Days</th>{fin && <th className="th text-right">Wages</th>}</tr></thead>
        <tbody>{list.map(e => {
          const total = days.reduce((s, d) => s + n(map.get(e.id + d)?.day_value), 0);
          return (
            <tr key={e.id} className="border-t border-slate-100">
              <td className="sticky left-0 bg-white px-3 py-1.5 text-sm"><div className="font-medium">{e.name}</div><div className="text-[11px] text-ink-500">{e.code}</div></td>
              {days.map(d => { const r = map.get(e.id + d); return <td key={d} className={cx("border-l border-slate-100 px-1 py-1.5 text-center tabular-nums", r?.is_leave && "bg-amber-50 text-amber-700", r && !r.is_leave && n(r.day_value) === 0 && "bg-red-50 text-red-600")}>{!r ? "" : r.is_leave ? "L" : n(r.day_value) === 0 ? "A" : qty(r.day_value)}</td>; })}
              <td className="px-3 py-1.5 text-right text-sm font-semibold tabular-nums">{qty(total)}</td>
              {fin && <td className="px-3 py-1.5 text-right text-sm tabular-nums">{inr(wageBy.get(e.id) ?? 0)}</td>}
            </tr>
          );
        })}</tbody>
        <tfoot><tr className="bg-slate-50 text-sm font-semibold"><td className="sticky left-0 bg-slate-50 px-3 py-2">Total</td>{days.map(d => <td key={d} className="px-1 py-2 text-center text-xs tabular-nums">{qty(list.reduce((s, e) => s + n(map.get(e.id + d)?.day_value), 0)) || ""}</td>)}
          <td className="px-3 py-2 text-right tabular-nums">{qty(list.reduce((s, e) => s + days.reduce((x, d) => x + n(map.get(e.id + d)?.day_value), 0), 0))}</td>
          {fin && <td className="px-3 py-2 text-right tabular-nums">{inr([...wageBy.values()].reduce((s, v) => s + v, 0))}</td>}</tr></tfoot>
      </table>
    </div>
  );
}

export { toast };
