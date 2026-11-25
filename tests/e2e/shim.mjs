// Local stand-in for the parts of Supabase the app uses (PostgREST + GoTrue + the admin-users
// function), backed by the real migrations in a local Postgres. Test-only — never deployed.
// Usage: PGDATABASE=bw node tests/e2e/shim.mjs   (serves dist/ and the API on :54321)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

// Match PostgREST's JSON: numerics as numbers, dates as plain strings.
pg.types.setTypeParser(1700, v => parseFloat(v)); pg.types.setTypeParser(20, v => parseInt(v, 10));
pg.types.setTypeParser(1082, v => v); pg.types.setTypeParser(1114, v => v.replace(" ", "T")); pg.types.setTypeParser(1184, v => v.replace(" ", "T"));
const pool = new pg.Pool({ host: "/tmp", port: 54329, user: "postgres", database: process.env.PGDATABASE || "bw", max: 8 });
const DIST = path.resolve(process.argv[2] || "dist");
const PORT = +(process.env.PORT || 54321);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(p)}.${crypto.randomBytes(16).toString("base64url")}`;
const decode = (t) => { try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()); } catch { return null; } };
const qi = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { code: "PGRST100" }); return `"${s}"`; };
export const ANON = jwt({ role: "anon", iss: "supabase", exp: 4102444800 });

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Expose-Headers": "Content-Range", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const pgErr = (res, e) => send(res, e.code === "42501" ? 403 : e.code === "PGRST116" ? 406 : 400, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });

async function asUser(sub, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(sub ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    await c.query("SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [sub ?? "", sub ? "authenticated" : "anon"]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
}

// ---- PostgREST filter parsing ----
function splitList(s) { // a,b,"c,d"
  const out = []; let cur = "", q = false;
  for (const ch of s) { if (ch === '"') { q = !q; continue; } if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; }
  out.push(cur); return out;
}
function where(params, vals) {
  const parts = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|in|is|like|ilike)\.(.*)$/s.exec(v);
    if (!m) throw Object.assign(new Error(`unsupported filter ${k}=${v}`), { code: "PGRST100" });
    const [, not, op, raw] = m; const col = qi(k); let sql;
    if (op === "in") { const list = splitList(raw.replace(/^\(|\)$/g, "")).filter(x => x !== ""); if (!list.length) sql = "false"; else { vals.push(list); sql = `${col}::text = ANY($${vals.length}::text[])`; } }
    else if (op === "is") sql = `${col} IS ${raw === "null" ? "NULL" : raw === "true" ? "TRUE" : "FALSE"}`;
    else { const o = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE" }[op]; vals.push(raw); sql = `${col} ${o} $${vals.length}`; }
    parts.push(not ? `NOT (${sql})` : sql);
  }
  return parts.length ? " WHERE " + parts.join(" AND ") : "";
}
const selectList = (s) => !s || s === "*" ? "*" : s.split(",").map(x => x.trim()).filter(Boolean).map(qi).join(", ");
function orderBy(o) {
  if (!o) return "";
  return " ORDER BY " + o.split(",").map(p => { const [c, d, nl] = p.split("."); return `${qi(c)} ${d === "desc" ? "DESC" : "ASC"}${nl === "nullsfirst" ? " NULLS FIRST" : nl === "nullslast" ? " NULLS LAST" : ""}`; }).join(", ");
}
const val = (v) => v !== null && typeof v === "object" ? JSON.stringify(v) : v;

const fnCache = new Map();
async function fnInfo(name) {
  if (fnCache.has(name)) return fnCache.get(name);
  const { rows } = await pool.query(`SELECT p.proargnames, p.proretset, format_type(p.prorettype, NULL) AS ret, p.pronargs,
      array(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) t) AS types, p.proargmodes
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`, [name]);
  fnCache.set(name, rows); return rows;
}

async function rest(req, res, url, sub, body) {
  const seg = url.pathname.replace(/^\/rest\/v1\//, "");
  const params = [...url.searchParams.entries()];
  const prefer = req.headers["prefer"] ?? "";
  const single = (req.headers["accept"] ?? "").includes("vnd.pgrst.object");
  if (seg.startsWith("rpc/")) {
    const name = seg.slice(4); const args = body ?? Object.fromEntries(params);
    const overloads = await fnInfo(name);
    if (!overloads.length) return send(res, 404, { code: "PGRST202", message: `function ${name} not found` });
    const f = overloads.find(o => Object.keys(args).every(k => (o.proargnames ?? []).includes(k))) ?? overloads[0];
    const vals = [], named = [];
    for (const [k, v] of Object.entries(args)) {
      const i = (f.proargnames ?? []).indexOf(k); const t = f.types[i];
      if (v === undefined) continue;
      vals.push(v === null ? null : t === "jsonb" || t === "json" ? JSON.stringify(v) : Array.isArray(v) ? `{${v.join(",")}}` : v);
      named.push(`${qi(k)} => $${vals.length}::${t}`);
    }
    const isTable = f.proretset || (f.proargmodes ?? []).includes("t");
    const sql = isTable ? `SELECT * FROM public.${qi(name)}(${named.join(", ")})` : `SELECT public.${qi(name)}(${named.join(", ")}) AS v`;
    const r = await asUser(sub, c => c.query(sql, vals));
    return send(res, 200, isTable ? r.rows : (r.rows[0]?.v ?? null));
  }
  const table = qi(seg);
  if (req.method === "GET") {
    const vals = [];
    let sql = `SELECT ${selectList(url.searchParams.get("select"))} FROM public.${table}${where(params, vals)}${orderBy(url.searchParams.get("order"))}`;
    const range = req.headers["range"]; let limit = url.searchParams.get("limit"), offset = url.searchParams.get("offset");
    if (range) { const [a, b] = range.split("-").map(Number); offset = a; limit = b - a + 1; }
    if (limit) sql += ` LIMIT ${+limit}`; if (offset) sql += ` OFFSET ${+offset}`;
    const r = await asUser(sub, c => c.query(sql, vals));
    if (single) { if (r.rows.length > 1) return pgErr(res, { code: "PGRST116", message: "multiple rows" }); return r.rows.length ? send(res, 200, r.rows[0]) : (prefer.includes("maybe") ? send(res, 200, null) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: "The result contains 0 rows" })); }
    return send(res, 200, r.rows, { "Content-Range": `0-${r.rows.length - 1}/*` });
  }
  const ret = prefer.includes("return=representation");
  const sel = selectList(url.searchParams.get("select"));
  if (req.method === "POST") {
    const rows = Array.isArray(body) ? body : [body];
    const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const vals = []; const tuples = rows.map(r => "(" + cols.map(c => { if (!(c in r)) return "DEFAULT"; vals.push(val(r[c])); return `$${vals.length}`; }).join(", ") + ")");
    let sql = `INSERT INTO public.${table} (${cols.map(qi).join(", ")}) VALUES ${tuples.join(", ")}`;
    const oc = url.searchParams.get("on_conflict");
    if (prefer.includes("resolution=merge-duplicates") && oc) sql += ` ON CONFLICT (${oc.split(",").map(qi).join(", ")}) DO UPDATE SET ${cols.map(c => `${qi(c)} = EXCLUDED.${qi(c)}`).join(", ")}`;
    if (ret) sql += ` RETURNING ${sel}`;
    const r = await asUser(sub, c => c.query(sql, vals));
    if (!ret) return send(res, 201);
    return single ? send(res, 201, r.rows[0] ?? null) : send(res, 201, r.rows);
  }
  if (req.method === "PATCH") {
    const vals = []; const sets = Object.entries(body).map(([k, v]) => { vals.push(val(v)); return `${qi(k)} = $${vals.length}`; });
    let sql = `UPDATE public.${table} SET ${sets.join(", ")}${where(params, vals)}`; if (ret) sql += ` RETURNING ${sel}`;
    const r = await asUser(sub, c => c.query(sql, vals));
    return ret ? send(res, 200, single ? r.rows[0] : r.rows) : send(res, 204);
  }
  if (req.method === "DELETE") {
    const vals = []; await asUser(sub, c => c.query(`DELETE FROM public.${table}${where(params, vals)}`, vals)); return send(res, 204);
  }
  return send(res, 405, { message: "method" });
}

// ---- auth ----
async function userRow(id) { return (await pool.query("SELECT id, email, raw_user_meta_data meta, created_at FROM auth.users WHERE id=$1", [id])).rows[0]; }
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at, user_metadata: { full_name: u.meta?.full_name }, app_metadata: { provider: "email" }, created_at: u.created_at, updated_at: u.created_at });
function session(u) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: jwt({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, exp }), token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: `rt.${u.id}`, user: userJson(u) };
}
async function auth(req, res, url, sub, body) {
  const p = url.pathname.replace(/^\/auth\/v1/, "");
  if (p === "/token") {
    const gt = url.searchParams.get("grant_type");
    let u;
    if (gt === "password") {
      u = (await pool.query("SELECT id, email, raw_user_meta_data meta, created_at FROM auth.users WHERE lower(email)=lower($1)", [body.email])).rows[0];
      if (!u || u.meta?.pw !== body.password) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials", msg: "Invalid login credentials" });
    } else if (gt === "refresh_token") {
      u = await userRow(String(body.refresh_token).replace(/^rt\./, ""));
      if (!u) return send(res, 400, { error: "invalid_grant", msg: "bad refresh" });
    }
    return send(res, 200, session(u));
  }
  if (p === "/user" && req.method === "GET") { const u = sub && await userRow(sub); return u ? send(res, 200, userJson(u)) : send(res, 401, { msg: "no user" }); }
  if (p === "/user" && req.method === "PUT") {
    if (!sub) return send(res, 401, { msg: "no user" });
    if (body.password) await pool.query("UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('pw', $2::text) WHERE id=$1", [sub, body.password]);
    return send(res, 200, userJson(await userRow(sub)));
  }
  if (p === "/logout") return send(res, 204);
  if (p === "/recover") return send(res, 200, {});
  return send(res, 404, { msg: "auth endpoint " + p });
}

// ---- mock of supabase/functions/admin-users ----
async function adminUsers(req, res, sub, body) {
  const ok = sub && (await asUser(sub, c => c.query("SELECT is_md() v"))).rows[0].v;
  if (!ok) return send(res, 403, { error: "Only the MD can manage users." });
  if (body.action === "create") {
    if ((await pool.query("SELECT 1 FROM auth.users WHERE lower(email)=lower($1)", [body.email])).rowCount) return send(res, 400, { error: "A user with this email already exists." });
    const { rows: [u] } = await pool.query("INSERT INTO auth.users(email, raw_user_meta_data) VALUES ($1, jsonb_build_object('full_name', $2::text, 'pw', $3::text)) RETURNING id", [body.email, body.full_name, body.password]);
    await pool.query("UPDATE profiles SET phone=$2 WHERE id=$1", [u.id, body.phone || null]);
    await pool.query("INSERT INTO user_roles(user_id, role, assigned_by) VALUES ($1,$2,$3)", [u.id, body.role, sub]);
    return send(res, 200, { ok: true, id: u.id });
  }
  if (body.action === "reset_password") { await pool.query("UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('pw', $2::text) WHERE id=$1", [body.user_id, body.password]); return send(res, 200, { ok: true }); }
  return send(res, 400, { error: "Unknown action." });
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
export const log = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") return send(res, 204);
  let raw = ""; for await (const ch of req) raw += ch;
  const body = raw ? JSON.parse(raw) : undefined;
  const tok = (req.headers["authorization"] ?? "").replace(/^Bearer /, "");
  const claims = decode(tok); const sub = claims?.role === "authenticated" ? claims.sub : null;
  try {
    if (url.pathname.startsWith("/rest/v1/")) return await rest(req, res, url, sub, body);
    if (url.pathname.startsWith("/auth/v1/")) return await auth(req, res, url, sub, body);
    if (url.pathname === "/functions/v1/admin-users") return await adminUsers(req, res, sub, body);
    // static SPA
    let f = path.join(DIST, decodeURIComponent(url.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    if (process.env.SHIM_DEBUG) console.error(req.method, url.pathname + url.search, e.message);
    pgErr(res, e);
  }
});
server.listen(PORT, () => console.log(`shim on http://localhost:${PORT}  anon=${ANON}`));
