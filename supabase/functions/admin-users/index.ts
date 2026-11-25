// Supabase Edge Function: lets the MD create logins and reset passwords from Settings → Users.
// Deploy:  supabase functions deploy admin-users
// Needs no extra secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
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
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: me } = await caller.auth.getUser();
    if (!me?.user) return json({ error: "Not signed in." }, 401);
    const { data: isMd, error: rErr } = await caller.rpc("is_md");
    if (rErr || !isMd) return json({ error: "Only the MD can manage users." }, 403);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const body = await req.json();

    if (body.action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const full_name = String(body.full_name ?? "").trim();
      const role = body.role as string;
      if (!email || !full_name) return json({ error: "Name and email are required." }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      if (!["md", "accountant", "supervisor"].includes(role)) return json({ error: "Choose a role." }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
      if (error) return json({ error: error.message.includes("already") ? "A user with this email already exists." : error.message }, 400);
      const id = data.user!.id;
      await admin.from("profiles").upsert({ id, full_name, email, phone: body.phone || null, active: true });
      const { error: e2 } = await admin.from("user_roles").upsert({ user_id: id, role, assigned_by: me.user.id });
      if (e2) return json({ error: e2.message }, 400);
      return json({ ok: true, id });
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
