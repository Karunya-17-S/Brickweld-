// @ts-nocheck — this file runs on Supabase (Deno), not in the Vite app; VS Code's Node TypeScript doesn't know the `Deno` global.
// Supabase Edge Function: lets the MD create logins and reset passwords from Settings → Users.
// It ONLY touches Supabase Auth. The role is attached afterwards by the app calling the
// set_user_role() database function as the MD, so no table permissions are needed here.
// Deploy: Supabase → Edge Functions → admin-users → paste this file → Deploy (Verify JWT on).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!url || !anon || !service) return json({ error: "Function setup problem: Supabase keys are not available to the function." }, 500);

    // 1. Who is calling? Must be a signed-in MD.
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: me, error: meErr } = await caller.auth.getUser();
    if (meErr || !me?.user) return json({ error: "Your session has expired. Sign out and sign in again." }, 401);
    const { data: isMd, error: rErr } = await caller.rpc("is_md");
    if (rErr) return json({ error: `Could not check your role: ${rErr.message}` }, 403);
    if (!isMd) return json({ error: "Only the MD can add users or reset passwords." }, 403);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json();

    if (body.action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const full_name = String(body.full_name ?? "").trim();
      const phone = String(body.phone ?? "").trim();
      if (!email || !full_name) return json({ error: "Name and email are required." }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name, phone } });
      if (!error) return json({ ok: true, id: data.user!.id, existed: false });

      // Login already exists (e.g. an earlier attempt half-finished): reuse it and set the new password.
      if (/already|registered|exists/i.test(error.message)) {
        let found = null;
        for (let page = 1; page <= 20 && !found; page++) {
          const { data: list, error: lErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
          if (lErr) return json({ error: lErr.message }, 400);
          found = list.users.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
          if (list.users.length < 200) break;
        }
        if (!found) return json({ error: "A user with this email already exists." }, 400);
        const { error: uErr } = await admin.auth.admin.updateUserById(found.id, { password, email_confirm: true, user_metadata: { full_name, phone } });
        if (uErr) return json({ error: uErr.message }, 400);
        return json({ ok: true, id: found.id, existed: true });
      }
      return json({ error: error.message }, 400);
    }

    if (body.action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
