import { useList, type Row } from "@/lib/data";
import { inr, MODE_LABEL } from "@/lib/format";
import { Select } from "./ui";

export const useProjects = () => useList("projects", { select: "id,code,name,kind,status,client_id,site_address,progress,start_date,end_date", order: [{ col: "kind", asc: false }, { col: "name" }] });
export const useParties = (type?: "client" | "supplier" | "contractor") =>
  useList("parties", { select: "id,type,code,name,phone,email,gstin,contact_person,address,active,notes", eq: type ? { type } : {}, order: [{ col: "name" }] });
export const useAccounts = (enabled = true) => useList("v_account_balances", { order: [{ col: "type" }, { col: "name" }], enabled });
export const useEmployees = () => useList("employees", { select: "id,code,name,phone,team_id,designation,staff_type,wage_type,active,joined_on", order: [{ col: "name" }] });
export const useTeams = () => useList("teams", { select: "id,name,leader_id,active,notes", order: [{ col: "name" }] });
export const useCategories = () => useList("expense_categories", { select: "id,name,active", order: [{ col: "name" }] });
export const useMaterials = () => useList("materials", { select: "id,name,unit,category,active", order: [{ col: "name" }] });
export const useJobTypes = () => useList("job_types", { select: "id,name,active", order: [{ col: "name" }] });

interface SelProps { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; className?: string; required?: boolean }

export function ProjectSelect({ value, onChange, placeholder = "Select project / site", includeOffice = true, onlyOpen = false, ...p }: SelProps & { includeOffice?: boolean; onlyOpen?: boolean }) {
  const { data } = useProjects();
  const list = (data ?? []).filter(x => (includeOffice || x.kind !== "office") && (!onlyOpen || x.status !== "completed" || x.id === value));
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} {...p}>
      <option value="">{placeholder}</option>
      {list.map(x => <option key={x.id} value={x.id}>{x.code} · {x.name}{x.kind === "office" ? " (office)" : ""}</option>)}
    </Select>
  );
}

export function PartySelect({ type, value, onChange, placeholder, ...p }: SelProps & { type: "client" | "supplier" | "contractor" }) {
  const { data } = useParties(type);
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} {...p}>
      <option value="">{placeholder ?? `Select ${type}`}</option>
      {(data ?? []).filter(x => x.active || x.id === value).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
    </Select>
  );
}

export function AccountSelect({ value, onChange, placeholder = "Paid from / to account", showBalance = true, ...p }: SelProps & { showBalance?: boolean }) {
  const { data } = useAccounts();
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} {...p}>
      <option value="">{placeholder}</option>
      {(data ?? []).filter((a: Row) => a.active || a.id === value).map((a: Row) => (
        <option key={a.id} value={a.id}>{a.name} ({a.type === "bank" ? "Bank" : "Petty cash"}){showBalance ? ` — ${inr(a.balance)}` : ""}</option>
      ))}
    </Select>
  );
}

export function EmployeeSelect({ value, onChange, placeholder = "Select worker", teamId, ...p }: SelProps & { teamId?: string }) {
  const { data } = useEmployees();
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} {...p}>
      <option value="">{placeholder}</option>
      {(data ?? []).filter(x => (x.active || x.id === value) && (!teamId || x.team_id === teamId)).map(x => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
    </Select>
  );
}

export function TeamSelect({ value, onChange, placeholder = "All teams", ...p }: SelProps) {
  const { data } = useTeams();
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} {...p}>
      <option value="">{placeholder}</option>
      {(data ?? []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
    </Select>
  );
}

export function CategorySelect({ value, onChange, placeholder = "Select category", ...p }: SelProps) {
  const { data } = useCategories();
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} {...p}>
      <option value="">{placeholder}</option>
      {(data ?? []).filter(x => x.active || x.id === value).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
    </Select>
  );
}

export function ModeSelect({ value, onChange, ...p }: SelProps) {
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} {...p}>
      {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </Select>
  );
}

/** Free text with suggestions from the materials master. */
export function MaterialInput({ value, onChange, onPick, id = "materials-list", ...p }: { value: string; onChange: (v: string) => void; onPick?: (m: Row) => void; id?: string; placeholder?: string; className?: string }) {
  const { data } = useMaterials();
  return (
    <>
      <input list={id} value={value} className={`input ${p.className ?? ""}`} placeholder={p.placeholder ?? "Material"}
        onChange={e => {
          onChange(e.target.value);
          const m = (data ?? []).find(x => x.name.toLowerCase() === e.target.value.toLowerCase());
          if (m && onPick) onPick(m);
        }} />
      <datalist id={id}>{(data ?? []).map(m => <option key={m.id} value={m.name}>{m.unit}</option>)}</datalist>
    </>
  );
}

export const UNITS = ["nos", "bag", "kg", "ton", "unit", "cft", "cum", "sqft", "sqm", "rft", "m", "load", "trip", "ltr", "day", "lumpsum"];
export function UnitSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`input ${className ?? ""}`}>
      {UNITS.concat(UNITS.includes(value) || !value ? [] : [value]).map(u => <option key={u} value={u}>{u}</option>)}
    </select>
  );
}
