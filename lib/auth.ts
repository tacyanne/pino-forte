type AuthUser = { id: number; name: string; email: string; role: string; active: number };

async function d1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Banco de dados indisponível.");
  return env.DB;
}

export async function ensureAuthTables() {
  const db = await d1();
  await db.exec(`CREATE TABLE IF NOT EXISTS app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS app_sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  return db;
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
  const db = await ensureAuthTables();
  return await db.prepare(`SELECT u.id,u.name,u.email,u.role,u.active FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>CURRENT_TIMESTAMP AND u.active=1`).bind(token).first<AuthUser>();
}

export async function requireUser(request: Request) {
  const user = await currentUser(request);
  return user || Response.json({ error: "Faça login para continuar." }, { status: 401 });
}

export function sessionCookie(token: string, maxAge = 60 * 60 * 24 * 30) {
  return `pino_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
