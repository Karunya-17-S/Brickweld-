/**
 * Day value from in/out time — the same rules the database uses (calc_day_value).
 * 12h+ = 1.5, 8h+ = 1, 4h+ = 0.5, less = 0.
 * In-time without am/pm is morning; out-time without am/pm is afternoon. "9.30" = 9:30.
 */
export interface DayRules { fullDay: number; otDay: number; halfDay: number }
export const DEFAULT_RULES: DayRules = { fullDay: 8, otDay: 12, halfDay: 4 };

export function parseHour(raw: string | null | undefined, defaultPm: boolean): number | null {
  if (!raw || !raw.trim()) return null;
  let s = raw.trim().toLowerCase();
  const pm = s.includes("pm"), am = s.includes("am");
  s = s.replace(/pm|am/g, "").replace(/\./g, ":").trim();
  const [hs, ms] = s.split(":");
  let h = Number(hs);
  const m = ms ? Number(ms) / 60 : 0;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (pm) { if (h < 12) h += 12; }
  else if (am) { if (h === 12) h = 0; }
  else if (h >= 13 || h === 12) { /* already 24h / noon */ }
  else if (defaultPm) h += 12;
  return h + m;
}

export function hoursBetween(inT?: string | null, outT?: string | null) {
  const a = parseHour(inT, false), b = parseHour(outT, true);
  if (a == null || b == null || b <= a) return 0;
  return b - a;
}

export function dayValue(inT?: string | null, outT?: string | null, r: DayRules = DEFAULT_RULES) {
  const h = hoursBetween(inT, outT);
  if (h >= r.otDay) return 1.5;
  if (h >= r.fullDay) return 1;
  if (h >= r.halfDay) return 0.5;
  return 0;
}

export function timeWarning(inT?: string | null, outT?: string | null): string | null {
  if (!inT || !outT) return null;
  const a = parseHour(inT, false), b = parseHour(outT, true);
  if (a == null || b == null) return "Time not understood. Use e.g. 9, 9:30, 6pm or 18.";
  if (b <= a) return "Out time must be after in time.";
  if (b - a > 16) return `That is ${(b - a).toFixed(1)} hours — please check.`;
  return null;
}
