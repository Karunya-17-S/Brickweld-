import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type Role = "md" | "accountant" | "supervisor";

interface AuthState {
  loading: boolean;
  session: Session | null;
  userId: string | null;
  email: string | null;
  fullName: string;
  role: Role | null;
  active: boolean;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [fullName, setFullName] = useState("");
  const [active, setActive] = useState(true);

  async function loadProfile(s: Session | null) {
    if (!s) { setRole(null); setFullName(""); return; }
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", s.user.id).maybeSingle(),
      supabase.from("profiles").select("full_name, active").eq("id", s.user.id).maybeSingle(),
    ]);
    setRole(((r as { role?: Role } | null)?.role) ?? null);
    setFullName((p as { full_name?: string } | null)?.full_name || s.user.email || "");
    setActive((p as { active?: boolean } | null)?.active ?? true);
  }

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "TOKEN_REFRESHED") { setSession(s); return; }
      if (event === "SIGNED_OUT") { qc.clear(); setSession(null); setRole(null); setLoading(false); return; }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        setLoading(true);
        qc.clear(); // never show the previous user's cached data
        setSession(s);
        // defer: supabase-js recommends not awaiting inside the callback
        setTimeout(() => loadProfile(s).finally(() => setLoading(false)), 0);
      }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AuthState = {
    loading, session, role, fullName, active,
    userId: session?.user.id ?? null,
    email: session?.user.email ?? null,
    signOut: async () => { qc.clear(); await supabase.auth.signOut(); },
    reload: async () => { await loadProfile(session); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

export const ROLE_LABEL: Record<Role, string> = { md: "Managing Director", accountant: "Accountant", supervisor: "Supervisor" };
