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
  if (date && (date.includes("T") || date.includes(" "))) {
    const utcValue = date.includes("T") ? date : `${date.replace(" ", "T")}Z`;
    const parsed = new Date(utcValue);
    if (!Number.isNaN(parsed.getTime()))
      return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(parsed);
  }
  const value = date?.slice(0, 10);
  const [y, m, d] = value?.split("-") || [];
  return y && m && d ? `${d}/${m}/${y}` : value || "—";
};
const monthInSaoPaulo = (date: string) => {
  if (!date) return "";
  const utcValue = date.includes("T") ? date : `${date.replace(" ", "T")}Z`;
  const parsed = new Date(utcValue);
  if (Number.isNaN(parsed.getTime())) return date.slice(0, 7);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(parsed);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}`;
};
const toIsoDate = (date: string) => {
  const [d, m, y] = date.split("/");
  return d && m && y ? `${y}-${m}-${d}` : "";
};
const todayIso = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};
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
const formatPhone = (value: string) => maskPhone(value);
const formatDocument = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `CPF: ${maskDoc(digits, "CPF")}`;
  if (digits.length === 14) return `CNPJ: ${maskDoc(digits, "CNPJ")}`;
  return value || "—";
};
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
const orderItemSummary = (order: Order) =>
  getOrderItems(order)
    .map((item) => `${item.code} — ${item.quantity} un.`)
    .join(" | ");
const normalizeCustomerName = (name: string) =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
const findBestCustomer = (list: Customer[], name: string) => {
  const normalized = normalizeCustomerName(name);
  return list
    .filter((customer) => normalizeCustomerName(customer.name) === normalized)
    .sort((a, b) => {
      const score = (customer: Customer) =>
        (customer.document.replace(/\D/g, "").length >= 11 ? 4 : 0) +
        (customer.whatsapp.replace(/\D/g, "").length >= 10 ? 2 : 0) +
        (customer.email.includes("@") ? 1 : 0);
      return score(b) - score(a) || b.id - a.id;
    })[0];
};

export default function Home() {
  const [auth, setAuth] = useState<{ loading: boolean; setupRequired: boolean; user: any; users: any[] }>({ loading: true, setupRequired: false, user: null, users: [] });
  const [authError, setAuthError] = useState("");
  const [authSaving, setAuthSaving] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showTempPassword, setShowTempPassword] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [menu, setMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [lateOnly, setLateOnly] = useState(false);
  const [notice, setNotice] = useState("");
  const [customerModal, setCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [productModal, setProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [reportMonth, setReportMonth] = useState("");
  const [reportCustomer, setReportCustomer] = useState("");
  const [reportPaymentStatus, setReportPaymentStatus] = useState("");
  const [orderModal, setOrderModal] = useState<Order | null>(null);
  const [draftProductionStatus, setDraftProductionStatus] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
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
      const [cat, ord, config] = await Promise.all([
        fetch("/api/catalog").then((r) => r.json()),
        fetch("/api/orders").then((r) => r.json()),
        fetch("/api/settings").then((r) => r.json()),
      ]);
      setCustomers(cat.customers || []);
      setProducts(cat.products || []);
      setOrders(ord.orders || []);
      let settings = config.settings;
      try {
        const localSettings = JSON.parse(localStorage.getItem("pino-settings") || "null");
        if (localSettings) {
          const migrated = await fetch("/api/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(localSettings),
          }).then((response) => response.json());
          settings = migrated.settings || localSettings;
          localStorage.removeItem("pino-settings");
        }
      } catch {}
      if (settings) {
        setCompanyName(settings.companyName);
        setResponsible(settings.responsible);
        setCompanyPhone(settings.companyPhone);
        setOrderFooter(settings.orderFooter);
      }
      if (!selectedCode && cat.products?.[0])
        setSelectedCode(cat.products[0].code);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    fetch("/api/auth").then((r) => r.json()).then((data) => {
      setAuth({ loading: false, setupRequired: !!data.setupRequired, user: data.user || null, users: data.users || [] });
      if (data.user) loadAll(); else setLoading(false);
    }).catch(() => { setAuth((value) => ({ ...value, loading: false })); setLoading(false); });
  }, []);
  useEffect(() => {
    setDraftProductionStatus(orderModal?.productionStatus || "");
  }, [orderModal?.id, orderModal?.productionStatus]);

  async function submitAuth(event: any) {
    event.preventDefault(); setAuthError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    if (auth.setupRequired && !name) return setAuthError("Informe seu nome.");
    if (!email.includes("@")) return setAuthError("Informe um e-mail válido.");
    if (password.length < 8) return setAuthError("A senha precisa ter pelo menos 8 caracteres.");
    if (auth.setupRequired && !/[A-Z]/.test(password)) return setAuthError("A senha precisa ter pelo menos uma letra maiúscula.");
    if (auth.setupRequired && !/\d/.test(password)) return setAuthError("A senha precisa ter pelo menos um número.");
    if (auth.setupRequired && !/[^A-Za-z0-9]/.test(password)) return setAuthError("A senha precisa ter pelo menos um caractere especial.");
    setAuthSaving(true);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: auth.setupRequired ? "setup" : "login", name, email, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setAuthError(data.error || "Não foi possível criar o acesso. Tente novamente.");
      location.reload();
    } catch {
      setAuthError("Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.");
    } finally {
      setAuthSaving(false);
    }
  }

  async function logout() { await fetch("/api/auth", { method: "DELETE" }); location.reload(); }

  async function createUser(event: any) {
    event.preventDefault(); setAuthError("");
    const form = new FormData(event.currentTarget);
    setUserSaving(true);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create-user", name: form.get("name"), email: form.get("email"), password: form.get("password") }) });
      const data = await response.json();
      const refreshed = await fetch("/api/auth").then((r) => r.json());
      setAuth((value) => ({ ...value, users: refreshed.users || [] }));
      if (!response.ok) {
        if (response.status === 409) return setAuthError("Este usuário já está cadastrado e foi atualizado na lista abaixo.");
        return setAuthError(data.error || "Não foi possível cadastrar o usuário.");
      }
      event.currentTarget.reset(); setShowTempPassword(false); flash("Usuário cadastrado com sucesso.");
    } finally {
      setUserSaving(false);
    }
  }
  async function toggleUser(id: number, active: boolean) {
    await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "toggle-user", id, active }) });
    const refreshed = await fetch("/api/auth").then((r) => r.json());
    setAuth((value) => ({ ...value, users: refreshed.users || [] }));
  }
  const product = products.find((p) => p.code === selectedCode) || products[0];
  const total = orderItems.reduce(
    (sum, item) =>
      sum +
      (products.find((p) => p.code === item.code)?.price || 0) * item.quantity,
    0,
  );
  const metrics = useMemo(
    () => ({
      queue: orders.filter((o) =>
        ["Fila de produção", "Aguardando", "Em produção"].includes(o.productionStatus),
      ).length,
      open: orders.filter(
        (o) => !["Entregue", "Cancelada"].includes(o.productionStatus),
      ).length,
      production: orders.filter((o) => o.productionStatus === "Em produção")
        .length,
      delivered: orders.filter((o) => o.productionStatus === "Entregue").length,
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
      (!lateOnly ||
        (o.deliveryDate < todayIso() &&
          !["Entregue", "Cancelada"].includes(o.productionStatus))) &&
      `${o.number} ${o.customerName} ${o.productCode}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const filteredCustomers = customers.filter((c) =>
    `${c.name} ${c.document} ${c.whatsapp}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const reportOrders = orders.filter(
    (o) => {
      const paymentStatus =
        o.received >= o.total
          ? "Pago"
          : o.received > 0
            ? "Pagamento parcial"
            : "Aguardando pagamento";
      return (
        (!reportMonth || monthInSaoPaulo(o.createdAt) === reportMonth) &&
        (!reportCustomer || o.customerName === reportCustomer) &&
        (!reportPaymentStatus || paymentStatus === reportPaymentStatus)
      );
    },
  );
  const reportSales = reportOrders.reduce((sum, o) => sum + o.total, 0);
  const reportReceived = reportOrders.reduce((sum, o) => sum + o.received, 0);
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
              const month = monthInSaoPaulo(o.createdAt);
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
    setLateOnly(false);
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
  function openLateOrders() {
    setLateOnly(true);
    setStatusFilter("Todos");
    setQuery("");
    setScreen("orders");
    window.scrollTo({ top: 0 });
  }
  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(""), 3500);
  }
  async function saveSettings() {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName, responsible, companyPhone, orderFooter }),
    });
    if (!response.ok) return flash("Não foi possível salvar as configurações.");
    flash("Configurações salvas e sincronizadas com sucesso.");
  }
  function updateItem(
    index: number,
    changes: Partial<{ code: string; quantity: number }>,
  ) {
    setOrderItems((items) =>
      items.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    );
  }
  function openCustomer(customer?: Customer) {
    if (customer) {
      setEditingCustomer(customer);
      setCustomerName(customer.name);
      setCustomerEmail(customer.email);
      setPhone(maskPhone(customer.whatsapp));
      const type =
        customer.document.toUpperCase().includes("CNPJ") ||
        customer.document.replace(/\D/g, "").length === 14
          ? "CNPJ"
          : "CPF";
      setDocType(type);
      setDoc(maskDoc(customer.document, type));
    } else {
      setEditingCustomer(null);
      setCustomerName("");
      setCustomerEmail("");
      setPhone("");
      setDocType("CPF");
      setDoc("");
    }
    setCustomerModal(true);
  }

  async function saveCustomer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = new FormData(e.currentTarget);
    try {
      if (!customerName.trim()) throw new Error("Informe o nome do cliente.");
      if (phone.replace(/\D/g, "").length < 10)
        throw new Error("Informe um WhatsApp válido.");
      if (
        doc &&
        doc.replace(/\D/g, "").length !== (docType === "CPF" ? 11 : 14)
      )
        throw new Error(`${docType} incompleto.`);
      const r = await fetch("/api/catalog", {
        method: editingCustomer ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editingCustomer?.id,
          name: customerName,
          whatsapp: phone,
          document: doc ? `${docType}: ${doc}` : "",
          email: customerEmail,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setCustomers((v) =>
        (editingCustomer
          ? v.map((c) => (c.id === j.customer.id ? j.customer : c))
          : [...v, j.customer]
        ).sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSelectedCustomer(j.customer.name);
      setCustomerModal(false);
      setDoc("");
      setPhone("");
      flash(
        editingCustomer
          ? "Cliente atualizado com sucesso."
          : "Cliente cadastrado com sucesso.",
      );
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
      if (
        !String(f.get("code") || "").trim() ||
        !String(f.get("name") || "").trim() ||
        !String(f.get("measure") || "").trim()
      )
        throw new Error("Preencha código, descrição e medida do pino.");
      const r = await fetch("/api/catalog", {
        method: editingProduct ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "product",
          id: editingProduct?.id,
          code: f.get("code"),
          name: f.get("name"),
          measure: f.get("measure"),
          price: parseCurrency(String(f.get("price"))),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setProducts((v) =>
        (editingProduct
          ? v.map((p) => (p.id === j.product.id ? j.product : p))
          : [...v, j.product]
        ).sort((a, b) => a.code.localeCompare(b.code)),
      );
      setProductModal(false);
      setEditingProduct(null);
      flash(editingProduct ? "Pino atualizado com sucesso." : "Pino cadastrado com sucesso.");
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
      if (!selectedCustomer) throw new Error("Selecione um cliente.");
      if (!isValidBrDate(deliveryDate))
        throw new Error("Informe uma data válida no formato dd/mm/aaaa.");
      if (!orderItems.length) throw new Error("Adicione pelo menos um pino.");
      const items = orderItems.map((item) => ({
        ...item,
        unitPrice: products.find((p) => p.code === item.code)?.price || 0,
      }));
      const paymentMethod = String(f.get("paymentMethod") || "Pix");
      const paidOnCreation = ["Pix", "Dinheiro", "Cartão"].includes(paymentMethod);
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
          received: paidOnCreation ? total : paymentMethod === "Boleto" ? 0 : received,
          deliveryType: f.get("deliveryType"),
          paymentMethod,
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
      return false;
    }
    setOrders((v) => v.map((o) => (o.id === id ? j.order : o)));
    setOrderModal(j.order);
    flash("OS atualizada.");
    return true;
  }
  async function saveProductionStatus() {
    if (!orderModal || !draftProductionStatus || draftProductionStatus === orderModal.productionStatus) return;
    setStatusSaving(true);
    try {
      await updateOrder(orderModal.id, { productionStatus: draftProductionStatus });
    } finally {
      setStatusSaving(false);
    }
  }
  async function settleBoleto(order: Order) {
    if (!window.confirm(`Confirmar o recebimento de ${money(order.total)} referente ao boleto da ${order.number}?`)) return;
    let history: { amount: number; method: string; date: string }[] = [];
    try {
      const value = JSON.parse(order.commercialStatus);
      if (Array.isArray(value)) history = value;
    } catch {}
    history.push({ amount: order.total - order.received, method: "Boleto", date: todayIso() });
    await updateOrder(order.id, {
      received: order.total,
      commercialStatus: JSON.stringify(history),
    });
    flash("Pagamento do boleto confirmado.");
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
    const customer = findBestCustomer(customers, order.customerName);
    if (!customer?.whatsapp) return flash("Cliente sem WhatsApp cadastrado.");
    const number = customer.whatsapp.replace(/\D/g, "");
    const text = `Olá, ${customer.name}! A ${order.number} está com o status: ${order.productionStatus}. Previsão: ${brDate(order.deliveryDate)}.`;
    window.open(
      `https://wa.me/55${number}?text=${encodeURIComponent(text)}`,
      "_blank",
    );
  }
  function loadImageData(url: string, grayscale = false) {
    return new Promise<string>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (context) {
          context.drawImage(image, 0, 0);
          if (grayscale) {
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < pixels.data.length; i += 4) {
              const luminance = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
              const color = luminance < 38 ? 255 : 25;
              pixels.data[i] = color;
              pixels.data[i + 1] = color;
              pixels.data[i + 2] = color;
              pixels.data[i + 3] = 255;
            }
            context.putImageData(pixels, 0, 0);
          }
        }
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      image.onerror = () => reject(new Error("Não foi possível carregar a logo."));
      image.src = url;
    });
  }
  async function createPdf(order: Order) {
    const items = getOrderItems(order);
    let currentCustomers = customers;
    try {
      const catalog = await fetch("/api/catalog", { cache: "no-store" }).then((response) => response.json());
      if (Array.isArray(catalog.customers)) {
        currentCustomers = catalog.customers;
        setCustomers(catalog.customers);
      }
    } catch {}
    const customer = findBestCustomer(currentCustomers, order.customerName);
    const pdf = new jsPDF();
    const logo = await loadImageData("/logo-pdf.png", true);
    pdf.setDrawColor(60);
    pdf.setLineWidth(0.35);
    pdf.rect(15, 10, 180, 270);
    pdf.rect(15, 10, 38, 38);
    pdf.rect(53, 10, 105, 38);
    pdf.rect(158, 10, 37, 38);
    pdf.addImage(logo, "JPEG", 17, 12, 34, 34, undefined, "FAST");
    pdf.setTextColor(30);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text("PINOS DE BALANÇA | TRUCK E CARRETA", 57, 22);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Responsável: ${responsible || "—"}`, 57, 32);
    pdf.text(`WhatsApp: ${companyPhone || "—"}`, 57, 40);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("ORDEM DE SERVIÇO", 176.5, 18, { align: "center" });
    pdf.setFontSize(13);
    pdf.text(order.number, 176.5, 29, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.text(`Emissão: ${brDate(order.createdAt)}`, 176.5, 38, { align: "center" });
    pdf.text(`Entrega: ${brDate(order.deliveryDate)}`, 176.5, 44, { align: "center" });

    pdf.rect(15, 48, 180, 31);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text(`Cliente: ${order.customerName}`, 18, 56);
    pdf.setFont("helvetica", "normal");
    pdf.text(`CPF/CNPJ: ${customer ? formatDocument(customer.document).replace(/^(CPF|CNPJ): /, "") : "—"}`, 18, 64);
    pdf.text(`WhatsApp: ${customer ? formatPhone(customer.whatsapp) : "—"}`, 105, 64);
    pdf.text(`E-mail: ${customer?.email || "—"}`, 18, 72);
    pdf.text(`Pagamento: ${order.paymentMethod}`, 105, 72);

    const columns = [15, 39, 118, 135, 162, 195];
    pdf.rect(15, 79, 180, 132);
    pdf.setFillColor(235, 235, 235);
    pdf.rect(15, 79, 180, 10, "F");
    columns.slice(1, -1).forEach((x) => pdf.line(x, 79, x, 211));
    pdf.line(15, 89, 195, 89);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text("CÓDIGO", 18, 86);
    pdf.text("DESCRIÇÃO DO PRODUTO", 42, 86);
    pdf.text("QTD.", 126.5, 86, { align: "center" });
    pdf.text("VALOR UNIT.", 148.5, 86, { align: "center" });
    pdf.text("VALOR TOTAL", 191, 86, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    let y = 97;
    items.forEach((item) => {
      const p = products.find((x) => x.code === item.code);
      pdf.text(item.code, 18, y);
      pdf.text(`${p?.name || "Pino de balança"} (COMUM) · ${p?.measure || ""}`, 42, y, { maxWidth: 72 });
      pdf.text(String(item.quantity), 126.5, y, { align: "center" });
      pdf.text(money(item.unitPrice), 159, y, { align: "right" });
      pdf.text(money(item.unitPrice * item.quantity), 191, y, { align: "right" });
      y += 11;
    });
    pdf.line(15, 201, 195, 201);
    pdf.setFont("helvetica", "bold");
    pdf.text("TOTAL DA ORDEM", 78.5, 208, { align: "center" });
    pdf.text(String(items.reduce((sum, item) => sum + item.quantity, 0)), 126.5, 208, { align: "center" });
    pdf.text(money(order.total), 191, 208, { align: "right" });
    pdf.setFont("helvetica", "normal");

    pdf.rect(15, 211, 180, 28);
    pdf.setFontSize(9);
    pdf.text(`Status: ${order.productionStatus}`, 18, 219);
    pdf.text(`Forma de entrega: ${order.deliveryType}`, 105, 219);
    pdf.text(`Previsão de entrega: ${brDate(order.deliveryDate)}`, 18, 227);
    pdf.text(order.notes ? `Observações: ${order.notes}` : "Observações: —", 18, 235, { maxWidth: 172 });

    pdf.line(24, 250, 88, 250);
    pdf.line(122, 250, 186, 250);
    pdf.setFontSize(9);
    pdf.setTextColor(70);
    pdf.text("Assinatura do cliente", 56, 256, { align: "center" });
    pdf.text(order.customerName, 56, 261, { align: "center" });
    pdf.text("Responsável pela empresa", 154, 256, { align: "center" });
    pdf.text(responsible || "Responsável", 154, 261, { align: "center" });
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    pdf.text(orderFooter, 105, 275, { align: "center" });
    return pdf;
  }
  async function downloadPdf(order: Order) {
    const pdf = await createPdf(order);
    pdf.save(`${order.number}.pdf`);
  }
  async function shareOrder(order: Order) {
    let currentCustomers = customers;
    try {
      const catalog = await fetch("/api/catalog", { cache: "no-store" }).then((response) => response.json());
      if (Array.isArray(catalog.customers)) currentCustomers = catalog.customers;
    } catch {}
    const customer = findBestCustomer(currentCustomers, order.customerName);
    if (!customer?.whatsapp) return flash("Cliente sem WhatsApp cadastrado.");
    const text = `Olá, ${customer.name}! Segue a ${order.number}. Status: ${order.productionStatus}. Previsão: ${brDate(order.deliveryDate)}.`;
    await downloadPdf(order);
    const number = customer.whatsapp.replace(/\D/g, "");
    window.open(
      `https://wa.me/55${number}?text=${encodeURIComponent(text)}`,
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
      ...reportOrders.map((o) => [
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

  if (auth.loading) return <main className="auth-page"><div className="auth-card"><div className="empty">Carregando acesso...</div></div></main>;
  if (!auth.user) return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo"><img src="/logo-sistema.png" alt="Rogério Mendes" /></div>
        <div className="auth-content">
        <h1>Acesso ao sistema</h1>
        <form onSubmit={submitAuth} noValidate>
          {auth.setupRequired && <Field label="Seu nome"><input name="name" required autoFocus placeholder="Nome completo" /></Field>}
          <Field label="E-mail"><input name="email" type="email" required defaultValue={auth.setupRequired ? "tacytpr@gmail.com" : ""} readOnly={auth.setupRequired} autoFocus={!auth.setupRequired} /></Field>
          <Field label={auth.setupRequired ? "Crie uma senha" : "Senha"}><div className="password-input"><input name="password" type={showAuthPassword ? "text" : "password"} minLength={8} required placeholder={auth.setupRequired ? "Maiúscula, número e caractere especial" : "Digite sua senha"} /><button type="button" onClick={() => setShowAuthPassword((value) => !value)} aria-label={showAuthPassword ? "Ocultar senha" : "Mostrar senha"}><EyeIcon open={showAuthPassword} /></button></div></Field>
          {authError && <p className="modal-error">{authError}</p>}
          <button className="primary-button" type="submit" disabled={authSaving}>{authSaving ? (auth.setupRequired ? "Criando acesso..." : "Entrando...") : (auth.setupRequired ? "Criar acesso e entrar" : "Entrar")}</button>
        </form>
        </div>
      </section>
    </main>
  );

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
          <img className="brand-logo" src="/logo-sistema.png" alt="Rogério Mendes — Pinos de Balança" />
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
              <strong>{auth.user.name}</strong>
              <span>{auth.user.role === "admin" ? "Administrador" : "Usuário"}</span>
            </div>
          </div>
          <button className="logout-button" onClick={logout}>Sair</button>
        </div>
      </aside>
      <section className="workspace">
        <header className="mobile-header">
          <button onClick={() => setMenu(!menu)}>☰</button>
          <img className="mobile-header-logo" src="/logo-sistema.png" alt="Rogério Mendes" />
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
                    label="Fila de produção"
                    value={metrics.queue}
                  />
                  <Metric
                    icon="⚒"
                    label="Em produção"
                    value={metrics.production}
                  />
                  <Metric icon="✓" label="Entregues" value={metrics.delivered} />
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
                    <div className="panel finance finance-card">
                      <div className="finance-main">
                        <span>Vendas registradas</span>
                        <strong>{money(metrics.sales)}</strong>
                        <small>Total das Ordens de Serviço</small>
                      </div>
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
                    <div
                      className={`panel attention deadline-card ${metrics.late ? "has-alert" : "is-ok"}`}
                    >
                      <div className="deadline-icon">
                        {metrics.late ? "!" : "✓"}
                      </div>
                      <div>
                        <h2>
                          {metrics.late ? "Atenção aos prazos" : "Tudo em dia"}
                        </h2>
                        <p>
                          {metrics.late
                            ? `${metrics.late} ${metrics.late === 1 ? "ordem está atrasada" : "ordens estão atrasadas"}. Consulte a lista para priorizar a produção.`
                            : "Nenhuma ordem está atrasada no momento."}
                        </p>
                        {metrics.late > 0 && (
                          <button onClick={openLateOrders}>
                            Ver ordens atrasadas →
                          </button>
                        )}
                      </div>
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
                <form onSubmit={saveOrder} noValidate>
                  <Card n="1" title="Cliente">
                    <div className="form-title">
                      <span></span>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => openCustomer()}
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
                    <div className="form-grid service-grid">
                      <Field label="Data do pedido">
                        <input
                          value={brDate(todayIso())}
                          readOnly
                          aria-readonly="true"
                        />
                      </Field>
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
                                inputMode="numeric"
                                min="1"
                                value={item.quantity || ""}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) =>
                                  updateItem(index, {
                                    quantity:
                                      e.target.value === ""
                                        ? 0
                                        : Math.max(0, Number(e.target.value)),
                                  })
                                }
                                onBlur={() => {
                                  if (item.quantity < 1)
                                    updateItem(index, { quantity: 1 });
                                }}
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
                      "Fila de produção",
                      "Em produção",
                      "Pronta",
                      "Entregue",
                      "Cancelada",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Filters>
                {lateOnly && (
                  <div className="active-filter">
                    <span>Exibindo somente ordens atrasadas</span>
                    <button onClick={() => setLateOnly(false)}>Mostrar todas</button>
                  </div>
                )}
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
                      onClick={() => openCustomer()}
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
                          <td>{formatDocument(c.document)}</td>
                          <td>{formatPhone(c.whatsapp)}</td>
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
                              onClick={() => openCustomer(c)}
                            >
                              Editar
                            </button>
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
                      onClick={() => { setEditingProduct(null); setProductModal(true); }}
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
                              onClick={() => { setEditingProduct(p); setProductModal(true); }}
                            >
                              Editar
                            </button>
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
                                let laterPayments: { amount: number; method: string; date: string }[] = [];
                                try {
                                  const value = JSON.parse(o.commercialStatus);
                                  laterPayments = Array.isArray(value) ? value : [];
                                } catch {}
                                const laterTotal = laterPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
                                const initialPayment = Math.max(0, o.received - laterTotal);
                                return [
                                  ...(initialPayment > 0 ? [{ amount: initialPayment, method: "Pagamento inicial", date: o.createdAt }] : []),
                                  ...laterPayments,
                                ];
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
                                    <span>
                                      Ordens: <b>{item.orders.length} OS</b>
                                    </span>
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
                <div className="filters report-filters">
                  <label className="field">
                    <span>Mês</span>
                    <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Cliente</span>
                    <select value={reportCustomer} onChange={(e) => setReportCustomer(e.target.value)}>
                      <option value="">Todos os clientes</option>
                      {customers.map((customer) => <option key={customer.id} value={customer.name}>{customer.name}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Status do pagamento</span>
                    <select value={reportPaymentStatus} onChange={(e) => setReportPaymentStatus(e.target.value)}>
                      <option value="">Todos os status</option>
                      <option>Pago</option>
                      <option>Pagamento parcial</option>
                      <option>Aguardando pagamento</option>
                    </select>
                  </label>
                  {(reportMonth || reportCustomer || reportPaymentStatus) && <button className="outline-button" onClick={() => { setReportMonth(""); setReportCustomer(""); setReportPaymentStatus(""); }}>Limpar filtros</button>}
                </div>
                <section className="metrics report-metrics">
                  <Metric
                    icon="R$"
                    label="Vendas"
                    value={money(reportSales)}
                  />
                  <Metric
                    icon="✓"
                    label="Recebido"
                    value={money(reportReceived)}
                  />
                  <Metric
                    icon="…"
                    label="Pendente"
                    value={money(reportSales - reportReceived)}
                  />
                </section>
                <div className="panel report-bars">
                  {products.map((p) => {
                    const count = reportOrders
                      .reduce((s, o) => s + getOrderItems(o).filter((item) => item.code === p.code).reduce((n, item) => n + item.quantity, 0), 0);
                    const max = Math.max(
                      1,
                      ...products.map((x) =>
                        reportOrders.reduce((s, o) => s + getOrderItems(o).filter((item) => item.code === x.code).reduce((n, item) => n + item.quantity, 0), 0),
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
                {auth.user.role === "admin" && <div className="panel user-admin">
                  <div className="panel-title"><div><h2>Usuários do sistema</h2><p>Cadastre uma senha temporária e entregue-a diretamente à pessoa.</p></div></div>
                  <form className="user-create" onSubmit={createUser}>
                    <Field label="Nome"><input name="name" required placeholder="Nome da pessoa" /></Field>
                    <Field label="E-mail"><input name="email" type="email" required autoComplete="off" placeholder="E-mail da pessoa" /></Field>
                    <Field label="Senha temporária"><div className="password-input"><input name="password" type={showTempPassword ? "text" : "password"} minLength={8} required placeholder="Maiúscula, número e caractere especial" /><button type="button" onClick={() => setShowTempPassword((value) => !value)} aria-label={showTempPassword ? "Ocultar senha" : "Mostrar senha"}><EyeIcon open={showTempPassword} /></button></div></Field>
                    <button className="primary-button" disabled={userSaving}>{userSaving ? "Cadastrando..." : "Cadastrar usuário"}</button>
                  </form>
                  {authError && <p className="modal-error user-error">{authError}</p>}
                  <div className="user-list">{auth.users.map((user) => <div key={user.id}><span><b>{user.name}</b><small>{user.email} · {user.role === "admin" ? "Administrador" : "Usuário"}</small></span>{user.role !== "admin" && <button className="link-button" onClick={() => toggleUser(user.id, !user.active)}>{user.active ? "Bloquear" : "Ativar"}</button>}</div>)}</div>
                </div>}
              </div>
            )}
          </>
        )}
      </section>
      {menu && <button className="overlay" onClick={() => setMenu(false)} />}
      {customerModal && (
        <Modal
          title={editingCustomer ? "Editar cliente" : "Cadastrar cliente"}
          close={() => setCustomerModal(false)}
        >
          <form onSubmit={saveCustomer} noValidate>
            <Field label="Nome ou razão social *">
              <input
                name="name"
                required
                autoFocus
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
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
              <input
                name="email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
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
                {editingCustomer ? "Salvar alterações" : "Salvar cliente"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {productModal && (
        <Modal title={editingProduct ? "Editar pino" : "Cadastrar pino"} close={() => { setProductModal(false); setEditingProduct(null); }}>
          <form onSubmit={saveProduct} noValidate>
            <div className="form-grid">
              <Field label="Código *">
                <input name="code" required placeholder="Ex.: RN 250" defaultValue={editingProduct?.code || ""} />
              </Field>
              <Field label="Medida *">
                <input name="measure" required placeholder="Ex.: 250 mm" defaultValue={editingProduct?.measure || ""} />
              </Field>
            </div>
            <Field label="Descrição *">
              <input name="name" required placeholder="Pino de balança..." defaultValue={editingProduct?.name || ""} />
            </Field>
            <Field label="Preço *">
              <input
                name="price"
                required
                inputMode="numeric"
                defaultValue={editingProduct ? money(editingProduct.price) : "R$ 0,00"}
                onChange={(e) => {
                  e.currentTarget.value = maskCurrency(e.currentTarget.value);
                }}
              />
            </Field>
            <div className="modal-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => { setProductModal(false); setEditingProduct(null); }}
              >
                Cancelar
              </button>
              <button className="primary-button" disabled={saving}>
                {editingProduct ? "Salvar alterações" : "Salvar pino"}
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
                {orderItemSummary(orderModal)}
              </b>
            </div>
            <div>
              <span>Forma de pagamento</span>
              <b>
                {orderModal.paymentMethod}
                {orderModal.received >= orderModal.total
                  ? " · Pago"
                  : orderModal.received > 0
                    ? " · Pagamento parcial"
                    : " · Aguardando pagamento"}
              </b>
            </div>
            <div>
              <span>Valor total</span>
              <b>{money(orderModal.total)}</b>
            </div>
            {orderModal.received > 0 && orderModal.received < orderModal.total && (
              <>
                <div>
                  <span>Valor recebido</span>
                  <b>{money(orderModal.received)}</b>
                </div>
                <div>
                  <span>Saldo devedor</span>
                  <b>{money(orderModal.total - orderModal.received)}</b>
                </div>
              </>
            )}
          </div>
          <div className="order-management">
            <div className="status-only">
              <Field label="Status da produção">
                <select
                  value={draftProductionStatus}
                  onChange={(e) => setDraftProductionStatus(e.target.value)}
                >
                  {["Fila de produção", "Em produção", "Pronta", "Entregue", "Cancelada"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              {draftProductionStatus !== orderModal.productionStatus && <span className="unsaved-status">Alteração não salva</span>}
            </div>
            <button
              className="save-status-button"
              onClick={saveProductionStatus}
              disabled={statusSaving || draftProductionStatus === orderModal.productionStatus}
            >
              {statusSaving ? "Salvando..." : "Salvar status"}
            </button>
            {orderModal.paymentMethod === "Boleto" && orderModal.received < orderModal.total && (
              <button className="boleto-pay" onClick={() => settleBoleto(orderModal)}>
                ✓ Confirmar pagamento
              </button>
            )}
          </div>
          <div className="detail-actions document-actions">
            <button
              className="outline-button"
              onClick={() => downloadPdf(orderModal)}
            >
              Baixar PDF
            </button>
            <button
              className="whatsapp-button"
              onClick={() => shareOrder(orderModal)}
              disabled={draftProductionStatus !== orderModal.productionStatus}
            >
              Enviar ao cliente
            </button>
          </div>
          <p className="send-help">
            {draftProductionStatus !== orderModal.productionStatus
              ? "Salve a alteração de status para liberar o envio ao cliente. O PDF usa sempre o último status salvo."
              : "“Enviar ao cliente” baixa o PDF e abre diretamente o WhatsApp cadastrado do cliente."}
          </p>
        </Modal>
      )}
    </main>
  );
}

function Heading({
  title,
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
        <h1>{title}</h1>
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
function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4 20 20" />}
    </svg>
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
                {o.number} · Emitida em {brDate(o.createdAt)} · {orderItemSummary(o)}{" "}
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
