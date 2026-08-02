import {
  createAppSession,
  createAppUser,
  currentUser,
  deleteAppSession,
  findUserByEmail,
  hasUsers,
  listUsersForAdmin,
  passwordHash,
  sessionCookie,
  setAppUserActive,
} from "../../../lib/auth";

const cleanEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const validNewPassword = (password: string) =>
  password.length >= 8 &&
  /[A-Z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z0-9]/.test(password);
const passwordRuleError =
  "A senha deve ter no minimo 8 caracteres, uma letra maiuscula, um numero e um caractere especial.";

async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    return Response.json({ error: "Requisicao invalida." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const setupRequired = !(await hasUsers());
  const user = await currentUser(request);
  const users = await listUsersForAdmin(user);
  return Response.json({ setupRequired, user, users });
}

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const action = String(body.action || "login");

  if (action === "setup") {
    if (await hasUsers()) {
      return Response.json({ error: "A conta administradora ja foi criada." }, { status: 409 });
    }

    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    if (email !== "tacytpr@gmail.com")
      return Response.json({ error: "Use o e-mail administrador autorizado." }, { status: 400 });
    if (!name) return Response.json({ error: "Informe seu nome." }, { status: 400 });
    if (!validNewPassword(password))
      return Response.json({ error: passwordRuleError }, { status: 400 });

    try {
      const { hash, salt } = await passwordHash(password);
      const created = await createAppUser({ name, email, passwordHash: hash, salt, role: "admin" });
      if (!created?.id) throw new Error("Cadastro nao localizado apos a gravacao.");
      return createSession(created.id);
    } catch (error) {
      return Response.json(
        {
          error: `Nao foi possivel criar o acesso: ${
            error instanceof Error ? error.message : "erro interno"
          }.`,
        },
        { status: 500 },
      );
    }
  }

  if (action === "login") {
    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    const row = await findUserByEmail(email);
    if (!row?.active) return Response.json({ error: "E-mail ou senha invalidos." }, { status: 401 });
    const { hash } = await passwordHash(password, row.salt);
    if (hash !== row.passwordHash)
      return Response.json({ error: "E-mail ou senha invalidos." }, { status: 401 });
    return createSession(row.id);
  }

  const admin = await currentUser(request);
  if (!admin || admin.role !== "admin")
    return Response.json({ error: "Acesso restrito ao administrador." }, { status: 403 });

  if (action === "create-user") {
    const email = cleanEmail(body.email);
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    if (!name || !email.includes("@"))
      return Response.json({ error: "Informe nome e e-mail validos." }, { status: 400 });
    if (!validNewPassword(password))
      return Response.json({ error: passwordRuleError }, { status: 400 });
    const { hash, salt } = await passwordHash(password);
    try {
      await createAppUser({ name, email, passwordHash: hash, salt, role: "user" });
    } catch {
      return Response.json({ error: "Este e-mail ja esta cadastrado." }, { status: 409 });
    }
    return Response.json({ success: true });
  }

  if (action === "toggle-user") {
    await setAppUserActive(Number(body.id), Boolean(body.active));
    return Response.json({ success: true });
  }

  return Response.json({ error: "Acao invalida." }, { status: 400 });
}

async function createSession(userId: number) {
  const token = await createAppSession(userId);
  return Response.json({ success: true }, { headers: { "Set-Cookie": sessionCookie(token) } });
}

export async function DELETE(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)pino_session=([^;]+)/)?.[1];
  if (token) await deleteAppSession(token);
  return Response.json({ success: true }, { headers: { "Set-Cookie": sessionCookie("", 0) } });
}
