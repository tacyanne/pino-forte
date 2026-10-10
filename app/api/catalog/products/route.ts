import { loadActiveCatalogProducts } from "../../../../lib/catalog-products";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "cache-control": "no-store, no-cache, must-revalidate" };
  try {
    return Response.json(
      { products: await loadActiveCatalogProducts() },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Não foi possível atualizar o catálogo. Tente novamente." },
      { status: 500, headers },
    );
  }
}
