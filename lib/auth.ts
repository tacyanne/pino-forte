import { getSql } from "../db";
import {
  hasSupabaseRest,
  supabaseDelete,
  supabaseInsert,
  supabasePatch,
  supabaseSelect,
} from "./supabase-rest";

type AuthUser = { id: number; name: string; email: string; role: string; active: boolean };
type StoredAuthUser = AuthUser & { passwordHash: string; salt: string; createdAt?: string };
type StoredSession = { token: string; userId: number; expiresAt: string };

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
  if (hasSupabaseRest()) return currentUserFromRest(token);
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

async function currentUserFromRest(token: string): Promise<AuthUser | null> {
  const [session] = await supabaseSelect<StoredSession>("app_sessions", {
    select: "token,userId:user_id,expiresAt:expires_at",
    token: `eq.${token}`,
    limit: "1",
  });
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const [user] = await supabaseSelect<AuthUser>("app_users", {
    select: "id,name,email,role,active",
    id: `eq.${session.userId}`,
    active: "eq.true",
    limit: "1",
  });
  return user || null;
}

export async function hasUsers() {
  if (hasSupabaseRest()) {
    const rows = await supabaseSelect<{ id: number }>("app_users", {
      select: "id",
      limit: "1",
    });
    return rows.length > 0;
  }
  const sql = await ensureAuthTables();
  const [count] = await sql<{ total: string }[]>`SELECT COUNT(*)::text total FROM app_users`;
  return Number(count?.total || 0) > 0;
}

export async function listUsersForAdmin(admin: AuthUser | null) {
  if (admin?.role !== "admin") return [];
  if (hasSupabaseRest()) {
    return supabaseSelect<AuthUser & { createdAt: string }>("app_users", {
      select: "id,name,email,role,active,createdAt:created_at",
      order: "name.asc",
    });
  }
  const sql = await ensureAuthTables();
  return sql`SELECT id, name, email, role, active, created_at "createdAt" FROM app_users ORDER BY name`;
}

export async function createAppUser(user: {
  name: string;
  email: string;
  passwordHash: string;
  salt: string;
  role: string;
}) {
  if (hasSupabaseRest()) {
    return supabaseInsert<{ id: number }>("app_users", {
      name: user.name,
      email: user.email,
      password_hash: user.passwordHash,
      salt: user.salt,
      role: user.role,
    });
  }
  const sql = await ensureAuthTables();
  const [created] = await sql<{ id: number }[]>`
    INSERT INTO app_users (name, email, password_hash, salt, role)
    VALUES (${user.name}, ${user.email}, ${user.passwordHash}, ${user.salt}, ${user.role})
    RETURNING id
  `;
  return created;
}

export async function findUserByEmail(email: string) {
  if (hasSupabaseRest()) {
    const [user] = await supabaseSelect<StoredAuthUser>("app_users", {
      select: "id,passwordHash:password_hash,salt,active,name,email,role",
      email: `eq.${email}`,
      limit: "1",
    });
    return user || null;
  }
  const sql = await ensureAuthTables();
  const [row] = await sql<StoredAuthUser[]>`
    SELECT id, password_hash "passwordHash", salt, active, name, email, role
    FROM app_users
    WHERE email = ${email}
    LIMIT 1
  `;
  return row || null;
}

export async function createAppSession(userId: number) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 24 * 30 * 1000).toISOString();
  if (hasSupabaseRest()) {
    await supabaseInsert("app_sessions", {
      token,
      user_id: userId,
      expires_at: expiresAt,
    });
    return token;
  }
  const sql = await ensureAuthTables();
  await sql`
    INSERT INTO app_sessions (token, user_id, expires_at)
    VALUES (${token}, ${userId}, ${expiresAt})
  `;
  return token;
}

export async function deleteAppSession(token: string) {
  if (hasSupabaseRest()) {
    await supabaseDelete("app_sessions", { token: `eq.${token}` });
    return;
  }
  const sql = await ensureAuthTables();
  await sql`DELETE FROM app_sessions WHERE token = ${token}`;
}

export async function setAppUserActive(id: number, active: boolean) {
  if (hasSupabaseRest()) {
    await supabasePatch("app_users", { id: `eq.${id}`, role: "neq.admin" }, { active });
    return;
  }
  const sql = await ensureAuthTables();
  await sql`UPDATE app_users SET active = ${active} WHERE id = ${id} AND role != 'admin'`;
}

export async function requireUser(request: Request) {
  const user = await currentUser(request);
  return user || Response.json({ error: "Faça login para continuar." }, { status: 401 });
}

export function sessionCookie(token: string, maxAge = 60 * 60 * 24 * 30) {
  return `pino_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
