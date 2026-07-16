"use client";

import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";

type Screen =
  | "dashboard"
  | "new-order"
  | "orders"
  | "customers"
  | "products"
  | "wallet"
  | "reports"
  | "settings";
type Customer = {
  id: number;
  name: string;
  document: string;
  whatsapp: string;
  email: string;
  active: boolean;
  createdAt: string;
};
type Product = {
  id: number;
  code: string;
  sku: string;
  name: string;
  measure: string;
  price: number;
  active: boolean;
};
type Order = {
  id: number;
  number: string;
  customerName: string;
  origin: string;
  productCode: string;
  quantity: number;
  unitPrice: number;
  total: number;
  received: number;
  deliveryDate: string;
  deliveryType: string;
  paymentMethod: string;
  productionStatus: string;
  commercialStatus: string;
  notes: string;
  createdAt: string;
};

const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (date: string) => {
  const value = date?.slice(0, 10);
  const [y, m, d] = value?.split("-") || [];
  return y && m && d ? `${d}/${m}/${y}` : value || "—";
};
const toIsoDate = (date: string) => {
  const [d, m, y] = date.split("/");
  return d && m && y ? `${y}-${m}-${d}` : "";
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const maskDate = (value: string) =>
  value
    .replace(/\D/g, "")
    .slice(0, 8)
    .replace(/(\d{2})(\d)/, "$1/$2")
    .replace(/(\d{2})(\d)/, "$1/$2");
const isValidBrDate = (value: string) => {
  const [d, m, y] = value.split("/").map(Number);
  if (!d || !m || !y || y < 2000) return false;
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
};
const parseCurrency = (value: string) =>
  Number(value.replace(/[^\d]/g, "")) / 100;
const maskCurrency = (value: string) => money(parseCurrency(value));
const maskDoc = (value: string, type: "CPF" | "CNPJ") => {
  const d = value.replace(/\D/g, "").slice(0, type === "CPF" ? 11 : 14);
  return type === "CPF"
    ? d
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
    : d
        .replace(/(\d{2})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1/$2")
        .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
};
const maskPhone = (value: string) =>
  value
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
const statusTone = (status: string) =>
  status === "Entregue" || status === "Pronta"
    ? "green"
    : status === "Cancelada"
      ? "red"
      : status === "Em produção"
        ? "blue"
        : "amber";
const getOrderItems = (order: Order) => {
  try {
    const items = JSON.parse(order.productCode);
    if (Array.isArray(items))
      return items as { code: string; quantity: number; unitPrice: number }[];
  } catch {}
  return [
    {
      code: order.productCode,
      quantity: order.quantity,
      unitPrice: order.unitPrice,
    },
  ];
};
const orderCodes = (order: Order) =>
  getOrderItems(order)
    .map((item) => item.code)
    .join(", ");

export default function Home() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [menu, setMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [notice, setNotice] = useState("");
  const [customerModal, setCustomerModal] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [orderModal, setOrderModal] = useState<Order | null>(null);
  const [walletPayment, setWalletPayment] = useState<{
    items: Order[];
    customer: string;
  } | null>(null);
  const [walletPayMethod, setWalletPayMethod] = useState("Pix");
  const [walletPayDate, setWalletPayDate] = useState("");
  const [walletPayAmount, setWalletPayAmount] = useState(0);
  const [submitAction, setSubmitAction] = useState<"save" | "pdf">("save");
  const [docType, setDocType] = useState<"CPF" | "CNPJ">("CPF");
  const [doc, setDoc] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyName, setCompanyName] = useState("Pino de Balança");
  const [responsible, setResponsible] = useState("Rogério Mendes");
  const [orderFooter, setOrderFooter] = useState(
    "Documento gerado pelo sistema Pino de Balança",
  );
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [received, setReceived] = useState(0);
  const [orderItems, setOrderItems] = useState<
    { code: string; quantity: number }[]
  >([]);
  const [deliveryDate, setDeliveryDate] = useState("");

  async function loadAll() {
    setLoading(true);
    try {
      const [cat, ord] = await Promise.all([
        fetch("/api/catalog").then((r) => r.json()),
        fetch("/api/orders").then((r) => r.json()),
      ]);
      setCustomers(cat.customers || []);
      setProducts(cat.products || []);
      setOrders(ord.orders || []);
      if (!selectedCode && cat.products?.[0])
        setSelectedCode(cat.products[0].code);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadAll();
    try {
      const saved = JSON.parse(localStorage.getItem("pino-settings") || "{}");
      if (saved.companyName) setCompanyName(saved.companyName);
      if (saved.responsible) setResponsible(saved.responsible);
      if (saved.companyPhone) setCompanyPhone(saved.companyPhone);
      if (saved.orderFooter) setOrderFooter(saved.orderFooter);
    } catch {}
  }, []);
  const product = products.find((p) => p.code === selectedCode) || products[0];
  const total = orderItems.reduce(
    (sum, item) =>
      sum +
      (products.find((p) => p.code === item.code)?.price || 0) * item.quantity,
    0,
  );
  const metrics = useMemo(
    () => ({
      open: orders.filter(
        (o) => !["Entregue", "Cancelada"].includes(o.productionStatus),
      ).length,
      production: orders.filter((o) => o.productionStatus === "Em produção")
        .length,
      ready: orders.filter((o) => o.productionStatus === "Pronta").length,
      late: orders.filter(
        (o) =>
          o.deliveryDate < todayIso() &&
          !["Entregue", "Cancelada"].includes(o.productionStatus),
      ).length,
      sales: orders.reduce((s, o) => s + o.total, 0),
      received: orders.reduce((s, o) => s + o.received, 0),
    }),
    [orders],
  );
  const filteredOrders = orders.filter(
    (o) =>
      (statusFilter === "Todos" || o.productionStatus === statusFilter) &&
      `${o.number} ${o.customerName} ${o.productCode}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const filteredCustomers = customers.filter((c) =>
    `${c.name} ${c.document} ${c.whatsapp}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const walletMonths = useMemo(
    () =>
      Object.entries(
        orders
          .filter(
            (o) =>
              o.paymentMethod === "Carteira" &&
              o.productionStatus !== "Cancelada",
          )
          .reduce(
            (months, o) => {
              const month = o.createdAt.slice(0, 7);
              const customers = months[month] || (months[month] = {});
              const key = o.customerName;
              const current = customers[key] || {
                customer: key,
                orders: [] as Order[],
                total: 0,
                received: 0,
              };
              current.orders.push(o);
              current.total += o.total;
              current.received += o.received;
              customers[key] = current;
              return months;
            },
            {} as Record<
              string,
              Record<
                string,
                {
                  customer: string;
                  orders: Order[];
                  total: number;
                  received: number;
                }
              >
            >,
          ),
      ).sort(([a], [b]) => b.localeCompare(a)),
    [orders],
  );
  function go(next: Screen) {
    if (next === "new-order") {
      const first = products.find((p) => p.active)?.code || "";
      setSelectedCustomer("");
      setDeliveryDate("");
      setQuantity(1);
      setReceived(0);
      setSelectedCode(first);
      setOrderItems(first ? [{ code: first, quantity: 1 }] : []);
    }
    setScreen(next);
    setMenu(false);
    setQuery("");
    setNotice("");
    window.scrollTo({ top: 0 });
  }
  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(""), 3500);
  }
  function saveSettings() {
    localStorage.setItem(
      "pino-settings",
      JSON.stringify({ companyName, responsible, companyPhone, orderFooter }),
    );
    flash("Configurações salvas com sucesso.");
  }
  function updateItem(
    index: number,
    changes: Partial<{ code: string; quantity: number }>,
  ) {
    setOrderItems((items) =>
      items.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    );
  }

  async function saveCustomer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = new FormData(e.currentTarget);
    try {
      if (
        doc &&
        doc.replace(/\D/g, "").length !== (docType === "CPF" ? 11 : 14)
      )
        throw new Error(`${docType} incompleto.`);
      const r = await fetch("/api/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: f.get("name"),
          whatsapp: phone,
          document: doc ? `${docType}: ${doc}` : "",
          email: f.get("email"),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setCustomers((v) =>
        [...v, j.customer].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSelectedCustomer(j.customer.name);
      setCustomerModal(false);
      setDoc("");
      setPhone("");
      flash("Cliente cadastrado com sucesso.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Erro ao cadastrar.");
    } finally {
      setSaving(false);
    }
  }
  async function saveProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "product",
          code: f.get("code"),
          name: f.get("name"),
          measure: f.get("measure"),
          price: parseCurrency(String(f.get("price"))),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setProducts((v) =>
        [...v, j.product].sort((a, b) => a.code.localeCompare(b.code)),
      );
      setProductModal(false);
      flash("Pino cadastrado com sucesso.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Erro ao cadastrar.");
    } finally {
      setSaving(false);
    }
  }
  async function saveOrder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = new FormData(e.currentTarget);
    try {
      if (!isValidBrDate(deliveryDate))
        throw new Error("Informe uma data válida no formato dd/mm/aaaa.");
      if (!orderItems.length) throw new Error("Adicione pelo menos um pino.");
      const items = orderItems.map((item) => ({
        ...item,
        unitPrice: products.find((p) => p.code === item.code)?.price || 0,
      }));
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: selectedCustomer,
          origin: f.get("origin"),
          deliveryDate: toIsoDate(deliveryDate),
          productCode: selectedCode,
          quantity,
          unitPrice: product.price,
          items,
          received,
          deliveryType: f.get("deliveryType"),
          paymentMethod: f.get("paymentMethod"),
          notes: f.get("notes"),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setOrders((v) => [j.order, ...v]);
      setDeliveryDate("");
      setReceived(0);
      flash(`${j.order.number} criada com sucesso.`);
      if (submitAction === "pdf") downloadPdf(j.order);
      setOrderModal(j.order);
      setScreen("orders");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Erro ao salvar a OS.");
    } finally {
      setSaving(false);
    }
  }
  async function updateOrder(
    id: number,
    changes: Record<string, string | number>,
  ) {
    const r = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...changes }),
    });
    const j = await r.json();
    if (!r.ok) {
      flash(j.error);
      return;
    }
    setOrders((v) => v.map((o) => (o.id === id ? j.order : o)));
    setOrderModal(j.order);
    flash("OS atualizada.");
  }
  async function settleWallet() {
    if (!walletPayment) return;
    if (!isValidBrDate(walletPayDate))
      return flash("Informe uma data de pagamento válida.");
    const balance = walletPayment.items.reduce(
      (s, o) => s + o.total - o.received,
      0,
    );
    if (walletPayAmount <= 0 || walletPayAmount > balance)
      return flash("Informe um valor pago válido, até o limite do saldo.");
    setSaving(true);
    let remaining = walletPayAmount;
    try {
      for (const order of walletPayment.items.filter(
        (o) => o.received < o.total,
      )) {
        if (remaining <= 0) break;
        const portion = Math.min(remaining, order.total - order.received);
        let history: { amount: number; method: string; date: string }[] = [];
        try {
          const parsed = JSON.parse(order.commercialStatus);
          if (Array.isArray(parsed)) history = parsed;
        } catch {}
        history.push({
          amount: portion,
          method: walletPayMethod,
          date: toIsoDate(walletPayDate),
        });
        const r = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: order.id,
            received: order.received + portion,
            commercialStatus: JSON.stringify(history),
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setOrders((v) => v.map((o) => (o.id === order.id ? j.order : o)));
        remaining -= portion;
      }
      setWalletPayment(null);
      setWalletPayDate("");
      setWalletPayAmount(0);
      flash("Pagamento da carteira registrado.");
    } catch (err) {
      flash(
        err instanceof Error
          ? err.message
          : "Não foi possível registrar o pagamento.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function toggle(
    type: "customer" | "product",
    id: number,
    active: boolean,
  ) {
    const r = await fetch("/api/catalog", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, id, active }),
    });
    const j = await r.json();
    if (!r.ok) {
      flash(j.error);
      return;
    }
    if (type === "customer")
      setCustomers((v) => v.map((x) => (x.id === id ? j.customer : x)));
    else setProducts((v) => v.map((x) => (x.id === id ? j.product : x)));
  }
  function whatsapp(order: Order) {
    const customer = customers.find((c) => c.name === order.customerName);
    if (!customer?.whatsapp) return flash("Cliente sem WhatsApp cadastrado.");
    const number = customer.whatsapp.replace(/\D/g, "");
    const text = `Olá, ${customer.name}! A ${order.number} está com o status: ${order.productionStatus}. Previsão: ${brDate(order.deliveryDate)}.`;
    window.open(
      `https://wa.me/55${number}?text=${encodeURIComponent(text)}`,
      "_blank",
    );
  }
  function createPdf(order: Order) {
    const items = getOrderItems(order);
    const pdf = new jsPDF();
    pdf.setTextColor(23, 74, 82);
    pdf.setFontSize(22);
    pdf.text(companyName || "Pino de Balança", 18, 22);
    pdf.setFontSize(10);
    pdf.setTextColor(90);
    pdf.text("Ordem de Serviço de fabricação", 18, 29);
    pdf.setFontSize(16);
    pdf.setTextColor(216, 107, 50);
    pdf.text(order.number, 192, 22, { align: "right" });
    pdf.setDrawColor(23, 74, 82);
    pdf.setLineWidth(1.2);
    pdf.line(18, 34, 192, 34);
    pdf.setTextColor(30);
    pdf.setFontSize(11);
    pdf.text(`Emissão: ${brDate(order.createdAt)}`, 18, 46);
    pdf.text(`Cliente: ${order.customerName}`, 18, 55);
    pdf.text(`Origem: ${order.origin}`, 18, 64);
    pdf.text(`Previsão: ${brDate(order.deliveryDate)}`, 110, 46);
    pdf.text(`Status: ${order.productionStatus}`, 110, 55);
    pdf.setFillColor(23, 74, 82);
    pdf.rect(18, 75, 174, 10, "F");
    pdf.setTextColor(255);
    pdf.text("MODELO", 22, 82);
    pdf.text("QTD.", 115, 82);
    pdf.text("UNITÁRIO", 140, 82);
    pdf.text("SUBTOTAL", 188, 82, { align: "right" });
    pdf.setTextColor(30);
    let y = 94;
    items.forEach((item) => {
      const p = products.find((x) => x.code === item.code);
      pdf.text(`${item.code} — ${p?.measure || ""}`, 22, y);
      pdf.text(String(item.quantity), 117, y);
      pdf.text(money(item.unitPrice), 140, y);
      pdf.text(money(item.unitPrice * item.quantity), 188, y, {
        align: "right",
      });
      y += 10;
    });
    y += 5;
    pdf.text(`Total: ${money(order.total)}`, 192, y, { align: "right" });
    pdf.text(`Recebido: ${money(order.received)}`, 192, y + 9, {
      align: "right",
    });
    pdf.setFontSize(13);
    pdf.setTextColor(23, 74, 82);
    pdf.text(
      `Saldo: ${money(Math.max(0, order.total - order.received))}`,
      192,
      y + 20,
      { align: "right" },
    );
    pdf.setFontSize(10);
    pdf.setTextColor(70);
    pdf.text(
      `Pagamento: ${order.paymentMethod} | Entrega: ${order.deliveryType}`,
      18,
      y + 37,
    );
    pdf.text(
      order.notes ? `Observações: ${order.notes}` : "Sem observações.",
      18,
      y + 47,
      { maxWidth: 174 },
    );
    pdf.setFontSize(8);
    pdf.setTextColor(120);
    pdf.text(orderFooter, 105, 282, { align: "center" });
    return pdf;
  }
  function downloadPdf(order: Order) {
    createPdf(order).save(`${order.number}.pdf`);
  }
  async function shareOrder(order: Order) {
    const customer = customers.find((c) => c.name === order.customerName);
    if (!customer?.whatsapp) return flash("Cliente sem WhatsApp cadastrado.");
    const text = `Olá, ${customer.name}! Segue a ${order.number}. Status: ${order.productionStatus}. Previsão: ${brDate(order.deliveryDate)}.`;
    const blob = createPdf(order).output("blob");
    const file = new File([blob], `${order.number}.pdf`, {
      type: "application/pdf",
    });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: order.number, text, files: [file] });
        return;
      } catch {}
    }
    downloadPdf(order);
    const number = customer.whatsapp.replace(/\D/g, "");
    window.open(
      `https://wa.me/55${number}?text=${encodeURIComponent(text + " O PDF foi baixado para ser anexado nesta conversa.")}`,
      "_blank",
    );
  }
  function printOrder(order: Order) {
    const p = products.find((x) => x.code === order.productCode);
    const w = window.open("", "_blank");
    if (!w) return flash("Permita pop-ups para gerar o PDF.");
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${order.number}</title><style>@page{size:A4;margin:15mm}body{font-family:Arial;color:#203235;font-size:12px}header{display:flex;justify-content:space-between;border-bottom:4px solid #174a52;padding-bottom:18px}h1{color:#174a52;margin:0}.n{color:#d86b32;font-size:20px;font-weight:bold}section{margin-top:24px}h2{font-size:12px;border-bottom:1px solid #ddd;padding-bottom:7px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}table{width:100%;border-collapse:collapse}th{background:#174a52;color:white;padding:10px;text-align:left}td{padding:10px;border-bottom:1px solid #ddd}.right{text-align:right}.total{text-align:right;font-size:16px;margin-top:18px}.actions{position:fixed;right:20px;top:20px}@media print{.actions{display:none}}</style></head><body><button class="actions" onclick="print()">Imprimir / Salvar PDF</button><header><div><h1>Pino de Balança</h1><span>Ordem de Serviço de fabricação</span></div><div><div>ORDEM DE SERVIÇO</div><div class="n">${order.number}</div></div></header><section><h2>CLIENTE E SERVIÇO</h2><div class="grid"><div><b>Cliente</b><br>${order.customerName}</div><div><b>Origem</b><br>${order.origin}</div><div><b>Previsão</b><br>${brDate(order.deliveryDate)}</div><div><b>Status</b><br>${order.productionStatus}</div></div></section><section><h2>ITEM</h2><table><tr><th>Código</th><th>Descrição</th><th class="right">Qtd.</th><th class="right">Unitário</th><th class="right">Subtotal</th></tr><tr><td>${order.productCode}</td><td>${p?.name || ""} · ${p?.measure || ""}</td><td class="right">${order.quantity}</td><td class="right">${money(order.unitPrice)}</td><td class="right">${money(order.total)}</td></tr></table><div class="total">Total: <b>${money(order.total)}</b><br>Recebido: ${money(order.received)}<br>Saldo: <b>${money(Math.max(0, order.total - order.received))}</b></div></section><section><h2>PAGAMENTO E OBSERVAÇÕES</h2><p>${order.paymentMethod} · ${order.deliveryType}</p><p>${order.notes || "Sem observações."}</p></section><script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`,
    );
    w.document.close();
  }
  function exportCsv() {
    const rows = [
      [
        "OS",
        "Cliente",
        "Pino",
        "Quantidade",
        "Total",
        "Recebido",
        "Saldo",
        "Entrega",
        "Status",
      ],
      ...orders.map((o) => [
        o.number,
        o.customerName,
        o.productCode,
        o.quantity,
        o.total,
        o.received,
        o.total - o.received,
        brDate(o.deliveryDate),
        o.productionStatus,
      ]),
    ];
    const csv = rows
      .map((r) =>
        r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(";"),
      )
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv" }),
    );
    a.download = `relatorio-os-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const nav: [Screen, string, string][] = [
    ["dashboard", "⌂", "Início"],
    ["orders", "▤", "Ordens de Serviço"],
    ["customers", "♙", "Clientes"],
    ["products", "⬡", "Pinos"],
    ["wallet", "▣", "Carteira"],
    ["reports", "▥", "Relatórios"],
    ["settings", "⚙", "Configurações"],
  ];
  return (
    <main className="app-shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">PB</div>
          <div>
            <strong>Pino de Balança</strong>
            <span>Gestão de serviços</span>
          </div>
        </div>
        <nav>
          {nav.map(([s, i, l]) => (
            <button
              key={s}
              className={`nav-item ${screen === s ? "active" : ""}`}
              onClick={() => go(s)}
            >
              <span>{i}</span>
              {l}
            </button>
          ))}
          <button className="nav-item new" onClick={() => go("new-order")}>
            <span>＋</span>Nova OS
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="avatar">RM</div>
            <div>
              <strong>Rogério Mendes</strong>
              <span>Administrador</span>
            </div>
          </div>
        </div>
      </aside>
      <section className="workspace">
        <header className="mobile-header">
          <button onClick={() => setMenu(!menu)}>☰</button>
          <strong>Pino de Balança</strong>
          <button className="mobile-add" onClick={() => go("new-order")}>
            ＋
          </button>
        </header>
        {notice && <div className="toast">{notice}</div>}
        {loading ? (
          <div className="page">
            <div className="empty">Carregando dados...</div>
          </div>
        ) : (
          <>
            {screen === "dashboard" && (
              <div className="page">
                <Heading
                  eyebrow={brDate(todayIso())}
                  title="Painel de controle"
                  subtitle="Acompanhe produção, prazos e recebimentos."
                  action={
                    <button
                      className="primary-button"
                      onClick={() => go("new-order")}
                    >
                      ＋ Criar nova OS
                    </button>
                  }
                />
                <section className="metrics">
                  <Metric
                    icon="▤"
                    label="Ordens abertas"
                    value={metrics.open}
                  />
                  <Metric
                    icon="⚒"
                    label="Em produção"
                    value={metrics.production}
                  />
                  <Metric icon="✓" label="Prontas" value={metrics.ready} />
                  <Metric
                    icon="!"
                    label="Atrasadas"
                    value={metrics.late}
                    alert={metrics.late > 0}
                  />
                </section>
                <section className="content-grid">
                  <div className="panel">
                    <div className="panel-title">
                      <div>
                        <h2>Ordens recentes</h2>
                        <p>Últimos serviços cadastrados</p>
                      </div>
                      <button onClick={() => go("orders")}>Ver todas</button>
                    </div>
                    <OrderList
                      orders={orders.slice(0, 6)}
                      onOpen={setOrderModal}
                    />
                  </div>
                  <div className="side-stack">
                    <div className="panel finance">
                      <span>Valor vendido</span>
                      <strong>{money(metrics.sales)}</strong>
                      <small>Todo o período</small>
                      <div className="finance-line">
                        <span>
                          <b>{money(metrics.received)}</b> recebido
                        </span>
                        <span>
                          <b>{money(metrics.sales - metrics.received)}</b>{" "}
                          pendente
                        </span>
                      </div>
                    </div>
                    <div className="panel attention">
                      <h2>
                        {metrics.late ? "Atenção aos prazos" : "Tudo em dia"}
                      </h2>
                      <p>
                        {metrics.late
                          ? `${metrics.late} OS atrasada(s).`
                          : "Nenhuma OS atrasada."}
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            )}
            {screen === "new-order" && (
              <div className="page order-page">
                <button className="back-button" onClick={() => go("dashboard")}>
                  ← Voltar ao início
                </button>
                <Heading
                  eyebrow="NOVA ORDEM DE SERVIÇO"
                  title="Criar nova OS"
                  subtitle="Preencha os dados obrigatórios."
                />
                <form onSubmit={saveOrder}>
                  <Card n="1" title="Cliente">
                    <div className="form-title">
                      <span></span>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setCustomerModal(true)}
                      >
                        ＋ Cadastrar cliente
                      </button>
                    </div>
                    <Field label="Cliente *">
                      <select
                        required
                        value={selectedCustomer}
                        onChange={(e) => setSelectedCustomer(e.target.value)}
                      >
                        <option value="">Selecione</option>
                        {customers
                          .filter((c) => c.active)
                          .map((c) => (
                            <option key={c.id}>{c.name}</option>
                          ))}
                      </select>
                    </Field>
                  </Card>
                  <Card n="2" title="Serviço e prazo">
                    <div className="form-grid">
                      <Field label="Origem do pedido *">
                        <select name="origin">
                          <option>WhatsApp</option>
                          <option>Balcão</option>
                          <option>Outros</option>
                        </select>
                      </Field>
                      <Field label="Previsão de entrega *">
                        <input
                          name="deliveryDate"
                          required
                          inputMode="numeric"
                          pattern="\d{2}/\d{2}/\d{4}"
                          maxLength={10}
                          value={deliveryDate}
                          onChange={(e) =>
                            setDeliveryDate(maskDate(e.target.value))
                          }
                          placeholder="dd/mm/aaaa"
                        />
                      </Field>
                    </div>
                  </Card>
                  <Card n="3" title="Pinos">
                    <div className="multi-items">
                      {orderItems.map((item, index) => {
                        const p = products.find((x) => x.code === item.code);
                        return (
                          <div className="item-row" key={index}>
                            <Field label={`Modelo ${index + 1}`}>
                              <select
                                value={item.code}
                                onChange={(e) =>
                                  updateItem(index, { code: e.target.value })
                                }
                              >
                                {products
                                  .filter((p) => p.active)
                                  .map((p) => (
                                    <option key={p.id}>{p.code}</option>
                                  ))}
                              </select>
                            </Field>
                            <div className="product-info">
                              <span>Descrição</span>
                              <strong>{p?.name}</strong>
                              <small>
                                {p?.measure} · {money(p?.price || 0)}
                              </small>
                            </div>
                            <Field label="Quantidade">
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) =>
                                  updateItem(index, {
                                    quantity: Math.max(1, +e.target.value),
                                  })
                                }
                              />
                            </Field>
                            <div className="subtotal">
                              <span>Subtotal</span>
                              <strong>
                                {money((p?.price || 0) * item.quantity)}
                              </strong>
                            </div>
                            {orderItems.length > 1 && (
                              <button
                                type="button"
                                className="remove-item"
                                onClick={() =>
                                  setOrderItems((items) =>
                                    items.filter((_, i) => i !== index),
                                  )
                                }
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="outline-button"
                      onClick={() =>
                        setOrderItems((items) => [
                          ...items,
                          {
                            code: products.find((p) => p.active)?.code || "",
                            quantity: 1,
                          },
                        ])
                      }
                    >
                      ＋ Adicionar outro pino
                    </button>
                    <div className="items-total">
                      Total dos pinos <strong>{money(total)}</strong>
                    </div>
                  </Card>
                  <Card n="4" title="Entrega e pagamento">
                    <div className="form-grid">
                      <Field label="Forma de entrega">
                        <select name="deliveryType">
                          <option>Retirada no local</option>
                          <option>Entrega</option>
                        </select>
                      </Field>
                      <Field label="Forma de pagamento">
                        <select name="paymentMethod">
                          <option>Pix</option>
                          <option>Dinheiro</option>
                          <option>Cartão</option>
                          <option>Boleto</option>
                          <option>Carteira</option>
                        </select>
                        <small className="field-help">
                          Carteira: as OS do cliente ficam acumuladas para
                          pagamento no mês seguinte.
                        </small>
                      </Field>
                      <Field label="Valor recebido">
                        <input
                          inputMode="numeric"
                          value={money(received)}
                          onChange={(e) =>
                            setReceived(
                              Math.min(total, parseCurrency(e.target.value)),
                            )
                          }
                        />
                      </Field>
                      <div className="payment-summary">
                        <span>
                          Total <strong>{money(total)}</strong>
                        </span>
                        <span>
                          Saldo{" "}
                          <strong>
                            {money(Math.max(0, total - received))}
                          </strong>
                        </span>
                      </div>
                    </div>
                  </Card>
                  <Card n="5" title="Observações">
                    <Field label="Informações para fabricação">
                      <textarea name="notes" rows={3} />
                    </Field>
                  </Card>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="cancel-button"
                      onClick={() => go("dashboard")}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="save-button"
                      onClick={() => setSubmitAction("save")}
                    >
                      Salvar OS
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="primary-button"
                      onClick={() => setSubmitAction("pdf")}
                    >
                      {saving ? "Salvando..." : "Salvar e gerar PDF"}
                    </button>
                  </div>
                </form>
              </div>
            )}
            {screen === "orders" && (
              <div className="page">
                <Heading
                  eyebrow="GESTÃO"
                  title="Ordens de Serviço"
                  subtitle="Atualize produção, pagamentos e prazos."
                  action={
                    <button
                      className="primary-button"
                      onClick={() => go("new-order")}
                    >
                      ＋ Nova OS
                    </button>
                  }
                />
                <Filters query={query} setQuery={setQuery}>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option>Todos</option>
                    {[
                      "Aguardando",
                      "Em produção",
                      "Pronta",
                      "Entregue",
                      "Cancelada",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Filters>
                <div className="panel">
                  <OrderList orders={filteredOrders} onOpen={setOrderModal} />
                </div>
              </div>
            )}
            {screen === "customers" && (
              <div className="page">
                <Heading
                  eyebrow="CADASTROS"
                  title="Clientes"
                  subtitle="Consulte clientes por nome, CPF, CNPJ ou WhatsApp."
                  action={
                    <button
                      className="primary-button"
                      onClick={() => setCustomerModal(true)}
                    >
                      ＋ Novo cliente
                    </button>
                  }
                />
                <Filters query={query} setQuery={setQuery} />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>CPF/CNPJ</th>
                        <th>WhatsApp</th>
                        <th>E-mail</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomers.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <b>{c.name}</b>
                          </td>
                          <td>{c.document || "—"}</td>
                          <td>{c.whatsapp}</td>
                          <td>{c.email || "—"}</td>
                          <td>
                            <span
                              className={`status ${c.active ? "green" : "red"}`}
                            >
                              {c.active ? "Ativo" : "Inativo"}
                            </span>
                          </td>
                          <td>
                            <button
                              className="link-button"
                              onClick={() =>
                                toggle("customer", c.id, !c.active)
                              }
                            >
                              {c.active ? "Inativar" : "Ativar"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {screen === "products" && (
              <div className="page">
                <Heading
                  eyebrow="CATÁLOGO"
                  title="Pinos e preços"
                  subtitle="Mantenha os modelos disponíveis e seus valores."
                  action={
                    <button
                      className="primary-button"
                      onClick={() => setProductModal(true)}
                    >
                      ＋ Novo pino
                    </button>
                  }
                />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Descrição</th>
                        <th>Medida</th>
                        <th>Preço</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <b>{p.code}</b>
                          </td>
                          <td>{p.name}</td>
                          <td>{p.measure}</td>
                          <td>{money(p.price)}</td>
                          <td>
                            <span
                              className={`status ${p.active ? "green" : "red"}`}
                            >
                              {p.active ? "Ativo" : "Inativo"}
                            </span>
                          </td>
                          <td>
                            <button
                              className="link-button"
                              onClick={() => toggle("product", p.id, !p.active)}
                            >
                              {p.active ? "Inativar" : "Ativar"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {screen === "wallet" && (
              <div className="page">
                <Heading
                  eyebrow="PAGAMENTO MENSAL"
                  title="Carteira de clientes"
                  subtitle="Pagamentos parciais e saldos organizados por mês."
                />
                {!walletMonths.length ? (
                  <div className="panel empty">
                    Nenhum cliente possui compras na Carteira.
                  </div>
                ) : (
                  <div className="month-stack">
                    {walletMonths.map(([month, customerMap]) => {
                      const [year, monthNumber] = month.split("-");
                      const label = new Date(
                        +year,
                        +monthNumber - 1,
                        1,
                      ).toLocaleDateString("pt-BR", {
                        month: "long",
                        year: "numeric",
                      });
                      return (
                        <section className="month-frame" key={month}>
                          <h2>{label}</h2>
                          <div className="wallet-grid">
                            {Object.values(customerMap).map((item) => {
                              const balance = item.total - item.received;
                              const history = item.orders.flatMap((o) => {
                                try {
                                  const value = JSON.parse(o.commercialStatus);
                                  return Array.isArray(value) ? value : [];
                                } catch {
                                  return [];
                                }
                              }) as {
                                amount: number;
                                method: string;
                                date: string;
                              }[];
                              return (
                                <section
                                  className="panel wallet-card"
                                  key={item.customer}
                                >
                                  <div className="wallet-head">
                                    <div>
                                      <span>CLIENTE</span>
                                      <h2>{item.customer}</h2>
                                    </div>
                                    <span
                                      className={`status ${balance ? "amber" : "green"}`}
                                    >
                                      {balance ? "Em aberto" : "Pago"}
                                    </span>
                                  </div>
                                  <div className="wallet-total">
                                    <span>Total acumulado</span>
                                    <strong>{money(item.total)}</strong>
                                  </div>
                                  <div className="wallet-summary">
                                    <span>{item.orders.length} OS</span>
                                    <span>
                                      Pago: <b>{money(item.received)}</b>
                                    </span>
                                    <span>
                                      Saldo: <b>{money(balance)}</b>
                                    </span>
                                  </div>
                                  <div className="wallet-orders">
                                    {item.orders.map((o) => (
                                      <button
                                        key={o.id}
                                        onClick={() => setOrderModal(o)}
                                      >
                                        <span>
                                          {o.number}
                                          <small>
                                            Emitida em {brDate(o.createdAt)}
                                          </small>
                                        </span>
                                        <b>{money(o.total)}</b>
                                      </button>
                                    ))}
                                  </div>
                                  {history.length > 0 && (
                                    <div className="payment-history">
                                      <strong>Histórico de pagamentos</strong>
                                      {history.map((p, i) => (
                                        <div key={i}>
                                          <span>
                                            {brDate(p.date)} · {p.method}
                                          </span>
                                          <b>{money(p.amount)}</b>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {balance > 0 && (
                                    <button
                                      className="primary-button wallet-pay"
                                      disabled={saving}
                                      onClick={() => {
                                        setWalletPayment({
                                          items: item.orders,
                                          customer: item.customer,
                                        });
                                        setWalletPayDate(brDate(todayIso()));
                                        setWalletPayAmount(0);
                                      }}
                                    >
                                      ＋ Registrar pagamento
                                    </button>
                                  )}
                                </section>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {screen === "reports" && (
              <div className="page">
                <Heading
                  eyebrow="ANÁLISE"
                  title="Relatórios"
                  subtitle="Indicadores comerciais e financeiros."
                  action={
                    <button className="primary-button" onClick={exportCsv}>
                      ↓ Exportar CSV
                    </button>
                  }
                />
                <section className="metrics">
                  <Metric
                    icon="R$"
                    label="Vendas"
                    value={money(metrics.sales)}
                  />
                  <Metric
                    icon="✓"
                    label="Recebido"
                    value={money(metrics.received)}
                  />
                  <Metric
                    icon="…"
                    label="Pendente"
                    value={money(metrics.sales - metrics.received)}
                  />
                  <Metric
                    icon="▤"
                    label="OS cadastradas"
                    value={orders.length}
                  />
                </section>
                <div className="panel report-bars">
                  {products.map((p) => {
                    const count = orders
                      .filter((o) => o.productCode === p.code)
                      .reduce((s, o) => s + o.quantity, 0);
                    const max = Math.max(
                      1,
                      ...products.map((x) =>
                        orders
                          .filter((o) => o.productCode === x.code)
                          .reduce((s, o) => s + o.quantity, 0),
                      ),
                    );
                    return (
                      <div key={p.id}>
                        <span>{p.code}</span>
                        <div>
                          <i style={{ width: `${(count / max) * 100}%` }} />
                        </div>
                        <b>{count} un.</b>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {screen === "settings" && (
              <div className="page">
                <Heading
                  eyebrow="SISTEMA"
                  title="Configurações"
                  subtitle="Preferências usadas nos documentos e mensagens."
                />
                <div className="form-card settings-card">
                  <Field label="Nome da empresa">
                    <input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                  </Field>
                  <Field label="Responsável">
                    <input
                      value={responsible}
                      onChange={(e) => setResponsible(e.target.value)}
                    />
                  </Field>
                  <Field label="WhatsApp da empresa">
                    <input
                      inputMode="tel"
                      value={companyPhone}
                      onChange={(e) =>
                        setCompanyPhone(maskPhone(e.target.value))
                      }
                      placeholder="(00) 00000-0000"
                    />
                  </Field>
                  <Field label="Rodapé da OS">
                    <input
                      value={orderFooter}
                      onChange={(e) => setOrderFooter(e.target.value)}
                    />
                  </Field>
                  <button className="primary-button" onClick={saveSettings}>
                    Salvar configurações
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {menu && <button className="overlay" onClick={() => setMenu(false)} />}
      {customerModal && (
        <Modal title="Cadastrar cliente" close={() => setCustomerModal(false)}>
          <form onSubmit={saveCustomer}>
            <Field label="Nome ou razão social *">
              <input name="name" required autoFocus />
            </Field>
            <div className="form-grid">
              <Field label="WhatsApp *">
                <input
                  required
                  value={phone}
                  onChange={(e) => setPhone(maskPhone(e.target.value))}
                  placeholder="(00) 00000-0000"
                />
              </Field>
              <Field label="Documento">
                <div className="doc-grid">
                  <select
                    value={docType}
                    onChange={(e) => {
                      setDocType(e.target.value as "CPF" | "CNPJ");
                      setDoc("");
                    }}
                  >
                    <option>CPF</option>
                    <option>CNPJ</option>
                  </select>
                  <input
                    value={doc}
                    onChange={(e) => setDoc(maskDoc(e.target.value, docType))}
                    placeholder={
                      docType === "CPF"
                        ? "000.000.000-00"
                        : "00.000.000/0000-00"
                    }
                  />
                </div>
              </Field>
            </div>
            <Field label="E-mail">
              <input name="email" type="email" />
            </Field>
            <div className="modal-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => setCustomerModal(false)}
              >
                Cancelar
              </button>
              <button className="primary-button" disabled={saving}>
                Salvar cliente
              </button>
            </div>
          </form>
        </Modal>
      )}
      {productModal && (
        <Modal title="Cadastrar pino" close={() => setProductModal(false)}>
          <form onSubmit={saveProduct}>
            <div className="form-grid">
              <Field label="Código *">
                <input name="code" required placeholder="Ex.: RN 250" />
              </Field>
              <Field label="Medida *">
                <input name="measure" required placeholder="Ex.: 250 mm" />
              </Field>
            </div>
            <Field label="Descrição *">
              <input name="name" required placeholder="Pino de balança..." />
            </Field>
            <Field label="Preço *">
              <input
                name="price"
                required
                inputMode="numeric"
                defaultValue="R$ 0,00"
                onChange={(e) => {
                  e.currentTarget.value = maskCurrency(e.currentTarget.value);
                }}
              />
            </Field>
            <div className="modal-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => setProductModal(false)}
              >
                Cancelar
              </button>
              <button className="primary-button" disabled={saving}>
                Salvar pino
              </button>
            </div>
          </form>
        </Modal>
      )}
      {walletPayment && (
        <Modal
          title="Registrar pagamento da Carteira"
          close={() => setWalletPayment(null)}
        >
          <p className="confirm-text">
            Informe o valor recebido de <b>{walletPayment.customer}</b>. O saldo
            restante continuará em aberto.
          </p>
          <div className="form-grid">
            <Field label="Valor pago *">
              <input
                inputMode="numeric"
                value={money(walletPayAmount)}
                onChange={(e) =>
                  setWalletPayAmount(parseCurrency(e.target.value))
                }
              />
            </Field>
            <Field label="Forma de pagamento *">
              <select
                value={walletPayMethod}
                onChange={(e) => setWalletPayMethod(e.target.value)}
              >
                <option>Pix</option>
                <option>Dinheiro</option>
                <option>Cartão</option>
                <option>Boleto</option>
              </select>
            </Field>
            <Field label="Data do pagamento *">
              <input
                inputMode="numeric"
                maxLength={10}
                value={walletPayDate}
                onChange={(e) => setWalletPayDate(maskDate(e.target.value))}
                placeholder="dd/mm/aaaa"
              />
            </Field>
          </div>
          <div className="modal-actions">
            <button
              className="cancel-button"
              onClick={() => setWalletPayment(null)}
            >
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={saving}
              onClick={settleWallet}
            >
              {saving ? "Registrando..." : "Confirmar pagamento"}
            </button>
          </div>
        </Modal>
      )}
      {orderModal && (
        <Modal title={orderModal.number} close={() => setOrderModal(null)}>
          <div className="order-detail">
            <div>
              <span>Cliente</span>
              <b>{orderModal.customerName}</b>
            </div>
            <div>
              <span>Emissão</span>
              <b>{brDate(orderModal.createdAt)}</b>
            </div>
            <div>
              <span>Entrega</span>
              <b>{brDate(orderModal.deliveryDate)}</b>
            </div>
            <div>
              <span>Pinos</span>
              <b>
                {orderCodes(orderModal)} · {orderModal.quantity} un.
              </b>
            </div>
            <div>
              <span>Saldo</span>
              <b>
                {money(Math.max(0, orderModal.total - orderModal.received))}
              </b>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Status da produção">
              <select
                value={orderModal.productionStatus}
                onChange={(e) =>
                  updateOrder(orderModal.id, {
                    productionStatus: e.target.value,
                  })
                }
              >
                {[
                  "Aguardando",
                  "Em produção",
                  "Pronta",
                  "Entregue",
                  "Cancelada",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Valor total recebido">
              <input
                inputMode="numeric"
                value={money(orderModal.received)}
                onChange={(e) =>
                  setOrderModal({
                    ...orderModal,
                    received: Math.min(
                      orderModal.total,
                      parseCurrency(e.target.value),
                    ),
                  })
                }
                onBlur={() =>
                  updateOrder(orderModal.id, { received: orderModal.received })
                }
              />
            </Field>
          </div>
          <div className="detail-actions three">
            <button
              className="outline-button"
              onClick={() => printOrder(orderModal)}
            >
              Imprimir OS
            </button>
            <button
              className="outline-button"
              onClick={() => downloadPdf(orderModal)}
            >
              Baixar PDF
            </button>
            <button
              className="whatsapp-button"
              onClick={() => shareOrder(orderModal)}
            >
              Enviar ao cliente
            </button>
          </div>
          <p className="send-help">
            “Enviar ao cliente” usa o WhatsApp cadastrado e prepara a mensagem
            com o PDF da OS.
          </p>
        </Modal>
      )}
    </main>
  );
}

function Heading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  alert,
}: {
  icon: string;
  label: string;
  value: string | number;
  alert?: boolean;
}) {
  return (
    <div className={`metric ${alert ? "alert" : ""}`}>
      <div className={`metric-icon ${alert ? "red" : "blue"}`}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
function Card({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="form-card">
      <div className="section-number">{n}</div>
      <div className="form-content">
        <div className="form-title">
          <div>
            <h2>{title}</h2>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Filters({
  query,
  setQuery,
  children,
}: {
  query: string;
  setQuery: (v: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="filters">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar..."
      />
      {children}
    </div>
  );
}
function OrderList({
  orders,
  onOpen,
}: {
  orders: Order[];
  onOpen: (o: Order) => void;
}) {
  return (
    <div className="order-list">
      {!orders.length ? (
        <div className="empty">Nenhuma Ordem de Serviço encontrada.</div>
      ) : (
        orders.map((o) => (
          <button className="order-row" key={o.id} onClick={() => onOpen(o)}>
            <div className="date-box">
              <strong>{brDate(o.deliveryDate)}</strong>
              <span>{o.origin}</span>
            </div>
            <div className="order-main">
              <strong>{o.customerName}</strong>
              <span>
                {o.number} · Emitida em {brDate(o.createdAt)} · {orderCodes(o)}{" "}
                · {money(o.total)}
              </span>
            </div>
            <span className={`status ${statusTone(o.productionStatus)}`}>
              {o.productionStatus}
            </span>
            <span className="arrow">›</span>
          </button>
        ))
      )}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop">
      <div className="customer-modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={close}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
