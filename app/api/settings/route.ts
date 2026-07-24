import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { requireUser } from "../../../lib/auth";

const defaults = {
  id: 1,
  companyName: "Pino Forte",
  responsible: "Rogério Mendes",
  companyPhone: "",
  orderFooter: "Documento gerado pelo sistema Pino Forte",
};

export async function GET(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  const db = await getDb();
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  if (settings) {
    const usesLegacyBrand =
      settings.companyName === "Pino de Balança" ||
      settings.orderFooter.includes("Pino de Balança");
    if (usesLegacyBrand || !settings.responsible?.trim()) {
      const [updated] = await db
        .update(appSettings)
        .set({
          companyName: "Pino Forte",
          responsible: settings.responsible?.trim() || defaults.responsible,
          orderFooter: "Documento gerado pelo sistema Pino Forte",
        })
        .where(eq(appSettings.id, 1))
        .returning();
      return Response.json({ settings: updated });
    }
    return Response.json({ settings });
  }
  const [created] = await db.insert(appSettings).values(defaults).returning();
  return Response.json({ settings: created });
}

export async function PUT(request: Request) {
  const auth = await requireUser(request); if (auth instanceof Response) return auth;
  const body = await request.json() as Partial<typeof defaults>;
  const settings = {
    id: 1,
    companyName: String(body.companyName || defaults.companyName).trim(),
    responsible: String(body.responsible || defaults.responsible).trim(),
    companyPhone: String(body.companyPhone || "").trim(),
    orderFooter: String(body.orderFooter || defaults.orderFooter).trim(),
  };
  const db = await getDb();
  const [saved] = await db.insert(appSettings).values(settings).onConflictDoUpdate({
    target: appSettings.id,
    set: settings,
  }).returning();
  return Response.json({ settings: saved });
}
