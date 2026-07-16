"use client";

import { useMemo, useState } from "react";

const products = [
  { code: "RN 180", name: "Pino de balança RN 180", measure: "180 mm", price: 49 },
  { code: "RN 190", name: "Pino de balança RN 190", measure: "190 mm", price: 55 },
  { code: "RN 205", name: "Pino de balança RN 205", measure: "205 mm", price: 56 },
  { code: "RN 225", name: "Pino de balança RN 225", measure: "225 mm", price: 57 },
  { code: "RO 215", name: "Pino de balança RO 215", measure: "215 mm", price: 63 },
  { code: "RO 235", name: "Pino de balança RO 235", measure: "235 mm", price: 68 },
];

const orders: Array<{ id: string; client: string; product: string; date: string; status: string; tone: string }> = [];

function Money({ value }: { value: number }) {
  return <>R$ {value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</>;
}

export default function Home() {
  const [screen, setScreen] = useState<"dashboard" | "new-order">("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState("RN 225");
  const [quantity, setQuantity] = useState(2);
  const [received, setReceived] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedNumber, setSavedNumber] = useState("OS-2026-0049");
  const product = useMemo(() => products.find((item) => item.code === selectedCode)!, [selectedCode]);
  const total = product.price * quantity;

  function goTo(target: "dashboard" | "new-order") {
    setScreen(target);
    setMenuOpen(false);
    setSaved(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveError("");
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)?.value || "";
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerName: value("client"), origin: value("origin"), deliveryDate: value("delivery-date"), productCode: selectedCode, quantity, unitPrice: product.price, received, deliveryType: "Retirada no local", paymentMethod: value("payment"), notes: value("notes") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar a OS.");
      setSavedNumber(result.order.number);
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível salvar a OS.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <div className="brand-mark">PB</div>
          <div><strong>Pino de Balança</strong><span>Gestão de serviços</span></div>
        </div>
        <nav aria-label="Menu principal">
          <button className={screen === "dashboard" ? "nav-item active" : "nav-item"} onClick={() => goTo("dashboard")}><span>⌂</span> Início</button>
          <button className="nav-item new" onClick={() => goTo("new-order")}><span>＋</span> Nova OS</button>
          <button className="nav-item"><span>▤</span> Ordens de Serviço</button>
          <button className="nav-item"><span>♙</span> Clientes</button>
          <button className="nav-item"><span>⬡</span> Pinos</button>
          <button className="nav-item"><span>▥</span> Relatórios</button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item"><span>⚙</span> Configurações</button>
          <button className="nav-item"><span>↪</span> Sair</button>
          <div className="user-card"><div className="avatar">RM</div><div><strong>Rogério Mendes</strong><span>Administrador</span></div></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="mobile-header"><button aria-label="Abrir menu" onClick={() => setMenuOpen(!menuOpen)}>☰</button><strong>Pino de Balança</strong><button className="mobile-add" onClick={() => goTo("new-order")}>＋</button></header>

        {screen === "dashboard" ? (
          <div className="page dashboard-page">
            <div className="page-heading">
              <div><p className="eyebrow">QUARTA-FEIRA, 15 DE JULHO</p><h1>Boa tarde, Rogério</h1><p>Acompanhe o que precisa da sua atenção hoje.</p></div>
              <button className="primary-button" onClick={() => goTo("new-order")}><span>＋</span> Criar nova OS</button>
            </div>

            <section className="metrics" aria-label="Resumo das ordens">
              <button className="metric"><div className="metric-icon blue">▤</div><div><span>Ordens abertas</span><strong>0</strong><small>Ver todas →</small></div></button>
              <button className="metric"><div className="metric-icon navy">⚒</div><div><span>Em produção</span><strong>0</strong><small>Acompanhar →</small></div></button>
              <button className="metric"><div className="metric-icon green">✓</div><div><span>Prontas</span><strong>0</strong><small>Ver retiradas →</small></div></button>
              <button className="metric"><div className="metric-icon red">!</div><div><span>Atrasadas</span><strong>0</strong><small>Ver todas →</small></div></button>
            </section>

            <section className="content-grid">
              <div className="panel deliveries">
                <div className="panel-title"><div><h2>Próximas entregas</h2><p>Serviços previstos para hoje e amanhã</p></div><button>Ver agenda completa</button></div>
                <div className="order-list">
                  {orders.length === 0 ? <div style={{padding:"70px 20px",textAlign:"center",color:"#69777a"}}><strong style={{display:"block",color:"#223033",marginBottom:7}}>Nenhuma Ordem de Serviço cadastrada</strong><span>Cadastre um cliente e crie a primeira OS.</span></div> : orders.map((order) => <button className="order-row" key={order.id}><div className="date-box"><strong>{order.date.split(",")[0]}</strong><span>{order.date.split(",")[1] || ""}</span></div><div className="order-main"><strong>{order.client}</strong><span>{order.id} · {order.product}</span></div><span className={`status ${order.tone}`}>{order.status}</span><span className="arrow">›</span></button>)}
                </div>
              </div>

              <div className="side-stack">
                <div className="panel attention"><div className="attention-head"><div className="round-alert">✓</div><div><h2>Tudo em dia</h2><p>Nenhuma ordem precisa de atenção</p></div></div></div>
                <div className="panel finance"><div><span>Resumo do mês</span><strong><Money value={0} /></strong><small>Valor vendido em julho</small></div><div className="finance-line"><span><b><Money value={0} /></b> recebido</span><span><b><Money value={0} /></b> pendente</span></div></div>
              </div>
            </section>
          </div>
        ) : (
          <div className="page order-page">
            <button className="back-button" onClick={() => goTo("dashboard")}>← Voltar ao início</button>
            <div className="page-heading compact"><div><p className="eyebrow">NOVA ORDEM DE SERVIÇO</p><h1>Criar nova OS</h1><p>Preencha os dados abaixo. Os campos com * são obrigatórios.</p></div><div className="os-number"><span>Número da OS</span><strong>OS-2026-0049</strong></div></div>

            {saved && <div className="success-message"><span>✓</span><div><strong>Ordem de Serviço criada com sucesso.</strong><p>A {savedNumber} foi salva e já está disponível para acompanhamento.</p></div><button onClick={() => setSaved(false)}>×</button></div>}
            {saveError && <div className="success-message"><div><strong>Não foi possível salvar.</strong><p>{saveError}</p></div></div>}

            <form onSubmit={saveOrder}>
              <section className="form-card"><div className="section-number">1</div><div className="form-content"><div className="form-title"><div><h2>Cliente</h2><p>Cadastre o primeiro cliente para criar a OS</p></div><button type="button" className="text-button">＋ Cadastrar novo cliente</button></div><div className="field full"><label htmlFor="client">Cliente *</label><select id="client" required defaultValue=""><option value="" disabled>Nenhum cliente cadastrado</option></select></div></div></section>

              <section className="form-card"><div className="section-number">2</div><div className="form-content"><div className="form-title"><div><h2>Informações do serviço</h2><p>Dados gerais e prazo combinado</p></div></div><div className="form-grid"><div className="field"><label htmlFor="origin">Origem do pedido *</label><select id="origin"><option>WhatsApp</option><option>Painel administrativo</option><option>Outro</option></select></div><div className="field"><label htmlFor="delivery-date">Previsão de entrega *</label><input id="delivery-date" type="date" defaultValue="2026-07-18" /></div><div className="field"><label htmlFor="vehicle">Veículo <small>opcional</small></label><input id="vehicle" placeholder="Ex.: Mercedes-Benz" /></div><div className="field"><label htmlFor="plate">Placa <small>opcional</small></label><input id="plate" placeholder="ABC-1D23" maxLength={8} /></div></div></div></section>

              <section className="form-card"><div className="section-number">3</div><div className="form-content"><div className="form-title"><div><h2>Pinos</h2><p>Selecione o código para preencher os dados automaticamente</p></div></div><div className="product-entry"><div className="field"><label htmlFor="product">Código do pino *</label><select id="product" value={selectedCode} onChange={(e) => setSelectedCode(e.target.value)}>{products.map((item) => <option key={item.code}>{item.code}</option>)}</select></div><div className="product-info"><span>Produto</span><strong>{product.name}</strong><small>Medida: {product.measure}</small></div><div className="field small-field"><label htmlFor="quantity">Quantidade *</label><input id="quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} /></div><div className="field price-field"><label htmlFor="price">Preço unitário</label><div className="currency-input"><span>R$</span><input id="price" value={product.price.toFixed(2).replace(".", ",")} readOnly /></div></div><div className="subtotal"><span>Subtotal</span><strong><Money value={total} /></strong></div></div><button type="button" className="outline-button">＋ Adicionar outro pino</button></div></section>

              <section className="form-card"><div className="section-number">4</div><div className="form-content"><div className="form-title"><div><h2>Entrega e pagamento</h2><p>Como o cliente receberá e pagará</p></div></div><div className="form-grid"><fieldset className="field radio-field"><legend>Forma de entrega *</legend><label><input type="radio" name="delivery" defaultChecked /> Retirada no local</label><label><input type="radio" name="delivery" /> Entrega</label></fieldset><div className="field"><label htmlFor="payment">Forma de pagamento</label><select id="payment"><option>Pix</option><option>Dinheiro</option><option>Transferência</option><option>Cartão</option><option>Boleto</option><option>Outro</option></select></div><div className="field"><label htmlFor="received">Valor já recebido</label><div className="currency-input"><span>R$</span><input id="received" type="number" min="0" max={total} value={received} onChange={(e) => setReceived(Math.max(0, Number(e.target.value)))} /></div></div><div className="payment-summary"><span>Total da OS <strong><Money value={total} /></strong></span><span>Recebido <strong><Money value={received} /></strong></span><span className="pending">Saldo pendente <strong><Money value={Math.max(0, total - received)} /></strong></span></div></div></div></section>

              <section className="form-card notes-card"><div className="section-number">5</div><div className="form-content"><div className="form-title"><div><h2>Observações</h2><p>Informações importantes para a fabricação</p></div></div><div className="field full"><label htmlFor="notes">Observações da OS</label><textarea id="notes" rows={3} placeholder="Ex.: cliente solicitou acabamento especial..." /></div></div></section>

              <div className="form-actions"><button type="button" className="cancel-button" onClick={() => goTo("dashboard")}>Cancelar</button><button type="submit" disabled={saving} className="save-button secondary-save">{saving ? "Salvando..." : "Salvar OS"}</button><button type="submit" disabled={saving} className="primary-button">{saving ? "Salvando..." : "Salvar e gerar PDF"}</button></div>
            </form>
          </div>
        )}
      </section>
      {menuOpen && <button className="overlay" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    </main>
  );
}
