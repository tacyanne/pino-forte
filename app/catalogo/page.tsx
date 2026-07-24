const products = [
  { code: "RN 180", measure: "50 × 180 mm", price: "R$ 49,00", line: "Linha Randon", image: "/img-000.png" },
  { code: "RN 190", measure: "50 × 190 mm", price: "R$ 55,00", line: "Linha Randon", image: "/img-001.png" },
  { code: "RN 205", measure: "50 × 205 mm", price: "R$ 56,00", line: "Linha Randon", image: "/img-002.png" },
  { code: "RN 225", measure: "50 × 225 mm", price: "R$ 57,00", line: "Linha Randon", image: "/img-003.png" },
  { code: "RO 215", measure: "50 × 215 mm", price: "R$ 63,00", line: "Linha Rodoviária", image: "/img-004.png" },
  { code: "RO 235", measure: "50 × 235 mm", price: "R$ 68,00", line: "Linha Rodoviária", image: "/img-005.png" },
];

const whatsappMessage = encodeURIComponent(
  "Olá! Preciso realizar um pedido de peças para suspensão.",
);
const whatsapp = `https://wa.me/5543991565317?text=${whatsappMessage}`;

export default function CatalogoPage() {
  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div className="catalog-header-inner">
          <img src="/logo-sistema.png" alt="Pino Forte — Fábrica de Peças para Suspensão" />
          <div className="catalog-title">
            <h1>Catálogo de preços</h1>
          </div>
        </div>
      </header>

      <section className="catalog-content" aria-label="Pinos disponíveis">
        <div className="catalog-grid">
          {products.map((product) => {
            return (
              <article className="catalog-card" key={product.code}>
                <div className="catalog-card-top">
                  <span className="catalog-code">{product.code}</span>
                  <strong className="catalog-price">{product.price}</strong>
                </div>
                <div className="catalog-product">
                  <img
                    className="catalog-product-image"
                    src={product.image}
                    alt={`Pino de balança ${product.code}`}
                  />
                  <div>
                    <span>{product.line}</span>
                    <h3>Pino de balança</h3>
                    <span className="catalog-type">COMUM</span>
                    <strong>{product.measure}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
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
