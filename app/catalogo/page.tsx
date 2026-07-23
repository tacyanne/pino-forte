const products = [
  { code: "RN 180", measure: "50 × 180 mm", price: "R$ 49,00", line: "Linha Randon" },
  { code: "RN 190", measure: "50 × 190 mm", price: "R$ 55,00", line: "Linha Randon" },
  { code: "RN 205", measure: "50 × 205 mm", price: "R$ 56,00", line: "Linha Randon" },
  { code: "RN 225", measure: "50 × 225 mm", price: "R$ 57,00", line: "Linha Randon" },
  { code: "RO 215", measure: "50 × 215 mm", price: "R$ 63,00", line: "Linha Rodoviária" },
  { code: "RO 235", measure: "50 × 235 mm", price: "R$ 68,00", line: "Linha Rodoviária" },
];

const whatsapp = "https://wa.me/5543991585317";

export default function CatalogoPage() {
  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div className="catalog-header-inner">
          <img src="/logo-sistema.png" alt="Rogério Mendes — Pino de Balança, Truck e Carreta" />
          <div className="catalog-title">
            <span>PINOS DE BALANÇA</span>
            <h1>Catálogo de preços</h1>
            <p>Escolha o modelo e faça seu pedido pelo WhatsApp.</p>
          </div>
          <a className="catalog-top-contact" href={whatsapp} target="_blank" rel="noreferrer">
            <small>WhatsApp</small>
            <strong>(43) 99158-5317</strong>
          </a>
        </div>
      </header>

      <section className="catalog-content" aria-label="Pinos disponíveis">
        <div className="catalog-intro">
          <div>
            <span className="catalog-count">6 MODELOS DISPONÍVEIS</span>
            <h2>Encontre o pino que você precisa</h2>
          </div>
          <p>Todos com diâmetro de 50 mm.</p>
        </div>

        <div className="catalog-grid">
          {products.map((product) => {
            const message = encodeURIComponent(
              `Olá! Quero pedir o pino ${product.code}, medida ${product.measure}.`,
            );
            return (
              <article className="catalog-card" key={product.code}>
                <div className="catalog-card-top">
                  <span className="catalog-code">{product.code}</span>
                  <strong className="catalog-price">{product.price}</strong>
                </div>
                <div className="catalog-product">
                  <div className="catalog-pin" aria-hidden="true">
                    <i />
                    <i />
                  </div>
                  <div>
                    <span>{product.line}</span>
                    <h3>Pino de balança</h3>
                    <strong>{product.measure}</strong>
                  </div>
                </div>
                <a
                  className="catalog-order"
                  href={`${whatsapp}?text=${message}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Pedir pino ${product.code} pelo WhatsApp`}
                >
                  Pedir este pino <span>→</span>
                </a>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="catalog-footer">
        <div>
          <strong>Faça seu pedido de forma rápida e fácil pelo WhatsApp!</strong>
          <span>Informe o código do pino para agilizar o atendimento.</span>
        </div>
        <a href={whatsapp} target="_blank" rel="noreferrer">Falar no WhatsApp</a>
      </footer>
    </main>
  );
}
