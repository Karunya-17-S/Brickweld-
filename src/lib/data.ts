import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { supabase, friendlyError } from "./supabase";
import { toast } from "@/components/toast";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface ListOpts {
  select?: string;
  eq?: Record<string, unknown>;
  inList?: Record<string, unknown[]>;
  gte?: Record<string, unknown>;
  lte?: Record<string, unknown>;
  isNull?: string[];
  order?: { col: string; asc?: boolean }[];
  limit?: number;
  enabled?: boolean;
}

/** Fetch every row (pages through Supabase's 1000-row limit). */
export async function fetchAll(table: string, o: ListOpts = {}): Promise<Row[]> {
  const out: Row[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = supabase.from(table).select(o.select ?? "*");
    for (const [k, v] of Object.entries(o.eq ?? {})) if (v !== undefined && v !== null && v !== "") q = q.eq(k, v as string);
    for (const [k, v] of Object.entries(o.inList ?? {})) q = q.in(k, v as string[]);
    for (const [k, v] of Object.entries(o.gte ?? {})) if (v) q = q.gte(k, v as string);
    for (const [k, v] of Object.entries(o.lte ?? {})) if (v) q = q.lte(k, v as string);
    for (const c of o.isNull ?? []) q = q.is(c, null);
    for (const ord of o.order ?? []) q = q.order(ord.col, { ascending: ord.asc ?? true });
    if (!o.order?.length) q = q.order("id", { ascending: true });
    const lim = o.limit ? Math.min(page, o.limit - out.length) : page;
    q = q.range(from, from + lim - 1);
    const { data, error } = await q;
    if (error) throw new Error(friendlyError(error));
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < lim || (o.limit && out.length >= o.limit)) break;
  }
  return out;
}

export function useList(table: string, o: ListOpts = {}, extra?: Partial<UseQueryOptions<Row[]>>) {
  return useQuery<Row[]>({
    queryKey: [table, o],
    queryFn: () => fetchAll(table, o),
    enabled: o.enabled ?? true,
    ...extra,
  });
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

export function useRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}, enabled = true) {
  return useQuery<T>({ queryKey: ["rpc", fn, args], queryFn: () => rpc<T>(fn, args), enabled });
}

/** Run a write, toast the result, refresh every list so all screens agree. */
export function useAction<A, R = unknown>(fn: (a: A) => Promise<R>, success?: string | ((r: R) => string)) {
  const qc = useQueryClient();
  return useMutation<R, Error, A>({
    mutationFn: fn,
    onSuccess: (r) => {
      if (success) toast.success(typeof success === "function" ? success(r) : success);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
}

export async function insertRow(table: string, values: Row) {
  const { data, error } = await supabase.from(table).insert(values).select("id").single();
  if (error) throw new Error(friendlyError(error));
  return data as Row;
}
export async function updateRow(table: string, id: string, values: Row, key = "id") {
  const { error } = await supabase.from(table).update(values).eq(key, id);
  if (error) throw new Error(friendlyError(error));
}
export async function upsertRow(table: string, values: Row, onConflict: string) {
  const { error } = await supabase.from(table).upsert(values, { onConflict });
  if (error) throw new Error(friendlyError(error));
}
/** Treat empty strings as null before saving. */
export function clean(v: Row): Row {
  const o: Row = {};
  for (const [k, x] of Object.entries(v)) o[k] = x === "" ? null : x;
  return o;
}
