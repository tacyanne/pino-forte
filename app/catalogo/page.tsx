import { asc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { products } from "../../db/schema";

export const dynamic = "force-dynamic";

const whatsappMessage = encodeURIComponent(
  "Olá! Preciso realizar um pedido de peças para suspensão.",
);
const whatsapp = `https://wa.me/5543991565317?text=${whatsappMessage}`;

const productImages: Record<string, string> = {
  "RN 180": "/img-000.png",
  "RN 190": "/img-001.png",
  "RN 205": "/img-002.png",
  "RN 225": "/img-003.png",
  "RO 215": "/img-004.png",
  "RO 235": "/img-005.png",
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function productLine(code: string) {
  if (code.toUpperCase().startsWith("RN")) return "Linha Randon";
  if (code.toUpperCase().startsWith("RO")) return "Linha Rodoviária";
  return "Pino de balança";
}

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams?: Promise<{ tipo?: string }>;
}) {
  const params = await searchParams;
  const distributor = params?.tipo === "distribuidor";
  const db = await getDb();
  const catalogProducts = await db
    .select()
    .from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.code));

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div className="catalog-header-inner">
          <img src="/logo-sistema.png" alt="Pino Forte — Fabricação de Peças para Suspensão" />
          <div className="catalog-title">
            <h1>{distributor ? "Catálogo distribuidor" : "Catálogo de preços"}</h1>
          </div>
        </div>
      </header>

      <section className="catalog-content" aria-label="Pinos disponíveis">
        {distributor && (
          <div className="catalog-discount-rule">
            <strong>Regra de desconto</strong>
            <span>Até 9 unidades: 5%</span>
            <span>De 10 a 19 unidades: 8%</span>
            <span>20 unidades ou mais: 10%</span>
            <small>Descontos acima de 10% dependem de autorização.</small>
          </div>
        )}
        {catalogProducts.length ? (
          <div className="catalog-grid">
            {catalogProducts.map((product) => (
              <article className="catalog-card" key={product.id}>
                <div className="catalog-card-top">
                  <span className="catalog-code">{product.code}</span>
                  <strong className="catalog-price">{money(product.price)}</strong>
                </div>
                <div className="catalog-product">
                  {productImages[product.code] ? (
                    <img
                      className="catalog-product-image"
                      src={productImages[product.code]}
                      alt={`Pino de balança ${product.code}`}
                    />
                  ) : (
                    <div className="catalog-pin" aria-hidden="true">
                      <i />
                      <i />
                    </div>
                  )}
                  <div>
                    <span>{productLine(product.code)}</span>
                    <h3>Pino de balança</h3>
                    <span className="catalog-type">COMUM</span>
                    <strong>{product.measure}</strong>
                  </div>
                </div>
                {distributor && (
                  <div className="catalog-discount-values">
                    <strong>Desconto por peça</strong>
                    <span>5%: - {money(product.price * 0.05)}</span>
                    <span>8%: - {money(product.price * 0.08)}</span>
                    <span>10%: - {money(product.price * 0.1)}</span>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="empty">Nenhum pino disponível no momento.</p>
        )}
      </section>

      <footer className="catalog-footer">
        <a href={whatsapp} target="_blank" rel="noreferrer" aria-label="Falar no WhatsApp">
          Faça seu pedido de forma rápida e fácil | (43) 99156-5317
        </a>
      </footer>
    </main>
  );
}
