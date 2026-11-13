"use client";
import { BrandImage } from "./brand-image";
import type { PieceLine } from "../lib/piece-lines";
import { ORDER_STATUS, canGenerateOrderPdf, isQueuedWithoutPayment, normalizeOrderStatus } from "../lib/order-status";
import { BOLETO_STEP_DAYS, BOLETO_TERMS, installmentCount, planInstallments, splitCents } from "../lib/boleto-installments";

import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { jsPDF } from "jspdf";
import { ProductImageInput } from "./catalogo/product-image-input";
import { CatalogImage } from "./catalogo/catalog-image";
import { productImageSource } from "../lib/product-images";
import { loadCatalogImage } from "../lib/catalog-image";
import { fetchCatalogProducts, notifyCatalogUpdate, watchCatalogUpdates } from "../lib/catalog-sync";
import { catalogPdfDetails, drawCatalogPdfDetails } from "../lib/catalog-product-pdf";
import type { PieceType } from "../lib/piece-types";
import { activePeriod, allocateSpent, fabricationCategoryIds, leftSentence, periodMonth, plainResult, preferredFabricationCategoryId, splitPaidExpenses, type FinancePeriod } from "../lib/finance-plain";
import { STOCK_STATUS_LABEL, paceSentence, stockPosition, stockTotals, type StockKind, type StockMovement } from "../lib/stock";
import { priceChangeLabel, priceTimeline, type ProductPrice } from "../lib/product-prices";
import { NO_BATCH, allocateBatches, batchStudy, lockedBatchProducts, type PurchaseBatch } from "../lib/purchase-batches";
import { buildDashboardActions, forecastAhead, previousLabel, tightSentence, type DashboardAction } from "../lib/dashboard";
import { DEFAULT_TARGET_PROFIT_RATE, adjustPrice, parsePercent, priceForMargin, simulatePrice, sourceComparison, targetRateOf, type SourceSimulation } from "../lib/pricing";
import { costAt, costOfSourceAt, costSourceOf, normalizePieceCode, openCost, profitOnCost, summarizeSalesProfit, totalCostCents, costUseAt, latestCostUse, type CostUse, type ProductCost } from "../lib/product-costs";
import { countLabel, openHint, payableKpis, wholePercent } from "../lib/payable-kpis";
import { barHeights, cashForecast, dedupeReceipts, distributeCents, divergingBars, forecastCurrentMonth, monthlyCash, monthlyResult, shortMonth } from "../lib/finance-monthly";

type Screen =
  | "dashboard"
  | "new-order"
  | "orders"
  | "stock"
  | "customers"
  | "products"
  | "piece-types"
  | "piece-lines"
  | "catalog"
  | "financial"
  | "financial-monthly"
  | "financial-cash"
  | "financial-payables"
  | "financial-pricing"
  | "financial-batches"
  | "wallet"
  | "reports"
  | "settings";
type SettingsSection =
  | "customers"
  | "products"
  | "piece-types"
  | "piece-lines"
  | "company"
  | "users";
type Customer = {
  id: number;
  name: string;
  document: string;
  whatsapp: string;
  email: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  customerType: string;
  active: boolean;
  createdAt: string;
};
const boletoLabel = (order: { paymentMethod: string; boletoTermDays?: number | null }) => {
  if (order.paymentMethod !== "Boleto" || !order.boletoTermDays) return order.paymentMethod;
  const count = installmentCount(order.boletoTermDays);
  const days = Array.from({ length: count }, (_, index) => BOLETO_STEP_DAYS * (index + 1)).join("/");
  return `Boleto ${count}x (${days} dias)`;
};
type Product = {
  imageData?: string | null;
  id: number;
  code: string;
  sku: string;
  pieceType: string;
  lineName?: string | null;
  name: string;
  measure: string;
  price: number;
  active: boolean;
};
type Order = {
  id: number;
  number: string;
  customerName: string;
  customerType: string;
  origin: string;
  productCode: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discountRate: number;
  total: number;
  received: number;
  deliveryDate: string;
  deliveryType: string;
  paymentMethod: string;
  walletMonth: string;
  productionStatus: string;
  commercialStatus: string;
  notes: string;
  createdAt: string;
  boletoTermDays?: number | null;
};
type FinanceSummary = {
  month: string;
  receivableOpenCents: number;
  receivableOverdueCents: number;
  receivableReceivedCents: number;
  payableOpenCents: number;
  payableOverdueCents: number;
  payablePaidCents: number;
  cashInCents: number;
  cashOutCents: number;
  cashNetCents: number;
};
type AccountReceivable = {
  id: number;
  serviceOrderId: number;
  customerId: number | null;
  issuedAt: string;
  dueDate: string;
  originalAmountCents: number;
  receivedAmountCents: number;
  balanceCents: number;
  status: string;
  notes: string;
};
type ReceivableInstallment = {
  id: number;
  accountReceivableId: number;
  serviceOrderId: number;
  number: number;
  totalInstallments: number;
  dueDate: string;
  amountCents: number;
  receivedCents: number;
  balanceCents: number;
  status: string;
};
type FinanceCategory = { id: number; name: string; type: string; active: boolean };
type AccountPayable = {
  id: number;
  serviceOrderId?: number | null;
  categoryId?: number | null;
  supplier: string;
  description: string;
  dueDate: string;
  purchaseDate?: string | null;
  amountCents: number;
  paidAt: string | null;
  paymentMethod: string;
  notes: string;
  status: string;
};
type Receipt = {
  id: number;
  accountReceivableId: number;
  serviceOrderId: number;
  receiptDate: string;
  amountCents: number;
  paymentMethod: string;
  notes: string;
  status: string;
  legacySourceKey?: string | null;
};
type CashMovement = {
  id: number;
  type: string;
  movementDate: string;
  amountCents: number;
  paymentMethod: string;
  description: string;
  status: string;
};
type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt?: string;
};
type FinanceData = {
  historyTruncated: boolean;
  summary: FinanceSummary | null;
  categories: FinanceCategory[];
  accountsReceivable: AccountReceivable[];
  receivableInstallments: ReceivableInstallment[];
  accountsPayable: AccountPayable[];
  receipts: Receipt[];
  cashMovements: CashMovement[];
};
type WalletEntry = {
  receivable: AccountReceivable;
  order?: Order;
  orderNumber: string;
  issuedAt: string;
  total: number;
  received: number;
  balance: number;
};

const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const isDistributor = (customerType?: string) =>
  customerType?.trim().toLocaleLowerCase("pt-BR") === "distribuidor";
