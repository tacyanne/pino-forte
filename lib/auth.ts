import { getSql } from "../db";

type AuthUser = { id: number; name: string; email: string; role: string; active: boolean };

export async function ensureAuthTables() {
  return getSql();
}

const hex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (value: string) => new Uint8Array(value.match(/.{1,2}/g)?.map((x) => parseInt(x, 16)) || []);

export async function passwordHash(password: string, saltHex?: string) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 45000 }, key, 256);
  return { hash: hex(new Uint8Array(bits)), salt: hex(salt) };
}

export async function currentUser(request: Request): Promise<AuthUser | null> {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)pino_session=([^;]+)/)?.[1];
  if (!token) return null;
  const sql = await ensureAuthTables();
  const rows = await sql<AuthUser[]>`
    SELECT u.id, u.name, u.email, u.role, u.active
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at::timestamp > CURRENT_TIMESTAMP
      AND u.active = true
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function requireUser(request: Request) {
  const user = await currentUser(request);
  return user || Response.json({ error: "Faça login para continuar." }, { status: 401 });
}

export function sessionCookie(token: string, maxAge = 60 * 60 * 24 * 30) {
  return `pino_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
