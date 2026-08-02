import { currentUser, ensureAuthTables, passwordHash, sessionCookie } from "../../../lib/auth";

const cleanEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const validNewPassword = (password: string) => password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
const passwordRuleError = "A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, um número e um caractere especial.";

async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    return Response.json({ error: "Requisicao invalida." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const sql = await ensureAuthTables();
  const [count] = await sql<{ total: string }[]>`SELECT COUNT(*)::text total FROM app_users`;
  const user = await currentUser(request);
  const users = user?.role === "admin"
    ? await sql`SELECT id, name, email, role, active, created_at "createdAt" FROM app_users ORDER BY name`
    : [];
  return Response.json({ setupRequired: Number(count?.total || 0) === 0, user, users });
}

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const action = String(body.action || "login");
  const sql = await ensureAuthTables();

  if (action === "setup") {
    const [count] = await sql<{ total: string }[]>`SELECT COUNT(*)::text total FROM app_users`;
    if (Number(count?.total || 0) > 0) return Response.json({ error: "A conta administradora já foi criada." }, { status: 409 });
    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    if (email !== "tacytpr@gmail.com") return Response.json({ error: "Use o e-mail administrador autorizado." }, { status: 400 });
    if (!name) return Response.json({ error: "Informe seu nome." }, { status: 400 });
    if (!validNewPassword(password)) return Response.json({ error: passwordRuleError }, { status: 400 });
    try {
      const { hash, salt } = await passwordHash(password);
      const [created] = await sql<{ id: number }[]>`
        INSERT INTO app_users (name, email, password_hash, salt, role)
        VALUES (${name}, ${email}, ${hash}, ${salt}, 'admin')
        RETURNING id
      `;
      if (!created?.id) throw new Error("Cadastro não localizado após a gravação.");
      return createSession(created.id);
    } catch (error) {
      return Response.json({ error: `Não foi possível criar o acesso: ${error instanceof Error ? error.message : "erro interno"}.` }, { status: 500 });
    }
  }

  if (action === "login") {
    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    const [row] = await sql<{ id: number; passwordHash: string; salt: string; active: boolean }[]>`
      SELECT id, password_hash "passwordHash", salt, active
      FROM app_users
      WHERE email = ${email}
      LIMIT 1
    `;
    if (!row?.active) return Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    const { hash } = await passwordHash(password, row.salt);
    if (hash !== row.passwordHash) return Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    return createSession(row.id);
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
    try {
      await sql`
        INSERT INTO app_users (name, email, password_hash, salt, role)
        VALUES (${name}, ${email}, ${hash}, ${salt}, 'user')
      `;
    } catch {
      return Response.json({ error: "Este e-mail já está cadastrado." }, { status: 409 });
    }
    return Response.json({ success: true });
  }
  if (action === "toggle-user") {
    await sql`UPDATE app_users SET active = ${Boolean(body.active)} WHERE id = ${Number(body.id)} AND role != 'admin'`;
    return Response.json({ success: true });
  }
  return Response.json({ error: "Ação inválida." }, { status: 400 });
}

async function createSession(userId: number) {
  const sql = await ensureAuthTables();
  const token = crypto.randomUUID() + crypto.randomUUID();
  await sql`
    INSERT INTO app_sessions (token, user_id, expires_at)
    VALUES (${token}, ${userId}, (CURRENT_TIMESTAMP + INTERVAL '30 days')::text)
  `;
  return Response.json({ success: true }, { headers: { "Set-Cookie": sessionCookie(token) } });
}

export async function DELETE(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)pino_session=([^;]+)/)?.[1];
  if (token) {
    const sql = await ensureAuthTables();
    await sql`DELETE FROM app_sessions WHERE token = ${token}`;
  }
  return Response.json({ success: true }, { headers: { "Set-Cookie": sessionCookie("", 0) } });
}
