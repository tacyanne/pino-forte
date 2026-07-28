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

export default async function CatalogoPage() {
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
            <h1>Catálogo de preços</h1>
          </div>
        </div>
      </header>

      <section className="catalog-content" aria-label="Pinos disponíveis">
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
                    <h3>{product.name}</h3>
                    <strong>{product.measure}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty">Nenhum pino disponível no momento.</p>
        )}
      </section>

      <footer className="catalog-footer">
        <div>
          <strong>Faça seu pedido de forma rápida e fácil</strong>
          <span>
            Desenvolvido por{" "}
            <a
              className="catalog-credit"
              href="https://www.ribexai.com.br"
              target="_blank"
              rel="noreferrer"
            >
              RibeX AI
            </a>
          </span>
        </div>
        <a href={whatsapp} target="_blank" rel="noreferrer" aria-label="Falar no WhatsApp">
          Falar no WhatsApp
        </a>
      </footer>
    </main>
  );
}
