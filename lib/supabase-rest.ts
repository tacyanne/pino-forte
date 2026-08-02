type QueryValue = string | number | boolean | null;

const restKey = () =>
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

export function hasSupabaseRest() {
  return Boolean(process.env.SUPABASE_URL && restKey());
}

function restUrl(path: string, query?: Record<string, string>) {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new Error("Configure SUPABASE_URL.");
  const url = new URL(`/rest/v1/${path}`, base);
  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

function headers(extra?: HeadersInit) {
  const key = restKey();
  if (!key) throw new Error("Configure SUPABASE_SERVICE_ROLE_KEY.");
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Supabase retornou HTTP ${response.status}.`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export async function supabaseSelect<T>(
  table: string,
  query?: Record<string, string>,
) {
  const response = await fetch(restUrl(table, query), {
    headers: headers(),
    cache: "no-store",
  });
  return parseResponse<T[]>(response);
}

export async function supabaseGetOne<T>(
  table: string,
  query?: Record<string, string>,
) {
  const rows = await supabaseSelect<T>(table, { ...query, limit: query?.limit || "1" });
  return rows[0] || null;
}

export async function supabaseInsert<T>(
  table: string,
  values: Record<string, QueryValue>,
) {
  const response = await fetch(restUrl(table), {
    method: "POST",
    headers: headers({ prefer: "return=representation" }),
    body: JSON.stringify(values),
  });
  const rows = await parseResponse<T[]>(response);
  return rows[0];
}

export async function supabaseUpsert<T>(
  table: string,
  values: Record<string, QueryValue>,
  onConflict: string,
) {
  const response = await fetch(restUrl(table, { on_conflict: onConflict }), {
    method: "POST",
    headers: headers({ prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(values),
  });
  const rows = await parseResponse<T[]>(response);
  return rows[0];
}

export async function supabasePatch<T>(
  table: string,
  query: Record<string, string>,
  values: Record<string, QueryValue>,
) {
  const response = await fetch(restUrl(table, query), {
    method: "PATCH",
    headers: headers({ prefer: "return=representation" }),
    body: JSON.stringify(values),
  });
  const rows = await parseResponse<T[]>(response);
  return rows[0];
}

export async function supabaseDelete(
  table: string,
  query: Record<string, string>,
) {
  const response = await fetch(restUrl(table, query), {
    method: "DELETE",
    headers: headers(),
  });
  await parseResponse<null>(response);
}
