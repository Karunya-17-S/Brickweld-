import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError = !url || !key
  ? "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values."
  : null;

export const supabase = createClient(url ?? "http://localhost", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Turns Postgres / Supabase errors into a sentence a user can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string; details?: string } | null;
  const msg = err?.message ?? String(e ?? "Something went wrong");
  if (err?.code === "23505" || /duplicate key/i.test(msg)) return "This already exists (same name / number / date). Use a different value or edit the existing record.";
  if (err?.code === "42501" || /row-level security|permission denied/i.test(msg)) return "You don't have permission to do this.";
  if (/violates check constraint "txn_required_links"/.test(msg)) return "Fill in the required links (project, party, worker or category) for this entry.";
  if (/violates check constraint/i.test(msg)) return "One of the values is not allowed (check amounts are positive and fields are filled).";
  if (/violates foreign key/i.test(msg)) return "A linked record is missing or was deleted.";
  if (/violates not-null/i.test(msg)) return "Please fill in all required fields.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the server. Check your internet connection.";
  return msg.replace(/^ERROR:\s*/i, "");
}
