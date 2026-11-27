import { useState } from "react";
import { supabase, friendlyError } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Field, Input, Spinner } from "@/components/ui";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setErr(/invalid/i.test(error.message) ? "Wrong email or password." : friendlyError(error));
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + "/login" });
      if (error) setErr(friendlyError(error)); else setSent(true);
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-[#2c3560] p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500 text-xl font-bold">B</div>
          <div><div className="text-2xl font-semibold">Brickweld</div><div className="text-sm text-white/60">Projects · Accounts · Site</div></div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-7 shadow-2xl">
          <div>
            <h1 className="text-lg font-semibold">{mode === "login" ? "Sign in" : "Reset password"}</h1>
            <p className="text-sm text-ink-500">{mode === "login" ? "One sign-in for everyone — MD, Accountant and Site supervisor. The app opens your own screens after you sign in." : "We'll email you a reset link."}</p>
          </div>
          <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field>
          {mode === "login" && <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>}
          {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          {sent && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Check your email for the reset link.</div>}
          <button className="btn-primary w-full py-2" disabled={busy}>{busy && <Spinner className="text-white" />}{mode === "login" ? "Sign in" : "Send reset link"}</button>
          <button type="button" onClick={() => { setMode(mode === "login" ? "forgot" : "login"); setErr(null); setSent(false); }} className="w-full text-center text-sm text-brand-600 hover:underline">
            {mode === "login" ? "Forgot password?" : "Back to sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function NoRolePage() {
  const { email, signOut, active, reload } = useAuth();
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
        <h1 className="text-lg font-semibold">{active ? "Waiting for access" : "Account disabled"}</h1>
        <p className="mt-2 text-sm text-ink-600">
          {active ? <>You're signed in as <b>{email}</b>, but the MD hasn't given you a role yet. Ask the MD to open <b>Settings → Users</b> and assign your role.</>
            : <>This account has been deactivated by the MD.</>}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-secondary" onClick={() => reload()}>Check again</button>
          <button className="btn-primary" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
