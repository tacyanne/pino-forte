"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [customers, setCustomers] = useState<Array<{ id: number; name: string; whatsapp: string; document: string }>>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customerModal, setCustomerModal] = useState(false);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [submitAction, setSubmitAction] = useState<"save" | "pdf">("save");
  const [documentType, setDocumentType] = useState<"CPF" | "CNPJ">("CPF");
  const [documentValue, setDocumentValue] = useState("");
  const product = useMemo(() => products.find((item) => item.code === selectedCode)!, [selectedCode]);
  const total = product.price * quantity;
  const maskDocument = (value: string, type: "CPF" | "CNPJ") => {
    const digits = value.replace(/\D/g, "").slice(0, type === "CPF" ? 11 : 14);
    return type === "CPF"
      ? digits.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2")
      : digits.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  };
  const toIsoDate = (value: string) => { const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? `${match[3]}-${match[2]}-${match[1]}` : ""; };

  useEffect(() => {
    fetch("/api/catalog").then((response) => response.json()).then((data) => {
      if (Array.isArray(data.customers)) setCustomers(data.customers);
    }).catch(() => setCustomerError("Não foi possível carregar os clientes."));
  }, []);

  function goTo(target: "dashboard" | "new-order") {
    setScreen(target);
    setMenuOpen(false);
    setSaved(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const printWindow = submitAction === "pdf" ? window.open("", "_blank") : null;
    if (printWindow) printWindow.document.write("<p style='font-family:Arial;padding:30px'>Gerando Ordem de Serviço...</p>");
    setSaving(true);
    setSaveError("");
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)?.value || "";
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerName: value("client"), origin: value("origin"), deliveryDate: toIsoDate(value("delivery-date")), productCode: selectedCode, quantity, unitPrice: product.price, received, deliveryType: "Retirada no local", paymentMethod: value("payment"), notes: value("notes") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar a OS.");
      setSavedNumber(result.order.number);
      setSaved(true);
      if (submitAction === "pdf" && printWindow) {
        const escapeHtml = (input: unknown) => String(input ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character));
        const order = result.order;
        const pending = Math.max(0, Number(order.total) - Number(order.received));
        const money = (amount: number) => amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        printWindow.document.open();
        const brDate = (date: string) => { const [year, month, day] = date.split("-"); return year && month && day ? `${day}/${month}/${year}` : date; };
        printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(order.number)}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#213033;margin:0;font-size:12px}.header{display:flex;justify-content:space-between;border-bottom:4px solid #174a52;padding-bottom:18px}.brand{font-size:22px;font-weight:800;color:#174a52}.subtitle{color:#69777a;margin-top:4px}.number{text-align:right}.number strong{display:block;font-size:18px;color:#d86b32;margin-top:5px}.section{margin-top:24px}.section h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#174a52;border-bottom:1px solid #dce4e2;padding-bottom:7px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 30px}.label{color:#69777a;font-size:10px;display:block;margin-bottom:4px}.value{font-weight:700}.items{width:100%;border-collapse:collapse;margin-top:10px}.items th{background:#174a52;color:#fff;text-align:left;padding:10px}.items td{padding:11px 10px;border-bottom:1px solid #dce4e2}.right{text-align:right!important}.totals{margin:18px 0 0 auto;width:280px}.totals div{display:flex;justify-content:space-between;padding:7px 0}.totals .grand{font-size:15px;font-weight:800;border-top:2px solid #174a52;color:#174a52}.footer{margin-top:60px;border-top:1px solid #cfd8d6;padding-top:12px;color:#69777a;text-align:center}.actions{position:fixed;right:20px;top:20px}@media print{.actions{display:none}}</style></head><body><button class="actions" onclick="window.print()">Imprimir / Salvar PDF</button><div class="header"><div><div class="brand">Pino de Balança</div><div class="subtitle">Ordem de Serviço de fabricação</div></div><div class="number"><span>ORDEM DE SERVIÇO</span><strong>${escapeHtml(order.number)}</strong></div></div><div class="section"><h2>Cliente e serviço</h2><div class="grid"><div><span class="label">Cliente</span><span class="value">${escapeHtml(order.customerName)}</span></div><div><span class="label">Origem do pedido</span><span class="value">${escapeHtml(order.origin)}</span></div><div><span class="label">Previsão de entrega</span><span class="value">${escapeHtml(brDate(order.deliveryDate))}</span></div><div><span class="label">Forma de entrega</span><span class="value">${escapeHtml(order.deliveryType)}</span></div></div></div><div class="section"><h2>Itens da OS</h2><table class="items"><thead><tr><th>Código</th><th>Descrição</th><th class="right">Qtd.</th><th class="right">Unitário</th><th class="right">Subtotal</th></tr></thead><tbody><tr><td>${escapeHtml(order.productCode)}</td><td>${escapeHtml(product.name)} · ${escapeHtml(product.measure)}</td><td class="right">${escapeHtml(order.quantity)}</td><td class="right">${money(Number(order.unitPrice))}</td><td class="right">${money(Number(order.total))}</td></tr></tbody></table><div class="totals"><div><span>Total</span><strong>${money(Number(order.total))}</strong></div><div><span>Recebido</span><strong>${money(Number(order.received))}</strong></div><div class="grand"><span>Saldo pendente</span><strong>${money(pending)}</strong></div></div></div><div class="section"><h2>Pagamento e observações</h2><div class="grid"><div><span class="label">Forma de pagamento</span><span class="value">${escapeHtml(order.paymentMethod)}</span></div><div><span class="label">Situação da produção</span><span class="value">${escapeHtml(order.productionStatus)}</span></div></div>${order.notes ? `<p><span class="label">Observações</span>${escapeHtml(order.notes)}</p>` : ""}</div><div class="footer">Documento gerado pelo sistema Pino de Balança</div><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
        printWindow.document.close();
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (printWindow) printWindow.close();
      setSaveError(error instanceof Error ? error.message : "Não foi possível salvar a OS.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCustomerSaving(true); setCustomerError("");
    const form = new FormData(event.currentTarget);
    try {
      const requiredDigits = documentType === "CPF" ? 11 : 14;
      if (documentValue && documentValue.replace(/\D/g, "").length !== requiredDigits) throw new Error(`${documentType} incompleto.`);
      const response = await fetch("/api/catalog", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), whatsapp: form.get("whatsapp"), document: documentValue ? `${documentType}: ${documentValue}` : "", email: form.get("email") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível cadastrar o cliente.");
      setCustomers((current) => [...current, result.customer].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedCustomer(result.customer.name);
      setCustomerModal(false);
    } catch (error) { setCustomerError(error instanceof Error ? error.message : "Não foi possível cadastrar o cliente."); }
    finally { setCustomerSaving(false); }
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
              <div><p className="eyebrow">15/07/2026</p><h1>Boa tarde, Rogério</h1><p>Acompanhe o que precisa da sua atenção hoje.</p></div>
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
              <section className="form-card"><div className="section-number">1</div><div className="form-content"><div className="form-title"><div><h2>Cliente</h2><p>Selecione um cliente cadastrado</p></div><button type="button" className="text-button" onClick={() => { setCustomerError(""); setCustomerModal(true); }}>＋ Cadastrar novo cliente</button></div><div className="field full"><label htmlFor="client">Cliente *</label><select id="client" required value={selectedCustomer} onChange={(event) => setSelectedCustomer(event.target.value)}><option value="" disabled>{customers.length ? "Selecione o cliente" : "Nenhum cliente cadastrado"}</option>{customers.map((customer) => <option key={customer.id} value={customer.name}>{customer.name} · {customer.whatsapp}</option>)}</select></div>{selectedCustomer && <div className="selected-client"><div className="avatar orange">✓</div><div><strong>{selectedCustomer}</strong><span>Cliente selecionado para esta Ordem de Serviço</span></div><span>✓ Selecionado</span></div>}</div></section>

              <section className="form-card"><div className="section-number">2</div><div className="form-content"><div className="form-title"><div><h2>Informações do serviço</h2><p>Dados gerais e prazo combinado</p></div></div><div className="form-grid"><div className="field"><label htmlFor="origin">Origem do pedido *</label><select id="origin"><option>WhatsApp</option><option>Balcão</option><option>Outros</option></select></div><div className="field"><label htmlFor="delivery-date">Previsão de entrega *</label><input id="delivery-date" inputMode="numeric" required pattern="\d{2}/\d{2}/\d{4}" placeholder="dd/mm/aaaa" defaultValue="18/07/2026" /></div></div></div></section>

              <section className="form-card"><div className="section-number">3</div><div className="form-content"><div className="form-title"><div><h2>Pinos</h2><p>Selecione o código para preencher os dados automaticamente</p></div></div><div className="product-entry"><div className="field"><label htmlFor="product">Código do pino *</label><select id="product" value={selectedCode} onChange={(e) => setSelectedCode(e.target.value)}>{products.map((item) => <option key={item.code}>{item.code}</option>)}</select></div><div className="product-info"><span>Produto</span><strong>{product.name}</strong><small>Medida: {product.measure}</small></div><div className="field small-field"><label htmlFor="quantity">Quantidade *</label><input id="quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} /></div><div className="field price-field"><label htmlFor="price">Preço unitário</label><div className="currency-input"><span>R$</span><input id="price" value={product.price.toFixed(2).replace(".", ",")} readOnly /></div></div><div className="subtotal"><span>Subtotal</span><strong><Money value={total} /></strong></div></div><button type="button" className="outline-button">＋ Adicionar outro pino</button></div></section>

              <section className="form-card"><div className="section-number">4</div><div className="form-content"><div className="form-title"><div><h2>Entrega e pagamento</h2><p>Como o cliente receberá e pagará</p></div></div><div className="form-grid"><fieldset className="field radio-field"><legend>Forma de entrega *</legend><label><input type="radio" name="delivery" defaultChecked /> Retirada no local</label><label><input type="radio" name="delivery" /> Entrega</label></fieldset><div className="field"><label htmlFor="payment">Forma de pagamento</label><select id="payment"><option>Pix</option><option>Dinheiro</option><option>Transferência</option><option>Cartão</option><option>Boleto</option><option>Outro</option></select></div><div className="field"><label htmlFor="received">Valor já recebido</label><div className="currency-input"><span>R$</span><input id="received" type="number" min="0" max={total} value={received} onChange={(e) => setReceived(Math.max(0, Number(e.target.value)))} /></div></div><div className="payment-summary"><span>Total da OS <strong><Money value={total} /></strong></span><span>Recebido <strong><Money value={received} /></strong></span><span className="pending">Saldo pendente <strong><Money value={Math.max(0, total - received)} /></strong></span></div></div></div></section>

              <section className="form-card notes-card"><div className="section-number">5</div><div className="form-content"><div className="form-title"><div><h2>Observações</h2><p>Informações importantes para a fabricação</p></div></div><div className="field full"><label htmlFor="notes">Observações da OS</label><textarea id="notes" rows={3} placeholder="Ex.: cliente solicitou acabamento especial..." /></div></div></section>

              <div className="form-actions"><button type="button" className="cancel-button" onClick={() => goTo("dashboard")}>Cancelar</button><button type="submit" disabled={saving} onClick={() => setSubmitAction("save")} className="save-button secondary-save">{saving ? "Salvando..." : "Salvar OS"}</button><button type="submit" disabled={saving} onClick={() => setSubmitAction("pdf")} className="primary-button">{saving ? "Gerando..." : "Salvar e gerar PDF"}</button></div>
            </form>
          </div>
        )}
      </section>
      {menuOpen && <button className="overlay" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
      {customerModal && <div className="modal-backdrop" role="presentation"><div className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="customer-title"><div className="modal-head"><div><p className="eyebrow">NOVO CLIENTE</p><h2 id="customer-title">Cadastrar cliente</h2></div><button type="button" aria-label="Fechar" onClick={() => setCustomerModal(false)}>×</button></div><form onSubmit={saveCustomer}><div className="field full"><label htmlFor="customer-name">Nome ou razão social *</label><input id="customer-name" name="name" required autoFocus placeholder="Digite o nome do cliente" /></div><div className="form-grid"><div className="field"><label htmlFor="customer-whatsapp">WhatsApp *</label><input id="customer-whatsapp" name="whatsapp" required placeholder="(00) 00000-0000" /></div><div className="field"><label htmlFor="customer-document">Documento</label><div style={{display:"grid",gridTemplateColumns:"110px 1fr",gap:8}}><select aria-label="Tipo de documento" value={documentType} onChange={(event) => { setDocumentType(event.target.value as "CPF" | "CNPJ"); setDocumentValue(""); }}><option>CPF</option><option>CNPJ</option></select><input id="customer-document" name="document" inputMode="numeric" value={documentValue} onChange={(event) => setDocumentValue(maskDocument(event.target.value, documentType))} placeholder={documentType === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"} /></div></div></div><div className="field full"><label htmlFor="customer-email">E-mail</label><input id="customer-email" name="email" type="email" placeholder="cliente@email.com" /></div>{customerError && <p className="modal-error">{customerError}</p>}<div className="modal-actions"><button type="button" className="cancel-button" onClick={() => setCustomerModal(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={customerSaving}>{customerSaving ? "Salvando..." : "Salvar cliente"}</button></div></form></div></div>}
    </main>
  );
}
