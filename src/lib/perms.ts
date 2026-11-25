import type { Role } from "./auth";

export type NavKey = "dashboard" | "projects" | "attendance" | "accounts" | "materials" | "contractors" | "masters" | "reports" | "audit" | "settings";

/** Which menu items each role sees, in order. Accountant = everything MD has, with their own dashboard. */
export const NAV_BY_ROLE: Record<Role, NavKey[]> = {
  md: ["dashboard", "projects", "attendance", "accounts", "materials", "contractors", "masters", "reports", "audit", "settings"],
  accountant: ["dashboard", "projects", "attendance", "accounts", "materials", "contractors", "masters", "reports", "audit", "settings"],
  supervisor: ["attendance", "projects", "materials", "reports"],
};

export const HOME_BY_ROLE: Record<Role, string> = { md: "/dashboard", accountant: "/dashboard", supervisor: "/attendance" };

export const can = {
  money: (r: Role | null) => r === "md" || r === "accountant",
  manageUsers: (r: Role | null) => r === "md",
  seeProfit: (r: Role | null) => r === "md" || r === "accountant",
  editMasters: (r: Role | null) => r === "md" || r === "accountant",
  deleteRecords: (r: Role | null) => r === "md" || r === "accountant",
  isMd: (r: Role | null) => r === "md",
};

export function canOpen(r: Role | null, key: NavKey) { return !!r && NAV_BY_ROLE[r].includes(key); }
