import { loadActiveCatalogProducts } from "../../lib/catalog-products";
import { CatalogView } from "./catalog-view";

export const dynamic = "force-dynamic";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams?: Promise<{ tipo?: string }>;
}) {
  const params = await searchParams;
  return (
    <CatalogView
      initialProducts={await loadActiveCatalogProducts()}
      distributor={params?.tipo === "distribuidor"}
    />
  );
}
