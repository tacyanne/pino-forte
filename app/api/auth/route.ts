import { currentUser, ensureAuthTables, passwordHash, sessionCookie } from "../../../lib/auth";

const cleanEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const validNewPassword = (password: string) => password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
const passwordRuleError = "A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, um número e um caractere especial.";

export async function GET(request: Request) {
  const db = await ensureAuthTables();
  const count = await db.prepare("SELECT COUNT(*) total FROM app_users").first<{ total: number }>();
  const user = await currentUser(request);
  const users = user?.role === "admin" ? (await db.prepare("SELECT id,name,email,role,active,created_at createdAt FROM app_users ORDER BY name").all()).results : [];
  return Response.json({ setupRequired: Number(count?.total || 0) === 0, user, users });
}

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action || "login");
  const db = await ensureAuthTables();

  if (action === "setup") {
    const count = await db.prepare("SELECT COUNT(*) total FROM app_users").first<{ total: number }>();
    if (Number(count?.total || 0) > 0) return Response.json({ error: "A conta administradora já foi criada." }, { status: 409 });
    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    if (email !== "tacytpr@gmail.com") return Response.json({ error: "Use o e-mail administrador autorizado." }, { status: 400 });
    if (!name) return Response.json({ error: "Informe seu nome." }, { status: 400 });
    if (!validNewPassword(password)) return Response.json({ error: passwordRuleError }, { status: 400 });
    const { hash, salt } = await passwordHash(password);
    const result = await db.prepare("INSERT INTO app_users(name,email,password_hash,salt,role) VALUES(?,?,?,?, 'admin')").bind(name, email, hash, salt).run();
    return createSession(db, Number(result.meta.last_row_id));
  }

  if (action === "login") {
    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    const row = await db.prepare("SELECT id,password_hash passwordHash,salt,active FROM app_users WHERE email=?").bind(email).first<{ id:number; passwordHash:string; salt:string; active:number }>();
    if (!row?.active) return Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    const { hash } = await passwordHash(password, row.salt);
    if (hash !== row.passwordHash) return Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    return createSession(db, row.id);
  }

  const admin = await currentUser(request);
  if (!admin || admin.role !== "admin") return Response.json({ error: "Acesso restrito ao administrador." }, { status: 403 });
  if (action === "create-user") {
    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    if (!name || !email.includes("@")) return Response.json({ error: "Informe nome e e-mail válidos." }, { status: 400 });
    if (!validNewPassword(password)) return Response.json({ error: passwordRuleError }, { status: 400 });
    const { hash, salt } = await passwordHash(password);
    try { await db.prepare("INSERT INTO app_users(name,email,password_hash,salt,role) VALUES(?,?,?,?, 'user')").bind(name,email,hash,salt).run(); }
    catch { return Response.json({ error: "Este e-mail já está cadastrado." }, { status: 409 }); }
    return Response.json({ success: true });
  }
  if (action === "toggle-user") {
    await db.prepare("UPDATE app_users SET active=? WHERE id=? AND role!='admin'").bind(body.active ? 1 : 0, Number(body.id)).run();
    return Response.json({ success: true });
  }
  return Response.json({ error: "Ação inválida." }, { status: 400 });
}

async function createSession(db: any, userId: number) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.prepare("INSERT INTO app_sessions(token,user_id,expires_at) VALUES(?,?,datetime('now','+30 days'))").bind(token,userId).run();
  return Response.json({ success: true }, { headers: { "Set-Cookie": sessionCookie(token) } });
}

export async function DELETE(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)pino_session=([^;]+)/)?.[1];
  if (token) { const db = await ensureAuthTables(); await db.prepare("DELETE FROM app_sessions WHERE token=?").bind(token).run(); }
  return Response.json({ success: true }, { headers: { "Set-Cookie": sessionCookie("", 0) } });
}