// Peça zerada: nada em estoque e nada prometido na fila.
const isEmptyStock = (row?: { balance: number | null; reserved: number }) => (row?.balance ?? 0) <= 0 && (row?.reserved ?? 0) === 0;

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
const dateTimestamp = (date: string) => {
  if (!date) return 0;
  const brMatch = date.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const normalized = brMatch
    ? `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}T12:00:00`
    : date.includes("T")
      ? date
      : `${date.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};
const compareOrdersDesc = (a: Order, b: Order) =>
  b.number.localeCompare(a.number, "pt-BR", { numeric: true }) ||
  dateTimestamp(b.createdAt) - dateTimestamp(a.createdAt) ||
  b.id - a.id;
const sortOrdersDesc = (list: Order[]) => list.slice().sort(compareOrdersDesc);
const paymentObservationFor = (order: Order, receipts: Receipt[] = []) => {
  const confirmedReceipts = receipts
    .filter(
      (receipt) =>
        receipt.serviceOrderId === order.id && receipt.status === "Confirmado",
    )
    .map((receipt) => ({
      amount: receipt.amountCents / 100,
      method: receipt.paymentMethod,
      date: receipt.receiptDate,
    }))
    .sort((a, b) => dateTimestamp(b.date) - dateTimestamp(a.date));
  if (confirmedReceipts.length)
    return confirmedReceipts
      .map(
        (payment) =>
          `Pago ${money(payment.amount)} em ${brDate(payment.date)} via ${payment.method}`,
      )
      .join("\n");
  if (order.paymentMethod !== "Carteira") return "";
  let registeredPayments: { amount: number; method: string; date: string }[] = [];
  try {
    const parsed = JSON.parse(order.commercialStatus);
    if (Array.isArray(parsed)) registeredPayments = parsed;
  } catch {}
  const registeredTotal = registeredPayments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0,
  );
  const initialPayment = Math.max(0, order.received - registeredTotal);
  const paymentHistory = [
    ...(initialPayment > 0
      ? [
          {
            amount: initialPayment,
            method: `Pagamento inicial · ${order.paymentMethod}`,
            date: order.createdAt,
          },
        ]
      : []),
    ...registeredPayments,
  ]
    .filter((payment) => Number(payment.amount || 0) > 0)
    .sort((a, b) => dateTimestamp(b.date) - dateTimestamp(a.date));
  if (!paymentHistory.length) return "";
  return paymentHistory
    .map(
      (payment) =>
        `Pago ${money(Number(payment.amount))} em ${brDate(payment.date)} via ${payment.method.replace("Pagamento inicial · ", "")}`,
    )
    .join("\n");
};
const completeOrderNotes = (
  order: Order,
  separator = "\n",
  receipts: Receipt[] = [],
) =>
  [order.notes, paymentObservationFor(order, receipts)]
    .filter(Boolean)
    .join(separator);
// Dia (AAAA-MM-DD) no fuso de São Paulo, o mesmo usado para o mês da venda.
const dayInSaoPaulo = (date: string) => {
  if (!date || /^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "";
  const utcValue = date.includes("T") ? date : `${date.replace(" ", "T")}Z`;
  const parsed = new Date(utcValue);
  if (Number.isNaN(parsed.getTime())) return date.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
};
// Mês em que a conta pesa no resultado: o do pagamento, quando paga; senão, o do vencimento.
const payableMonth = (payable: { status: string; paidAt: string | null; dueDate: string }) =>
  ((payable.status === "Pago" && payable.paidAt) || payable.dueDate).slice(0, 7);
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
const monthLabel = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const monthYearLabel = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return `${String(monthNumber).padStart(2, "0")}/${year}`;
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
const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  const area = digits.slice(0, 2);
  const number = digits.slice(2);
  const split = number.length <= 8 ? 4 : 5;
  return `(${area}) ${number.slice(0, split)}${number.length > split ? `-${number.slice(split)}` : ""}`;
};
const formatPhone = (value: string) => maskPhone(value);
const maskZipCode = (value: string) => value.replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
const formatDocument = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `CPF: ${maskDoc(digits, "CPF")}`;
  if (digits.length === 14) return `CNPJ: ${maskDoc(digits, "CNPJ")}`;
  return value || "—";
};
const paymentStatus = (order: Order) =>
  order.productionStatus === "Cancelada"
    ? "Cancelada"
    : isQueuedWithoutPayment(order)
    ? "Na fila"
    : order.received >= order.total
    ? "Pago"
    : order.received > 0
      ? "Pagamento parcial"
      : "Em aberto";
const paymentTone = (order: Order) =>
  order.productionStatus === "Cancelada"
    ? "red"
    : isQueuedWithoutPayment(order)
    ? "blue"
    : order.received >= order.total ? "green" : order.received > 0 ? "blue" : "amber";
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
const orderItemSummary = (order: Order) =>
  getOrderItems(order)
    .map((item) => `${item.code} — ${item.quantity} un.`)
    .join(" | ");
const pieceLabel = (product?: Product, fallbackCode = "") => {
  const type = product?.pieceType || "Peça";
  const description = product?.name || fallbackCode;
  return [type, description].filter(Boolean).join(" · ");
};
const normalizeCustomerName = (name: string) =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
const userInitials = (name: string) => {
  const names = name.trim().split(/\s+/).filter(Boolean);
  return names.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—";
};
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
  const [auth, setAuth] = useState<{ loading: boolean; setupRequired: boolean; user: AuthUser | null; users: AuthUser[] }>({ loading: true, setupRequired: false, user: null, users: [] });
  const [authError, setAuthError] = useState("");
  const [authSaving, setAuthSaving] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showTempPassword, setShowTempPassword] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [menu, setMenu] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [financeCollapsed, setFinanceCollapsed] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("company");
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productCosts, setProductCosts] = useState<ProductCost[]>([]);
  const [productPrices, setProductPrices] = useState<ProductPrice[]>([]);
  const [productCostUses, setProductCostUses] = useState<CostUse[]>([]);
  // Rascunho do "Custo em uso" enquanto a peça está aberta para edição (key = peça em edição).
  const [costUseDraft, setCostUseDraft] = useState<{ key: string; source: "comprada" | "fabricada"; startsAt: string } | null>(null);
  const [targetRate, setTargetRate] = useState(DEFAULT_TARGET_PROFIT_RATE);
  const [targetInput, setTargetInput] = useState("");
  const [pricingProduct, setPricingProduct] = useState<Product | null>(null);
  const [simPrice, setSimPrice] = useState("");
  const [simMargin, setSimMargin] = useState("");
  const [bulkPercent, setBulkPercent] = useState("");
  const [bulkNinety, setBulkNinety] = useState(true);
  const [bulkType, setBulkType] = useState("");
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [stockError, setStockError] = useState("");
  const [purchaseBatches, setPurchaseBatches] = useState<PurchaseBatch[]>([]);
  const [viewingBatchId, setViewingBatchId] = useState<number | null>(null);
  // Lote em lançamento (id null) ou em edição.
  const [batchForm, setBatchForm] = useState<{ id: number | null } | null>(null);
  const [stockForm, setStockForm] = useState<{ product: Product; kind: StockKind } | null>(null);
  const [pieceTypes, setPieceTypes] = useState<PieceType[]>([]);
  const [typeModal, setTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<PieceType | null>(null);
  const [viewingType, setViewingType] = useState<PieceType | null>(null);
  const [typeSaving, setTypeSaving] = useState(false);
  const [pieceLines, setPieceLines] = useState<PieceLine[]>([]);
  const [lineModal, setLineModal] = useState(false);
  const [editingLine, setEditingLine] = useState<PieceLine | null>(null);
  const [viewingLine, setViewingLine] = useState<PieceLine | null>(null);
  const [lineSaving, setLineSaving] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("Todos");
  const [orderMonthFilter, setOrderMonthFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("Todos");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("Todos");
  const [orderPage, setOrderPage] = useState(1);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" | "warning" | "info" } | null>(null);
  const [customerModal, setCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [street, setStreet] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [zipLoading, setZipLoading] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [reportMonth, setReportMonth] = useState("");
  const [reportCustomer, setReportCustomer] = useState("");
  const [reportPaymentStatus, setReportPaymentStatus] = useState("");
  const financialMonth = reportMonth;
  const [financeData, setFinanceData] = useState<FinanceData>({
    historyTruncated: false,
    summary: null,
    categories: [],
    accountsReceivable: [],
    receivableInstallments: [],
    accountsPayable: [],
    receipts: [],
    cashMovements: [],
  });
  const [, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState("");
  const [payableModal, setPayableModal] = useState(false);
  const [payableStatus, setPayableStatus] = useState("Pendente");
  const [editingPayable, setEditingPayable] = useState<AccountPayable | null>(null);
  const [walletQuery, setWalletQuery] = useState("");
  const [walletStatusFilter, setWalletStatusFilter] = useState("");
  const [dashboardMonth] = useState(todayIso().slice(0, 7));
  const [orderModal, setOrderModal] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editOrderReturnTo, setEditOrderReturnTo] = useState<"orders" | "review">("review");
  const [walletPayment, setWalletPayment] = useState<{
    items: WalletEntry[];
    customer: string;
  } | null>(null);
  const [walletPayMethod, setWalletPayMethod] = useState("");
  const [walletPayDate, setWalletPayDate] = useState("");
  const [walletPayAmount, setWalletPayAmount] = useState(0);
  const [docType, setDocType] = useState<"CPF" | "CNPJ">("CPF");
  const [doc, setDoc] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyName, setCompanyName] = useState("Pino Forte");
  const [responsible, setResponsible] = useState("Rogério Mendes");
  const [orderFooter, setOrderFooter] = useState(
    "Documento gerado pelo sistema Pino Forte",
  );
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedOrderCustomerType, setSelectedOrderCustomerType] = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [received, setReceived] = useState(0);
  const [selectedDeliveryType, setSelectedDeliveryType] = useState("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [selectedBoletoTerm, setSelectedBoletoTerm] = useState("");
  const [selectedOrderStatus, setSelectedOrderStatus] = useState<string>(ORDER_STATUS.queue);
  const [discountOverride, setDiscountOverride] = useState("");
  const [orderItems, setOrderItems] = useState<
    { code: string; quantity: number; unitPrice?: number }[]
  >([]);

  async function refreshFinance(month = financialMonth) {
    setFinanceLoading(true);
    setFinanceError("");
    try {
      const response = await fetch(`/api/finance?month=${encodeURIComponent(month || todayIso().slice(0, 7))}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Nao foi possivel carregar o financeiro.");
      setFinanceData({
        historyTruncated: Boolean(data.historyTruncated),
        summary: data.summary || null,
        categories: data.categories || [],
        accountsReceivable: data.accountsReceivable || [],
        receivableInstallments: data.receivableInstallments || [],
        accountsPayable: data.accountsPayable || [],
        receipts: data.receipts || [],
        cashMovements: data.cashMovements || [],
      });
    } catch (error) {
      setFinanceError(error instanceof Error ? error.message : "Nao foi possivel carregar o financeiro.");
    } finally {
      setFinanceLoading(false);
    }
  }

  async function refreshStock() {
    try {
      const response = await fetch("/api/stock", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar o estoque.");
      setStockMovements(data.movements || []);
      setPurchaseBatches(data.batches || []);
      setStockError("");
    } catch (error) {
      setStockError(error instanceof Error ? error.message : "Não foi possível carregar o estoque.");
    }
  }
  async function saveStockMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stockForm) return;
    const form = new FormData(event.currentTarget);
    const quantity = Number(String(form.get("quantity") || "").trim());
    if (!Number.isInteger(quantity) || quantity < 0) return flash("Informe a quantidade em número inteiro.", "error");
    setSaving(true);
    try {
      const response = await fetch("/api/stock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: stockForm.product.id,
          kind: String(form.get("kind") || stockForm.kind),
          quantity,
          movementDate: String(form.get("movementDate") || todayIso()),
          notes: String(form.get("notes") || ""),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o lançamento.");
      setStockForm(null);
      await refreshStock();
      flash("Estoque atualizado.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Não foi possível salvar o lançamento.", "error");
    } finally {
      setSaving(false);
    }
  }
  // Lança um lote novo ou grava a edição: só entram as peças com quantidade.
  async function saveBatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batchForm) return;
    const form = new FormData(event.currentTarget);
    const items = products.flatMap((product) => {
      const quantity = Number(String(form.get(`batchQty-${product.id}`) || "").trim() || 0);
      return quantity > 0
        ? [{ productId: product.id, quantity, unitCostCents: Math.round(parseCurrency(String(form.get(`batchCost-${product.id}`) || "")) * 100) }]
        : [];
    });
    setSaving(true);
    try {
      const response = await fetch("/api/stock", {
        method: batchForm.id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "batch",
          id: batchForm.id ?? undefined,
          supplier: form.get("batchSupplier"),
          purchaseDate: form.get("batchDate"),
          notes: form.get("batchNotes"),
          items,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o lote.");
      setStockMovements(data.movements || []);
      setPurchaseBatches(data.batches || []);
      setBatchForm(null);
      flash(batchForm.id ? "Lote atualizado." : "Lote lançado. As peças já entraram no estoque.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Não foi possível salvar o lote.", "error");
    } finally {
      setSaving(false);
    }
  }
  async function deleteBatch(batch: PurchaseBatch) {
    if (!window.confirm(`Excluir o lote ${batch.supplier} de ${brDate(batch.purchaseDate)}? As peças dele saem do estoque. As vendas e as contas a pagar não são alteradas.`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/stock", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batchId: batch.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível excluir o lote.");
      setStockMovements(data.movements || []);
      setPurchaseBatches(data.batches || []);
      setViewingBatchId(null);
      flash("Lote excluído.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Não foi possível excluir o lote.", "error");
    } finally {
      setSaving(false);
    }
  }
  async function loadAll() {
    setLoading(true);
    try {
      const [cat, ord, config] = await Promise.all([
        fetch("/api/catalog", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/orders").then((r) => r.json()),
        fetch("/api/settings").then((r) => r.json()),
      ]);
      setCustomers(cat.customers || []);
      setProducts(cat.products || []);
      setProductCosts(cat.productCosts || []);
      setProductPrices(cat.productPrices || []);
      setProductCostUses(cat.productCostUses || []);
      setPieceTypes(cat.pieceTypes || []); setPieceLines(cat.pieceLines || []);
      setOrders(sortOrdersDesc(ord.orders || []));
      await refreshFinance();
      void refreshStock();
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
        setResponsible(settings.responsible || "Rogerio Mendes");
        setCompanyPhone(settings.companyPhone);
        setOrderFooter(settings.orderFooter);
        setTargetRate(targetRateOf(settings.targetProfitRate));
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
    if (!auth.user) return;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch("/api/catalog", { cache: "no-store", signal: request.signal });
        const data = await response.json();
        if (response.ok && Array.isArray(data.products) && !request.signal.aborted) {
          setProducts(data.products);
          if (Array.isArray(data.productCosts)) setProductCosts(data.productCosts);
          if (Array.isArray(data.productPrices)) setProductPrices(data.productPrices);
          if (Array.isArray(data.productCostUses)) setProductCostUses(data.productCostUses);
          if (Array.isArray(data.pieceTypes)) setPieceTypes(data.pieceTypes); if (Array.isArray(data.pieceLines)) setPieceLines(data.pieceLines);
        }
      } catch { /* Keep the last confirmed data; exports require a fresh successful read. */ }
    };
    const stop = watchCatalogUpdates(() => { void refresh(); });
    return () => { stop(); controller?.abort(); };
  }, [auth.user]);
  useEffect(() => {
    if (!auth.user) return;
    const id = window.setTimeout(() => {
      void refreshFinance(financialMonth);
    }, 0);
    return () => window.clearTimeout(id);
  }, [financialMonth, auth.user]);
  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
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
      if (!response.ok) {
        return setAuthError(
          data.error ||
            (auth.setupRequired
              ? "Não foi possível criar o acesso. Tente novamente."
              : "Não foi possível entrar. Verifique o e-mail e a senha."),
        );
      }
      location.reload();
    } catch {
      setAuthError("Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.");
    } finally {
      setAuthSaving(false);
    }
  }

  async function logout() { await fetch("/api/auth", { method: "DELETE" }); location.reload(); }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
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
  const itemUnitPrice = (item: { code: string; unitPrice?: number }) =>
    item.unitPrice ?? products.find((p) => p.code === item.code)?.price ?? 0;
  const subtotal = orderItems.reduce(
    (sum, item) => sum + itemUnitPrice(item) * item.quantity,
    0,
  );
  const totalQuantity = orderItems.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
  const normalizedSelectedCustomer = selectedCustomer.trim().toLocaleLowerCase("pt-BR");
  const orderCustomer =
    customers.find((customer) => String(customer.id) === selectedCustomerId) ||
    customers.find(
      (customer) =>
        customer.name.trim().toLocaleLowerCase("pt-BR") === normalizedSelectedCustomer,
    );
  const automaticDiscountRate =
    isDistributor(orderCustomer?.customerType || selectedOrderCustomerType)
      ? totalQuantity >= 20
        ? 10
        : totalQuantity >= 10
          ? 8
          : 5
      : 0;
  const explicitDiscountRate =
    discountOverride.trim() === "" ? null : Number(discountOverride);
  const discountRate =
    explicitDiscountRate !== null && Number.isFinite(explicitDiscountRate)
      ? explicitDiscountRate
      : automaticDiscountRate;
  const discountAmount = subtotal * discountRate / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;
  // Em "Fila de produção" o formulário tem só cliente, peças, data e observações.
  // OS antigas em fila que já têm pagamento continuam com o formulário completo.
  const legacyQueueWithPayment =
    !!editingOrder &&
    normalizeOrderStatus(editingOrder.productionStatus) === ORDER_STATUS.queue &&
    !!String(editingOrder.paymentMethod || "").trim();
  const showFinancialFields = selectedOrderStatus === ORDER_STATUS.delivered || legacyQueueWithPayment;
  // Recebido de cada mês pela data do recebimento, a mesma regra do Caixa mês a mês.
  // OS aguardando produção/entrega, da mais antiga para a mais nova.
  const queueOrders = useMemo(
    () =>
      orders
        .filter((order) => normalizeOrderStatus(order.productionStatus) === ORDER_STATUS.queue)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
    [orders],
  );
  // Lotes de compra: qual venda saiu de qual lote (primeiro que entra, primeiro que sai).
  const batchData = useMemo(() => {
    const byKey = new Map(products.map((item) => [normalizePieceCode(item.code), item]));
    const sales = orders
      .filter((order) => order.productionStatus === ORDER_STATUS.delivered)
      .flatMap((order) => {
        const items = getOrderItems(order);
        const totalCents = Math.round(order.total * 100);
        const revenues = distributeCents(totalCents, items.map((item) => itemUnitPrice(item) * item.quantity));
        const grossCents = items.reduce((sum, item) => sum + Math.round(itemUnitPrice(item) * item.quantity * 100), 0);
        return items.flatMap((item, index) => {
          const piece = byKey.get(normalizePieceCode(item.code));
          return piece
            ? [{
                orderId: order.id,
                orderNumber: order.number,
                productId: piece.id,
                quantity: Number(item.quantity) || 0,
                revenueCents: revenues[index],
                date: (order.deliveryDate || dayInSaoPaulo(order.createdAt)).slice(0, 10),
                // Um centavo por item é arredondamento, não desconto.
                discounted: grossCents - totalCents > items.length,
              }]
            : [];
        });
      });
    // Entradas sem lote também entram na fila: a venda sai primeiro do estoque mais antigo.
    const entries = stockMovements
      .filter((movement) => movement.kind === "entrada")
      .map((movement) => ({
        movementId: movement.id,
        batchId: Number(movement.batchId) || NO_BATCH,
        productId: movement.productId,
        quantity: movement.quantity,
        unitCostCents: movement.unitCostCents ?? null,
        date: movement.movementDate,
      }));
    const outs = stockMovements
      .filter((movement) => movement.kind === "saida")
      .map((movement) => ({ productId: movement.productId, quantity: movement.quantity, date: movement.movementDate }));
    const allocated = allocateBatches({ entries, sales, outs });
    // Vendas de peças de lote que não saíram de lote nenhum (vendidas além do estoque lançado).
    const firstBatchDate = new Map<number, string>();
    for (const entry of entries) {
      if (entry.batchId === NO_BATCH) continue;
      const current = firstBatchDate.get(entry.productId);
      if (!current || entry.date < current) firstBatchDate.set(entry.productId, entry.date);
    }
    const outsideQty = allocated.unallocated
      .filter((line) => {
        const first = firstBatchDate.get(line.productId);
        return Boolean(first) && line.date >= String(first);
      })
      .reduce((sum, line) => sum + line.quantity, 0);
    return { entries, byBatch: allocated.byBatch, outsideQty };
  }, [products, orders, stockMovements]);
  // Estudo de cada lote, calculado uma vez (a página é renderizada de novo a cada tecla digitada).
  const batchStudies = useMemo(() => {
    const pieces = products.map((product) => ({ id: product.id, code: product.code, priceCents: Math.round(product.price * 100) }));
    const format = { money, percent: (rate: number) => `${(rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` };
    return new Map(
      purchaseBatches.map((batch) => [
        batch.id,
        batchStudy({
          entries: batchData.entries.filter((entry) => entry.batchId === batch.id),
          allocation: batchData.byBatch.get(batch.id),
          products: pieces,
          targetRate,
          format,
        }),
      ]),
    );
  }, [purchaseBatches, batchData, products, targetRate]);
  // Estoque: OS entregues baixam o saldo sozinhas; OS na fila ficam como prometido.
  const stock = useMemo(() => {
    const byKey = new Map(products.map((item) => [normalizePieceCode(item.code), item]));
    const linesOf = (list: Order[], dateOf: (order: Order) => string) =>
      list.flatMap((order) =>
        getOrderItems(order).flatMap((item) => {
          const piece = byKey.get(normalizePieceCode(item.code));
          return piece ? [{ productId: piece.id, quantity: Number(item.quantity) || 0, date: dateOf(order), orderNumber: order.number }] : [];
        }),
      );
    const delivered = orders.filter((order) => order.productionStatus === ORDER_STATUS.delivered);
    const sold = linesOf(delivered, (order) => (order.deliveryDate || dayInSaoPaulo(order.createdAt)).slice(0, 10));
    const productIds = products.map((item) => item.id);
    const rows = stockPosition({
      productIds,
      movements: stockMovements,
      sold,
      reserved: linesOf(queueOrders, (order) => dayInSaoPaulo(order.createdAt)),
      today: todayIso(),
    });
    return { rows, totals: stockTotals(rows) };
  }, [products, orders, queueOrders, stockMovements]);
  const receivableByOrderId = new Map(
    financeData.accountsReceivable.map((receivable) => [receivable.serviceOrderId, receivable]),
  );
  const orderDisplayStatus = (order: Order) => {
    const baseStatus = paymentStatus(order);
    const receivable = receivableByOrderId.get(order.id);
    if (
      baseStatus !== "Pago" &&
      baseStatus !== "Cancelada" &&
      receivable &&
      receivable.balanceCents > 0 &&
      dateTimestamp(receivable.dueDate) < dateTimestamp(todayIso())
    ) return "Atrasado";
    return baseStatus;
  };
  const orderDisplayTone = (order: Order) =>
    orderDisplayStatus(order) === "Atrasado" ? "red" : paymentTone(order);
  const filteredOrders = orders
    .filter(
      (o) =>
        (!orderMonthFilter || monthInSaoPaulo(o.createdAt) === orderMonthFilter) &&
        (paymentFilter === "Todos" || orderDisplayStatus(o) === paymentFilter) &&
        (paymentMethodFilter === "Todos" || o.paymentMethod === paymentMethodFilter) &&
        `${o.number} ${o.customerName} ${o.productCode}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(compareOrdersDesc);
  const ordersPerPage = 10;
  const orderPageCount = Math.max(1, Math.ceil(filteredOrders.length / ordersPerPage));
  const paginatedOrders = filteredOrders.slice(
    (orderPage - 1) * ordersPerPage,
    orderPage * ordersPerPage,
  );
  useEffect(() => {
    const id = window.setTimeout(() => setOrderPage(1), 0);
    return () => window.clearTimeout(id);
  }, [query, orderMonthFilter, paymentFilter, paymentMethodFilter]);
  const filteredCustomers = customers.filter((c) =>
    `${c.name} ${c.document} ${c.whatsapp}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const pieceTypeOptions = pieceTypes.map((type) => type.name);
  const selectablePieceTypes = pieceTypes.filter((type) => type.active || type.name === editingProduct?.pieceType);
  const selectablePieceLines = pieceLines.filter((line) => line.active || line.name === editingProduct?.name);
  const filteredPieceLines = pieceLines.filter((line) => line.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const filteredPieceTypes = pieceTypes.filter((type) => type.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const filteredProducts = products.filter((product) =>
    (productTypeFilter === "Todos" || product.pieceType === productTypeFilter) &&
    `${product.code} ${product.pieceType} ${product.name} ${product.measure}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const reportOrders = orders.filter(
    (o) => {
      const status = orderDisplayStatus(o);
      return (
        o.productionStatus === ORDER_STATUS.delivered &&
        (!reportMonth || monthInSaoPaulo(o.createdAt) === reportMonth) &&
        (!reportCustomer || o.customerName.toLowerCase().includes(reportCustomer.toLowerCase())) &&
        (!reportPaymentStatus || status === reportPaymentStatus)
      );
    },
  );
  const reportSales = reportOrders.reduce((sum, o) => sum + o.total, 0);
  // Lucro bruto: receita de cada item (já com o desconto da OS) menos o custo vigente na data da venda.
  const salesProfit = summarizeSalesProfit(
    reportOrders.flatMap((order) => {
      // O total da OS (já com desconto) é dividido entre os itens sem sobrar centavo.
      const items = getOrderItems(order);
      const revenues = distributeCents(Math.round(order.total * 100), items.map((item) => itemUnitPrice(item) * item.quantity));
      return items.map((item, index) => ({
        code: item.code,
        quantity: item.quantity,
        revenueCents: revenues[index],
        date: dayInSaoPaulo(order.createdAt),
      }));
    }),
    products,
    productCosts,
    productCostUses,
  );
  const percent = (rate: number) => `${(rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const currentCostOf = (productId: number) => costAt(productCosts, productId, todayIso(), productCostUses);
  // Custo em uso da peça hoje: a escolha registrada ou, sem escolha, a origem do custo vigente.
  const costUseOf = (productId: number) => {
    const chosen = costUseAt(productCostUses, productId, todayIso()) ?? latestCostUse(productCostUses, productId);
    const current = currentCostOf(productId);
    return {
      source: chosen?.source ?? costSourceOf(current?.source ?? "comprada"),
      startsAt: chosen?.startsAt ?? current?.startsAt ?? todayIso(),
      saved: chosen,
    };
  };
  // Peças do lote que já têm OS entregue (a partir da data do lote) ou na fila: ficam travadas.
  const lockedPiecesOf = (batch: PurchaseBatch) => {
    const byKey = new Map(products.map((item) => [normalizePieceCode(item.code), item]));
    const lines = orders.flatMap((order) => {
      const status = normalizeOrderStatus(order.productionStatus);
      if (status === ORDER_STATUS.canceled) return [];
      const delivered = status === ORDER_STATUS.delivered;
      const date = ((delivered ? order.deliveryDate : "") || dayInSaoPaulo(order.createdAt)).slice(0, 10);
      return getOrderItems(order).flatMap((item) => {
        const piece = byKey.get(normalizePieceCode(item.code));
        return piece ? [{ productId: piece.id, date, status: delivered ? ("entregue" as const) : ("fila" as const) }] : [];
      });
    });
    const inBatch = stockMovements.filter((movement) => movement.kind === "entrada" && movement.batchId === batch.id).map((movement) => movement.productId);
    return lockedBatchProducts(batch.purchaseDate, inBatch, lines);
  };
  const signedMoney = (cents: number) => `${cents < 0 ? "− " : "+ "}${money(Math.abs(cents) / 100)}`;
  const priceHistoryBlock = (productId: number, note?: string) => {
    const timeline = priceTimeline(productPrices, productId);
    if (!timeline.length) return null;
    return (
      <fieldset className="product-cost-fields price-history">
        <legend>Histórico de preço</legend>
        {timeline.map((item) => (
          <div className="price-history-row" key={item.id}>
            <span>{brDate(item.startsAt)}</span>
            <b>{money(item.priceCents / 100)}</b>
            <small className={item.deltaCents === null ? "" : item.deltaCents < 0 ? "down" : "up"}>
              {priceChangeLabel(item, money)}
              {item.source === "vendas" ? " · estimado pelas vendas" : ""}
            </small>
          </div>
        ))}
        {note && <small>{note}</small>}
      </fieldset>
    );
  };
  const marginTone = (rate: number | null) =>
    rate === null ? "" : rate >= targetRate ? "green" : rate > 0 ? "amber" : "red";
  const reportReceived = reportOrders.reduce((sum, o) => sum + o.received, 0);
  const reportMonths = Array.from(
    new Set(orders.filter((o) => o.productionStatus === ORDER_STATUS.delivered).map((o) => monthInSaoPaulo(o.createdAt))),
  ).filter(Boolean).sort((a, b) => b.localeCompare(a));
  const ordersById = useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders],
  );
  const installmentsByReceivable = new Map<number, ReceivableInstallment[]>();
  for (const installment of financeData.receivableInstallments) {
    if (installment.status === "Cancelado") continue;
    const list = installmentsByReceivable.get(installment.accountReceivableId) || [];
    list.push(installment);
    installmentsByReceivable.set(installment.accountReceivableId, list);
  }
  // Vencimento mostrado na lista de OS: a próxima parcela em aberto ou, já paga, a última.
  const orderDueOf = (orderId: number) => {
    const parcels = financeData.receivableInstallments
      .filter((item) => item.serviceOrderId === orderId && item.status !== "Cancelado")
      .sort((a, b) => a.number - b.number);
    const open = parcels.find((item) => item.balanceCents > 0);
    const pick = open ?? parcels[parcels.length - 1];
    if (pick) {
      return {
        dueDate: pick.dueDate,
        overdue: Boolean(open) && pick.dueDate < todayIso(),
        label: pick.totalInstallments > 1 ? `parcela ${pick.number}/${pick.totalInstallments}` : "",
      };
    }
    const receivable = financeData.accountsReceivable.find((item) => item.serviceOrderId === orderId);
    return receivable?.dueDate
      ? { dueDate: receivable.dueDate, overdue: receivable.balanceCents > 0 && receivable.dueDate < todayIso(), label: "" }
      : null;
  };
  const openInstallmentsOf = (receivableId: number) =>
    (installmentsByReceivable.get(receivableId) || [])
      .filter((item) => item.balanceCents > 0)
      .sort((a, b) => a.number - b.number);
  const financialRows = financeData.accountsReceivable
    .flatMap((receivable) => {
      const order = ordersById.get(receivable.serviceOrderId);
      const customer = receivable.customerId
        ? customers.find((item) => item.id === receivable.customerId)
        : undefined;
      const base = {
        receivable,
        order,
        orderNumber: order?.number || `CR-${String(receivable.id).padStart(5, "0")}`,
        customerName: order?.customerName || customer?.name || "Cliente nao identificado",
        paymentMethod: order?.paymentMethod || "Nao informado",
        issuedAt: receivable.issuedAt,
      };
      const openInstallments = openInstallmentsOf(receivable.id);
      if (openInstallments.length) {
        return openInstallments.map((installment) => ({
          ...base,
          key: `${receivable.id}-${installment.number}`,
          installmentLabel: installment.totalInstallments > 1 ? `Parcela ${installment.number}/${installment.totalInstallments}` : "",
          total: installment.amountCents / 100,
          received: installment.receivedCents / 100,
          balance: installment.balanceCents / 100,
          dueDate: installment.dueDate,
          status: (dateTimestamp(installment.dueDate) < dateTimestamp(todayIso()) ? "Atrasado" : "Em aberto") as string,
        }));
      }
      const status: string =
        receivable.status === "Pago"
          ? "Pago"
          : receivable.status === "Vencido" || dateTimestamp(receivable.dueDate) < dateTimestamp(todayIso())
            ? "Atrasado"
            : "Em aberto";
      return [{
        ...base,
        key: String(receivable.id),
        installmentLabel: "",
        total: receivable.originalAmountCents / 100,
        received: receivable.receivedAmountCents / 100,
        balance: receivable.balanceCents / 100,
        dueDate: receivable.dueDate,
        status,
      }];
    })
    .filter((row) => (
      row.balance > 0 &&
      row.status !== "Pago" &&
      (!reportMonth || monthInSaoPaulo(row.issuedAt) === reportMonth || row.issuedAt.slice(0, 7) === reportMonth) &&
      (!reportCustomer || row.customerName.toLowerCase().includes(reportCustomer.toLowerCase())) &&
      (!reportPaymentStatus || (row.order ? orderDisplayStatus(row.order) : row.status) === reportPaymentStatus)
    ))
    .sort((a, b) => {
      const orderDifference = b.orderNumber.localeCompare(a.orderNumber, "pt-BR", { numeric: true });
      if (orderDifference !== 0) return orderDifference;
      const dateDifference = dateTimestamp(b.dueDate) - dateTimestamp(a.dueDate);
      if (dateDifference !== 0) return dateDifference;
      const numberDifference = a.key.localeCompare(b.key, "pt-BR", { numeric: true });
      return numberDifference !== 0 ? numberDifference : b.receivable.id - a.receivable.id;
    });
  // Previsto/recebido contam a conta inteira uma única vez; em aberto/atrasado somam por parcela.
  const financialTotalsSeen = new Set<number>();
  const financialTotals = financialRows.reduce(
    (summary, row) => {
      const firstOfReceivable = !financialTotalsSeen.has(row.receivable.id);
      financialTotalsSeen.add(row.receivable.id);
      return {
        forecast: summary.forecast + (firstOfReceivable ? row.receivable.originalAmountCents / 100 : 0),
        received: summary.received + (firstOfReceivable ? row.receivable.receivedAmountCents / 100 : 0),
        pending: summary.pending + (row.status === "Em aberto" ? row.balance : 0),
        overdue: summary.overdue + (row.status === "Atrasado" ? row.balance : 0),
      };
    },
    { forecast: 0, received: 0, pending: 0, overdue: 0 },
  );
  // Tudo o que está em aberto para receber hoje, sem filtro de período.
  const openReceivableRows = financeData.accountsReceivable
    .filter(
      (receivable) =>
        receivable.status !== "Pago" &&
        receivable.status !== "Cancelado" &&
        receivable.balanceCents > 0,
    )
    .flatMap((receivable) => {
      const order = ordersById.get(receivable.serviceOrderId);
      const customer = receivable.customerId
        ? customers.find((item) => item.id === receivable.customerId)
        : undefined;
      const openInstallments = openInstallmentsOf(receivable.id);
      const parcels = openInstallments.length
        ? openInstallments.map((installment) => ({
            key: `${receivable.id}-${installment.number}`,
            dueDate: installment.dueDate,
            balance: installment.balanceCents / 100,
            installmentLabel: installment.totalInstallments > 1 ? `Parcela ${installment.number}/${installment.totalInstallments}` : "",
          }))
        : [{ key: String(receivable.id), dueDate: receivable.dueDate, balance: receivable.balanceCents / 100, installmentLabel: "" }];
      return parcels.map((parcel) => ({
        receivable,
        order,
        orderNumber: order?.number || `CR-${String(receivable.id).padStart(5, "0")}`,
        customerName: order?.customerName || customer?.name || "Cliente não identificado",
        ...parcel,
        status: dateTimestamp(parcel.dueDate) < dateTimestamp(todayIso()) ? "Atrasado" : "Em aberto",
      }));
    })
    .sort((a, b) => {
      const dueDifference = dateTimestamp(b.dueDate) - dateTimestamp(a.dueDate);
      if (dueDifference !== 0) return dueDifference;
      return b.receivable.id - a.receivable.id;
    });
  // A tela inicial mostra todas as OS em aberto, da que vence primeiro para a que vence por último.
  const payableRows = financeData.accountsPayable
    .filter((payable) =>
      payable.status !== "Cancelado" &&
      (!financialMonth || payableMonth(payable) === financialMonth),
    )
    .slice()
    .sort((a, b) => {
      const statusWeight = { Pendente: 0, Vencido: 0, Pago: 1 } as Record<string, number>;
      const statusDifference = (statusWeight[a.status] ?? 0) - (statusWeight[b.status] ?? 0);
      if (statusDifference !== 0) return statusDifference;
      return dateTimestamp(b.dueDate) - dateTimestamp(a.dueDate);
    });
  // Financeiro em linguagem simples: o gasto é o que foi pago em Contas a pagar no período.
  const fabricationIds = fabricationCategoryIds(financeData.categories);
  const paidSplit = splitPaidExpenses(payableRows, fabricationIds);
  const plain = plainResult({
    salesCents: Math.round(reportSales * 100),
    receivedCents: Math.round(reportReceived * 100),
    fabricationCents: paidSplit.fabricationCents,
    otherExpensesCents: paidSplit.otherCents,
  });
  const financePeriod = activePeriod(reportMonth, todayIso());
  // Indicadores da tela Contas a pagar: sempre sobre as contas listadas no período escolhido.
  const payableTotals = payableKpis(payableRows, fabricationIds, todayIso());
  const payablePeriodLabel = financePeriod === "this" ? " deste mês" : financePeriod === "last" ? " do mês passado" : "";
  // Resumo executivo: resultado do período e a posição de hoje do que falta receber e pagar.
  const summaryPeriodLabel = financePeriod === "this" ? "neste mês" : financePeriod === "last" ? "no mês passado" : "até hoje";
  const receivableOpen = openReceivableRows.reduce((sum, row) => sum + row.balance, 0);
  const receivableOverdue = openReceivableRows
    .filter((row) => row.status === "Atrasado")
    .reduce((sum, row) => sum + row.balance, 0);
  const openPayableTotals = payableKpis(
    financeData.accountsPayable.filter((payable) => payable.status !== "Pago"),
    fabricationIds,
    todayIso(),
  );
  // Lucro e caixa mês a mês usam todo o histórico, sem o filtro de período.
  // Memorizado: a página inteira é renderizada de novo a cada tecla digitada em qualquer formulário.
  const monthly = useMemo(() => {
    const today = todayIso();
    const currentMonthKey = today.slice(0, 7);
    const fabrication = fabricationCategoryIds(financeData.categories);
    const sales = orders
      .filter((order) => order.productionStatus === ORDER_STATUS.delivered)
      // A venda do mês é o total da OS, o mesmo número usado no Resumo.
      .map((order) => ({ month: monthInSaoPaulo(order.createdAt), revenueCents: Math.round(order.total * 100) }));
    const payables = financeData.accountsPayable
      .filter((payable) => payable.status !== "Cancelado")
      .map((payable) => ({
        month: payableMonth(payable),
        amountCents: payable.amountCents,
        paid: payable.status === "Pago",
        isFabrication: payable.categoryId != null && fabrication.includes(payable.categoryId),
      }));
    const result = monthlyResult(sales, payables, currentMonthKey);
    const cash = monthlyCash(
      dedupeReceipts(
        financeData.receipts,
        Object.fromEntries(orders.map((order) => [order.id, Math.round(order.received * 100)])),
      ),
      payables,
      currentMonthKey,
    );
    const forecast = forecastCurrentMonth(
      result.find((row) => row.month === currentMonthKey),
      today,
      payables
        .filter((payable) => !payable.paid && payable.month === currentMonthKey)
        .reduce((sum, payable) => sum + payable.amountCents, 0),
    );
    return { result, cash, forecast };
  }, [orders, financeData]);
  const resultByMonth = monthly.result;
  const cashByMonth = monthly.cash;
  const monthForecast = monthly.forecast;
  const resultTotal = resultByMonth.length ? resultByMonth[resultByMonth.length - 1].accumulatedCents : 0;
  const cashTotal = cashByMonth.length ? cashByMonth[cashByMonth.length - 1].balanceCents : 0;
  // Previsão do caixa: resto deste mês e os próximos 3, com o que já está lançado para receber e pagar.
  const cashForecastRows = cashForecast({
    receivables: openReceivableRows.map((row) => ({ dueDate: row.dueDate, balanceCents: Math.round(row.balance * 100) })),
    payables: financeData.accountsPayable
      .filter((payable) => payable.status !== "Pago" && payable.status !== "Cancelado")
      .map((payable) => ({ dueDate: payable.dueDate, amountCents: payable.amountCents })),
    todayIso: todayIso(),
    startBalanceCents: cashTotal,
  });
  const cashForecastEnd = cashForecastRows[cashForecastRows.length - 1];
  // Caixa do período escolhido no Resumo: mesma regra da tela "Caixa mês a mês" (data do recebimento e do pagamento).
  const periodCash = reportMonth ? cashByMonth.filter((row) => row.month === reportMonth) : cashByMonth;
  const periodCashIn = periodCash.reduce((sum, row) => sum + row.inCents, 0);
  const periodCashOut = periodCash.reduce((sum, row) => sum + row.outCents, 0);
  const wholeMoney = (cents: number) => Math.round(cents / 100).toLocaleString("pt-BR");
  const isFinanceScreen =
    screen === "financial" || screen === "reports" || screen === "financial-monthly" || screen === "financial-cash" || screen === "financial-payables" || screen === "financial-pricing" || screen === "financial-batches";
  const showFinanceMenu = isFinanceScreen ? !financeCollapsed : financeOpen;
  const walletCustomers = useMemo(() => {
    const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
    return Object.values(
      financeData.accountsReceivable
        .filter((receivable) => receivable.status !== "Cancelado")
        .reduce(
          (grouped, receivable) => {
            const order = ordersById.get(receivable.serviceOrderId);
            const customer = receivable.customerId ? customerMap.get(receivable.customerId) : undefined;
            const key = order?.customerName || customer?.name || "Cliente nao identificado";
            const current = grouped[key] || {
              customer: key,
              items: [] as WalletEntry[],
              total: 0,
              received: 0,
            };
            const entry = {
              receivable,
              order,
              orderNumber: order?.number || `CR-${String(receivable.id).padStart(5, "0")}`,
              issuedAt: receivable.issuedAt,
              total: receivable.originalAmountCents / 100,
              received: receivable.receivedAmountCents / 100,
              balance: receivable.balanceCents / 100,
            };
            current.items.push(entry);
            current.total += entry.total;
            current.received += entry.received;
            grouped[key] = current;
            return grouped;
          },
          {} as Record<string, {
            customer: string;
            items: WalletEntry[];
            total: number;
            received: number;
          }>,
        ),
    ).sort((a, b) => a.customer.localeCompare(b.customer, "pt-BR"));
  }, [customers, financeData.accountsReceivable, ordersById]);
  const walletRows = walletCustomers.filter((item) => {
    const balance = item.total - item.received;
    const status = balance <= 0
      ? "Pago"
      : item.items.some((entry) => entry.balance > 0 && dateTimestamp(entry.receivable.dueDate) < dateTimestamp(todayIso()))
        ? "Atrasado"
        : "Em aberto";
    return (
      (!walletStatusFilter || status === walletStatusFilter) &&
      item.customer.toLowerCase().includes(walletQuery.toLowerCase())
    );
  });
  const walletTotals = walletRows.reduce(
    (summary, item) => ({
      total: summary.total + item.total,
      received: summary.received + item.received,
      pending: summary.pending + Math.max(0, item.total - item.received),
    }),
    { total: 0, received: 0, pending: 0 },
  );
  function go(next: Screen) {
    setCustomerModal(false);
    setEditingCustomer(null);
    setViewingCustomer(null);
    setProductModal(false); setCostUseDraft(null);
    setEditingProduct(null);
    setViewingProduct(null);
    setOrderModal(null);
    setWalletPayment(null);
    if (next === "orders") {
      setQuery("");
      setPaymentFilter("Todos");
      setPaymentMethodFilter("Todos");
      setOrderPage(1);
    }
    if (next === "new-order") {
      setEditingOrder(null);
      setSelectedCustomer("");
      setSelectedCustomerId("");
      setSelectedOrderCustomerType("");
      setQuantity(1);
      setReceived(0);
      setSelectedDeliveryType("");
      setSelectedPaymentMethod("");
      setSelectedBoletoTerm("");
      setSelectedOrderStatus(ORDER_STATUS.queue);
      setDiscountOverride("");
      setSelectedCode("");
      setOrderItems([{ code: "", quantity: 1 }]);
    }
    setScreen(next);
    setMenu(false);
    setQuery("");
    setNotice(null);
    window.scrollTo({ top: 0 });
  }
  function goSettings(section: SettingsSection) {
    setSettingsSection(section);
    setSettingsOpen(true);
    setSettingsCollapsed(false);
    if (section === "customers") return go("customers");
    if (section === "products") return go("products");
    if (section === "piece-types") return go("piece-types");
    if (section === "piece-lines") return go("piece-lines");
    return go("settings");
  }
  function flash(text: string, tone?: "success" | "error" | "warning" | "info") {
    const normalized = text.toLocaleLowerCase("pt-BR");
    const inferredTone =
      tone ||
      (/sucesso|confirmad[oa]|registrad[oa]|atualizad[oa]|criad[oa]/.test(normalized)
        ? "success"
        : /não foi possível|erro|inválid|incompleto|preencha|informe|selecione|adicione|sem whatsapp/.test(normalized)
          ? "error"
          : /cancelad[oa]|permita pop-ups/.test(normalized)
            ? "warning"
            : "info");
    setNotice({ text, tone: inferredTone });
    setTimeout(() => setNotice(null), 3500);
  }
  async function saveSettings() {
    if (!companyName.trim() || !responsible.trim() || !orderFooter.trim())
      return flash("Preencha todos os campos obrigatórios.");
    if (companyPhone.replace(/\D/g, "").length < 10)
      return flash("Informe um WhatsApp da empresa válido com DDD.");
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyName, responsible, companyPhone, orderFooter }),
    });
    if (!response.ok) return flash("Não foi possível salvar as configurações.");
    flash("Configurações salvas e sincronizadas com sucesso.");
  }
  async function saveTargetRate() {
    const rate = parsePercent(targetInput);
    if (rate === null || rate < 0 || rate > 10) return flash("Informe a meta em percentual, por exemplo 35.", "error");
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetProfitRate: rate }),
    });
    if (!response.ok) return flash("Não foi possível salvar a meta de lucro.", "error");
    setTargetRate(rate);
    setTargetInput("");
    flash("Meta de lucro salva.");
  }
  // Grava só o preço da peça; a API registra a mudança no histórico de preço.
  async function applyProductPrice(product: Product, priceCents: number) {
    const r = await fetch("/api/catalog", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "product", id: product.id, price: priceCents / 100 }),
    });
    const j = await r.json().catch(() => ({} as { product?: Product; productPrices?: ProductPrice[] }));
    if (!r.ok || !j.product) return false;
    const saved: Product = j.product;
    setProducts((v) => v.map((p) => (p.id === saved.id ? saved : p)));
    if (Array.isArray(j.productPrices)) {
      const savedPrices: ProductPrice[] = j.productPrices;
      setProductPrices((v) => [...v.filter((row) => row.productId !== saved.id), ...savedPrices]);
    }
    return true;
  }
  function openPriceSimulator(product: Product) {
    setPricingProduct(product);
    setSimPrice(money(product.price));
    setSimMargin("");
  }
  async function applySimulatedPrice(product: Product, priceCents: number) {
    setSaving(true);
    try {
      if (!(await applyProductPrice(product, priceCents))) return flash("Não foi possível aplicar o preço. Tente novamente.", "error");
      setPricingProduct(null);
      notifyCatalogUpdate();
      flash(`Preço de ${product.code} alterado para ${money(priceCents / 100)}.`);
    } finally {
      setSaving(false);
    }
  }
  async function applyBulkPrices(changes: { product: Product; priceCents: number }[]) {
    if (!changes.length) return;
    if (!window.confirm(`Aplicar o novo preço em ${changes.length === 1 ? "1 peça" : `${changes.length} peças`}? O preço anterior fica no histórico.`)) return;
    setSaving(true);
    try {
      let failed = 0;
      for (const change of changes) if (!(await applyProductPrice(change.product, change.priceCents))) failed += 1;
      notifyCatalogUpdate();
      if (failed) return flash(`${failed === 1 ? "1 peça não foi alterada" : `${failed} peças não foram alteradas`}. Tente novamente.`, "error");
      setBulkPercent("");
      flash("Preços reajustados.");
    } finally {
      setSaving(false);
    }
  }
  function updateItem(
    index: number,
    changes: Partial<{ code: string; quantity: number; unitPrice: number }>,
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
      setCustomerType(customer.customerType || "Cliente final");
      setPhone(maskPhone(customer.whatsapp));
      setZipCode(maskZipCode(customer.zipCode || ""));
      setStreet(customer.street || "");
      setAddressNumber(customer.number || "");
      setComplement(customer.complement || "");
      setNeighborhood(customer.neighborhood || "");
      setCity(customer.city || "");
      setAddressState(customer.state || "");
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
      setCustomerType("");
      setPhone("");
      setZipCode("");
      setStreet("");
      setAddressNumber("");
      setComplement("");
      setNeighborhood("");
      setCity("");
      setAddressState("");
      setDocType("CPF");
      setDoc("");
    }
    setCustomerModal(true);
  }

  async function lookupZipCode(value: string) {
    const masked = maskZipCode(value);
    setZipCode(masked);
    const digits = masked.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setZipLoading(true);
    try {
      const response = await fetch(`/api/cep?cep=${digits}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "CEP não encontrado.");
      setStreet(data.street || "");
      setNeighborhood(data.neighborhood || "");
      setCity(data.city || "");
      setAddressState(data.state || "");
    } catch (error) {
      setStreet(""); setNeighborhood(""); setCity(""); setAddressState("");
      flash(error instanceof Error ? error.message : "Não foi possível consultar o CEP.");
    } finally {
      setZipLoading(false);
    }
  }

  async function saveCustomer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      if (!customerName.trim()) throw new Error("Informe o nome do cliente.");
      if (phone.replace(/\D/g, "").length < 10)
        throw new Error("Informe um WhatsApp válido com DDD.");
      if (zipCode.replace(/\D/g, "").length !== 8)
        throw new Error("Informe um CEP válido.");
      if (!street || !neighborhood || !city || !addressState)
        throw new Error("Consulte um CEP válido para preencher o endereço.");
      if (!addressNumber.trim()) throw new Error("Informe o número do endereço.");
      if (!doc) throw new Error("Informe o CPF ou CNPJ.");
      if (!customerType) throw new Error("Selecione o tipo de cliente.");
      if (doc.replace(/\D/g, "").length !== (docType === "CPF" ? 11 : 14))
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
          customerType,
          zipCode,
          street,
          number: addressNumber,
          complement,
          neighborhood,
          city,
          state: addressState,
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
      setSelectedCustomerId(String(j.customer.id));
      setSelectedOrderCustomerType(j.customer.customerType || "");
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
  async function writeType(body: { id?: number; name?: string; active?: boolean }, editing: boolean) {
    const response = await fetch("/api/piece-types", {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.pieceType) throw new Error(data.error || "Não foi possível salvar o tipo. Tente novamente.");
    const saved: PieceType = data.pieceType;
    const previous = pieceTypes.find((type) => type.id === saved.id);
    setPieceTypes((types) => [...types.filter((type) => type.id !== saved.id), saved]
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    if (previous && previous.name !== saved.name) {
      setProducts((rows) => rows.map((product) => product.pieceType === previous.name ? { ...product, pieceType: saved.name } : product));
      setProductTypeFilter((value) => value === previous.name ? saved.name : value);
    }
    notifyCatalogUpdate();
    return saved;
  }
  async function saveType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTypeSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      await writeType({ id: editingType?.id, name: String(form.get("name") || "").trim() }, !!editingType);
      setTypeModal(false);
      setEditingType(null);
      flash(editingType ? "Tipo atualizado com sucesso." : "Tipo cadastrado com sucesso.", "success");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Não foi possível salvar o tipo.", "error");
    } finally { setTypeSaving(false); }
  }
  async function toggleType(type: PieceType) {
    setTypeSaving(true);
    try {
      await writeType({ id: type.id, active: !type.active }, true);
      setViewingType(null);
      flash(type.active ? "Tipo inativado com sucesso." : "Tipo ativado com sucesso.", "success");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Não foi possível atualizar o tipo.", "error");
    } finally { setTypeSaving(false); }
  }
  async function writeLine(body: { id?: number; name?: string; active?: boolean }, editing: boolean) {
    const response = await fetch("/api/piece-lines", {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.pieceLine) throw new Error(data.error || "Não foi possível salvar a linha. Tente novamente.");
    const saved: PieceLine = data.pieceLine;
    const previous = pieceLines.find((type) => type.id === saved.id);
    setPieceLines((types) => [...types.filter((type) => type.id !== saved.id), saved]
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    if (previous && previous.name !== saved.name) {
      setProducts((rows) => rows.map((product) => product.lineName === previous.name ? { ...product, lineName: saved.name, name: saved.name } : product));
    }
    notifyCatalogUpdate();
    return saved;
  }
  async function saveLine(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLineSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      await writeLine({ id: editingLine?.id, name: String(form.get("name") || "").trim() }, !!editingLine);
      setLineModal(false);
      setEditingLine(null);
      flash(editingLine ? "Linha atualizada com sucesso." : "Linha cadastrada com sucesso.", "success");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Não foi possível salvar a linha.", "error");
    } finally { setLineSaving(false); }
  }
  async function toggleLine(type: PieceLine) {
    setLineSaving(true);
    try {
      await writeLine({ id: type.id, active: !type.active }, true);
      setViewingLine(null);
      flash(type.active ? "Linha inativada com sucesso." : "Linha ativada com sucesso.", "success");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Não foi possível atualizar a linha.", "error");
    } finally { setLineSaving(false); }
  }
  async function saveProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (imageProcessing) return flash("Aguarde a padronização da imagem.");
    setSaving(true);
    const f = new FormData(e.currentTarget);
    try {
      if (
        !String(f.get("code") || "").trim() ||
        !String(f.get("pieceType") || "").trim() ||
        !String(f.get("name") || "").trim() ||
        !String(f.get("measure") || "").trim()
      )
        throw new Error("Preencha código, tipo de peça, linha e medidas.");
      let imageData = f.has("imageData") ? String(f.get("imageData")) : undefined;
      if (imageData === undefined && editingProduct && editingProduct.imageData == null &&
          editingProduct.code !== String(f.get("code")).trim().toUpperCase()) {
        const source = productImageSource(editingProduct);
        if (source) imageData = await loadCatalogImage(source);
      }
      const centsField = (name: string) => Math.round(parseCurrency(String(f.get(name) || "")) * 100);
      const cost = {
        materialCents: centsField("costMaterial"),
        laborCents: centsField("costLabor"),
        freightCents: centsField("costFreight"),
        startsAt: String(f.get("costStartsAt") || todayIso()),
      };
      const purchaseCost = {
        materialCents: centsField("purchasePrice"),
        laborCents: 0,
        freightCents: centsField("purchaseFreight"),
        startsAt: String(f.get("purchaseStartsAt") || todayIso()),
        supplier: String(f.get("purchaseSupplier") || "").trim(),
      };
      const shownUse = editingProduct ? costUseOf(editingProduct.id) : { source: "comprada" as const, startsAt: todayIso(), saved: null };
      const costUse = {
        source: costSourceOf(f.get("costUseSource")),
        startsAt: String(f.get("costUseStartsAt") || todayIso()),
      };
      const costUseChanged = costUse.source !== shownUse.source || costUse.startsAt !== shownUse.startsAt;
      const savedPurchase = editingProduct ? openCost(productCosts, editingProduct.id, "comprada") : null;
      const purchaseChanged = savedPurchase
        ? savedPurchase.rawMaterialCostCents !== purchaseCost.materialCents ||
          savedPurchase.freightCents !== purchaseCost.freightCents ||
          savedPurchase.supplier !== purchaseCost.supplier ||
          savedPurchase.startsAt !== purchaseCost.startsAt
        : totalCostCents(purchaseCost) > 0;
      const savedCost = editingProduct ? openCost(productCosts, editingProduct.id) : null;
      const costChanged = savedCost
        ? savedCost.rawMaterialCostCents !== cost.materialCents ||
          savedCost.additionalCostsCents !== cost.laborCents ||
          savedCost.freightCents !== cost.freightCents ||
          savedCost.startsAt !== cost.startsAt
        : totalCostCents(cost) > 0;
      const r = await fetch("/api/catalog", {
        method: editingProduct ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "product",
          id: editingProduct?.id,
          ...(costChanged ? { cost } : {}),
          ...(purchaseChanged ? { purchaseCost } : {}),
          ...(costUseChanged ? { costUse } : {}),
          ...(imageData !== undefined ? { imageData } : {}),
          code: f.get("code"),
          pieceType: f.get("pieceType"),
          lineName: f.get("name"),
          ...(!editingProduct ? { name: f.get("name") } : {}),
          measure: f.get("measure"),
          price: parseCurrency(String(f.get("price"))),
        }),
      });
      const j = await r.json().catch(() => ({} as { error?: string; product?: Product; productCosts?: ProductCost[]; productPrices?: ProductPrice[]; productCostUses?: CostUse[] }));
      if (!r.ok)
        throw new Error(
          j.error ||
            (r.status === 409
              ? "Já existe uma peça cadastrada com este código."
              : "Não foi possível cadastrar a peça. Tente novamente."),
        );
      if (!j.product)
        throw new Error("Não foi possível confirmar o cadastro da peça. Tente novamente.");
      setProducts((v) =>
        (editingProduct
          ? v.map((p) => (p.id === j.product.id ? j.product : p))
          : [...v, j.product]
        ).sort((a, b) => a.code.localeCompare(b.code)),
      );
      if ((costChanged || purchaseChanged) && Array.isArray(j.productCosts)) {
        const saved = j.productCosts;
        setProductCosts((v) => [...v.filter((row) => row.productId !== j.product.id), ...saved]);
      }
      if (Array.isArray(j.productPrices)) {
        const savedPrices = j.productPrices;
        setProductPrices((v) => [...v.filter((row) => row.productId !== j.product.id), ...savedPrices]);
      }
      if (costUseChanged && Array.isArray(j.productCostUses)) {
        const savedUses = j.productCostUses;
        setProductCostUses((v) => [...v.filter((row) => row.productId !== j.product.id), ...savedUses]);
      }
      setProductModal(false); setCostUseDraft(null);
      setEditingProduct(null);
      notifyCatalogUpdate();
      flash(editingProduct ? "Peça atualizada com sucesso." : "Peça cadastrada com sucesso.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Erro ao cadastrar.", "error");
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
      if (!orderItems.length) throw new Error("Adicione pelo menos uma peça.");
      if (orderItems.some((item) => !item.code)) throw new Error("Selecione todas as peças da OS.");
      const orderDate = String(f.get("orderDate") || "");
      if (!isValidBrDate(orderDate)) throw new Error("Informe uma data do pedido válida.");
      const wasDelivered = !!editingOrder && normalizeOrderStatus(editingOrder.productionStatus) === ORDER_STATUS.delivered;
      const baseBody = {
        id: editingOrder?.id,
        customerId: orderCustomer?.id,
        customerType: orderCustomer?.customerType || selectedOrderCustomerType,
        customerName: selectedCustomer,
        createdAt: toIsoDate(orderDate),
        notes: f.get("notes"),
      };
      let requestBody: Record<string, unknown>;
      if (!showFinancialFields) {
        // Em fila: só cliente, peças, data e observações. Preço e pagamento ficam para a entrega.
        if (wasDelivered && !window.confirm(
          `Voltar a ${editingOrder?.number} para a fila de produção? O recebível e as parcelas serão removidos.`,
        )) {
          setSaving(false);
          return;
        }
        requestBody = {
          ...baseBody,
          productionStatus: ORDER_STATUS.queue,
          productCode: selectedCode,
          quantity,
          unitPrice: product.price,
          items: orderItems.map((item) => ({ ...item, unitPrice: itemUnitPrice(item) })),
          discountRate,
        };
      } else {
        const items = orderItems.map((item) => ({
          ...item,
          unitPrice: itemUnitPrice(item),
        }));
        const paymentMethod = String(f.get("paymentMethod") || "");
        const deliveryType = String(f.get("deliveryType") || "");
        if (!deliveryType) throw new Error("Selecione a forma de entrega.");
        if (!paymentMethod) throw new Error("Selecione a forma de pagamento.");
        if (["Pix", "Dinheiro", "Cartão"].includes(paymentMethod) && received <= 0)
          throw new Error("Informe o valor recebido.");
        if (paymentMethod === "Boleto" && !selectedBoletoTerm)
          throw new Error("Escolha o prazo do boleto: 25, 50 ou 75 dias.");
        const moveToWallet =
          ["Pix", "Cartão"].includes(paymentMethod) &&
          received < total;
        const initialWalletHistory =
          moveToWallet && received > 0
            ? JSON.stringify([
                {
                  amount: received,
                  method: paymentMethod,
                  date: toIsoDate(orderDate),
                },
              ])
            : editingOrder?.commercialStatus || "";
        const delivering = selectedOrderStatus === ORDER_STATUS.delivered && !wasDelivered;
        if (delivering) {
          const methodLabel = paymentMethod === "Boleto"
            ? `Boleto em ${selectedBoletoTerm} dias (${installmentCount(Number(selectedBoletoTerm))}x)`
            : moveToWallet ? "Carteira" : paymentMethod;
          if (!window.confirm(`Confirmar entrega?\nTotal: ${money(total)}\nPagamento: ${methodLabel}`)) {
            setSaving(false);
            return;
          }
        }
        requestBody = {
          ...baseBody,
          deliveryDate: delivering ? todayIso() : editingOrder?.deliveryDate || todayIso(),
          productionStatus: selectedOrderStatus === ORDER_STATUS.delivered ? ORDER_STATUS.delivered : ORDER_STATUS.queue,
          productCode: selectedCode,
          quantity,
          unitPrice: product.price,
          items,
          discountRate,
          received,
          deliveryType,
          paymentMethod: moveToWallet ? "Carteira" : paymentMethod,
          boletoTermDays: paymentMethod === "Boleto" ? Number(selectedBoletoTerm) : null,
          commercialStatus: initialWalletHistory,
        };
      }
      const r = await fetch("/api/orders", {
        method: editingOrder ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setOrders((currentOrders) =>
        sortOrdersDesc(
          editingOrder
            ? currentOrders.map((order) => order.id === j.order.id ? j.order : order)
            : [j.order, ...currentOrders],
        ),
      );
      await refreshFinance();
      setReceived(0);
      flash(editingOrder ? `${j.order.number} atualizada com sucesso.` : `${j.order.number} criada com sucesso.`);
      setEditingOrder(null);
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
    setOrders((currentOrders) =>
      sortOrdersDesc(currentOrders.map((order) => (order.id === id ? j.order : order))),
    );
    setOrderModal(j.order);
    flash("OS atualizada.");
    return true;
  }
  async function cancelOrder(order: Order) {
    if (!window.confirm(`Cancelar a ${order.number}?`)) return;
    const updated = await updateOrder(order.id, { productionStatus: "Cancelada" });
    if (updated) {
      setOrderModal(null);
      flash(`${order.number} cancelada.`);
    }
  }
  function editOrder(order: Order, returnTo: "orders" | "review" = "review", presetStatus?: string) {
    const items = getOrderItems(order).map(({ code, quantity, unitPrice }) => ({
      code,
      quantity,
      unitPrice,
    }));
    setEditingOrder(order);
    setEditOrderReturnTo(returnTo);
    setSelectedCustomer(order.customerName);
    const matchingCustomer =
      customers.find(
        (customer) =>
          customer.name.trim().toLocaleLowerCase("pt-BR") ===
            order.customerName.trim().toLocaleLowerCase("pt-BR") &&
          isDistributor(customer.customerType) === isDistributor(order.customerType),
      ) ||
      customers.find(
        (customer) =>
          customer.name.trim().toLocaleLowerCase("pt-BR") ===
          order.customerName.trim().toLocaleLowerCase("pt-BR"),
      );
    setSelectedCustomerId(matchingCustomer ? String(matchingCustomer.id) : "");
    setSelectedOrderCustomerType(
      matchingCustomer?.customerType ||
        order.customerType ||
        "Cliente final",
    );
    setOrderItems(items);
    setSelectedCode(items[0]?.code || "");
    setQuantity(items[0]?.quantity || 1);
    setReceived(order.received);
    setSelectedDeliveryType(order.deliveryType);
    setSelectedPaymentMethod(order.paymentMethod);
    setSelectedBoletoTerm(order.paymentMethod === "Boleto" ? String(order.boletoTermDays || BOLETO_STEP_DAYS) : "");
    setSelectedOrderStatus(
      presetStatus ||
        (normalizeOrderStatus(order.productionStatus) === ORDER_STATUS.delivered ? ORDER_STATUS.delivered : ORDER_STATUS.queue),
    );
    setDiscountOverride(String(order.discountRate ?? 0));
    setOrderModal(null);
    setScreen("new-order");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function settleBoleto(order: Order, installment?: ReceivableInstallment) {
    const receivable = financeData.accountsReceivable.find((item) => item.serviceOrderId === order.id);
    const balanceCents = installment?.balanceCents ?? receivable?.balanceCents ?? Math.max(0, Math.round((order.total - order.received) * 100));
    if (balanceCents <= 0) return flash("Este boleto ja esta quitado.");
    const confirmText = installment
      ? `Confirmar o recebimento de ${money(balanceCents / 100)} da parcela ${installment.number}/${installment.totalInstallments} (vence em ${brDate(installment.dueDate)}) do boleto da ${order.number}?`
      : `Confirmar o recebimento de ${money(balanceCents / 100)} referente ao boleto da ${order.number}?`;
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    try {
      if (receivable) {
        const response = await fetch("/api/finance", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entity: "accountsReceivable",
            id: receivable.id,
            installmentId: installment?.id,
            amountCents: balanceCents,
            paymentMethod: "Boleto",
            receiptDate: todayIso(),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Nao foi possivel confirmar o boleto.");
      } else {
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
      }
      await loadAll();
      flash(installment ? `Parcela ${installment.number}/${installment.totalInstallments} do boleto confirmada.` : "Pagamento do boleto confirmado.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Nao foi possivel confirmar o boleto.", "error");
    } finally {
      setSaving(false);
    }
  }
  function openPayableForm(payable: AccountPayable | null = null) {
    setEditingPayable(payable);
    setPayableStatus(payable?.status === "Pago" ? "Pago" : "Pendente");
    setPayableModal(true);
  }
  function closePayableForm() {
    setPayableModal(false);
    setEditingPayable(null);
    setPayableStatus("Pendente");
  }
  async function savePayable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const supplier = String(form.get("supplier") || "").trim();
    const description = String(form.get("description") || "").trim();
    const dueDateInput = String(form.get("dueDate") || "").trim();
    const purchaseDateInput = String(form.get("purchaseDate") || "").trim();
    const paidAtInput = String(form.get("paidAt") || "").trim();
    const amountCents = Math.round(parseCurrency(String(form.get("amount") || "")) * 100);
    const paymentMethod = String(form.get("paymentMethod") || "").trim();
    const isFabrication = form.get("isFabrication") === "sim";
    const fabricationCategoryId = isFabrication ? preferredFabricationCategoryId(financeData.categories) : null;
    if (isFabrication && !fabricationCategoryId)
      return flash("Não foi possível marcar como gasto de fabricação. Atualize a página e tente de novo.", "error");
    const wasFabrication = editingPayable?.categoryId != null && fabricationIds.includes(editingPayable.categoryId);
    // Só mexe na categoria quando a marcação muda: desmarcar limpa apenas a categoria de fabricação.
    const categoryChange =
      isFabrication && !wasFabrication ? { categoryId: fabricationCategoryId } : !isFabrication && wasFabrication ? { categoryId: null } : {};
    if (!supplier || !description || !isValidBrDate(dueDateInput) || amountCents <= 0)
      return flash("Informe fornecedor, descricao, vencimento e valor.", "error");
    if (purchaseDateInput && !isValidBrDate(purchaseDateInput))
      return flash("Informe uma data da compra válida ou deixe em branco.", "error");
    if (payableStatus === "Pago" && (!paymentMethod || !isValidBrDate(paidAtInput)))
      return flash("Informe forma e data de pagamento para conta ja paga.", "error");
    setSaving(true);
    try {
      const fields = {
        supplier,
        description,
        dueDate: toIsoDate(dueDateInput),
        purchaseDate: purchaseDateInput ? toIsoDate(purchaseDateInput) : null,
        competenceMonth: toIsoDate(dueDateInput).slice(0, 7),
        amountCents,
        paymentMethod,
        status: payableStatus,
        paidAt: payableStatus === "Pago" ? toIsoDate(paidAtInput) : undefined,
        notes: String(form.get("notes") || ""),
      };
      const response = await fetch("/api/finance", {
        method: editingPayable ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editingPayable
            ? { entity: "accountsPayable", id: editingPayable.id, ...fields, ...categoryChange }
            : { action: "payable", ...fields, ...(fabricationCategoryId ? { categoryId: fabricationCategoryId } : {}) },
        ),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || (editingPayable ? "Não foi possível salvar a conta." : "Nao foi possivel cadastrar a conta a pagar."));
      const wasEditing = Boolean(editingPayable);
      closePayableForm();
      await refreshFinance();
      flash(wasEditing ? "Conta atualizada." : payableStatus === "Pago" ? "Conta paga cadastrada." : "Conta a pagar cadastrada.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Nao foi possivel cadastrar a conta a pagar.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function settlePayable(payable: AccountPayable) {
    if (payable.status === "Pago") return;
    if (!window.confirm("Marcar " + payable.description + " como paga?")) return;
    setSaving(true);
    try {
      const response = await fetch("/api/finance", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity: "accountsPayable",
          id: payable.id,
          status: "Pago",
          paidAt: todayIso(),
          paymentMethod: payable.paymentMethod || "Nao informado",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Nao foi possivel marcar a conta como paga.");
      await refreshFinance();
      flash("Conta marcada como paga.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Nao foi possivel marcar a conta como paga.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function settleWallet() {
    if (!walletPayment) return;
    if (!walletPayMethod) return flash("Selecione a forma de pagamento.");
    if (!isValidBrDate(walletPayDate))
      return flash("Informe uma data de pagamento válida.");
    const balance = walletPayment.items.reduce((sum, item) => sum + item.balance, 0);
    if (walletPayAmount <= 0 || walletPayAmount > balance)
      return flash("Informe um valor pago válido, até o limite do saldo.");
    setSaving(true);
    let remaining = walletPayAmount;
    try {
      const oldestOpenReceivables = walletPayment.items
        .filter((item) => item.balance > 0)
        .sort((a, b) => {
          const dateDifference = dateTimestamp(a.issuedAt) - dateTimestamp(b.issuedAt);
          if (dateDifference !== 0) return dateDifference;
          return a.orderNumber.localeCompare(b.orderNumber, "pt-BR", { numeric: true });
        });
      for (const item of oldestOpenReceivables) {
        if (remaining <= 0) break;
        const portion = Math.min(remaining, item.balance);
        const r = await fetch("/api/finance", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entity: "accountsReceivable",
            id: item.receivable.id,
            amount: portion,
            paymentMethod: walletPayMethod,
            receiptDate: toIsoDate(walletPayDate),
            notes: "Recebimento registrado pela Carteira.",
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Nao foi possivel registrar o recebimento.");
        remaining -= portion;
      }
      const [ordersResponse] = await Promise.all([
        fetch("/api/orders", { cache: "no-store" }).then((response) => response.json()),
        refreshFinance(),
      ]);
      setOrders(sortOrdersDesc(ordersResponse.orders || []));
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
    else {
      setProducts((v) => v.map((x) => (x.id === id ? j.product : x)));
      notifyCatalogUpdate();
    }
  }
  function whatsapp(order: Order) {
    const customer = findBestCustomer(customers, order.customerName);
    if (!customer?.whatsapp) return flash("Cliente sem WhatsApp cadastrado.");
    const number = customer.whatsapp.replace(/\D/g, "");
    const text = `Olá, ${customer.name}! Segue a ${order.number}. Forma de pagamento: ${boletoLabel(order)}.`;
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
              pixels.data[i] = luminance;
              pixels.data[i + 1] = luminance;
              pixels.data[i + 2] = luminance;
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
  async function downloadCatalogPdf(
    audience: "final" | "distributor",
    variant: "bw" | "color",
  ) {
    let currentProducts: Product[];
    try {
      currentProducts = await fetchCatalogProducts<Product>();
    } catch (error) {
      flash(error instanceof Error ? error.message : "Não foi possível atualizar o catálogo.", "error");
      return;
    }
    const activeProducts = currentProducts
      .filter((product) => product.active)
      .sort((a, b) => a.code.localeCompare(b.code, "pt-BR"));
    if (!activeProducts.length) {
      flash("Nenhuma peça ativa disponível para o catálogo.");
      return;
    }
    const distributor = audience === "distributor";
    const color = variant === "color";
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const logo = await loadImageData(color ? "/logo-sistema.png" : "/logo-pdf.png", !color);
    const productImageData = await Promise.all(
      activeProducts.map(async (product) => {
        const imageUrl = productImageSource(product);
        if (!imageUrl) return "";
        try {
          return await loadCatalogImage(imageUrl, !color);
        } catch {
          return "";
        }
      }),
    );
    const pages: { items: Product[]; y: number; height: number }[][] = [[]];
    let nextRowY = distributor ? 65 : 49;
    for (let index = 0; index < activeProducts.length; index += 2) {
      const items = activeProducts.slice(index, index + 2);
      const height = Math.max(...items.map((item) => catalogPdfDetails(pdf, item).height)) + (distributor ? 8 : 5);
      if (nextRowY + height > 263 && pages[pages.length - 1].length) {
        pages.push([]);
        nextRowY = distributor ? 65 : 49;
      }
      pages[pages.length - 1].push({ items, y: nextRowY, height });
      nextRowY += height + 5;
    }
    let sourceIndex = 0;
    for (let page = 0; page < pages.length; page += 1) {
      if (page > 0) pdf.addPage();
      if (color) {
        pdf.setFillColor(248, 248, 246);
        pdf.rect(0, 0, 210, 297, "F");
        pdf.setFillColor(255, 92, 0);
        pdf.rect(0, 0, 210, 2, "F");
        pdf.setFillColor(7, 7, 7);
        pdf.rect(0, 2, 210, 42, "F");
        pdf.addImage(logo, "JPEG", 12, 8, 78, 28, undefined, "FAST");
        pdf.setTextColor(255, 255, 255);
      } else {
        pdf.setTextColor(30, 30, 30);
        pdf.addImage(logo, "JPEG", 12, 10, 78, 26, undefined, "FAST");
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(distributor ? 18 : 20);
      pdf.text(
        distributor ? "CATÁLOGO DISTRIBUIDOR" : "CATÁLOGO DE PREÇOS",
        198,
        24,
        { align: "right" },
      );
      if (!color) {
        pdf.setDrawColor(30, 30, 30);
        pdf.setLineWidth(0.35);
        pdf.line(12, 43, 198, 43);
      }

      if (distributor) {
        pdf.setFillColor(color ? 255 : 247, color ? 248 : 247, color ? 244 : 247);
        pdf.setDrawColor(color ? 255 : 190, color ? 92 : 190, color ? 0 : 190);
        pdf.roundedRect(12, 47, 186, 14, 2, 2, "FD");
        pdf.setTextColor(35, 35, 35);
        pdf.setFontSize(8.5);
        pdf.setFont("helvetica", "bold");
        pdf.text("REGRA DE DESCONTO", 17, 52.5);
        pdf.setFont("helvetica", "normal");
        pdf.text("5% até 9 unidades  |  8% de 10 a 19 unidades  |  10% de 20 em diante", 17, 57.5);
      }

      pages[page].forEach(({ items, y, height: cardHeight }) => items.forEach((product, column) => {
        const x = column === 0 ? 12 : 109;
        const width = 89;

        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(color ? 215 : 190, color ? 215 : 190, color ? 210 : 190);
        pdf.setLineWidth(0.25);
        pdf.roundedRect(x, y, width, cardHeight, 3, 3, color ? "FD" : "S");
        pdf.setFillColor(color ? 255 : 245, color ? 92 : 245, color ? 0 : 245);
        pdf.setDrawColor(color ? 255 : 90, color ? 92 : 90, color ? 0 : 90);
        pdf.roundedRect(x + 5, y + 5, 24, 9, 2, 2, "FD");
        pdf.setTextColor(color ? 255 : 35, color ? 255 : 35, color ? 255 : 35);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.5);
        pdf.text(product.code, x + 17, y + 11, { align: "center" });
        pdf.setTextColor(35, 35, 35);
        pdf.setFontSize(12);
        pdf.text(money(product.price), x + width - 5, y + 11, { align: "right" });

        if (productImageData[sourceIndex]) {
          pdf.addImage(productImageData[sourceIndex], "JPEG", x + 6, y + 19, 36, 29, undefined, "FAST");
        }
        drawCatalogPdfDetails(pdf, product, x + 47, y + 22);
        sourceIndex += 1;

        if (distributor) {
          pdf.setFontSize(6.7);
          pdf.setTextColor(75, 75, 75);
          pdf.setFont("helvetica", "normal");
          pdf.text(
            `Preço por peça: 5% ${money(product.price * 0.95)}  |  8% ${money(product.price * 0.92)}  |  10% ${money(product.price * 0.9)}`,
            x + 5,
            y + cardHeight - 3,
          );
        }
      }));

      if (color) {
        pdf.setFillColor(7, 7, 7);
        pdf.roundedRect(12, 270, 186, 18, 3, 3, "F");
        pdf.setTextColor(255, 255, 255);
      } else {
        pdf.setDrawColor(185, 185, 185);
        pdf.line(12, 276, 198, 276);
        pdf.setTextColor(35, 35, 35);
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.text("Faça seu pedido de forma rápida e fácil | (43) 99156-5317", 105, color ? 281 : 286, { align: "center" });
    }
    pdf.save(
      `catalogo-pino-forte-${distributor ? "distribuidor" : "cliente-final"}-${color ? "colorido" : "pb"}.pdf`,
    );
  }
  async function createPdfLegacy(order: Order) {
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
    const logo = await loadImageData("/logo-pdf.png");
    pdf.setDrawColor(60);
    pdf.setLineWidth(0.35);
    pdf.rect(15, 10, 180, 270);
    pdf.rect(15, 10, 70, 38);
    pdf.rect(85, 10, 73, 38);
    pdf.rect(158, 10, 37, 38);
    pdf.addImage(logo, "JPEG", 23, 19.8, 54, 18.4, undefined, "FAST");
    pdf.setTextColor(30);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text("PINO FORTE", 89, 20);
    pdf.setFontSize(7.5);
    pdf.text("FABRICAÇÃO DE PEÇAS PARA SUSPENSÃO", 89, 26);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(`Responsável: ${responsible || "—"}`, 89, 34);
    pdf.text(`WhatsApp: ${companyPhone || "—"}`, 89, 41);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("ORDEM DE SERVIÇO", 176.5, 18, { align: "center" });
    pdf.setFontSize(13);
    pdf.text(order.number, 176.5, 29, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.text(`Data do pedido: ${brDate(order.createdAt)}`, 176.5, 38, { align: "center" });

    pdf.rect(15, 48, 180, 31);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text(`Cliente: ${order.customerName}`, 18, 56);
    pdf.setFont("helvetica", "normal");
    pdf.text(`CPF/CNPJ: ${customer ? formatDocument(customer.document).replace(/^(CPF|CNPJ): /, "") : "—"}`, 18, 64);
    pdf.text(`WhatsApp: ${customer ? formatPhone(customer.whatsapp) : "—"}`, 105, 64);
    pdf.text(`E-mail: ${customer?.email || "—"}`, 18, 72);
    pdf.text(`Pagamento: ${boletoLabel(order)}`, 105, 72);

    const columns = [15, 39, 118, 135, 162, 195];
    pdf.rect(15, 79, 180, 132);
    pdf.setFillColor(235, 235, 235);
    pdf.rect(15, 79, 180, 10, "F");
    columns.slice(1, -1).forEach((x) => pdf.line(x, 79, x, 211));
    pdf.line(15, 89, 195, 89);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text("CÓDIGO", 18, 86);
    pdf.text("DESCRIÇÃO DA PEÇA", 42, 86);
    pdf.text("QTD.", 126.5, 86, { align: "center" });
    pdf.text("VALOR UNIT.", 148.5, 86, { align: "center" });
    pdf.text("VALOR TOTAL", 191, 86, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    let y = 97;
    items.forEach((item) => {
      const p = products.find((x) => x.code === item.code);
      pdf.text(item.code, 18, y);
      pdf.text(`${pieceLabel(p, item.code)} · ${p?.measure || ""}`, 42, y, { maxWidth: 72 });
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
    pdf.text(`Forma de pagamento: ${boletoLabel(order)}`, 18, 219);
    pdf.text(`Forma de entrega: ${order.deliveryType}`, 105, 219);
    if (order.paymentMethod === "Boleto" && order.boletoTermDays) {
      const parcels = planInstallments({
        totalCents: Math.round(order.total * 100),
        receivedCents: 0,
        issuedAt: order.createdAt.slice(0, 10),
        termDays: order.boletoTermDays,
        today: todayIso(),
      });
      pdf.setFontSize(8);
      pdf.text(
        parcels.map((parcel) => `${parcel.number}/${parcel.totalInstallments}: ${brDate(parcel.dueDate)} - ${money(parcel.amountCents / 100)}`).join("   |   "),
        18,
        226,
        { maxWidth: 172 },
      );
      pdf.setFontSize(9);
    }
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
    pdf.text(orderFooter, 105, 273, { align: "center" });
    return pdf;
  }
  async function createPdf(order: Order) {
    const items = getOrderItems(order);
    let currentCustomers = customers;
    try {
      const catalog = await fetch("/api/catalog", { cache: "no-store" }).then((response) => response.json());
      if (Array.isArray(catalog.customers)) currentCustomers = catalog.customers;
    } catch {}
    const customer = findBestCustomer(currentCustomers, order.customerName);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const logo = await loadImageData("/logo-pdf.png");
    const left = 5;
    const right = 205;
    const address = customer ? [customer.street, customer.number, customer.complement, customer.neighborhood, `${customer.city || ""}/${customer.state || ""}`, customer.zipCode].filter(Boolean).join(", ") : "";
    const columns = [5, 31, 119, 139, 171, 205];
    const observationLines = [
      "Observações:",
      ...completeOrderNotes(order, "\n", financeData.receipts)
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => pdf.splitTextToSize(line, 192)),
    ];
    const drawOrderCopy = (offsetY: number) => {
      const at = (y: number) => y + offsetY;
      pdf.setDrawColor(60);
      pdf.setLineWidth(0.3);
      pdf.rect(left, at(5), 200, 138);

      if (order.productionStatus === "Cancelada") {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(48);
        pdf.setTextColor(248, 248, 248);
        pdf.setDrawColor(185, 185, 185);
        pdf.setLineWidth(0.25);
        pdf.text("CANCELADA", 105, at(82), { align: "center", angle: 28, renderingMode: "fillThenStroke" });
        pdf.setTextColor(25);
        pdf.setDrawColor(60);
        pdf.setLineWidth(0.3);
      }

      pdf.rect(left, at(5), 70, 27);
      pdf.rect(75, at(5), 80, 27);
      pdf.rect(155, at(5), 50, 27);
      pdf.addImage(logo, "JPEG", 13, at(9.3), 54, 18.4, undefined, "FAST");
      pdf.setTextColor(25);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("PINO FORTE", 79, at(13));
      pdf.setFontSize(7);
      pdf.text("FABRICAÇÃO DE PEÇAS PARA SUSPENSÃO", 79, at(18.5));
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.text(`Responsável: ${responsible || "—"}`, 79, at(24));
      pdf.text(`Telefone: ${companyPhone || "—"}`, 79, at(29));
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.text("ORDEM DE SERVIÇO", 180, at(12), { align: "center" });
      pdf.setFontSize(11);
      pdf.text(order.number, 180, at(20), { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(`Data do pedido: ${brDate(order.createdAt)}`, 180, at(26), { align: "center" });

      pdf.rect(left, at(32), 200, 23);
      pdf.setFontSize(7.5);
      pdf.setFont("helvetica", "bold");
      pdf.text(`Cliente: ${order.customerName}`, 8, at(39));
      pdf.setFont("helvetica", "normal");
      pdf.text(`CPF/CNPJ: ${customer ? formatDocument(customer.document).replace(/^(CPF|CNPJ): /, "") : "—"}`, 8, at(46));
      pdf.text(`Telefone: ${customer ? formatPhone(customer.whatsapp) : "—"}`, 106, at(46));
      pdf.text(`Endereço: ${address || "—"}`, 8, at(52), { maxWidth: 130 });

      pdf.rect(left, at(55), 200, 53);
      columns.slice(1, -1).forEach((x) => pdf.line(x, at(55), x, at(108)));
      pdf.line(left, at(63), right, at(63));
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.text("CÓDIGO", 8, at(60));
      pdf.text("DESCRIÇÃO DA PEÇA", 34, at(60));
      pdf.text("QTD.", 129, at(60), { align: "center" });
      const queuedCopy = isQueuedWithoutPayment(order);
      if (!queuedCopy) {
        pdf.text("VALOR UNIT.", 155, at(60), { align: "center" });
        pdf.text("VALOR TOTAL", 201, at(60), { align: "right" });
      }
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(items.length > 5 ? 5.5 : 7);
      let itemY = 69;
      const rowHeight = Math.min(7, 29 / Math.max(items.length, 1));
      items.forEach((item) => {
        const product = products.find((value) => value.code === item.code);
        pdf.text(item.code, 8, at(itemY));
        pdf.text(`${pieceLabel(product, item.code)} · ${product?.measure || ""}`, 34, at(itemY), { maxWidth: 82 });
        pdf.text(String(item.quantity), 129, at(itemY), { align: "center" });
        if (!queuedCopy) {
          pdf.text(money(item.unitPrice), 168, at(itemY), { align: "right" });
          pdf.text(money(item.unitPrice * item.quantity), 201, at(itemY), { align: "right" });
        }
        itemY += rowHeight;
      });
      pdf.line(left, at(100), right, at(100));
      pdf.setFont("helvetica", "bold");
      pdf.text(queuedCopy ? "QUANTIDADE TOTAL" : order.discountRate > 0 ? `SUBTOTAL ${money(order.subtotal || order.total)} · DESCONTO ${order.discountRate}%` : "TOTAL DA ORDEM", 75, at(105), { align: "center" });
      pdf.text(String(items.reduce((sum, item) => sum + item.quantity, 0)), 129, at(105), { align: "center" });
      if (!queuedCopy) pdf.text(money(order.total), 201, at(105), { align: "right" });

      pdf.rect(left, at(108), 200, 18);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Status: ${normalizeOrderStatus(order.productionStatus)}`, 8, at(114));
      if (!queuedCopy) {
        pdf.text(`Forma de entrega: ${order.deliveryType}`, 65, at(114));
        pdf.text(`Previsão: ${brDate(order.deliveryDate)}`, 132, at(114));
      }
      // Pagamento na linha da previsão, à direita (sem passar da borda); boleto: uma parcela por linha.
      const paymentLabel = `Pagamento: ${boletoLabel(order)}`;
      pdf.setFontSize(7);
      const paymentX = Math.min(162, 201 - pdf.getTextWidth(paymentLabel));
      if (!queuedCopy) pdf.text(paymentLabel, paymentX, at(114));
      if (!queuedCopy && order.paymentMethod === "Boleto" && order.boletoTermDays) {
        const parcels = planInstallments({
          totalCents: Math.round(order.total * 100),
          receivedCents: 0,
          issuedAt: order.createdAt.slice(0, 10),
          termDays: order.boletoTermDays,
          today: todayIso(),
        });
        pdf.setFontSize(6);
        parcels.forEach((parcel, index) => {
          pdf.text(
            `${parcel.number}/${parcel.totalInstallments} ${brDate(parcel.dueDate)} ${money(parcel.amountCents / 100)}`,
            paymentX,
            at(116.8 + index * 2.1),
          );
        });
      }
      pdf.setFontSize(6.2);
      pdf.text(observationLines, 8, at(119), { lineHeightFactor: 1.05 });

      pdf.line(18, at(133), 82, at(133));
      pdf.line(128, at(133), 192, at(133));
      pdf.setTextColor(70);
      pdf.text("Assinatura do cliente", 50, at(137), { align: "center" });
      pdf.text("Responsável pela empresa", 160, at(137), { align: "center" });
      pdf.setFontSize(6.5);
      pdf.setTextColor(100);
      pdf.text(orderFooter, 105, at(139.5), { align: "center" });
    };

    drawOrderCopy(0);
    pdf.setDrawColor(165);
    pdf.setLineDashPattern([2, 2], 0);
    pdf.line(5, 148.5, 205, 148.5);
    pdf.setLineDashPattern([], 0);
    drawOrderCopy(149);
    return pdf;
  }
  async function downloadPdf(order: Order) {
    // O PDF da OS só é gerado depois da entrega.
    if (!canGenerateOrderPdf(order))
      return flash("O PDF só pode ser gerado depois que a OS for entregue.");
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
    const text = `Olá, ${customer.name}! Segue a ${order.number}. Forma de pagamento: ${boletoLabel(order)}.`;
    await downloadPdf(order);
    const number = customer.whatsapp.replace(/\D/g, "");
    window.open(
      `https://wa.me/55${number}?text=${encodeURIComponent(text)}`,
      "_blank",
    );
  }
  async function createWalletPdf(items: WalletEntry[], customerName: string, month = "geral") {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const total = items.reduce((sum, item) => sum + item.total, 0);
    const logo = await loadImageData("/logo-pdf.png");
    const [year, monthNumber] = month.split("-");
    const period = year && monthNumber
      ? (() => {
          const periodMonth = new Date(+year, +monthNumber - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
          return `${periodMonth.charAt(0).toUpperCase()}${periodMonth.slice(1)}/${year}`;
        })()
      : "Geral";
    const history = items.flatMap((item) =>
      financeData.receipts
        .filter((receipt) => receipt.accountReceivableId === item.receivable.id && receipt.status === "Confirmado")
        .map((receipt) => ({
          amount: receipt.amountCents / 100,
          method: receipt.paymentMethod,
          date: receipt.receiptDate,
          orderNumber: item.orderNumber,
        })),
    ).sort((a, b) => dateTimestamp(b.date) - dateTimestamp(a.date));

    const left = 15;
    const right = 195;
    pdf.addImage(logo, "JPEG", left, 12.2, 52, 17.7, undefined, "FAST");
    pdf.setTextColor(25);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text("PINO FORTE", 76, 15.5);
    pdf.setFontSize(7);
    pdf.text("FABRICAÇÃO DE PEÇAS PARA SUSPENSÃO", 76, 21);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.text(`Responsável: ${responsible || "Rogério Mendes"}`, 76, 26.5);
    pdf.text(`Telefone: ${companyPhone || "—"}`, 76, 31.5);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.text("COMPROVANTE DE QUITAÇÃO", 165, 17, { align: "center" });
    pdf.text("DA CARTEIRA", 165, 24, { align: "center" });
    pdf.setDrawColor(216, 107, 50);
    pdf.setLineWidth(1);
    pdf.line(left, 37, right, 37);

    pdf.setFillColor(245, 248, 247);
    pdf.roundedRect(left, 43, 180, 24, 2, 2, "F");
    pdf.setFontSize(8);
    pdf.setTextColor(82, 97, 100);
    pdf.setFont("helvetica", "normal");
    pdf.text("CLIENTE", 20, 50);
    pdf.text("PERÍODO", 105, 50);
    pdf.text("STATUS", 150, 50);
    pdf.text("TOTAL", 190, 50, { align: "right" });
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(25);
    pdf.text(customerName, 20, 59, { maxWidth: 76 });
    pdf.text(period, 105, 59);
    pdf.text("Pago", 150, 59);
    pdf.text(money(total), 190, 59, { align: "right" });

    let y = 79;
    const drawSectionTitle = (title: string) => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(23, 74, 82);
      pdf.text(title, left, y);
      y += 7;
    };
    const drawHeader = (labels: Array<{ text: string; x: number; align?: "left" | "center" | "right" }>) => {
      pdf.setFillColor(238, 243, 242);
      pdf.rect(left, y - 5, 180, 9, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(82, 97, 100);
      labels.forEach((label) => pdf.text(label.text, label.x, y, { align: label.align || "left" }));
      y += 7;
    };
    drawSectionTitle("HISTÓRICO DE PEDIDOS");
    drawHeader([{ text: "OS", x: 18 }, { text: "DATA DO PEDIDO", x: 105, align: "center" }, { text: "VALOR", x: 192, align: "right" }]);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(25);
    items.slice().sort((a, b) => dateTimestamp(a.issuedAt) - dateTimestamp(b.issuedAt)).forEach((item) => {
      pdf.text(item.orderNumber, 18, y);
      pdf.text(brDate(item.issuedAt), 105, y, { align: "center" });
      pdf.text(money(item.total), 192, y, { align: "right" });
      pdf.setDrawColor(224, 230, 228);
      pdf.setLineWidth(0.2);
      pdf.line(left, y + 3, right, y + 3);
      y += 8;
    });
    y += 8;
    drawSectionTitle("HISTÓRICO DE PAGAMENTOS");
    drawHeader([{ text: "OS", x: 18 }, { text: "DATA DE PAGAMENTO", x: 78 }, { text: "FORMA DE PAGAMENTO", x: 125 }, { text: "VALOR PAGO", x: 192, align: "right" }]);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(25);
    history.forEach((payment) => {
      pdf.text(payment.orderNumber, 18, y);
      pdf.text(brDate(payment.date), 78, y);
      pdf.text(payment.method, 125, y);
      pdf.text(money(Number(payment.amount)), 192, y, { align: "right" });
      pdf.setDrawColor(224, 230, 228);
      pdf.line(left, y + 3, right, y + 3);
      y += 8;
    });
    pdf.setDrawColor(216, 107, 50);
    pdf.setLineWidth(0.45);
    pdf.line(left, 282, right, 282);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(100);
    pdf.text(orderFooter, 105, 288, { align: "center" });
    return pdf;
  }
  async function downloadWalletPdf(items: WalletEntry[], customerName: string, month = "geral") {
    const pdf = await createWalletPdf(items, customerName, month);
    pdf.save(`Carteira-${customerName.replace(/[^a-z0-9]+/gi, "-")}-${month}.pdf`);
  }
  async function shareWallet(items: WalletEntry[], customerName: string, month = "geral") {
    let currentCustomers = customers;
    try {
      const catalog = await fetch("/api/catalog", { cache: "no-store" }).then((response) => response.json());
      if (Array.isArray(catalog.customers)) currentCustomers = catalog.customers;
    } catch {}
    const customer = findBestCustomer(currentCustomers, customerName);
    if (!customer?.whatsapp) return flash("Cliente sem WhatsApp cadastrado.");
    await downloadWalletPdf(items, customerName, month);
    const text = `Olá, ${customer.name}! Segue o comprovante da Carteira paga.`;
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
      `<!doctype html><html><head><meta charset="utf-8"><title>${order.number}</title><style>@page{size:A4;margin:15mm}body{font-family:Arial;color:#203235;font-size:12px}header{display:flex;justify-content:space-between;border-bottom:4px solid #080808;padding-bottom:18px}h1{color:#080808;margin:0}.n{color:#ff5c00;font-size:20px;font-weight:bold}section{margin-top:24px}h2{font-size:12px;border-bottom:1px solid #ddd;padding-bottom:7px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}table{width:100%;border-collapse:collapse}th{background:#080808;color:white;padding:10px;text-align:left}td{padding:10px;border-bottom:1px solid #ddd}.right{text-align:right}.total{text-align:right;font-size:16px;margin-top:18px}.actions{position:fixed;right:20px;top:20px}@media print{.actions{display:none}}</style></head><body><button class="actions" onclick="print()">Imprimir / Salvar PDF</button><header><div><h1>Pino Forte</h1><span>Fabricação de Peças para Suspensão</span></div><div><div>ORDEM DE SERVIÇO</div><div class="n">${order.number}</div></div></header><section><h2>CLIENTE E SERVIÇO</h2><div class="grid"><div><b>Cliente</b><br>${order.customerName}</div><div><b>Data do pedido</b><br>${brDate(order.createdAt)}</div><div><b>Status</b><br>${orderDisplayStatus(order)}</div></div></section><section><h2>ITEM</h2><table><tr><th>Código</th><th>Descrição da peça</th><th class="right">Qtd.</th><th class="right">Unitário</th><th class="right">Subtotal</th></tr><tr><td>${order.productCode}</td><td>${pieceLabel(p, order.productCode)} · ${p?.measure || ""}</td><td class="right">${order.quantity}</td><td class="right">${money(order.unitPrice)}</td><td class="right">${money(order.subtotal || order.total)}</td></tr></table><div class="total">${order.discountRate > 0 ? `Subtotal: ${money(order.subtotal || order.total)}<br>Desconto distribuidor (${order.discountRate}%): - ${money((order.subtotal || order.total) - order.total)}<br>` : ""}Total: <b>${money(order.total)}</b><br>Recebido: ${money(order.received)}<br>Saldo: <b>${money(Math.max(0, order.total - order.received))}</b></div></section><section><h2>PAGAMENTO E OBSERVAÇÕES</h2><p>${boletoLabel(order)} · ${order.deliveryType}</p><p>${order.notes || "Sem observações."}</p></section><script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`,
    );
    w.document.close();
  }
  function exportCsv() {
    const rows = [
      [
        "OS",
        "Cliente",
        "Peça",
        "Quantidade",
        "Total",
        "Recebido",
        "Saldo",
        "Status do pagamento",
      ],
      ...reportOrders.map((o) => [
        o.number,
        o.customerName,
        o.productCode,
        o.quantity,
        o.total,
        o.received,
        o.total - o.received,
        orderDisplayStatus(o),
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
        <div className="auth-logo"><BrandImage alt="Pino Forte" sizes="(max-width: 600px) 210px, 240px" /></div>
        <div className="auth-content">
        <h1>Acesso ao sistema</h1>
        <form onSubmit={submitAuth} noValidate>
          {auth.setupRequired && <Field label="Seu nome *"><input name="name" required autoFocus /></Field>}
          <Field label="E-mail *"><input name="email" type="email" required defaultValue={auth.setupRequired ? "tacytpr@gmail.com" : ""} readOnly={auth.setupRequired} autoFocus={!auth.setupRequired} /></Field>
          <Field label={auth.setupRequired ? "Crie uma senha *" : "Senha *"}><div className="password-input"><input name="password" type={showAuthPassword ? "text" : "password"} minLength={8} required /><button type="button" onClick={() => setShowAuthPassword((value) => !value)} aria-label={showAuthPassword ? "Ocultar senha" : "Mostrar senha"}><EyeIcon open={showAuthPassword} /></button></div></Field>
          {authError && <p className="modal-error">{authError}</p>}
          <button className="primary-button" type="submit" disabled={authSaving}>{authSaving ? (auth.setupRequired ? "Criando acesso..." : "Entrando...") : (auth.setupRequired ? "Criar acesso e entrar" : "Entrar")}</button>
        </form>
        </div>
      </section>
    </main>
  );

  const primaryNav: [Screen, string, string][] = [
    ["dashboard", "⌂", "Início"],
    ["orders", "▤", "OS"],
    ["stock", "▥", "Estoque"],
    ["wallet", "▣", "Carteira"],
    ["catalog", "▦", "Catálogo"],
    ["financial", "$", "Financeiro"],
  ];
  const financeNav: [Screen, string][] = [
    ["financial", "Resumo"],
    ["financial-monthly", "Lucro mês a mês"],
    ["financial-cash", "Caixa mês a mês"],
    ["financial-payables", "Contas a pagar"],
    ["financial-pricing", "Preços e margem"],
    ["financial-batches", "Lotes de compra"],
  ];
  const settingsNav: [SettingsSection, string, string][] = [
    ["customers", "♙", "Clientes"],
    ["products", "⬡", "Peças"],
    ["piece-types", "◇", "Tipos"],
    ["piece-lines", "◇", "Linhas"],
    ["company", "⌂", "Empresa"],
    ["users", "◉", "Usuários"],
  ];
  const isSettingsScreen = screen === "settings" || screen === "customers" || screen === "products" || screen === "piece-types" || screen === "piece-lines";
  // Numa tela de Configurações o submenu abre sozinho, mas pode ser recolhido pelo usuário.
  const showSettings = isSettingsScreen ? !settingsCollapsed : settingsOpen;
  return (
    <main className="app-shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <button
          type="button"
          className="brand brand-home"
          onClick={() => go("dashboard")}
          aria-label="Ir para o início"
        >
          <BrandImage className="brand-logo" alt="Pino Forte — Fabricação de Peças para Suspensão" sizes="212px" />
        </button>
        <nav>
          {primaryNav.map(([s, i, l]) => s !== "financial" ? (
            <button
              key={s}
              className={`nav-item ${screen === s ? "active" : ""}`}
              onClick={() => go(s)}
            >
              <span>{i}</span>
              {l}
            </button>
          ) : (
            <div key={s} className="nav-group-wrap">
              <button
                type="button"
                className={`nav-item nav-group ${isFinanceScreen ? "active" : ""}`}
                aria-expanded={showFinanceMenu}
                onClick={() => {
                  if (isFinanceScreen) return setFinanceCollapsed((value) => !value);
                  setFinanceCollapsed(false);
                  setFinanceOpen(true);
                  go("financial");
                }}
              >
                <span>{i}</span>
                {l}
                <b>{showFinanceMenu ? "⌃" : "⌄"}</b>
              </button>
              {showFinanceMenu && (
                <div className="nav-submenu">
                  {financeNav.map(([target, label]) => (
                    <button
                      key={target}
                      className={`nav-item nav-subitem ${screen === target ? "active" : ""}`}
                      onClick={() => go(target)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            className={`nav-item nav-group ${isSettingsScreen ? "active" : ""}`}
            aria-expanded={showSettings}
            onClick={() => {
              if (isSettingsScreen) return setSettingsCollapsed((value) => !value);
              setSettingsCollapsed(false);
              setSettingsOpen((value) => !value);
            }}
          >
            <span>⚙</span>
            Configurações
            <b>{showSettings ? "⌃" : "⌄"}</b>
          </button>
          {showSettings && (
            <div className="nav-submenu">
              {settingsNav.map(([section, i, l]) => {
                const active =
                  (section === "customers" && screen === "customers") ||
                  (section === "products" && screen === "products") ||
                  (section === "piece-types" && screen === "piece-types") ||
                  (section === "piece-lines" && screen === "piece-lines") ||
                  (screen === "settings" && settingsSection === section);
                return (
                <button
                  key={section}
                  className={`nav-item nav-subitem ${active ? "active" : ""}`}
                  onClick={() => goSettings(section)}
                >
                  <span>{i}</span>
                  {l}
                </button>
              );})}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="avatar" aria-label={`Iniciais de ${auth.user.name}`}>
              {userInitials(auth.user.name)}
            </div>
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
          <button
            type="button"
            className="mobile-logo-home"
            onClick={() => go("dashboard")}
            aria-label="Ir para o início"
          >
            <BrandImage className="mobile-header-logo" alt="Pino Forte" sizes="112px" />
          </button>
          <button className="mobile-add" onClick={() => go("new-order")}>
            ＋
          </button>
        </header>
        {notice && (
          <div className={`toast toast-${notice.tone}`} role="status" aria-live="polite">
            {notice.text}
          </div>
        )}
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
                  subtitle="O que precisa de você hoje e como está o mês."
                  action={
                    <button
                      className="primary-button"
                      onClick={() => go("new-order")}
                    >
                      ＋ Nova OS
                    </button>
                  }
                />
                {(() => {
                  const today = todayIso();
                  const receivables = openReceivableRows.map((row) => ({
                    key: row.key,
                    orderId: row.order?.id ?? null,
                    orderNumber: row.orderNumber,
                    customerName: row.customerName,
                    installmentLabel: row.installmentLabel,
                    dueDate: row.dueDate,
                    balanceCents: Math.round(row.balance * 100),
                  }));
                  const pendingPayables = financeData.accountsPayable
                    .filter((payable) => payable.status !== "Pago" && payable.status !== "Cancelado")
                    .map((payable) => ({ id: payable.id, supplier: payable.supplier, dueDate: payable.dueDate, amountCents: payable.amountCents, orderId: payable.serviceOrderId ?? null }));
                  const activeProducts = products.filter((product) => product.active);
                  const actions = buildDashboardActions({
                    today,
                    receivables,
                    payables: pendingPayables,
                    batches: purchaseBatches.flatMap((batch) => {
                      const study = batchStudies.get(batch.id);
                      return study ? [{ id: batch.id, supplier: batch.supplier, totalCents: study.totalCents, stockQty: study.stockQty, boughtQty: study.boughtQty }] : [];
                    }),
                    queue: queueOrders.map((order) => ({
                      orderId: order.id,
                      orderNumber: order.number,
                      customerName: order.customerName,
                      totalCents: Math.round(order.total * 100),
                      createdAt: dayInSaoPaulo(order.createdAt),
                    })),
                    stock: activeProducts.flatMap((product) => {
                      const row = stock.rows.find((entry) => entry.productId === product.id);
                      return row ? [{ code: product.code, status: row.status, available: row.available, missing: row.missing, monthlyPace: row.monthlyPace }] : [];
                    }),
                    pieces: activeProducts.map((product) => {
                      const cost = currentCostOf(product.id);
                      return { code: product.code, onCost: cost ? profitOnCost(product.price, cost.unitCostCents / 100) : null };
                    }),
                    targetRate,
                    format: { money, brDate, percent },
                  });
                  const openAction = (action: DashboardAction) => {
                    if (action.target === "batch") {
                      go("financial-batches");
                      return setViewingBatchId(action.batchId ?? null);
                    }
                    if (action.target === "order") {
                      const order = action.orderId ? ordersById.get(action.orderId) : undefined;
                      return order ? setOrderModal(order) : go("orders");
                    }
                    go(action.target === "payables" ? "financial-payables" : action.target === "stock" ? "stock" : action.target === "pricing" ? "financial-pricing" : "products");
                  };
                  const ahead = forecastAhead({ today, receivables, payables: pendingPayables });
                  const warning = tightSentence(ahead, money);
                  const [year, monthNumber] = dashboardMonth.split("-").map(Number);
                  const previousMonth = monthNumber === 1 ? `${year - 1}-12` : `${year}-${String(monthNumber - 1).padStart(2, "0")}`;
                  const monthName = (month: string) => monthLabel(month).split(" ")[0].toLowerCase();
                  const result = resultByMonth.find((row) => row.month === dashboardMonth);
                  const lastResult = resultByMonth.find((row) => row.month === previousMonth);
                  const cashNow = cashByMonth.find((row) => row.month === dashboardMonth);
                  const cashLast = cashByMonth.find((row) => row.month === previousMonth);
                  const salesCents = result?.salesCents ?? 0;
                  const leftCents = result?.leftCents ?? 0;
                  const before = (cents: number | undefined) => previousLabel(monthName(previousMonth), cents ?? null, money);
                  return (
                    <div className="dash-cols">
                      <div>
                        <section className="panel dash-band">
                          <h2>Precisa de você hoje</h2>
                          {!actions.length && <p className="dash-clear">Tudo em dia. Nada vencendo nos próximos 7 dias.</p>}
                          {actions.map((action) => (
                            <div className="dash-action" key={action.key}>
                              <i className={action.tone} aria-hidden="true" />
                              <span>
                                <b>{action.title}</b>
                                <small>{action.detail}</small>
                              </span>
                              <button type="button" onClick={() => openAction(action)}>{action.button}</button>
                            </div>
                          ))}
                        </section>
                      </div>
                      <div>
                        <section className="panel dash-band">
                          <h2>O que vem pela frente · próximos 30 dias</h2>
                          <div className="dash-forward">
                            <div><span>A receber</span><strong>{money(ahead.inCents / 100)}</strong></div>
                            <div><span>A pagar</span><strong>{money(ahead.outCents / 100)}</strong></div>
                            <div className={ahead.balanceCents < 0 ? "bad" : "good"}>
                              <span>Saldo previsto</span>
                              <strong>{`${ahead.balanceCents < 0 ? "− " : "+ "}${money(Math.abs(ahead.balanceCents) / 100)}`}</strong>
                            </div>
                          </div>
                          {warning && <p className="dash-warn">{warning}</p>}
                        </section>
                      <section className="panel dash-band">
                        <h2>{`Como estou em ${monthName(dashboardMonth)}`}</h2>
                        <div className="dash-kpis">
                          <div><span>Vendi</span><strong>{money(salesCents / 100)}</strong><small>{before(lastResult?.salesCents)}</small></div>
                          <div><span>Recebi</span><strong>{money((cashNow?.inCents ?? 0) / 100)}</strong><small>{before(cashLast?.inCents)}</small></div>
                          <div><span>Paguei</span><strong>{money((result?.spentCents ?? 0) / 100)}</strong><small>{before(lastResult?.spentCents)}</small></div>
                          <div className={leftCents < 0 ? "bad" : "good"}>
                            <span>{leftCents < 0 ? "Faltou" : "Sobrou"}</span>
                            <strong>{`${leftCents < 0 ? "− " : "+ "}${money(Math.abs(leftCents) / 100)}`}</strong>
                            <small>vendi menos o que paguei</small>
                          </div>
                        </div>
                        <p className="dash-phrase">{leftSentence(salesCents > 0 ? Math.round((leftCents / salesCents) * 10000) : null, money)}</p>
                        <button type="button" className="outline-button" onClick={() => go("financial")}>Ver o Financeiro completo</button>
                      </section>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            {screen === "new-order" && (
              <div className="page order-page">
                <Heading
                  eyebrow="NOVA ORDEM DE SERVIÇO"
                  title={editingOrder ? "Editar Ordem de Serviço" : "Cadastrar Ordem de Serviço"}
                  subtitle="Preencha o pedido e revise antes de gerar o PDF."
                />
                {editingOrder && <p className="edit-order-number">{editingOrder.number}</p>}
                <form className="customer-page-form order-simple-form" key={editingOrder?.id || "new"} onSubmit={saveOrder} noValidate>
                  <Card n="1" title="Dados do pedido">
                    <div className="form-grid order-customer-date-grid">
                      <Field label="Cliente *">
                        <select
                          required
                          value={selectedCustomerId}
                          onChange={(e) => {
                            const id = e.target.value;
                            const customer = customers.find(
                              (item) => String(item.id) === id,
                            );
                            setSelectedCustomerId(id);
                            setSelectedCustomer(customer?.name || "");
                            setSelectedOrderCustomerType(customer?.customerType || "");
                          }}
                        >
                          <option value="">Selecione</option>
                          {customers
                            .filter((c) => c.active)
                            .map((c) => (
                              <option key={c.id} value={String(c.id)}>{c.name}</option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Tipo de cliente">
                        <input
                          readOnly
                          value={
                            selectedCustomer
                              ? orderCustomer?.customerType ||
                                selectedOrderCustomerType ||
                                "Cliente final"
                              : ""
                          }
                          placeholder="Selecione o cliente"
                        />
                      </Field>
                      <Field label="Status">
                        <select
                          value={selectedOrderStatus}
                          onChange={(e) => setSelectedOrderStatus(e.target.value)}
                        >
                          <option value={ORDER_STATUS.queue}>Fila de produção</option>
                          <option value={ORDER_STATUS.delivered}>Entregue</option>
                        </select>
                      </Field>
                      <Field label="Data do pedido *">
                        <input
                          name="orderDate"
                          required
                          inputMode="numeric"
                          defaultValue={brDate(editingOrder?.createdAt || todayIso())}
                          onInput={(e) => { e.currentTarget.value = maskDate(e.currentTarget.value); }}
                        />
                      </Field>
                    </div>
                  </Card>
                  <Card n="2" title="Peças do pedido">
                    <div className="multi-items">
                      {orderItems.map((item, index) => {
                        return (
                          <div className="item-row" key={index}>
                            <Field label={`Peça ${index + 1} *`}>
                              <select
                                required
                                value={item.code}
                                onChange={(e) => {
                                  const code = e.target.value;
                                  updateItem(index, {
                                    code,
                                    unitPrice:
                                      products.find((product) => product.code === code)?.price || 0,
                                  });
                                }}
                              >
                                <option value="">Selecione</option>
                                {products
                                  .filter(
                                    (p) =>
                                      p.active &&
                                      (p.code === item.code ||
                                        !orderItems.some(
                                          (selected, selectedIndex) =>
                                            selectedIndex !== index &&
                                            selected.code === p.code,
                                        )),
                                  )
                                  .map((p) => (
                                    <option key={p.id} value={p.code}>
                                      {[p.code, pieceLabel(p), p.measure].filter(Boolean).join(" · ")}
                                    </option>
                                  ))}
                              </select>
                            </Field>
                            <Field label="Quantidade *">
                              <input
                                required
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
                            <div className="order-item-value">
                              <span>Valor unitário</span>
                              <strong>{money(itemUnitPrice(item))}</strong>
                            </div>
                            <div className="subtotal">
                              <span>Valor total</span>
                              <strong>
                                {money(itemUnitPrice(item) * item.quantity)}
                              </strong>
                            </div>
                            {index === orderItems.length - 1 && (
                              <button
                                type="button"
                                className="outline-button add-item-inline"
                                disabled={
                                  products.filter((product) => product.active).every((product) =>
                                    orderItems.some((selected) => selected.code === product.code),
                                  )
                                }
                                onClick={() =>
                                  setOrderItems((items) => [
                                    ...items,
                                    { code: "", quantity: 1 },
                                  ])
                                }
                              >
                                ＋ Peça
                              </button>
                            )}
                            {orderItems.length > 1 && (
                              <button
                                type="button"
                                className="remove-item"
                                aria-label={`Excluir modelo ${index + 1}`}
                                title="Excluir peça"
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
                  </Card>
                  <Card n="3" title={showFinancialFields ? "Entrega, pagamento e observações" : "Valor e observações"}>
                    {showFinancialFields && (
                    <div className="form-grid order-payment-grid">
                      <Field label="Forma de entrega *">
                        <select name="deliveryType" required value={selectedDeliveryType} onChange={(e) => setSelectedDeliveryType(e.target.value)}>
                          <option value="">Selecione</option>
                          <option>Retirada no local</option>
                          <option>Entrega</option>
                        </select>
                      </Field>
                      <Field label="Forma de pagamento *">
                        <select name="paymentMethod" required value={selectedPaymentMethod} onChange={(e) => setSelectedPaymentMethod(e.target.value)}>
                          <option value="">Selecione</option>
                          <option>Pix</option>
                          <option>Dinheiro</option>
                          <option>Cartão</option>
                          <option>Boleto</option>
                          <option>Carteira</option>
                        </select>
                      </Field>
                      {selectedPaymentMethod === "Boleto" && (
                        <>
                          <Field label="Prazo do boleto *">
                            <select name="boletoTerm" required value={selectedBoletoTerm} onChange={(e) => setSelectedBoletoTerm(e.target.value)}>
                              <option value="">Selecione</option>
                              {BOLETO_TERMS.map((term) => (
                                <option key={term} value={term}>{term} dias ({installmentCount(term)}x)</option>
                              ))}
                            </select>
                          </Field>
                          {selectedBoletoTerm && (
                            <div className="boleto-installments-preview">
                              {splitCents(Math.round(total * 100), installmentCount(Number(selectedBoletoTerm))).map((cents, index, list) => (
                                <span key={index}>
                                  <small>Parcela {index + 1}/{list.length} · {BOLETO_STEP_DAYS * (index + 1)} dias</small>
                                  <b>{money(cents / 100)}</b>
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      <Field label={["Pix", "Dinheiro", "Cartão"].includes(selectedPaymentMethod) ? "Valor recebido *" : "Valor recebido"}>
                        <input
                          required={["Pix", "Dinheiro", "Cartão"].includes(selectedPaymentMethod)}
                          inputMode="numeric"
                          value={money(received)}
                          onChange={(e) =>
                            setReceived(
                              Math.min(total, parseCurrency(e.target.value)),
                            )
                          }
                        />
                      </Field>
                      <div className={`payment-summary ${discountRate > 0 ? "four-columns" : "two-columns"}`}>
                        {discountRate > 0 && (
                          <>
                            <span>Subtotal <strong>{money(subtotal)}</strong></span>
                            <span>Desconto distribuidor ({discountRate}%) <strong>- {money(discountAmount)}</strong></span>
                          </>
                        )}
                        <span>Total da OS <strong>{money(total)}</strong></span>
                        {received > total ? (
                          <span className="credit">Crédito do cliente <strong>{money(received - total)}</strong></span>
                        ) : (
                          <span className="pending">Saldo devedor <strong>{money(Math.max(0, total - received))}</strong></span>
                        )}
                      </div>
                    </div>
                    )}
                    {!showFinancialFields && (
                      <div className={`payment-summary ${discountRate > 0 ? "three-columns" : "two-columns"}`}>
                        {discountRate > 0 && (
                          <>
                            <span>Subtotal <strong>{money(subtotal)}</strong></span>
                            <span>Desconto distribuidor ({discountRate}%) <strong>- {money(discountAmount)}</strong></span>
                          </>
                        )}
                        <span>Total da OS <strong>{money(total)}</strong></span>
                      </div>
                    )}
                    <div className="order-notes">
                      <Field label="Observações adicionais">
                        <textarea name="notes" rows={2} defaultValue={editingOrder?.notes || ""} />
                      </Field>
                    </div>
                  </Card>
                  <div className="form-actions">
                    <button
                      type="button"
                      className={editingOrder ? "system-back-button" : "cancel-button"}
                      onClick={() => {
                        if (editingOrder) {
                          const order = editingOrder;
                          setEditingOrder(null);
                          setScreen("orders");
                          if (editOrderReturnTo === "review") setOrderModal(order);
                          else setOrderModal(null);
                        } else {
                          go("dashboard");
                        }
                      }}
                    >
                      {editingOrder ? "Voltar" : "Cancelar"}
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="primary-button"
                    >
                      {saving ? "Salvando..." : "Salvar"}
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
                  subtitle="Consulte pedidos e acompanhe os pagamentos."
                  action={
                    <button
                      className="primary-button"
                      onClick={() => go("new-order")}
                    >
                      ＋ Nova OS
                    </button>
                  }
                />
                <div className="filters operational-filters operational-filters-orders">
                  <Field label="Buscar cliente ou OS">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </Field>
                  <Field label="Mês">
                    <select
                      value={orderMonthFilter}
                      onChange={(event) => setOrderMonthFilter(event.target.value)}
                    >
                      <option value="">Todos</option>
                      {reportMonths.map((month) => (
                        <option key={month} value={month}>{monthLabel(month)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
                      <option>Todos</option>
                      {["Na fila", "Pago", "Pagamento parcial", "Em aberto", "Atrasado", "Cancelada"].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="Forma de pagamento">
                    <select value={paymentMethodFilter} onChange={(e) => setPaymentMethodFilter(e.target.value)}>
                      <option>Todos</option>
                      <option>Pix</option>
                      <option>Dinheiro</option>
                      <option>Cartão</option>
                      <option>Boleto</option>
                      <option>Carteira</option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="outline-button filter-clear"
                    onClick={() => {
                      setQuery("");
                      setOrderMonthFilter("");
                      setPaymentFilter("Todos");
                      setPaymentMethodFilter("Todos");
                    }}
                  >
                    Limpar
                  </button>
                </div>
                <div className="table-wrap standardized-table orders-table">
                  <table>
                    <thead><tr><th>OS</th><th>Cliente</th><th>Data do pedido</th><th>Vencimento</th><th>Valor total</th><th>Forma de pagamento</th><th>Status</th></tr></thead>
                    <tbody>
                      {!paginatedOrders.length && (
                        <tr className="orders-empty-row">
                          <td colSpan={7}>Nenhuma Ordem de Serviço encontrada.</td>
                        </tr>
                      )}
                      {paginatedOrders.map((order) => {
                        const due = orderDueOf(order.id);
                        return (
                        <tr
                          key={order.id}
                          className="clickable-order-row"
                          role="button"
                          tabIndex={0}
                          aria-label={`Visualizar ${order.number}`}
                          onClick={() => setOrderModal(order)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setOrderModal(order);
                            }
                          }}
                        >
                          <td><b>{order.number}</b></td>
                          <td><b>{order.customerName}</b></td>
                          <td>{brDate(order.createdAt)}</td>
                          <td className="order-due">
                            {due ? (
                              <>
                                <span className={due.overdue ? "overdue" : ""}>{brDate(due.dueDate)}</span>
                                {due.label && <small>{due.label}</small>}
                              </>
                            ) : "—"}
                          </td>
                          <td>{money(order.total)}</td>
                          <td>{order.paymentMethod || "—"}</td>
                          <td><span className={`status ${orderDisplayTone(order)}`}>{orderDisplayStatus(order)}</span></td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredOrders.length > 0 && (
                  <nav className="pagination" aria-label="Paginação das ordens de serviço">
                    <span>
                      Exibindo {(orderPage - 1) * ordersPerPage + 1}–{Math.min(orderPage * ordersPerPage, filteredOrders.length)} de {filteredOrders.length}
                    </span>
                    <div>
                      <button
                        type="button"
                        disabled={orderPage === 1}
                        onClick={() => setOrderPage((page) => Math.max(1, page - 1))}
                      >
                        Anterior
                      </button>
                      <strong>{orderPage} de {orderPageCount}</strong>
                      <button
                        type="button"
                        disabled={orderPage === orderPageCount}
                        onClick={() => setOrderPage((page) => Math.min(orderPageCount, page + 1))}
                      >
                        Próxima
                      </button>
                    </div>
                  </nav>
                )}
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
                <div className="table-wrap standardized-table customer-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>CPF/CNPJ</th>
                        <th>WhatsApp</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomers.map((c) => (
                        <tr
                          key={c.id}
                          className="clickable-table-row"
                          role="button"
                          tabIndex={0}
                          aria-label={`Visualizar cliente ${c.name}`}
                          onClick={() => setViewingCustomer(c)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setViewingCustomer(c);
                            }
                          }}
                        >
                          <td className="customer-name-cell">
                            <b>{c.name}</b>
                          </td>
                          <td>{formatDocument(c.document).replace(/^(CPF|CNPJ):\s*/, "")}</td>
                          <td>{formatPhone(c.whatsapp)}</td>
                          <td>
                            <span
                              className={`status ${c.active ? "green" : "red"}`}
                            >
                              {c.active ? "Ativo" : "Inativo"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {screen === "piece-types" && (
              <div className="page">
                <Heading eyebrow="CADASTROS" title="Tipos" subtitle="Mantenha os tipos disponíveis para o cadastro de peças."
                  action={<button className="primary-button" onClick={() => { setEditingType(null); setTypeModal(true); }}>＋ Novo tipo</button>} />
                <Filters query={query} setQuery={setQuery} queryLabel="Buscar tipo" />
                <div className="table-wrap standardized-table piece-type-table">
                  <table>
                    <thead><tr><th>Tipo</th><th>Status</th></tr></thead>
                    <tbody>
                      {filteredPieceTypes.map((type) => (
                        <tr key={type.id} className="clickable-table-row" role="button" tabIndex={0}
                          aria-label={`Visualizar tipo ${type.name}`} onClick={() => setViewingType(type)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewingType(type); } }}>
                          <td><b>{type.name}</b></td>
                          <td><span className={`status ${type.active ? "green" : "red"}`}>{type.active ? "Ativo" : "Inativo"}</span></td>
                        </tr>
                      ))}
                      {!filteredPieceTypes.length && <tr><td colSpan={2} className="empty">{query ? "Nenhum tipo encontrado." : "Nenhum tipo cadastrado."}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {screen === "piece-lines" && (
              <div className="page">
                <Heading eyebrow="CADASTROS" title="Linhas" subtitle="Mantenha as linhas disponíveis para o cadastro de peças."
                  action={<button className="primary-button" onClick={() => { setEditingLine(null); setLineModal(true); }}>＋ Nova linha</button>} />
                <Filters query={query} setQuery={setQuery} queryLabel="Buscar linha" />
                <div className="table-wrap standardized-table piece-type-table">
                  <table>
                    <thead><tr><th>Linha</th><th>Status</th></tr></thead>
                    <tbody>
                      {filteredPieceLines.map((type) => (
                        <tr key={type.id} className="clickable-table-row" role="button" tabIndex={0}
                          aria-label={`Visualizar linha ${type.name}`} onClick={() => setViewingLine(type)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewingLine(type); } }}>
                          <td><b>{type.name}</b></td>
                          <td><span className={`status ${type.active ? "green" : "red"}`}>{type.active ? "Ativo" : "Inativo"}</span></td>
                        </tr>
                      ))}
                      {!filteredPieceLines.length && <tr><td colSpan={2} className="empty">{query ? "Nenhuma linha encontrada." : "Nenhuma linha cadastrada."}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {screen === "products" && (
              <div className="page">
                <Heading
                  eyebrow="CADASTROS"
                  title="Peças"
                  subtitle="Mantenha as peças disponíveis e seus valores."
                  action={
                    <button
                      className="primary-button"
                      onClick={() => { setEditingProduct(null); setProductModal(true); }}
                    >
                      ＋ Nova peça
                    </button>
                  }
                />
                <Filters
                  query={query}
                  setQuery={setQuery}
                  queryLabel="Buscar peça"
                >
                  <label className="filter-field filter-type">
                    <span>Tipo</span>
                    <select value={productTypeFilter} onChange={(event) => setProductTypeFilter(event.target.value)}>
                      <option>Todos</option>
                      {pieceTypeOptions.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                </Filters>
                <section className="panel stock-panel">
                  <div className="piece-list">
                    <div className="piece-head" aria-hidden="true">
                      <span>Peça</span><span>Tipo / Linha</span><span>Preço</span><span>Custo</span><span>Lucro</span><span>Estoque</span><span>Status</span>
                    </div>
                    {!filteredProducts.length && <p className="compact-empty">Nenhuma peça encontrada.</p>}
                    {filteredProducts
                      // Mesma ordem da tela Estoque: menos disponível primeiro; as zeradas ficam no fim.
                      .map((item) => ({ item, row: stock.rows.find((entry) => entry.productId === item.id) }))
                      .sort((a, b) => Number(isEmptyStock(a.row)) - Number(isEmptyStock(b.row)) || (a.row?.available ?? 0) - (b.row?.available ?? 0) || a.item.code.localeCompare(b.item.code))
                      .map(({ item: p }) => {
                      const cost = currentCostOf(p.id);
                      const costValue = (cost?.unitCostCents ?? 0) / 100;
                      const rate = profitOnCost(p.price, costValue);
                      const since = priceTimeline(productPrices, p.id)[0]?.startsAt;
                      const stockRow = stock.rows.find((entry) => entry.productId === p.id);
                      const available = stockRow?.available ?? 0;
                      return (
                        <div
                          key={p.id}
                          className="piece-row"
                          role="button"
                          tabIndex={0}
                          aria-label={`Visualizar peça ${p.code}`}
                          onClick={() => setViewingProduct(p)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setViewingProduct(p);
                            }
                          }}
                        >
                          <span className="stock-main piece-main"><b>{p.code}</b><small>{p.measure}</small></span>
                          <span className="piece-cell piece-kind" data-label="Tipo / Linha">
                            <b>{p.pieceType || "—"}</b>
                            <small>{p.name.replace(/^Linha\s+/i, "")}</small>
                          </span>
                          <span className="piece-cell" data-label="Preço">
                            <b>{money(p.price)}</b>
                            {since && <small>{`desde ${brDate(since)}`}</small>}
                          </span>
                          <span className="piece-cell" data-label="Custo">
                            {rate === null || !cost ? (
                              <small>falta cadastrar</small>
                            ) : (
                              <>
                                <b>{money(costValue)}</b>
                                <small>{costSourceOf(cost.source) === "comprada" ? "revenda" : "fabricação"}</small>
                              </>
                            )}
                          </span>
                          <span className="piece-cell" data-label="Lucro">
                            {rate === null ? (
                              <small>—</small>
                            ) : (
                              <span className={`status ${marginTone(rate)}`}>{money(p.price - costValue)} · {percent(rate)}</span>
                            )}
                          </span>
                          <span className="piece-cell" data-label="Estoque">
                            <b className={available <= 0 ? "piece-stock-low" : ""}>{available}</b>
                          </span>
                          <span className="piece-status">
                            <span className={`status ${p.active ? "green" : "red"}`}>{p.active ? "Ativo" : "Inativo"}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
            {screen === "catalog" && (
              <div className="page">
                <Heading
                  eyebrow="MATERIAIS COMERCIAIS"
                  title="Catálogo"
                  subtitle="Acesse ou baixe a versão correta para cada público."
                />
                <div className="catalog-management-grid">
                  <article className="catalog-management-card">
                    <div>
                      <span>CLIENTE FINAL</span>
                      <h2>Catálogo de preços</h2>
                      <p>Apresenta os valores integrais cadastrados para venda ao consumidor.</p>
                    </div>
                    <div className="catalog-management-actions">
                      <a className="secondary-button" href="/catalogo">
                        Acessar online
                      </a>
                      <button className="catalog-bw-download" onClick={() => downloadCatalogPdf("final", "bw")}>
                        Baixar P&B
                      </button>
                      <button className="primary-button catalog-color-download" onClick={() => downloadCatalogPdf("final", "color")}>
                        Baixar Colorido
                      </button>
                    </div>
                  </article>
                  <article className="catalog-management-card distributor">
                    <div>
                      <span>DISTRIBUIDOR</span>
                      <h2>Catálogo para distribuidor</h2>
                      <p>Apresenta o preço de cada peça e os descontos de 5%, 8% e 10% conforme a quantidade.</p>
                    </div>
                    <div className="catalog-management-actions">
                      <a className="secondary-button" href="/catalogo?tipo=distribuidor">
                        Acessar online
                      </a>
                      <button className="catalog-bw-download" onClick={() => downloadCatalogPdf("distributor", "bw")}>
                        Baixar P&B
                      </button>
                      <button className="primary-button catalog-color-download" onClick={() => downloadCatalogPdf("distributor", "color")}>
                        Baixar Colorido
                      </button>
                    </div>
                  </article>
                </div>
              </div>
            )}
            {isFinanceScreen && (
              <div className="page">
                <Heading
                  eyebrow="FINANCEIRO"
                  title={screen === "financial-monthly" ? "Lucro mês a mês" : screen === "financial-cash" ? "Caixa mês a mês" : screen === "financial-payables" ? "Contas a pagar" : screen === "financial-pricing" ? "Preços e margem" : screen === "financial-batches" ? "Lotes de compra" : "Financeiro"}
                  subtitle={
                    screen === "financial-monthly"
                      ? "Quanto sobrou ou faltou em cada mês: o que foi vendido menos as contas pagas."
                      : screen === "financial-cash"
                        ? "O dinheiro que entrou e saiu de verdade em cada mês."
                        : screen === "financial-payables"
                          ? "Cadastre e acompanhe as contas da empresa."
                          : screen === "financial-pricing"
                            ? "Veja quanto cada peça deixa de lucro, simule preços e compare o custo revenda com o custo fabricação."
                          : screen === "financial-batches"
                            ? "Cada compra do fornecedor, o que já vendeu e quanto ela rende."
                          : "Veja quanto você vendeu, quanto gastou e quanto sobrou."
                  }
                  action={
                    screen === "financial" || screen === "reports" ? (
                      <button className="primary-button" onClick={exportCsv}>↓ Exportar CSV</button>
                    ) : screen === "financial-batches" ? (
                      <button className="primary-button" onClick={() => setBatchForm({ id: null })}>＋ Lançar lote</button>
                    ) : undefined
                  }
                />
                <nav className="finance-tabs" aria-label="Seções do financeiro">
                  {financeNav.map(([target, label]) => (
                    <button
                      type="button"
                      key={target}
                      className={screen === target || (target === "financial" && screen === "reports") ? "active" : ""}
                      onClick={() => go(target)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {financeData.historyTruncated && (screen === "financial-monthly" || screen === "financial-cash") && (
                  <p className="plain-warning">Histórico incompleto: há mais registros do que o sistema carrega de uma vez, e os meses mais antigos podem estar faltando.</p>
                )}
                {screen === "financial-batches" && (
                  <>
                {stockError && <p className="modal-error">{stockError}</p>}
                <section className="panel plain-panel batch-panel">
                  {!purchaseBatches.length && <p className="compact-empty">Nenhum lote de compra lançado ainda.</p>}
                  {batchData.outsideQty > 0 && (
                    <p className="plain-warning">
                      {`${batchData.outsideQty === 1 ? "1 peça vendida não saiu" : `${batchData.outsideQty} peças vendidas não saíram`} de nenhum lote, porque a venda passou do estoque lançado. Elas ficam fora dos estudos.`}
                    </p>
                  )}
                  <div className="batch-list">
                    {purchaseBatches.map((batch) => {
                      const study = batchStudies.get(batch.id);
                      if (!study) return null;
                      return (
                        <button type="button" className="batch-card" key={batch.id} onClick={() => setViewingBatchId(batch.id)}>
                          <span>
                            <b>{batch.supplier}</b>
                            <small>{`${brDate(batch.purchaseDate)} · ${study.soldQty} de ${study.boughtQty} vendidas · ${study.stockQty} em estoque`}</small>
                          </span>
                          <span className="batch-card-result">
                            <strong className={study.totalCents < 0 ? "bad" : "good"}>{signedMoney(study.totalCents)}</strong>
                            <small>{`lucro esperado${study.rateOnCost === null ? "" : ` · ${percent(study.rateOnCost)}`}`}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                  </>
                )}
                {screen === "financial-pricing" && (() => {
                  const today = todayIso();
                  const bulkRate = parsePercent(bulkPercent);
                  const rows = products
                    .filter((product) => product.active)
                    .map((product) => {
                      const priceCents = Math.round(product.price * 100);
                      const simulation = simulatePrice({
                        priceCents,
                        fabricatedCostCents: costOfSourceAt(productCosts, product.id, "fabricada", today)?.unitCostCents ?? null,
                        purchasedCostCents: costOfSourceAt(productCosts, product.id, "comprada", today)?.unitCostCents ?? null,
                        targetRate,
                      });
                      const inBulk = bulkRate !== null && bulkRate !== 0 && (!bulkType || product.pieceType === bulkType);
                      const newPriceCents = inBulk ? adjustPrice(priceCents, bulkRate, bulkNinety ? "ninety" : "exact") : null;
                      return { product, priceCents, simulation, newPriceCents, lastChange: priceTimeline(productPrices, product.id)[0] ?? null };
                    });
                  const bulkChanges = rows.flatMap((row) =>
                    row.newPriceCents !== null && row.newPriceCents > 0 && row.newPriceCents !== row.priceCents
                      ? [{ product: row.product, priceCents: row.newPriceCents }]
                      : [],
                  );
                  // Custo em uso de cada peça (escolhido na peça); sem esse custo cadastrado, vale o outro.
                  const inUse = (row: (typeof rows)[number]) => {
                    const chosen = row.simulation[costUseOf(row.product.id).source];
                    return chosen.costCents !== null ? chosen : chosen.source === "comprada" ? row.simulation.fabricada : row.simulation.comprada;
                  };
                  const belowTarget = rows.filter((row) => inUse(row).reachesTarget === false).length;
                  const withoutPurchase = rows.filter((row) => row.simulation.comprada.costCents === null).length;
                  const cheaperToBuy = rows.filter((row) => row.simulation.cheaper === "comprada").length;
                  const cheaperToMake = rows.filter((row) => row.simulation.cheaper === "fabricada").length;
                  const sourceCell = (source: SourceSimulation, label: string) => (
                    <span className="pricing-source" data-label={label}>
                      {source.costCents === null ? (
                        <small>falta o custo</small>
                      ) : (
                        <>
                          <b>{money(source.costCents / 100)}</b>
                          <small className={marginTone(source.onCost)}>{`lucro ${money((source.profitCents ?? 0) / 100)} · ${percent(source.onCost ?? 0)}`}</small>
                        </>
                      )}
                    </span>
                  );
                  return (
                    <>
                      <section className="finance-kpi-grid payable-kpis">
                        <article>
                          <span>Meta de lucro</span>
                          <strong>{percent(targetRate)}</strong>
                          <small>Sobre o custo da peça</small>
                        </article>
                        <article className={belowTarget > 0 ? "attention" : ""}>
                          <span>Abaixo da meta</span>
                          <strong>{belowTarget}</strong>
                          <small>{belowTarget > 0 ? "Peças com lucro menor que a meta" : "Todas as peças na meta"}</small>
                        </article>
                        <article>
                          <span>Revenda x fabricação</span>
                          <strong>{`${cheaperToBuy} x ${cheaperToMake}`}</strong>
                          <small>Peças em que a revenda custa menos x a fabricação</small>
                        </article>
                        <article className={withoutPurchase > 0 ? "attention" : ""}>
                          <span>Sem custo revenda</span>
                          <strong>{withoutPurchase}</strong>
                          <small>{withoutPurchase > 0 ? "Cadastre em Peças para comparar" : "Todas com custo revenda"}</small>
                        </article>
                      </section>
                      <section className="panel plain-panel pricing-tools">
                        <div className="pricing-tool">
                          <h2>Meta de lucro</h2>
                          <div className="pricing-tool-row">
                            <Field label="Meta sobre o custo (%)">
                              <input inputMode="decimal" value={targetInput} placeholder={percent(targetRate)} onChange={(e) => setTargetInput(e.target.value)} />
                            </Field>
                            <button type="button" className="outline-button" onClick={saveTargetRate} disabled={!targetInput.trim()}>Salvar meta</button>
                          </div>
                        </div>
                        <div className="pricing-tool">
                          <h2>Simular reajuste em várias peças</h2>
                          <div className="pricing-tool-row">
                            <Field label="Reajuste (%)">
                              <input inputMode="decimal" value={bulkPercent} placeholder="ex.: 5 ou -3" onChange={(e) => setBulkPercent(e.target.value)} />
                            </Field>
                            <Field label="Tipo de peça">
                              <select value={bulkType} onChange={(e) => setBulkType(e.target.value)}>
                                <option value="">Todas</option>
                                {pieceTypes.filter((type) => type.active).map((type) => <option key={type.id} value={type.name}>{type.name}</option>)}
                              </select>
                            </Field>
                            <label className="pricing-check">
                              <input type="checkbox" checked={bulkNinety} onChange={(e) => setBulkNinety(e.target.checked)} />
                              Terminar em ,90
                            </label>
                            <button type="button" className="primary-button" onClick={() => applyBulkPrices(bulkChanges)} disabled={saving || !bulkChanges.length}>
                              {bulkChanges.length ? `Aplicar em ${bulkChanges.length === 1 ? "1 peça" : `${bulkChanges.length} peças`}` : "Aplicar"}
                            </button>
                          </div>
                          <small>Nada é gravado até você tocar em Aplicar. O preço novo aparece em cada peça, abaixo.</small>
                        </div>
                      </section>
                      <section className="panel stock-panel">
                        <div className="pricing-list">
                          <div className="pricing-head" aria-hidden="true">
                            <span>Peça</span><span>Preço</span><span>Custo revenda</span><span>Custo fabricação</span><span>Comparação</span><span />
                          </div>
                          {!rows.length && <p className="compact-empty">Nenhuma peça ativa cadastrada.</p>}
                          {rows.map((row) => (
                            <div className="pricing-row" key={row.product.id}>
                              <span className="stock-main"><b>{row.product.code}</b><small>{row.product.measure}</small></span>
                              <span className="pricing-price" data-label="Preço">
                                <b>{money(row.priceCents / 100)}</b>
                                {row.newPriceCents !== null && row.newPriceCents !== row.priceCents && <small className="pricing-new">{`novo: ${money(row.newPriceCents / 100)}`}</small>}
                                {row.lastChange && <small>{`desde ${brDate(row.lastChange.startsAt)}`}</small>}
                              </span>
                              {sourceCell(row.simulation.comprada, "Custo revenda")}
                              {sourceCell(row.simulation.fabricada, "Custo fabricação")}
                              <span className="pricing-compare">{sourceComparison(row.simulation, money)}</span>
                              <span className="stock-action">
                                <button type="button" className="outline-button" onClick={() => openPriceSimulator(row.product)}>Simular</button>
                              </span>
                            </div>
                          ))}
                        </div>
                      </section>
                    </>
                  );
                })()}
                {screen === "financial-monthly" && (
                  <>
                    <section className={`plain-card plain-result month-hero ${resultTotal < 0 ? "negative" : "positive"}`}>
                      <span>{resultTotal < 0 ? "Quanto faltou até hoje" : "Quanto sobrou até hoje"}</span>
                      <strong>{money(resultTotal / 100)}</strong>
                      <p>
                        {resultByMonth.length
                          ? `Soma de ${shortMonth(resultByMonth[0].month)} até ${shortMonth(resultByMonth[resultByMonth.length - 1].month)}. Conta o que foi vendido, mesmo que ainda não tenha sido pago.`
                          : "Ainda não há venda entregue nem conta paga."}
                      </p>
                    </section>
                    {resultByMonth.length > 0 && (() => {
                      const bars = divergingBars(resultByMonth.map((row) => row.leftCents), 150);
                      return (
                        <section className="panel plain-panel">
                          <h2>Sobrou ou faltou em cada mês</h2>
                          <div className="month-chart" role="img" aria-label="Gráfico de barras com o que sobrou ou faltou em cada mês">
                            {resultByMonth.map((row, index) => (
                              <div className="month-col" key={row.month} title={`${shortMonth(row.month)}: ${row.leftCents < 0 ? "faltou" : "sobrou"} ${money(Math.abs(row.leftCents) / 100)}`}>
                                <div className="month-up" style={{ height: bars.positiveArea + 20 }}>
                                  {row.leftCents >= 0 && <small>{wholeMoney(row.leftCents)}</small>}
                                  {row.leftCents > 0 && <i className="bar positive" style={{ height: bars.heights[index] }} />}
                                </div>
                                <div className="month-down" style={{ height: bars.negativeArea + 20 }}>
                                  {row.leftCents < 0 && <i className="bar negative" style={{ height: bars.heights[index] }} />}
                                  {row.leftCents < 0 && <small>−{wholeMoney(-row.leftCents)}</small>}
                                </div>
                                <span>{shortMonth(row.month)}</span>
                              </div>
                            ))}
                          </div>
                          <p className="chart-legend"><i className="swatch positive" /> sobrou <i className="swatch negative" /> faltou <em>valores em reais</em></p>
                        </section>
                      );
                    })()}
                    {monthForecast && (
                      <section className="panel plain-panel">
                        <h2>Previsão para este mês</h2>
                        <p className="plain-text">
                          {`Se o ritmo dos primeiros ${monthForecast.day} dias continuar até o dia ${monthForecast.daysInMonth}, você deve vender ${money(monthForecast.salesCents / 100)}, gastar ${money(monthForecast.spentCents / 100)} e ${monthForecast.leftCents < 0 ? "faltar" : "sobrar"} ${money(Math.abs(monthForecast.leftCents) / 100)}.`}
                        </p>
                        <p className="plain-text muted">É uma conta de padaria: poucas vendas a mais ou a menos mudam o resultado.</p>
                      </section>
                    )}
                    {resultByMonth.length > 0 && (
                      <section className="panel plain-panel">
                        <h2>Os números de cada mês</h2>
                        <div className="month-table-wrap">
                          <table className="month-table">
                            <thead><tr><th>Mês</th><th>Vendi</th><th>Gastei</th><th>Sobrou</th><th>Somando tudo</th></tr></thead>
                            <tbody>
                              {resultByMonth.slice().reverse().map((row) => (
                                <tr key={row.month}>
                                  <td>{shortMonth(row.month)}</td>
                                  <td>{money(row.salesCents / 100)}</td>
                                  <td>{money(row.spentCents / 100)}</td>
                                  <td className={row.leftCents < 0 ? "negative" : "positive"}>{money(row.leftCents / 100)}</td>
                                  <td>{money(row.accumulatedCents / 100)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}
                  </>
                )}
                {screen === "financial-cash" && (
                  <>
                    <section className={`plain-card plain-result month-hero ${cashTotal < 0 ? "negative" : "positive"}`}>
                      <span>{cashTotal < 0 ? "Saiu mais do que entrou" : "Entrou mais do que saiu"}</span>
                      <strong>{money(cashTotal / 100)}</strong>
                      <p>
                        {cashByMonth.length
                          ? `De ${shortMonth(cashByMonth[0].month)} até hoje entraram ${money(cashByMonth.reduce((sum, row) => sum + row.inCents, 0) / 100)} e saíram ${money(cashByMonth.reduce((sum, row) => sum + row.outCents, 0) / 100)}. Só conta o que já foi recebido e pago.`
                          : "Ainda não há recebimento nem conta paga."}
                      </p>
                    </section>
                    {cashByMonth.length > 0 && (() => {
                      const heights = barHeights(cashByMonth.flatMap((row) => [row.inCents, row.outCents]), 150);
                      return (
                        <section className="panel plain-panel">
                          <h2>Entrou e saiu em cada mês</h2>
                          <p className="chart-legend"><i className="swatch cash-in" /> entrou <i className="swatch cash-out" /> saiu</p>
                          <div className="month-chart" role="img" aria-label="Gráfico de barras com o dinheiro que entrou e saiu em cada mês">
                            {cashByMonth.map((row, index) => (
                              <div className="month-col" key={row.month} title={`${shortMonth(row.month)}: entrou ${money(row.inCents / 100)}, saiu ${money(row.outCents / 100)}`}>
                                <div className="month-up month-pair" style={{ height: 170 }}>
                                  <i className="bar cash-in" style={{ height: heights[index * 2] }} />
                                  <i className="bar cash-out" style={{ height: heights[index * 2 + 1] }} />
                                </div>
                                <span>{shortMonth(row.month)}</span>
                                <small className={row.netCents < 0 ? "negative" : "positive"}>{row.netCents < 0 ? "−" : "+"}{wholeMoney(Math.abs(row.netCents))}</small>
                              </div>
                            ))}
                          </div>
                          <p className="chart-legend"><em>Embaixo de cada mês: o que entrou menos o que saiu, em reais.</em></p>
                        </section>
                      );
                    })()}
                    <section className="panel plain-panel">
                      <h2>Previsão dos próximos 3 meses</h2>
                      <p className="plain-text">
                        {`Se tudo for recebido e pago no vencimento, o caixa chega a ${money(cashForecastEnd.balanceCents / 100)} em ${shortMonth(cashForecastEnd.month)}.`}
                      </p>
                      <div className="month-table-wrap">
                        <table className="month-table forecast-table">
                          <thead><tr><th>Mês</th><th>Vai entrar</th><th>Vai sair</th><th>Saldo do mês</th><th>Caixa previsto</th></tr></thead>
                          <tbody>
                            {cashForecastRows.map((row) => (
                              <tr key={row.month}>
                                <td>{row.isCurrent ? `resto de ${shortMonth(row.month)}` : shortMonth(row.month)}</td>
                                <td>{money(row.inCents / 100)}</td>
                                <td>{money(row.outCents / 100)}</td>
                                <td className={row.netCents < 0 ? "negative" : "positive"}>{money(row.netCents / 100)}</td>
                                <td className={row.balanceCents < 0 ? "negative" : "positive"}>{money(row.balanceCents / 100)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="plain-text muted">Conta só o que já está lançado: OS a receber e contas a pagar, pelo vencimento. O que está atrasado entra neste mês. Vendas e contas novas ainda não aparecem.</p>
                    </section>
                    {cashByMonth.length > 0 && (
                      <section className="panel plain-panel">
                        <h2>Os números de cada mês</h2>
                        <div className="month-table-wrap">
                          <table className="month-table">
                            <thead><tr><th>Mês</th><th>Entrou</th><th>Saiu</th><th>Saldo do mês</th><th>Somando tudo</th></tr></thead>
                            <tbody>
                              {cashByMonth.slice().reverse().map((row) => (
                                <tr key={row.month}>
                                  <td>{shortMonth(row.month)}</td>
                                  <td>{money(row.inCents / 100)}</td>
                                  <td>{money(row.outCents / 100)}</td>
                                  <td className={row.netCents < 0 ? "negative" : "positive"}>{money(row.netCents / 100)}</td>
                                  <td>{money(row.balanceCents / 100)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}
                  </>
                )}
                {(screen === "financial" || screen === "reports" || screen === "financial-payables") && (
                <div className="plain-period" role="group" aria-label="Período">
                  {([["this", "Este mês"], ["last", "Mês passado"], ["all", "Tudo"]] as [FinancePeriod, string][]).map(([period, label]) => (
                    <button
                      type="button"
                      key={period}
                      className={financePeriod === period ? "active" : ""}
                      aria-pressed={financePeriod === period}
                      onClick={() => setReportMonth(periodMonth(period, todayIso()))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                )}
                {financeError && <p className="modal-error">{financeError}</p>}
                {(screen === "financial" || screen === "reports") && (
                <>
                <section className={`plain-card plain-result month-hero ${plain.leftCents < 0 ? "negative" : "positive"}`}>
                  <span>{`${plain.leftCents < 0 ? "Quanto faltou" : "Quanto sobrou"} ${summaryPeriodLabel}`}</span>
                  <strong>{money(plain.leftCents / 100)}</strong>
                  <p>{leftSentence(plain.leftPer100Cents, money)}</p>
                </section>
                <section className="finance-kpi-grid payable-kpis">
                  <article>
                    <span>Quanto vendi</span>
                    <strong>{money(plain.salesCents / 100)}</strong>
                    <small>{reportOrders.length === 1 ? "1 OS entregue" : `${reportOrders.length} OS entregues`}</small>
                  </article>
                  <article>
                    <span>Quanto gastei</span>
                    <strong>{money(plain.spentCents / 100)}</strong>
                    <small>{`${money(plain.fabricationCents / 100)} pagos para fabricar peça`}</small>
                    <small>{`${money(plain.otherExpensesCents / 100)} pagos em outras contas`}</small>
                  </article>
                  <article className={receivableOverdue > 0 ? "attention" : ""}>
                    <span>A receber</span>
                    <strong>{money(receivableOpen)}</strong>
                    <small>
                      {receivableOverdue > 0
                        ? `${money(receivableOverdue)} em atraso`
                        : receivableOpen > 0 ? "Tudo dentro do prazo" : "Nada a receber"}
                    </small>
                  </article>
                  <article className={openPayableTotals.overdueCents > 0 ? "attention" : ""}>
                    <span>A pagar</span>
                    <strong>{money(openPayableTotals.openCents / 100)}</strong>
                    <small>{openHint(openPayableTotals, money)}</small>
                  </article>
                </section>
                <section className="business-health-strip cash-strip">
                  <div><span>Entrou no caixa</span><b>{money(periodCashIn / 100)}</b></div>
                  <div><span>Saiu do caixa</span><b>{money(periodCashOut / 100)}</b></div>
                  <div>
                    <span>Saldo do caixa</span>
                    <b className={periodCashIn - periodCashOut < 0 ? "negative" : "positive"}>{money((periodCashIn - periodCashOut) / 100)}</b>
                  </div>
                </section>
                <section className="panel plain-panel">
                  <h2>Peças vendidas</h2>
                  {!salesProfit.byProduct.length && <p className="compact-empty">Nenhuma venda entregue neste período.</p>}
                  {salesProfit.byProduct.length > 0 && (
                    <p className="chart-legend">
                      <i className="swatch piece-cost" /> custo <i className="swatch piece-profit" /> lucro
                      <em>custo = contas pagas no período, divididas entre as peças</em>
                    </p>
                  )}
                  {(() => {
                    const pieces = salesProfit.byProduct.slice().sort((x, y) => y.revenueCents - x.revenueCents || y.quantity - x.quantity);
                    const top = pieces[0]?.revenueCents || 0;
                    // Custo de cada peça = parte dela nas contas pagas do período (a soma bate com "Quanto gastei").
                    const allocated = allocateSpent(pieces, plain.spentCents);
                    return pieces.map((row) => {
                      const measure = products.find((product) => product.id === row.productId)?.measure;
                      const units = row.quantity === 1 ? "1 unidade" : `${row.quantity} unidades`;
                      const width = top > 0 ? Math.max(2, Math.round((row.revenueCents / top) * 100)) : 2;
                      const cost = allocated.get(row.key) ?? 0;
                      const profit = row.revenueCents - cost;
                      // Parte da barra que é custo; com prejuízo, o custo ocupa a barra inteira.
                      const costShare = row.revenueCents > 0 ? Math.min(100, Math.round((cost / row.revenueCents) * 100)) : 100;
                      const split = `custo ${money(cost / 100)} · ${profit < 0 ? "prejuízo" : "lucro"} ${money(Math.abs(profit) / 100)}`;
                      return (
                        <div className="supplier-row piece-bar-row" key={row.key} title={`${row.code}: ${units}, vendeu ${money(row.revenueCents / 100)}, ${split}`}>
                          <span>{row.code}<small>{measure ? `${measure} · ${units}` : units}</small></span>
                          <div className="supplier-bar piece-bar" style={{ width: `${width}%` }}>
                            {costShare > 0 && <i className="piece-cost" style={{ width: `${costShare}%` }} />}
                            {costShare < 100 && <i className="piece-profit" style={{ width: `${100 - costShare}%` }} />}
                          </div>
                          <b>{money(row.revenueCents / 100)}</b>
                          <small className={`piece-split ${profit < 0 ? "negative" : ""}`}>{split}</small>
                        </div>
                      );
                    });
                  })()}
                  {salesProfit.byProduct.length > 0 && (
                    <p className="plain-text muted">
                      {`Os ${money(plain.spentCents / 100)} de contas pagas foram divididos entre as peças na proporção do custo cadastrado de cada uma. A soma dos lucros é o "Quanto sobrou" do topo.`}
                    </p>
                  )}
                </section>
                </>
                )}
                {screen === "financial-payables" && (
                  <>
                    <section className="plain-card month-hero">
                      <span>{`Total de contas${payablePeriodLabel}`}</span>
                      <strong>{money(payableTotals.totalCents / 100)}</strong>
                      <p>
                        {payableTotals.count
                          ? `${countLabel(payableTotals.count)}: ${money(payableTotals.paidCents / 100)} já pagos e ${money(payableTotals.openCents / 100)} a pagar.`
                          : "Nenhuma conta cadastrada neste período."}
                      </p>
                    </section>
                    <section className="finance-kpi-grid payable-kpis">
                      <article>
                        <span>Já pago</span>
                        <strong>{money(payableTotals.paidCents / 100)}</strong>
                        <small>{countLabel(payableTotals.paidCount)}</small>
                      </article>
                      <article className={payableTotals.overdueCents > 0 ? "attention" : ""}>
                        <span>A pagar</span>
                        <strong>{money(payableTotals.openCents / 100)}</strong>
                        <small>{openHint(payableTotals, money)}</small>
                      </article>
                      <article>
                        <span>Para fabricar peça</span>
                        <strong>{money(payableTotals.fabricationCents / 100)}</strong>
                        <small>{`${wholePercent(payableTotals.fabricationShare)} do total · pago e a pagar`}</small>
                      </article>
                      <article>
                        <span>Outras contas</span>
                        <strong>{money(payableTotals.otherCents / 100)}</strong>
                        <small>{`${wholePercent(payableTotals.fabricationShare === null ? null : 1 - payableTotals.fabricationShare)} do total · pago e a pagar`}</small>
                      </article>
                    </section>
                    {payableTotals.suppliers.length > 0 && (
                      <section className="panel plain-panel">
                        <h2>Para quem foi o dinheiro</h2>
                        {payableTotals.suppliers.slice(0, 5).map((supplier) => (
                          <div className="supplier-row" key={supplier.supplier} title={`${supplier.supplier}: ${money(supplier.totalCents / 100)} em ${countLabel(supplier.count)}`}>
                            <span>{supplier.supplier}<small>{countLabel(supplier.count)}</small></span>
                            <div className="supplier-bar"><i style={{ width: `${Math.max(2, Math.round((supplier.totalCents / payableTotals.suppliers[0].totalCents) * 100))}%` }} /></div>
                            <b>{money(supplier.totalCents / 100)}</b>
                          </div>
                        ))}
                      </section>
                    )}
                  </>
                )}
                {screen === "financial-payables" && (
                <section className="financial-layout">
                  <aside className="financial-side">
                    <div className="panel financial-next-card">
                      <div className="panel-title">
                        <div>
                          <h2>Contas a pagar</h2>
                          <p>{payableRows.length} registros encontrados</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openPayableForm()}
                          className="payable-add-button"
                        >
                          + Nova conta
                        </button>
                      </div>
                      {!payableRows.length ? (
                        <p className="finance-history-empty payable-empty">Nenhuma conta a pagar cadastrada no filtro atual.</p>
                      ) : (
                        <div className="payable-list">
                          <div className="payable-list-head" aria-hidden="true">
                            <span>Fornecedor</span>
                            <span>Data da compra</span>
                            <span>Vencimento</span>
                            <span>Forma</span>
                            <span>Valor</span>
                            <span>Status</span>
                            <span />
                          </div>
                          {payableRows.map((payable) => {
                            const isOverdue = payable.status !== "Pago" && payable.dueDate < todayIso();
                            const statusLabel = payable.status === "Pago" ? "Pago" : isOverdue ? "Atrasado" : payable.status;
                            return (
                              <div className="payable-row" key={payable.id}>
                                <span className="payable-main">
                                  <b>{payable.supplier}</b>
                                  <small>{payable.description}{payable.categoryId != null && fabricationIds.includes(payable.categoryId) ? " · gasto para fabricar peça" : ""}</small>
                                </span>
                                <span className="payable-date" data-label="Data da compra">
                                  {payable.purchaseDate ? brDate(payable.purchaseDate) : "—"}
                                </span>
                                <span className="payable-date" data-label="Vencimento">{brDate(payable.dueDate)}</span>
                                <span className="payable-date" data-label="Forma">
                                  {payable.paymentMethod || "—"}
                                </span>
                                <strong>{money(payable.amountCents / 100)}</strong>
                                <span className="payable-status">
                                  <span className={`status ${statusLabel === "Pago" ? "green" : statusLabel === "Atrasado" ? "red" : "amber"}`}>
                                    {statusLabel}
                                  </span>
                                </span>
                                <span className="payable-action">
                                  {payable.status !== "Pago" && (
                                    <>
                                      <button className="outline-button" onClick={() => openPayableForm(payable)} disabled={saving}>
                                        Editar
                                      </button>
                                      <button className="outline-button" onClick={() => settlePayable(payable)} disabled={saving}>
                                        Marcar paga
                                      </button>
                                    </>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                          <div className="payable-total">
                            <span>{`Total${payablePeriodLabel}`}</span>
                            <strong>{money(payableTotals.totalCents / 100)}</strong>
                          </div>
                        </div>
                      )}
                    </div>
                  </aside>
                </section>
                )}
              </div>
            )}
            {screen === "stock" && (
              <div className="page">
                <Heading
                  eyebrow="PEÇAS PRONTAS"
                  title="Estoque"
                  subtitle="Quantas peças você tem, quantas já estão prometidas e o que falta comprar."
                />
                {stockError && <p className="modal-error">{stockError}</p>}
                {!stockError && stock.totals.uncounted > 0 && (
                  <p className="plain-warning">
                    {`${stock.totals.uncounted === 1 ? "1 peça ainda não foi contada" : `${stock.totals.uncounted} peças ainda não foram contadas`}. Toque em "Lançar" para registrar uma contagem ou uma entrada: a partir daí, cada OS entregue baixa o estoque sozinha.`}
                  </p>
                )}
                <section className="finance-kpi-grid payable-kpis">
                  <article>
                    <span>Peças em estoque</span>
                    <strong>{stock.totals.inStock}</strong>
                    <small>Somando as peças já contadas</small>
                  </article>
                  <article>
                    <span>Prometidas na fila</span>
                    <strong>{stock.totals.reserved}</strong>
                    <small>{queueOrders.length === 1 ? "1 OS aguardando entrega" : `${queueOrders.length} OS aguardando entrega`}</small>
                  </article>
                  <article className={stock.totals.missing > 0 ? "attention" : ""}>
                    <span>Falta comprar</span>
                    <strong>{stock.totals.missing}</strong>
                    <small>{stock.totals.missing > 0 ? "Para entregar o que está na fila" : "A fila está coberta"}</small>
                  </article>
                  <article>
                    <span>Sem estoque</span>
                    <strong>{stock.totals.uncounted}</strong>
                    <small>{stock.totals.uncounted > 0 ? "Peças sem lançamento de estoque" : "Todas as peças com estoque lançado"}</small>
                  </article>
                </section>
                <section className="panel stock-panel">
                  <div className="stock-list">
                    <div className="stock-head" aria-hidden="true">
                      <span>Peça</span><span>Em estoque</span><span>Prometido</span><span>Disponível</span><span>Ritmo de venda</span><span>Situação</span><span />
                    </div>
                    {products
                      .filter((item) => item.active)
                      // Peça com menos disponível primeiro; as zeradas (nada em estoque, nada prometido) ficam no fim.
                      .map((item) => ({ item, row: stock.rows.find((entry) => entry.productId === item.id) }))
                      .sort((a, b) => Number(isEmptyStock(a.row)) - Number(isEmptyStock(b.row)) || (a.row?.available ?? 0) - (b.row?.available ?? 0) || (a.row?.balance ?? 0) - (b.row?.balance ?? 0) || a.item.code.localeCompare(b.item.code))
                      .map(({ item }) => {
                      const row = stock.rows.find((entry) => entry.productId === item.id);
                      if (!row) return null;
                      const tone = row.status === "ok" ? "green" : row.status === "falta" || row.status === "zerado" ? "red" : "amber";
                      return (
                        <div className="stock-row" key={item.id}>
                          <span className="stock-main"><b>{item.code}</b><small>{item.measure}</small></span>
                          <span className="stock-number" data-label="Em estoque">{row.balance ?? 0}</span>
                          <span className="stock-number" data-label="Prometido">{row.reserved}</span>
                          <span className={`stock-number ${row.available !== null && row.available < 0 ? "negative" : ""}`} data-label="Disponível">{row.available ?? 0}</span>
                          <span className="stock-pace">{paceSentence(row)}</span>
                          <span className="stock-status"><span className={`status ${tone}`}>{STOCK_STATUS_LABEL[row.status]}</span></span>
                          <span className="stock-action">
                            <button className="outline-button" onClick={() => setStockForm({ product: item, kind: "entrada" })} disabled={saving}>Lançar</button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}
            {screen === "wallet" && (
              <div className="page">
                <Heading eyebrow="FINANCEIRO" title="Carteira" subtitle="Acompanhe recebimentos por empresa e situação da carteira." />
                <div className="filters operational-filters operational-filters-wallet">
                  <Field label="Buscar cliente">
                    <input
                      value={walletQuery}
                      onChange={(event) => setWalletQuery(event.target.value)}
                    />
                  </Field>
                  <Field label="Status">
                    <select
                      value={walletStatusFilter}
                      onChange={(event) => setWalletStatusFilter(event.target.value)}
                    >
                      <option value="">Todos</option>
                      <option>Em aberto</option>
                      <option>Atrasado</option>
                      <option>Pago</option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="outline-button filter-clear"
                    onClick={() => {
                      setWalletQuery("");
                      setWalletStatusFilter("");
                    }}
                  >
                    Limpar
                  </button>
                </div>
                <section className="metrics report-metrics wallet-metrics">
                  <Metric icon="R$" label="Total em Carteira" value={money(walletTotals.total)} />
                  <Metric icon="✓" label="Recebido" value={money(walletTotals.received)} />
                  <Metric icon="!" label="Pendente" value={money(walletTotals.pending)} alert={walletTotals.pending > 0} tone="red" />
                </section>
                {!walletRows.length ? (
                  <div className="panel empty">
                    Nenhum registro encontrado na Carteira.
                  </div>
                ) : (
                  <div className="wallet-grid">
                            {walletRows.map((item) => {
                              const balance = item.total - item.received;
                              const walletStatus = balance <= 0
                                ? "Pago"
                                : item.items.some((entry) => entry.balance > 0 && dateTimestamp(entry.receivable.dueDate) < dateTimestamp(todayIso()))
                                  ? "Atrasado"
                                  : "Em aberto";
                              const history = item.items.flatMap((entry) =>
                                financeData.receipts
                                  .filter((receipt) => receipt.accountReceivableId === entry.receivable.id && receipt.status === "Confirmado")
                                  .map((receipt) => ({
                                    amount: receipt.amountCents / 100,
                                    method: receipt.paymentMethod,
                                    date: receipt.receiptDate,
                                    orderNumber: entry.orderNumber,
                                  })),
                              ).sort((a, b) => dateTimestamp(b.date) - dateTimestamp(a.date)) as {
                                amount: number;
                                method: string;
                                date: string;
                                orderNumber: string;
                              }[];
                              return (
                                <section
                                  className="panel wallet-card"
                                  key={item.customer}
                                >
                                  <div className="wallet-head">
                                    <div>
                                      <span>Empresa</span>
                                      <h2>{item.customer}</h2>
                                    </div>
                                    <span
                                      className={`status ${walletStatus === "Pago" ? "green" : walletStatus === "Atrasado" ? "red" : "amber"}`}
                                    >
                                      {walletStatus}
                                    </span>
                                  </div>
                                  <div className="wallet-summary wallet-summary-clean">
                                    <span>Total <b>{money(item.total)}</b></span>
                                    <span>Recebido <b>{money(item.received)}</b></span>
                                    <span className={balance > 0 ? "pending" : ""}>Saldo <b>{money(balance)}</b></span>
                                  </div>
                                  <div className="wallet-orders">
                                    <strong className="wallet-section-title">HISTÓRICO DE PEDIDOS</strong>
                                    <div className="wallet-orders-head">
                                      <span>OS</span>
                                      <span>Data do pedido</span>
                                      <span>Data de vencimento</span>
                                      <span>Valor</span>
                                    </div>
                                    {item.items
                                      .slice()
                                      .sort((a, b) => b.orderNumber.localeCompare(a.orderNumber, "pt-BR", { numeric: true }))
                                      .map((entry) => (
                                      <div
                                        className="wallet-order-row"
                                        key={entry.receivable.id}
                                        role="button"
                                        tabIndex={entry.order ? 0 : -1}
                                        aria-label={`Visualizar ${entry.orderNumber}`}
                                        onClick={() => entry.order && setOrderModal(entry.order)}
                                        onKeyDown={(event) => {
                                          if (entry.order && (event.key === "Enter" || event.key === " ")) setOrderModal(entry.order);
                                        }}
                                      >
                                        <b>{entry.orderNumber}</b>
                                        <span className="wallet-order-date" data-label="Data do pedido">{brDate(entry.issuedAt)}</span>
                                        <span className="wallet-order-date" data-label="Vencimento">{brDate(entry.receivable.dueDate)}</span>
                                        <strong>{money(entry.total)}</strong>
                                      </div>
                                    ))}
                                  </div>
                                  {history.length > 0 && (
                                    <div className="payment-history">
                                      <strong className="wallet-section-title">HISTÓRICO DE PAGAMENTOS</strong>
                                      <div className="payment-history-head">
                                        <span>OS</span>
                                        <span>Data de pagamento</span>
                                        <span>Forma de pagamento</span>
                                        <span>Valor pago</span>
                                      </div>
                                      {history.map((p, i) => (
                                        <div className="payment-history-row" key={i}>
                                          <span>{p.orderNumber}</span>
                                          <span>{brDate(p.date)}</span>
                                          <span>{p.method}</span>
                                          <b>{money(p.amount)}</b>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {balance > 0 ? (
                                    <div className="wallet-card-actions">
                                      <button
                                        className="primary-button wallet-pay"
                                        disabled={saving}
                                        onClick={() => {
                                          setWalletPayMethod("");
                                          setWalletPayment({
                                            items: item.items,
                                            customer: item.customer,
                                          });
                                          setWalletPayDate(brDate(todayIso()));
                                          setWalletPayAmount(0);
                                        }}
                                      >
                                        Registrar pagamento
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="wallet-card-actions">
                                      <button
                                        className="outline-button wallet-pay"
                                        onClick={() => downloadWalletPdf(item.items, item.customer)}
                                      >
                                        Baixar PDF
                                      </button>
                                      <button
                                        className="whatsapp-button wallet-pay"
                                        onClick={() => shareWallet(item.items, item.customer)}
                                      >
                                        Enviar ao cliente
                                      </button>
                                    </div>
                                  )}
                                </section>
                              );
                            })}
                  </div>
                )}
              </div>
            )}
            {false && screen === "reports" && (
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
                <div className="filters operational-filters operational-filters-three">
                  <Field label="Buscar cliente">
                    <select value={reportCustomer} onChange={(e) => setReportCustomer(e.target.value)}>
                      <option value="">Todos</option>
                      {[...customers]
                        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                        .map((customer) => (
                          <option key={customer.id} value={customer.name}>{customer.name}</option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Mês">
                    <select value={reportMonth} onChange={(e) => setReportMonth(e.target.value)}>
                      <option value="">Todos</option>
                      {reportMonths.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select value={reportPaymentStatus} onChange={(e) => setReportPaymentStatus(e.target.value)}>
                      <option value="">Todos</option>
                      <option>Pago</option>
                      <option>Pagamento parcial</option>
                      <option>Em aberto</option>
                      <option>Atrasado</option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    className="outline-button filter-clear"
                    onClick={() => { setReportMonth(""); setReportCustomer(""); setReportPaymentStatus(""); }}
                  >
                    Limpar
                  </button>
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
                    icon="!"
                    label="Pendente"
                    value={money(reportSales - reportReceived)}
                    alert={reportSales - reportReceived > 0}
                    tone="red"
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
                  eyebrow=""
                  title={settingsNav.find(([section]) => section === settingsSection)?.[2] || "Configurações"}
                  subtitle=""
                />
                {settingsSection === "company" && (
                  <div className="customer-page-form settings-card">
                    <div className="settings-section-title"><h2>Dados da empresa</h2></div>
                    <Field label="Nome da empresa *">
                      <input
                        required
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                      />
                    </Field>
                    <Field label="Responsável *">
                      <input
                        required
                        value={responsible}
                        onChange={(e) => setResponsible(e.target.value)}
                      />
                    </Field>
                    <Field label="WhatsApp da empresa *">
                      <input
                        required
                        inputMode="tel"
                        value={companyPhone}
                        onChange={(e) =>
                          setCompanyPhone(maskPhone(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Rodapé da OS *">
                      <input
                        required
                        value={orderFooter}
                        onChange={(e) => setOrderFooter(e.target.value)}
                      />
                    </Field>
                    <div className="settings-actions">
                      <button className="primary-button settings-submit-button" onClick={saveSettings}>
                        Salvar
                      </button>
                    </div>
                  </div>
                )}
                {settingsSection === "users" && auth.user.role === "admin" && (
                  <div className="customer-page-form user-admin settings-page-panel">
                    <div className="settings-section-title"><h2>Acesso ao sistema</h2></div>
                    <form className="user-create" onSubmit={createUser} noValidate>
                      <Field label="Nome *"><input name="name" required /></Field>
                      <Field label="E-mail *"><input name="email" type="email" required autoComplete="off" /></Field>
                      <Field label="Senha temporária *"><div className="password-input"><input name="password" type={showTempPassword ? "text" : "password"} minLength={8} required /><button type="button" onClick={() => setShowTempPassword((value) => !value)} aria-label={showTempPassword ? "Ocultar senha" : "Mostrar senha"}><EyeIcon open={showTempPassword} /></button></div></Field>
                      <button className="primary-button settings-submit-button" disabled={userSaving}>{userSaving ? "Salvando..." : "Salvar"}</button>
                    </form>
                    {authError && <p className="modal-error user-error">{authError}</p>}
                    <div className="user-list">{auth.users.map((user) => <div key={user.id}><span><b>{user.name}</b><small>{user.email} · {user.role === "admin" ? "Administrador" : "Usuário"}</small></span>{user.role !== "admin" && <button className={`link-button ${user.active ? "danger-action" : "success-action"}`} onClick={() => toggleUser(user.id, !user.active)}>{user.active ? "Bloquear" : "Ativar"}</button>}</div>)}</div>
                  </div>
                )}
                {settingsSection === "users" && auth.user.role !== "admin" && (
                  <div className="panel settings-page-panel">
                    <p className="finance-history-empty">Acesso restrito ao administrador.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
      {menu && <button className="overlay" onClick={() => setMenu(false)} />}
      {viewingCustomer && (
        <Modal
          title="Visualizar cliente"
          page
          pageLabel=""
          close={() => setViewingCustomer(null)}
        >
          <div className="record-view">
            <div className="record-view-grid">
              <div className="customer-primary-view-row">
                <ReviewField label="Nome ou razão social" value={viewingCustomer.name} />
                <ReviewField label="Status" value={viewingCustomer.active ? "Ativo" : "Inativo"} />
                <ReviewField label="Tipo de cliente" value={viewingCustomer.customerType || "Cliente final"} />
              </div>
              <div className="customer-contact-view-row">
                <ReviewField label="CPF/CNPJ" value={formatDocument(viewingCustomer.document).replace(/^(CPF|CNPJ):\s*/, "") || "—"} />
                <ReviewField label="WhatsApp" value={formatPhone(viewingCustomer.whatsapp) || "—"} />
                <ReviewField label="E-mail" value={viewingCustomer.email || "—"} />
              </div>
              <div className="customer-address-view-row">
                <ReviewField label="CEP" value={viewingCustomer.zipCode || "—"} />
                <ReviewField
                  label="Endereço"
                  value={[
                    viewingCustomer.street,
                    viewingCustomer.number,
                    viewingCustomer.complement,
                    viewingCustomer.neighborhood,
                    viewingCustomer.city && viewingCustomer.state
                      ? `${viewingCustomer.city} - ${viewingCustomer.state}`
                      : viewingCustomer.city || viewingCustomer.state,
                  ].filter(Boolean).join(", ") || "—"}
                  multiline
                />
              </div>
            </div>
            <div className="record-view-footer record-view-actions-row">
              <button className="record-back-button system-back-button" onClick={() => setViewingCustomer(null)}>
                Voltar
              </button>
              <button
                className="record-edit-button"
                onClick={() => {
                  const customer = viewingCustomer;
                  setViewingCustomer(null);
                  openCustomer(customer);
                }}
              >
                Editar
              </button>
              <button
                className={viewingCustomer.active ? "record-inactivate" : "record-activate"}
                onClick={async () => {
                  await toggle("customer", viewingCustomer.id, !viewingCustomer.active);
                  setViewingCustomer(null);
                }}
              >
                {viewingCustomer.active ? "Inativar" : "Ativar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {viewingType && (
        <Modal title="Visualizar tipo" page pageLabel="" close={() => { if (!typeSaving) setViewingType(null); }}>
          <div className="record-view">
            <div className="record-view-grid"><div className="type-form-row">
              <ReviewField label="Tipo" value={viewingType.name} />
              <ReviewField label="Status" value={viewingType.active ? "Ativo" : "Inativo"} />
            </div></div>
            <div className="record-view-footer record-view-actions-row">
              <button className="record-back-button system-back-button" disabled={typeSaving} onClick={() => setViewingType(null)}>Voltar</button>
              <button className="record-edit-button" disabled={typeSaving} onClick={() => { setEditingType(viewingType); setViewingType(null); setTypeModal(true); }}>Editar</button>
              <button className={viewingType.active ? "record-inactivate" : "record-activate"} disabled={typeSaving} onClick={() => { void toggleType(viewingType); }}>
                {typeSaving ? "Salvando..." : viewingType.active ? "Inativar" : "Ativar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {typeModal && (
        <Modal title={editingType ? "Editar tipo" : "Cadastrar tipo"} page pageLabel="" close={() => { if (!typeSaving) { setTypeModal(false); setEditingType(null); } }}>
          <form className="customer-page-form" onSubmit={saveType}>
            <div className="form-grid type-form-row">
              <Field label="Tipo *"><input name="name" required maxLength={80} defaultValue={editingType?.name || ""} disabled={typeSaving} /></Field>
              <Field label="Status"><input value={editingType?.active === false ? "Inativo" : "Ativo"} readOnly /></Field>
            </div>
            <div className="form-actions registration-actions">
              <button type="button" className="cancel-button" disabled={typeSaving} onClick={() => { const type = editingType; setTypeModal(false); setEditingType(null); if (type) setViewingType(type); }}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={typeSaving}>{typeSaving ? "Salvando..." : "Salvar"}</button>
            </div>
          </form>
        </Modal>
      )}
      {viewingLine && (
        <Modal title="Visualizar linha" page pageLabel="" close={() => { if (!lineSaving) setViewingLine(null); }}>
          <div className="record-view">
            <div className="record-view-grid"><div className="type-form-row">
              <ReviewField label="Linha" value={viewingLine.name} />
              <ReviewField label="Status" value={viewingLine.active ? "Ativo" : "Inativo"} />
            </div></div>
            <div className="record-view-footer record-view-actions-row">
              <button className="record-back-button system-back-button" disabled={lineSaving} onClick={() => setViewingLine(null)}>Voltar</button>
              <button className="record-edit-button" disabled={lineSaving} onClick={() => { setEditingLine(viewingLine); setViewingLine(null); setLineModal(true); }}>Editar</button>
              <button className={viewingLine.active ? "record-inactivate" : "record-activate"} disabled={lineSaving} onClick={() => { void toggleLine(viewingLine); }}>
                {lineSaving ? "Salvando..." : viewingLine.active ? "Inativar" : "Ativar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {lineModal && (
        <Modal title={editingLine ? "Editar linha" : "Cadastrar linha"} page pageLabel="" close={() => { if (!lineSaving) { setLineModal(false); setEditingLine(null); } }}>
          <form className="customer-page-form" onSubmit={saveLine}>
            <div className="form-grid type-form-row">
              <Field label="Linha *"><input name="name" required maxLength={200} defaultValue={editingLine?.name || ""} disabled={lineSaving} /></Field>
              <Field label="Status"><input value={editingLine?.active === false ? "Inativo" : "Ativo"} readOnly /></Field>
            </div>
            <div className="form-actions registration-actions">
              <button type="button" className="cancel-button" disabled={lineSaving} onClick={() => { const type = editingLine; setLineModal(false); setEditingLine(null); if (type) setViewingLine(type); }}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={lineSaving}>{lineSaving ? "Salvando..." : "Salvar"}</button>
            </div>
          </form>
        </Modal>
      )}
      {viewingProduct && (
        <Modal
          title="Visualizar peça"
          page
          pageLabel=""
          close={() => setViewingProduct(null)}
        >
          <div className="record-view">
            <div className="record-view-grid">
              <div className="product-view-row">
                <ReviewField label="Código" value={viewingProduct.code} />
                <ReviewField label="Tipo" value={viewingProduct.pieceType || "—"} />
                <ReviewField label="Valor" value={money(viewingProduct.price)} />
                <ReviewField label="Status" value={viewingProduct.active ? "Ativo" : "Inativo"} />
                <ReviewField label="Linha" value={viewingProduct.name} />
                <ReviewField label="Medidas" value={viewingProduct.measure} />
              </div>
            </div>
            {(() => {
              // Mesmos blocos e mesma ordem da tela de edição.
              const purchase = openCost(productCosts, viewingProduct.id, "comprada");
              const cost = openCost(productCosts, viewingProduct.id);
              const cents = (value?: number) => money((value ?? 0) / 100);
              const profitNote = (unitCostCents?: number) => {
                const costValue = (unitCostCents ?? 0) / 100;
                const rate = profitOnCost(viewingProduct.price, costValue);
                return rate === null
                  ? "Custo não cadastrado."
                  : `Custo total de ${money(costValue)}. Lucro por peça: ${money(viewingProduct.price - costValue)} · ${percent(rate)} sobre o custo.`;
              };
              const use = costUseOf(viewingProduct.id);
              return (
                <>
                  <fieldset className="product-cost-fields product-cost-readonly">
                    <legend>Custo revenda</legend>
                    <div className="product-cost-row">
                      <ReviewField label="Valor de compra" value={cents(purchase?.rawMaterialCostCents)} />
                      <ReviewField label="Frete" value={cents(purchase?.freightCents)} />
                      <ReviewField label="Fornecedor" value={purchase?.supplier || "—"} />
                      <ReviewField label="Custo válido desde" value={purchase ? brDate(purchase.startsAt) : "—"} />
                      <ReviewField label="Custo em uso" value={use.source === "comprada" ? "Sim" : "Não"} />
                      {use.source === "comprada" && <ReviewField label="Em uso desde" value={brDate(use.startsAt)} />}
                    </div>
                    <small>{profitNote(purchase?.unitCostCents)}</small>
                  </fieldset>
                  <fieldset className="product-cost-fields product-cost-readonly">
                    <legend>Custo fabricação</legend>
                    <div className="product-cost-row">
                      <ReviewField label="Material" value={cents(cost?.rawMaterialCostCents)} />
                      <ReviewField label="Mão de obra / terceiros" value={cents(cost?.additionalCostsCents)} />
                      <ReviewField label="Frete" value={cents(cost?.freightCents)} />
                      <ReviewField label="Custo válido desde" value={cost ? brDate(cost.startsAt) : "—"} />
                      <ReviewField label="Custo em uso" value={use.source === "fabricada" ? "Sim" : "Não"} />
                      {use.source === "fabricada" && <ReviewField label="Em uso desde" value={brDate(use.startsAt)} />}
                    </div>
                    <small>{profitNote(cost?.unitCostCents)}</small>
                  </fieldset>
                  {priceHistoryBlock(viewingProduct.id)}
                </>
              );
            })()}
            <section className="product-image-editor" aria-label="Imagem da peça">
              <div className="product-image-preview">
                {productImageSource(viewingProduct) ? (
                  <CatalogImage src={productImageSource(viewingProduct)} alt={`Imagem da peça ${viewingProduct.code}`} />
                ) : <span>Sem imagem cadastrada</span>}
              </div>
              <div className="product-image-controls">
                <strong>Imagem da peça</strong>
                <p>Esta imagem é usada no catálogo e nos PDFs.</p>
              </div>
            </section>
            <div className="record-view-footer record-view-actions-row">
              <button className="record-back-button system-back-button" onClick={() => setViewingProduct(null)}>
                Voltar
              </button>
              <button
                className="record-edit-button"
                onClick={() => {
                  const product = viewingProduct;
                  setViewingProduct(null);
                  setEditingProduct(product);
                  setProductModal(true);
                }}
              >
                Editar
              </button>
              <button
                className={viewingProduct.active ? "record-inactivate" : "record-activate"}
                onClick={async () => {
                  await toggle("product", viewingProduct.id, !viewingProduct.active);
                  setViewingProduct(null);
                }}
              >
                {viewingProduct.active ? "Inativar" : "Ativar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {customerModal && (
        <Modal
          title={editingCustomer ? "Editar cliente" : "Cadastrar cliente"}
          page
          pageLabel=""
          close={() => setCustomerModal(false)}
        >
          <form className="customer-page-form" onSubmit={saveCustomer} noValidate>
            <div className="form-grid customer-registration-primary">
              <Field label="Nome ou razão social *">
                <input
                  name="name"
                  required
                  autoFocus
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </Field>
              <Field label="Status">
                <input value={editingCustomer?.active === false ? "Inativo" : "Ativo"} readOnly />
              </Field>
              <Field label="Tipo de cliente *">
                <select required value={customerType} onChange={(e) => setCustomerType(e.target.value)}>
                  <option value="">Selecione</option>
                  <option>Cliente final</option>
                  <option>Distribuidor</option>
                </select>
              </Field>
            </div>
            <div className="form-grid customer-registration-contact">
              <Field label="CPF ou CNPJ *">
                <input
                  required
                  inputMode="numeric"
                  value={doc}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 14);
                    const type = digits.length > 11 ? "CNPJ" : "CPF";
                    setDocType(type);
                    setDoc(maskDoc(digits, type));
                  }}
                />
              </Field>
              <Field label="WhatsApp *">
                <input
                  required
                  value={phone}
                  onChange={(e) => setPhone(maskPhone(e.target.value))}
                />
              </Field>
              <Field label="E-mail">
                <input
                  name="email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                />
              </Field>
            </div>
            <div className="address-section">
              <div className="form-grid address-grid">
                <Field label="CEP *">
                  <input required inputMode="numeric" value={zipCode} onChange={(e) => lookupZipCode(e.target.value)} maxLength={9} />
                  {zipLoading && <small className="field-help">Buscando endereço...</small>}
                </Field>
                <Field label="Logradouro *">
                  <input value={street} readOnly required />
                </Field>
                <Field label="Bairro *">
                  <input value={neighborhood} readOnly required />
                </Field>
                <Field label="Cidade *">
                  <input value={city} readOnly required />
                </Field>
                <Field label="UF *">
                  <input value={addressState} readOnly required />
                </Field>
                <Field label="Número *">
                  <input required value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} />
                </Field>
                <Field label="Complemento">
                  <input value={complement} onChange={(e) => setComplement(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="form-actions registration-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => {
                  const customer = editingCustomer;
                  setCustomerModal(false);
                  setEditingCustomer(null);
                  if (customer) setViewingCustomer(customer);
                }}
              >
                Cancelar
              </button>
              <button className="primary-button" disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {pricingProduct && (() => {
        const product = products.find((item) => item.id === pricingProduct.id) || pricingProduct;
        const currentCents = Math.round(product.price * 100);
        const priceCents = Math.round(parseCurrency(simPrice) * 100);
        const fabricated = costOfSourceAt(productCosts, product.id, "fabricada", todayIso())?.unitCostCents ?? null;
        const purchased = costOfSourceAt(productCosts, product.id, "comprada", todayIso())?.unitCostCents ?? null;
        const useSource = costUseOf(product.id).source;
        const baseCost = (useSource === "comprada" ? purchased ?? fabricated : fabricated ?? purchased);
        const baseIsPurchase = baseCost !== null && (useSource === "comprada" ? purchased !== null : fabricated === null);
        const simulation = simulatePrice({ priceCents, fabricatedCostCents: fabricated, purchasedCostCents: purchased, targetRate });
        const column = (source: SourceSimulation, label: string) => (
          <article className={`sim-col ${source.reachesTarget === null ? "" : source.reachesTarget ? "ok" : (source.profitCents ?? 0) < 0 ? "bad" : "warn"}`}>
            <h3>{label}</h3>
            {source.costCents === null ? (
              <p className="compact-empty">Falta cadastrar este custo em Peças.</p>
            ) : (
              <dl>
                <div><dt>Custo</dt><dd>{money(source.costCents / 100)}</dd></div>
                <div><dt>{(source.profitCents ?? 0) < 0 ? "Prejuízo por peça" : "Lucro por peça"}</dt><dd><b>{money(Math.abs(source.profitCents ?? 0) / 100)}</b></dd></div>
                <div><dt>Lucro sobre o custo</dt><dd>{percent(source.onCost ?? 0)}</dd></div>
                <div><dt>Lucro sobre o preço</dt><dd>{percent(source.onPrice ?? 0)}</dd></div>
                <div><dt>Preço mínimo, sem prejuízo</dt><dd>{money((source.minPriceCents ?? 0) / 100)}</dd></div>
                <div><dt>{`Preço para a meta de ${percent(targetRate)}`}</dt><dd>{money((source.targetPriceCents ?? 0) / 100)}</dd></div>
              </dl>
            )}
          </article>
        );
        // Lucro que o preço simulado dá hoje sobre o custo em uso; aparece no campo enquanto nada é digitado.
        const currentRate = baseCost === null ? null : (baseIsPurchase ? simulation.comprada : simulation.fabricada).onCost;
        return (
          <Modal title={`Simular preço · ${product.code}`} close={() => setPricingProduct(null)}>
            <div className="sim-inputs">
              <Field label="Lucro desejado sobre o custo (%)">
                <input
                  inputMode="decimal"
                  value={simMargin !== "" ? simMargin : currentRate === null ? "" : percent(currentRate)}
                  placeholder={percent(targetRate)}
                  disabled={baseCost === null}
                  onFocus={(e) => e.target.select()}
                  onBlur={() => setSimMargin("")}
                  onChange={(e) => {
                    setSimMargin(e.target.value);
                    const rate = parsePercent(e.target.value);
                    if (rate !== null && baseCost !== null) setSimPrice(money(priceForMargin(baseCost, rate) / 100));
                  }}
                />
              </Field>
              <Field label="Ou o preço de venda">
                <input
                  inputMode="numeric"
                  value={simPrice}
                  onChange={(e) => {
                    setSimPrice(maskCurrency(e.target.value));
                    setSimMargin("");
                  }}
                />
              </Field>
            </div>
            <p className="sim-note">
              {`Preço atual: ${money(currentCents / 100)}. `}
              {baseCost === null ? "Cadastre o custo da peça para simular o lucro." : `O lucro desejado é calculado sobre o ${baseIsPurchase ? "custo revenda" : "custo fabricação"}, o custo em uso da peça.`}
            </p>
            <div className="sim-grid">
              {column(simulation.comprada, "Custo revenda")}
              {column(simulation.fabricada, "Custo fabricação")}
            </div>
            <p className="sim-compare">{sourceComparison(simulation, money)}</p>
            <div className="form-actions">
              <button type="button" className="cancel-button" onClick={() => setPricingProduct(null)}>Fechar</button>
              <button type="button" className="primary-button" disabled={saving || priceCents <= 0 || priceCents === currentCents} onClick={() => applySimulatedPrice(product, priceCents)}>
                Aplicar preço
              </button>
            </div>
          </Modal>
        );
      })()}
      {viewingBatchId !== null && (() => {
        const batch = purchaseBatches.find((item) => item.id === viewingBatchId);
        const study = batch ? batchStudies.get(batch.id) : undefined;
        if (!batch || !study) return null;
        const orderIds = new Set(study.orders.map((row) => row.orderId));
        const toReceive = openReceivableRows.filter((row) => row.order && orderIds.has(row.order.id));
        const payables = financeData.accountsPayable.filter((payable) => payable.serviceOrderId != null && orderIds.has(payable.serviceOrderId) && payable.status !== "Cancelado");
        const toPay = payables.filter((payable) => payable.status !== "Pago");
        const receivedCents = [...orderIds].reduce((sum, id) => sum + Math.round((ordersById.get(id)?.received ?? 0) * 100), 0);
        const paidCents = payables.filter((payable) => payable.status === "Pago").reduce((sum, payable) => sum + payable.amountCents, 0);
        const dates = (rows: { amountCents: number; dueDate: string }[]) =>
          rows.length ? rows.map((row) => `${money(row.amountCents / 100)} em ${brDate(row.dueDate).slice(0, 5)}`).join(" · ") : "Nada pendente";
        const receiveRows = toReceive.map((row) => ({ amountCents: Math.round(row.balance * 100), dueDate: row.dueDate }));
        return (
          <Modal title={`Lote ${batch.supplier} · ${brDate(batch.purchaseDate)}`} page pageLabel="" backLabel="Lotes de compra" close={() => setViewingBatchId(null)}>
            <div className="batch-study">
              <p className="batch-sub">{`${study.boughtQty} peças compradas · ${study.soldQty} vendidas · ${study.stockQty} em estoque`}</p>
              <div className={`batch-hero ${study.totalCents < 0 ? "bad" : "good"}`}>
                <span>{study.totalCents < 0 ? "Prejuízo esperado do lote" : "Lucro esperado do lote"}</span>
                <strong>{signedMoney(study.totalCents)}</strong>
                <small>
                  {study.rateOnCost === null
                    ? "Cadastre o custo das peças do lote para calcular."
                    : `${percent(study.rateOnCost)} sobre o custo de ${money(study.costCents / 100)} · meta de ${percent(targetRate)}`}
                </small>
                <div className="batch-bar"><i style={{ width: `${Math.min(100, Math.round(study.soldShare * 100))}%` }} /></div>
                <small>{`${Math.round(study.soldShare * 100)}% do lote vendido`}</small>
              </div>
              <div className="dash-kpis batch-kpis">
                <div><span>Custo do lote</span><strong>{money(study.costCents / 100)}</strong><small>{`${study.boughtQty} peças`}</small></div>
                <div><span>Já vendido</span><strong>{money(study.soldRevenueCents / 100)}</strong><small>{`${study.soldQty} peças em ${study.orders.length} OS`}</small></div>
                <div className={study.realizedCents < 0 ? "bad" : "good"}><span>Lucro já feito</span><strong>{signedMoney(study.realizedCents)}</strong><small>nas peças vendidas</small></div>
                <div className={study.expectedStockCents < 0 ? "bad" : "good"}><span>Lucro que falta</span><strong>{signedMoney(study.expectedStockCents)}</strong><small>{`${study.stockQty} peças a preço de tabela`}</small></div>
              </div>
              <section className="batch-block">
                <h3>Pontos de atenção</h3>
                {!study.notes.length && <p className="dash-clear">Nenhum ponto de atenção neste lote.</p>}
                {study.notes.map((note) => (
                  <p className="batch-note" key={note.text}><i className={note.tone} aria-hidden="true" /><span>{note.text}</span></p>
                ))}
              </section>
              <section className="batch-block">
                <h3>Já vendidas</h3>
                {!study.orders.length && <p className="compact-empty">Nenhuma peça deste lote foi vendida ainda.</p>}
                {study.orders.map((row) => (
                  <div className="batch-row" key={row.orderId}>
                    <span>{`${row.orderNumber} · ${row.quantity === 1 ? "1 peça" : `${row.quantity} peças`}`}</span>
                    <b className={row.profitCents === null ? "" : row.profitCents < 0 ? "bad" : "good"}>{row.profitCents === null ? "—" : signedMoney(row.profitCents)}</b>
                    <small>
                      {row.profitCents === null
                        ? "Falta o custo destas peças no lote"
                        : `Vendeu ${money(row.revenueCents / 100)}${row.discounted ? " (com desconto)" : ""} · custou ${money(row.costCents / 100)}${row.uncostedQty ? ` · ${row.uncostedQty} sem custo fora da conta` : ""}`}
                    </small>
                  </div>
                ))}
              </section>
              <section className="batch-block">
                <h3>Dinheiro do lote</h3>
                <div className="batch-row">
                  <span>A receber dos clientes</span>
                  <b>{money(receiveRows.reduce((sum, row) => sum + row.amountCents, 0) / 100)}</b>
                  <small>{dates(receiveRows)}</small>
                </div>
                <div className="batch-row">
                  <span>A pagar ao fornecedor</span>
                  <b>{money(toPay.reduce((sum, payable) => sum + payable.amountCents, 0) / 100)}</b>
                  <small>{dates(toPay)}</small>
                </div>
                <div className="batch-row">
                  <span>Já recebido / já pago</span>
                  <b>{`${money(receivedCents / 100)} / ${money(paidCents / 100)}`}</b>
                  <small>Valores das OS deste lote. Você paga ao fornecedor só o que vende.</small>
                </div>
              </section>
              <section className="batch-block">
                <h3>Em estoque · lucro a preço de tabela</h3>
                {!study.stock.length && <p className="compact-empty">O lote já foi todo vendido.</p>}
                {study.stock.map((row) => (
                  <div className="batch-row" key={row.productId}>
                    <span>{`${row.code} · ${row.quantity === 1 ? "1 peça" : `${row.quantity} peças`}`}</span>
                    <b className={row.profitCents === null ? "" : row.profitCents < 0 ? "bad" : "good"}>{row.profitCents === null ? "—" : signedMoney(row.profitCents)}</b>
                    <small>
                      {row.unitProfitCents === null
                        ? "Falta o custo desta peça no lote"
                        : row.unitProfitCents < 0
                          ? `Prejuízo de ${money(-row.unitProfitCents / 100)} por peça`
                          : `${money(row.unitProfitCents / 100)} por peça${row.onCost === null ? "" : ` · ${percent(row.onCost)} sobre o custo`}`}
                    </small>
                  </div>
                ))}
              </section>
              <div className="form-actions batch-actions">
                <button
                  type="button"
                  className="record-inactivate"
                  disabled={saving || lockedPiecesOf(batch).size > 0}
                  title={lockedPiecesOf(batch).size > 0 ? "Lote com OS entregue ou na fila não pode ser excluído" : undefined}
                  onClick={() => deleteBatch(batch)}
                >
                  Excluir lote
                </button>
                <button type="button" className="primary-button" disabled={saving} onClick={() => { setViewingBatchId(null); setBatchForm({ id: batch.id }); }}>
                  Editar lote
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
      {batchForm && (() => {
        const batch = batchForm.id ? purchaseBatches.find((item) => item.id === batchForm.id) : undefined;
        const entryOf = (productId: number) =>
          batch ? stockMovements.find((movement) => movement.kind === "entrada" && movement.batchId === batch.id && movement.productId === productId) : undefined;
        // Peças ativas e, na edição, também as que já estão no lote.
        const rows = products.filter((product) => product.active || entryOf(product.id));
        const locked = batch ? lockedPiecesOf(batch) : new Set<number>();
        return (
          <Modal title={batch ? "Editar lote de compra" : "Lançar lote de compra"} page pageLabel="" backLabel="Voltar" close={() => setBatchForm(null)}>
            <form className="batch-form" onSubmit={saveBatch}>
              <div className="batch-form-head">
                <Field label="Fornecedor">
                  <input name="batchSupplier" required maxLength={120} defaultValue={batch?.supplier || ""} />
                </Field>
                <Field label="Data da compra">
                  <input type="date" name="batchDate" required max={todayIso()} defaultValue={batch?.purchaseDate || todayIso()} readOnly={locked.size > 0} />
                </Field>
                <Field label="Observação">
                  <input name="batchNotes" maxLength={200} defaultValue={batch?.notes || ""} />
                </Field>
              </div>
              <p className="sim-note">Preencha a quantidade só das peças que vieram neste lote. O custo é o valor pago por peça nesta compra.</p>
              <div className="batch-form-list">
                <div className="batch-form-row batch-form-labels" aria-hidden="true"><span>Peça</span><span>Quantidade</span><span>Custo pago por peça</span></div>
                {rows.map((product) => {
                  const entry = entryOf(product.id);
                  const suggested = entry?.unitCostCents ?? costOfSourceAt(productCosts, product.id, "comprada", todayIso())?.unitCostCents ?? 0;
                  return (
                    <div className={`batch-form-row${locked.has(product.id) ? " locked" : ""}`} key={product.id}>
                      <span className="stock-main"><b>{product.code}</b><small>{locked.has(product.id) ? "já tem OS · não pode mudar" : product.measure}</small></span>
                      <input name={`batchQty-${product.id}`} inputMode="numeric" placeholder="0" aria-label={`Quantidade de ${product.code}`} defaultValue={entry ? String(entry.quantity) : ""} readOnly={locked.has(product.id)} />
                      <input
                        name={`batchCost-${product.id}`}
                        inputMode="numeric"
                        aria-label={`Custo pago por peça de ${product.code}`}
                        defaultValue={money(suggested / 100)}
                        readOnly={locked.has(product.id)}
                        onChange={(e) => {
                          e.currentTarget.value = maskCurrency(e.currentTarget.value);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              {batch && (
                <p className="sim-note">
                  Para tirar uma peça do lote, apague a quantidade dela.
                  {locked.size > 0 ? " Peça com OS entregue ou na fila fica travada, e a data da compra também." : ""}
                </p>
              )}
              <div className="form-actions">
                <button type="button" className="cancel-button" onClick={() => setBatchForm(null)}>Cancelar</button>
                <button type="submit" className="primary-button" disabled={saving}>{batch ? "Salvar lote" : "Lançar lote"}</button>
              </div>
            </form>
          </Modal>
        );
      })()}
      {productModal && (
        <Modal title={editingProduct ? "Editar peça" : "Cadastrar peça"} page pageLabel="" close={() => { setProductModal(false); setCostUseDraft(null); setEditingProduct(null); }}>
          <form className="customer-page-form" onSubmit={saveProduct} noValidate>
            <div className="form-grid product-single-row">
              <Field label="Código *">
                <input name="code" required defaultValue={editingProduct?.code || ""} />
              </Field>
              <Field label="Tipo de peça *">
                <select name="pieceType" required defaultValue={editingProduct?.pieceType || ""}>
                  <option value="">Selecione</option>
                  {selectablePieceTypes.map((type) => (
                    <option key={type.id} value={type.name}>{type.name}{type.active ? "" : " (inativo)"}</option>
                  ))}
                </select>
{!pieceTypes.some((type) => type.active) && <small>Cadastre ou ative um tipo em Configurações → Tipos.</small>}
              </Field>
              <Field label="Valor *">
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
              <Field label="Status">
                <input value={editingProduct?.active === false ? "Inativo" : "Ativo"} readOnly />
              </Field>
              <Field label="Linha *">
                <select name="name" required defaultValue={editingProduct?.name || ""}><option value="">Selecione</option>{selectablePieceLines.map((line) => <option key={line.id} value={line.name}>{line.name}{line.active ? "" : " (inativa)"}</option>)}</select>
                {!pieceLines.some((line) => line.active) && <small>Cadastre ou ative uma linha em Configurações → Linhas.</small>}
              </Field>
              <Field label="Medidas *">
                <input name="measure" required defaultValue={editingProduct?.measure || ""} />
              </Field>
            </div>
            {(() => {
              const cost = editingProduct ? openCost(productCosts, editingProduct.id) : null;
              const purchase = editingProduct ? openCost(productCosts, editingProduct.id, "comprada") : null;
              const costField = (name: string, cents: number) => (
                <input
                  name={name}
                  inputMode="numeric"
                  defaultValue={money(cents / 100)}
                  onChange={(e) => {
                    e.currentTarget.value = maskCurrency(e.currentTarget.value);
                  }}
                />
              );
              const use = editingProduct ? costUseOf(editingProduct.id) : { source: "comprada" as const, startsAt: todayIso(), saved: null };
              const draftKey = String(editingProduct?.id ?? "new");
              const draft = costUseDraft?.key === draftKey ? costUseDraft : { key: draftKey, source: use.source, startsAt: use.startsAt };
              // "Custo em uso" dentro de cada custo: marcar Sim em um põe Não no outro.
              const costUseFields = (source: "comprada" | "fabricada") => {
                const other = source === "comprada" ? "fabricada" : "comprada";
                const active = draft.source === source;
                return (
                  <>
                    <Field label="Custo em uso">
                      <select
                        value={active ? "sim" : "nao"}
                        onChange={(e) => {
                          const next = e.target.value === "sim" ? source : other;
                          setCostUseDraft({ key: draftKey, source: next, startsAt: next === use.source ? use.startsAt : todayIso() });
                        }}
                      >
                        <option value="sim">Sim</option>
                        <option value="nao">Não</option>
                      </select>
                    </Field>
                    {active && (
                      <Field label="Em uso desde">
                        <input
                          type="date"
                          name="costUseStartsAt"
                          value={draft.startsAt}
                          onChange={(e) => setCostUseDraft({ ...draft, startsAt: e.target.value })}
                        />
                      </Field>
                    )}
                  </>
                );
              };
              return (
                <>
                <input type="hidden" name="costUseSource" value={draft.source} />
                <fieldset className="product-cost-fields">
                  <legend>Custo revenda</legend>
                  <div className="product-cost-row">
                    <Field label="Valor de compra">{costField("purchasePrice", purchase?.rawMaterialCostCents ?? 0)}</Field>
                    <Field label="Frete">{costField("purchaseFreight", purchase?.freightCents ?? 0)}</Field>
                    <Field label="Fornecedor">
                      <input name="purchaseSupplier" maxLength={120} defaultValue={purchase?.supplier || ""} />
                    </Field>
                    <Field label="Custo válido desde">
                      <input type="date" name="purchaseStartsAt" defaultValue={purchase?.startsAt || todayIso()} />
                    </Field>
                    {costUseFields("comprada")}
                  </div>
                  <small>
                    {purchase
                      ? `Custo atual de ${money(purchase.unitCostCents / 100)} desde ${brDate(purchase.startsAt)}. Para guardar o custo anterior no histórico, mude os valores e informe a data em que o novo começa a valer.`
                      : "Quanto custa comprar a peça pronta de outro fornecedor. Não aparece no catálogo nem nos PDFs."}
                  </small>
                </fieldset>
                <fieldset className="product-cost-fields">
                  <legend>Custo fabricação</legend>
                  <div className="product-cost-row">
                    <Field label="Material">{costField("costMaterial", cost?.rawMaterialCostCents ?? 0)}</Field>
                    <Field label="Mão de obra / terceiros">{costField("costLabor", cost?.additionalCostsCents ?? 0)}</Field>
                    <Field label="Frete">{costField("costFreight", cost?.freightCents ?? 0)}</Field>
                    <Field label="Custo válido desde">
                      <input type="date" name="costStartsAt" defaultValue={cost?.startsAt || todayIso()} />
                    </Field>
                    {costUseFields("fabricada")}
                  </div>
                  <small>
                    {cost
                      ? `Custo atual de ${money(cost.unitCostCents / 100)} desde ${brDate(cost.startsAt)}. Para guardar o custo anterior no histórico, mude os valores e informe a data em que o novo começa a valer.`
                      : "Quanto custa fabricar a peça. Não aparece no catálogo nem nos PDFs."}
                  </small>
                  <small>O custo marcado como em uso vale para o lucro em todo o sistema a partir da data Em uso desde. As vendas anteriores continuam com o custo da época.</small>
                </fieldset>
                </>
              );
            })()}
            {editingProduct && priceHistoryBlock(editingProduct.id, "Ao salvar um preço diferente, o novo vale a partir de hoje e o anterior fica aqui.")}
            <ProductImageInput key={editingProduct?.id ?? "new"} initialSource={editingProduct ? productImageSource(editingProduct) : ""} disabled={saving} onBusyChange={setImageProcessing} />
            <div className="form-actions registration-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => {
                  const product = editingProduct;
                  setProductModal(false); setCostUseDraft(null);
                  setEditingProduct(null);
                  if (product) setViewingProduct(product);
                }}
              >
                Cancelar
              </button>
              <button className="primary-button" disabled={saving || imageProcessing}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {stockForm && (
        <Modal title={`Estoque de ${stockForm.product.code}`} close={() => setStockForm(null)}>
          <form key={`${stockForm.product.id}-${stockForm.kind}`} onSubmit={saveStockMovement} noValidate>
            <div className="form-grid">
              <Field label="O que aconteceu *">
                <select name="kind" defaultValue={stockForm.kind}>
                  <option value="contagem">Contei: é isso que tenho agora</option>
                  <option value="entrada">Entrada: comprei peças</option>
                  <option value="saida">Saída: perdi, quebrei ou usei</option>
                </select>
              </Field>
              <Field label="Quantidade de peças *">
                <input name="quantity" inputMode="numeric" pattern="[0-9]*" required autoFocus />
              </Field>
              <Field label="Data *">
                <input type="date" name="movementDate" defaultValue={todayIso()} max={todayIso()} required />
              </Field>
              <Field label="Observações">
                <input name="notes" maxLength={200} />
              </Field>
            </div>
            <p className="plain-text muted">A contagem vale como fim do dia: as OS entregues depois dessa data baixam o estoque sozinhas.</p>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={() => setStockForm(null)}>Cancelar</button>
              <button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
            </div>
          </form>
        </Modal>
      )}
      {payableModal && (
        <Modal title={editingPayable ? "Editar conta a pagar" : "Cadastrar conta a pagar"} close={closePayableForm}>
          <form key={editingPayable?.id ?? "new"} onSubmit={savePayable} noValidate>
            <div className="form-grid">
              <Field label="Fornecedor *">
                <input name="supplier" required defaultValue={editingPayable?.supplier || ""} />
              </Field>
              <Field label="Descrição *">
                <input name="description" required defaultValue={editingPayable?.description || ""} />
              </Field>
              <Field label="Data da compra">
                <input
                  name="purchaseDate"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="dd/mm/aaaa"
                  defaultValue={editingPayable ? (editingPayable.purchaseDate ? brDate(editingPayable.purchaseDate) : "") : brDate(todayIso())}
                  onInput={(e) => { e.currentTarget.value = maskDate(e.currentTarget.value); }}
                />
              </Field>
              <Field label="Vencimento *">
                <input
                  name="dueDate"
                  inputMode="numeric"
                  maxLength={10}
                  defaultValue={brDate(editingPayable?.dueDate || todayIso())}
                  onInput={(e) => { e.currentTarget.value = maskDate(e.currentTarget.value); }}
                  required
                />
              </Field>
              <Field label="Valor *">
                <input
                  name="amount"
                  inputMode="numeric"
                  defaultValue={money((editingPayable?.amountCents ?? 0) / 100)}
                  onChange={(e) => { e.currentTarget.value = maskCurrency(e.currentTarget.value); }}
                  required
                />
              </Field>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="isFabrication"
                  value="sim"
                  defaultChecked={editingPayable?.categoryId != null && fabricationIds.includes(editingPayable.categoryId)}
                />
                <span>
                  <b>Gasto para fabricar peça</b>
                  <small>Marque para aço, serviço do torneiro e outros gastos da fabricação. Serve para separar esse gasto das outras contas.</small>
                </span>
              </label>
              <Field label="Status">
                <select value={payableStatus} onChange={(e) => setPayableStatus(e.target.value)}>
                  <option>Pendente</option>
                  <option>Pago</option>
                </select>
              </Field>
              <Field label="Forma de pagamento">
                <select name="paymentMethod" defaultValue={editingPayable?.paymentMethod || ""}>
                  <option value="">Selecione</option>
                  <option>Pix</option>
                  <option>Dinheiro</option>
                  <option>Cartão</option>
                  <option>Boleto</option>
                </select>
              </Field>
              {payableStatus === "Pago" && (
                <Field label="Data do pagamento *">
                  <input
                    name="paidAt"
                    inputMode="numeric"
                    maxLength={10}
                    defaultValue={brDate(todayIso())}
                    onInput={(e) => { e.currentTarget.value = maskDate(e.currentTarget.value); }}
                  />
                </Field>
              )}
              <Field label="Observações">
                <input name="notes" defaultValue={editingPayable?.notes || ""} />
              </Field>
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={closePayableForm}>
                Cancelar
              </button>
              <button className="primary-button" disabled={saving}>
                {saving ? "Salvando..." : editingPayable ? "Salvar" : "Adicionar"}
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
                <option value="">Selecione</option>
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
        <Modal
          title="Visualizar Ordem de Serviço"
          subtitle={orderModal.number}
          page
          pageLabel=""
          close={() => setOrderModal(null)}
        >
          <div className="order-view-form">
            <div className="form-grid order-customer-date-grid">
              <ReviewField label="Cliente" value={orderModal.customerName} />
              <ReviewField label="Tipo de cliente" value={isDistributor(orderModal.customerType) ? "Distribuidor" : "Cliente final"} />
              <ReviewField label="Data do pedido" value={brDate(orderModal.createdAt)} />
              {isQueuedWithoutPayment(orderModal) && <ReviewField label="Status" value="Fila de produção" />}
            </div>
            <div className="review-items">
              {getOrderItems(orderModal).map((item, index) => {
                const selectedProduct = products.find((product) => product.code === item.code);
                const unitPrice = item.unitPrice || selectedProduct?.price || 0;
                return (
                  <div className="review-item-row" key={`${item.code}-${index}`}>
                    <ReviewField label={`Peça ${index + 1}`} value={[item.code, pieceLabel(selectedProduct, item.code), selectedProduct?.measure].filter(Boolean).join(" · ")} />
                    <ReviewField label="Quantidade" value={String(item.quantity)} />
                    <ReviewField label="Valor unitário" value={money(unitPrice)} />
                    <ReviewField label="Valor total" value={money(unitPrice * item.quantity)} />
                  </div>
                );
              })}
              {isQueuedWithoutPayment(orderModal) && (
                <div className="review-queue-total">
                  {isDistributor(orderModal.customerType) && (
                    <>
                      <span>Subtotal <strong>{money(orderModal.subtotal || orderModal.total)}</strong></span>
                      <span>
                        Desconto ({orderModal.discountRate || 0}%)
                        <strong>- {money((orderModal.subtotal || orderModal.total) - orderModal.total)}</strong>
                      </span>
                    </>
                  )}
                  <span className="total">Total da OS <strong>{money(orderModal.total)}</strong></span>
                </div>
              )}
            </div>
            {isQueuedWithoutPayment(orderModal) ? null : (
            <div className="form-grid order-payment-grid review-payment-grid">
              <ReviewField label="Forma de entrega" value={orderModal.deliveryType} />
              <ReviewField label="Forma de pagamento" value={`${boletoLabel(orderModal)} · ${orderDisplayStatus(orderModal)}`} />
              <ReviewField label="Valor recebido" value={money(orderModal.received)} />
              <div className={`payment-summary ${isDistributor(orderModal.customerType) ? "four-columns" : "two-columns"}`}>
                {isDistributor(orderModal.customerType) && (
                  <>
                    <span>Subtotal <strong>{money(orderModal.subtotal || orderModal.total)}</strong></span>
                    <span>
                      Desconto ({orderModal.discountRate || 0}%)
                      <strong>- {money((orderModal.subtotal || orderModal.total) - orderModal.total)}</strong>
                    </span>
                  </>
                )}
                <span>Total da OS <strong>{money(orderModal.total)}</strong></span>
                {orderModal.received > orderModal.total ? (
                  <span className="credit">Crédito do cliente <strong>{money(orderModal.received - orderModal.total)}</strong></span>
                ) : (
                  <span className="pending">Saldo devedor <strong>{money(Math.max(0, orderModal.total - orderModal.received))}</strong></span>
                )}
                {orderModal.paymentMethod === "Boleto" && (() => {
                  const parcels = financeData.receivableInstallments
                    .filter((item) => item.serviceOrderId === orderModal.id)
                    .sort((a, b) => a.number - b.number);
                  if (parcels.length) {
                    return (
                      <div className="boleto-installments">
                        {parcels.map((parcel) => {
                          const overdue = parcel.balanceCents > 0 && parcel.dueDate < todayIso();
                          return (
                            <div className="boleto-installment-row" key={parcel.id}>
                              <span>
                                <b>{parcel.totalInstallments > 1 ? `Parcela ${parcel.number}/${parcel.totalInstallments} · ` : ""}{money(parcel.amountCents / 100)}</b>
                                <small>
                                  Vence em {brDate(parcel.dueDate)}
                                  {parcel.receivedCents > 0 && parcel.balanceCents > 0 ? ` · recebido ${money(parcel.receivedCents / 100)}` : ""}
                                </small>
                              </span>
                              {parcel.status === "Cancelado" ? (
                                <span className="status red">Cancelada</span>
                              ) : parcel.balanceCents <= 0 ? (
                                <span className="status green">Paga</span>
                              ) : (
                                <>
                                  <span className={`status ${overdue ? "red" : "amber"}`}>{overdue ? "Atrasada" : "Em aberto"}</span>
                                  <button
                                    className="boleto-pay"
                                    disabled={saving || orderModal.productionStatus === "Cancelada"}
                                    onClick={() => settleBoleto(orderModal, parcel)}
                                  >
                                    ✓ Confirmar pagamento
                                  </button>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                  if (orderModal.received < orderModal.total) {
                    return (
                      <div className="boleto-payment-card">
                        <span><b>Boleto aguardando pagamento</b><small>Confirme somente após identificar o recebimento.</small></span>
                        <button className="boleto-pay" onClick={() => settleBoleto(orderModal)}>
                          ✓ Confirmar pagamento
                        </button>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
            )}
            <ReviewField
              label="Observações adicionais"
              value={completeOrderNotes(orderModal, "\n", financeData.receipts)}
              multiline
            />
          </div>
          <div className="detail-actions document-actions order-view-actions">
            <button className="outline-button system-back-button" onClick={() => setOrderModal(null)}>
              Voltar
            </button>
            {canGenerateOrderPdf(orderModal) && (
              <button
                className="outline-button"
                onClick={() => downloadPdf(orderModal)}
              >
                Baixar PDF
              </button>
            )}
            <button
              className="cancel-button order-cancel-button"
              title={orderModal.productionStatus === "Cancelada" ? "OS já cancelada" : orderDisplayStatus(orderModal) === "Pago" ? "Cancelamento indisponível para OS paga" : "Cancelar"}
              disabled={orderModal.productionStatus === "Cancelada" || orderDisplayStatus(orderModal) === "Pago"}
              onClick={() => cancelOrder(orderModal)}
            >
              Cancelar
            </button>
            {orderModal.productionStatus !== "Cancelada" && normalizeOrderStatus(orderModal.productionStatus) === ORDER_STATUS.queue && (
              <button
                className="primary-button"
                onClick={() => editOrder(orderModal, "review", ORDER_STATUS.delivered)}
              >
                Entregar
              </button>
            )}
            <button
              className="primary-button"
              title={orderModal.productionStatus === "Cancelada" ? "Edição indisponível para OS cancelada" : orderDisplayStatus(orderModal) === "Pago" ? "Edição indisponível para OS paga" : "Editar"}
              disabled={orderModal.productionStatus === "Cancelada" || orderDisplayStatus(orderModal) === "Pago"}
              onClick={() => editOrder(orderModal, "review")}
            >
              Editar
            </button>
            {canGenerateOrderPdf(orderModal) && orderModal.productionStatus !== "Cancelada" && (
                <button
                  className="whatsapp-button"
                  onClick={() => shareOrder(orderModal)}
                >
                  Enviar ao cliente
                </button>
            )}
          </div>
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
  tone,
}: {
  icon: string;
  label: string;
  value: string | number;
  alert?: boolean;
  tone?: "blue" | "red";
}) {
  return (
    <div className={`metric ${alert ? "alert" : ""}`}>
      <div className={`metric-icon ${tone || (alert ? "red" : "blue")}`}>{icon}</div>
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
  children: ReactNode;
}) {
  const required = label.trim().endsWith("*") || hasRequiredControl(children);
  const cleanLabel = label.replace(/\s*\*+\s*$/, "");

  return (
    <label className="field">
      <span>
        {cleanLabel}
        {required && <b className="required-mark" aria-label="campo obrigatório"> *</b>}
      </span>
      {children}
    </label>
  );
}
function hasRequiredControl(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => {
    if (!isValidElement(child)) return false;
    const element = child as ReactElement<{
      required?: boolean;
      children?: ReactNode;
    }>;
    return Boolean(
      element.props.required || hasRequiredControl(element.props.children),
    );
  });
}
function ReviewField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={`review-field${multiline ? " multiline" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
function ActionIcon({ type }: { type: "cancel" | "view" | "edit" }) {
  if (type === "cancel") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m9 9 6 6M15 9l-6 6"/></svg>;
  if (type === "view") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.8 7.4 2.8 2.8"/></svg>;
}
function Filters({
  query,
  setQuery,
  queryLabel = "Buscar cliente",
  children,
}: {
  query: string;
  setQuery: (v: string) => void;
  queryLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="filters">
      <label className="filter-field filter-query">
        <span>{queryLabel}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
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
              <strong>{brDate(o.createdAt)}</strong>
              <span>Data do pedido</span>
            </div>
            <div className="order-main">
              <strong>{o.customerName}</strong>
              <span>
                {o.number} · Data do pedido: {brDate(o.createdAt)} · {orderItemSummary(o)}{" "}
                · {money(o.total)}
              </span>
            </div>
            <span className={`status ${paymentTone(o)}`}>
              {paymentStatus(o)}
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
  subtitle,
  page = false,
  pageLabel = "ORDEM DE SERVIÇO",
  backLabel,
  close,
  children,
}: {
  title: string;
  subtitle?: string;
  page?: boolean;
  pageLabel?: string;
  backLabel?: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={page ? "review-page" : "modal-backdrop"}>
      <div className={page ? "review-shell" : "customer-modal"}>
        <div className="modal-head">
          {page && backLabel && <button className="review-back" onClick={close}>← {backLabel}</button>}
          <div>
            {page && pageLabel && <span className="eyebrow">{pageLabel}</span>}
            <h2>{title}</h2>
            {subtitle && <p className="review-number">{subtitle}</p>}
          </div>
          {!page && <button onClick={close}>×</button>}
        </div>
        {children}
      </div>
    </div>
  );
}
