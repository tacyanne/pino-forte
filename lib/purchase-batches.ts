// Lote de compra: o que entrou de um fornecedor em uma data, o que já saiu dele e quanto rende.
// Módulo puro (API, tela e testes). Tudo em centavos inteiros.
//
// Qual venda saiu de qual lote: primeiro que entra, primeiro que sai, por peça.

export type PurchaseBatch = { id: number; supplier: string; purchaseDate: string; notes: string };

// Entrada de estoque ligada a um lote, com o custo pago por peça naquele lote.
export type BatchEntry = {
  movementId: number;
  batchId: number;
  productId: number;
  quantity: number;
  unitCostCents: number | null;
  date: string;
};

// Peça vendida em uma OS entregue (valor já com o desconto da OS).
export type BatchSale = {
  orderId: number;
  orderNumber: string;
  productId: number;
  quantity: number;
  revenueCents: number;
  date: string;
  discounted?: boolean;
};

// Saída lançada à mão (perda, amostra, ajuste): sai do lote mais antigo, sem virar venda.
export type BatchManualOut = { productId: number; quantity: number; date: string };

export type BatchSoldLine = {
  orderId: number;
  orderNumber: string;
  productId: number;
  quantity: number;
  revenueCents: number;
  costCents: number | null;
  discounted: boolean;
};

export type BatchAllocation = {
  sold: BatchSoldLine[];
  // Quantidade que ainda resta de cada entrada do lote.
  left: { movementId: number; productId: number; quantity: number; unitCostCents: number | null }[];
  manualOut: number;
};

const day = (value: string) => String(value || "").slice(0, 10);

export function allocateBatches(input: { entries: BatchEntry[]; sales: BatchSale[]; outs?: BatchManualOut[] }) {
  const byBatch = new Map<number, BatchAllocation>();
  const allocationOf = (batchId: number) => {
    let allocation = byBatch.get(batchId);
    if (!allocation) byBatch.set(batchId, (allocation = { sold: [], left: [], manualOut: 0 }));
    return allocation;
  };
  const unallocated: BatchSale[] = [];
  const productIds = new Set(input.entries.map((entry) => entry.productId));
  for (const sale of input.sales) if (!productIds.has(sale.productId)) unallocated.push({ ...sale });

  for (const productId of productIds) {
    const queue = input.entries
      .filter((entry) => entry.productId === productId && entry.quantity > 0)
      .sort((a, b) => day(a.date).localeCompare(day(b.date)) || a.movementId - b.movementId)
      .map((entry) => ({ entry, remaining: entry.quantity }));
    const events = [
      ...input.sales.filter((sale) => sale.productId === productId && sale.quantity > 0).map((sale) => ({ date: day(sale.date), sale, out: null as BatchManualOut | null })),
      ...(input.outs ?? []).filter((out) => out.productId === productId && out.quantity > 0).map((out) => ({ date: day(out.date), sale: null as BatchSale | null, out })),
    ].sort((a, b) => a.date.localeCompare(b.date) || Number(Boolean(a.out)) - Number(Boolean(b.out)) || (a.sale?.orderId ?? 0) - (b.sale?.orderId ?? 0));

    for (const event of events) {
      let pending = event.sale ? event.sale.quantity : event.out!.quantity;
      let revenueLeft = event.sale?.revenueCents ?? 0;
      for (const slot of queue) {
        if (pending <= 0) break;
        if (slot.remaining <= 0 || day(slot.entry.date) > event.date) continue;
        const take = Math.min(slot.remaining, pending);
        slot.remaining -= take;
        const allocation = allocationOf(slot.entry.batchId);
        if (event.sale) {
          // A última fatia da venda fica com o resto, para não sobrar centavo.
          const revenue = take === pending ? revenueLeft : Math.round((event.sale.revenueCents * take) / event.sale.quantity);
          revenueLeft -= revenue;
          allocation.sold.push({
            orderId: event.sale.orderId,
            orderNumber: event.sale.orderNumber,
            productId,
            quantity: take,
            revenueCents: revenue,
            costCents: slot.entry.unitCostCents === null ? null : slot.entry.unitCostCents * take,
            discounted: Boolean(event.sale.discounted),
          });
        } else {
          allocation.manualOut += take;
        }
        pending -= take;
      }
      if (pending > 0 && event.sale) unallocated.push({ ...event.sale, quantity: pending, revenueCents: revenueLeft });
    }
    for (const slot of queue) {
      const allocation = allocationOf(slot.entry.batchId);
      if (slot.remaining > 0)
        allocation.left.push({ movementId: slot.entry.movementId, productId, quantity: slot.remaining, unitCostCents: slot.entry.unitCostCents });
    }
  }
  return { byBatch, unallocated };
}

export type BatchOrderRow = {
  orderId: number;
  orderNumber: string;
  quantity: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  discounted: boolean;
};

export type BatchStockRow = {
  productId: number;
  code: string;
  quantity: number;
  priceCents: number;
  unitCostCents: number | null;
  unitProfitCents: number | null;
  profitCents: number | null;
  onCost: number | null;
};

export type BatchNote = { tone: "red" | "amber"; text: string };

export type BatchStudy = {
  boughtQty: number;
  soldQty: number;
  stockQty: number;
  manualOut: number;
  costCents: number;
  soldRevenueCents: number;
  realizedCents: number;
  expectedStockCents: number;
  totalCents: number;
  rateOnCost: number | null;
  soldShare: number;
  orders: BatchOrderRow[];
  stock: BatchStockRow[];
  missingCost: string[];
  notes: BatchNote[];
};

const THIN_MARGIN = 0.05;
const MAX_PIECE_NOTES = 3;

// O estudo do lote: o que já rendeu, o que ainda deve render e onde está perdendo dinheiro.
export function batchStudy(input: {
  entries: BatchEntry[];
  allocation: BatchAllocation | undefined;
  products: { id: number; code: string; priceCents: number }[];
  targetRate: number;
  format: { money: (value: number) => string; percent: (rate: number) => string };
}): BatchStudy {
  const { money, percent } = input.format;
  const allocation = input.allocation ?? { sold: [], left: [], manualOut: 0 };
  const productOf = new Map(input.products.map((product) => [product.id, product]));
  const codeOf = (productId: number) => productOf.get(productId)?.code ?? "Peça removida";

  const boughtQty = input.entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const costCents = input.entries.reduce((sum, entry) => sum + (entry.unitCostCents ?? 0) * entry.quantity, 0);
  const missingCost = [...new Set(input.entries.filter((entry) => entry.unitCostCents === null).map((entry) => codeOf(entry.productId)))].sort();

  const byOrder = new Map<number, BatchOrderRow>();
  for (const line of allocation.sold) {
    if (line.costCents === null) continue;
    const row = byOrder.get(line.orderId) ?? { orderId: line.orderId, orderNumber: line.orderNumber, quantity: 0, revenueCents: 0, costCents: 0, profitCents: 0, discounted: false };
    row.quantity += line.quantity;
    row.revenueCents += line.revenueCents;
    row.costCents += line.costCents;
    row.profitCents = row.revenueCents - row.costCents;
    row.discounted = row.discounted || line.discounted;
    byOrder.set(line.orderId, row);
  }
  const orders = [...byOrder.values()].sort((a, b) => b.orderNumber.localeCompare(a.orderNumber, "pt-BR", { numeric: true }));
  const soldQty = allocation.sold.reduce((sum, line) => sum + line.quantity, 0);
  const soldRevenueCents = allocation.sold.reduce((sum, line) => sum + line.revenueCents, 0);
  const realizedCents = orders.reduce((sum, row) => sum + row.profitCents, 0);

  const stockByProduct = new Map<number, BatchStockRow>();
  for (const slot of allocation.left) {
    const priceCents = productOf.get(slot.productId)?.priceCents ?? 0;
    const row =
      stockByProduct.get(slot.productId) ??
      ({ productId: slot.productId, code: codeOf(slot.productId), quantity: 0, priceCents, unitCostCents: slot.unitCostCents, unitProfitCents: null, profitCents: null, onCost: null } satisfies BatchStockRow);
    row.quantity += slot.quantity;
    if (slot.unitCostCents !== null) {
      row.unitCostCents = slot.unitCostCents;
      row.unitProfitCents = priceCents - slot.unitCostCents;
      row.profitCents = (row.profitCents ?? 0) + (priceCents - slot.unitCostCents) * slot.quantity;
      row.onCost = slot.unitCostCents > 0 ? (priceCents - slot.unitCostCents) / slot.unitCostCents : null;
    }
    stockByProduct.set(slot.productId, row);
  }
  const stock = [...stockByProduct.values()].sort(
    (a, b) => (b.profitCents ?? Number.NEGATIVE_INFINITY) - (a.profitCents ?? Number.NEGATIVE_INFINITY) || a.code.localeCompare(b.code),
  );
  const stockQty = stock.reduce((sum, row) => sum + row.quantity, 0);
  const expectedStockCents = stock.reduce((sum, row) => sum + (row.profitCents ?? 0), 0);
  const totalCents = realizedCents + expectedStockCents;
  const rateOnCost = costCents > 0 ? totalCents / costCents : null;

  const notes: BatchNote[] = [];
  const losing = stock.filter((row) => (row.unitProfitCents ?? 0) < 0);
  losing.slice(0, MAX_PIECE_NOTES).forEach((row) =>
    notes.push({ tone: "red", text: `${row.code} dá prejuízo: custa ${money((row.unitCostCents ?? 0) / 100)} e vende a ${money(row.priceCents / 100)}.` }),
  );
  if (losing.length > MAX_PIECE_NOTES) notes.push({ tone: "red", text: `Mais ${losing.length - MAX_PIECE_NOTES} peças do lote dão prejuízo no preço atual.` });
  for (const row of orders.filter((order) => order.profitCents < 0))
    notes.push({ tone: "red", text: `A ${row.orderNumber} foi vendida${row.discounted ? " com desconto" : ""} e deu prejuízo de ${money(-row.profitCents / 100)}.` });
  if (rateOnCost !== null && rateOnCost < input.targetRate)
    notes.push({ tone: "amber", text: `Lucro médio de ${percent(rateOnCost)} sobre o custo, abaixo da meta de ${percent(input.targetRate)}.` });
  stock
    .filter((row) => (row.unitProfitCents ?? 0) >= 0 && row.onCost !== null && row.onCost < THIN_MARGIN)
    .slice(0, MAX_PIECE_NOTES)
    .forEach((row) => notes.push({ tone: "amber", text: `${row.code} quase sem lucro: ${money((row.unitProfitCents ?? 0) / 100)} por peça.` }));
  if (missingCost.length)
    notes.push({ tone: "amber", text: `Sem custo neste lote: ${missingCost.join(", ")}. O lucro dessas peças não entra na conta.` });

  return {
    boughtQty,
    soldQty,
    stockQty,
    manualOut: allocation.manualOut,
    costCents,
    soldRevenueCents,
    realizedCents,
    expectedStockCents,
    totalCents,
    rateOnCost,
    soldShare: boughtQty > 0 ? soldQty / boughtQty : 0,
    orders,
    stock,
    missingCost,
    notes,
  };
}

export class PurchaseBatchError extends Error {
  status = 400;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PurchaseBatchInput = {
  supplier: string;
  purchaseDate: string;
  notes: string;
  items: { productId: number; quantity: number; unitCostCents: number }[];
};

export function parsePurchaseBatch(raw: unknown, today: string): PurchaseBatchInput {
  if (!raw || typeof raw !== "object") throw new PurchaseBatchError("Lote de compra inválido.");
  const body = raw as Record<string, unknown>;
  const supplier = String(body.supplier || "").trim().slice(0, 120);
  if (!supplier) throw new PurchaseBatchError("Informe o fornecedor do lote.");
  const purchaseDate = String(body.purchaseDate || today).slice(0, 10);
  if (!ISO_DATE.test(purchaseDate) || Number.isNaN(new Date(`${purchaseDate}T12:00:00Z`).getTime()))
    throw new PurchaseBatchError("Informe uma data válida para o lote.");
  if (purchaseDate > today) throw new PurchaseBatchError("A data do lote não pode ser no futuro.");
  const list = Array.isArray(body.items) ? body.items : [];
  const items = list
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return { productId: Number(row.productId), quantity: Number(row.quantity), unitCostCents: Math.round(Number(row.unitCostCents)) };
    })
    .filter((item) => item.quantity > 0);
  if (!items.length) throw new PurchaseBatchError("Informe pelo menos uma peça com quantidade.");
  for (const item of items) {
    if (!Number.isInteger(item.productId) || item.productId <= 0) throw new PurchaseBatchError("Escolha a peça de cada linha do lote.");
    if (!Number.isInteger(item.quantity) || item.quantity > 1_000_000) throw new PurchaseBatchError("Informe a quantidade em número inteiro.");
    if (!Number.isFinite(item.unitCostCents) || item.unitCostCents <= 0) throw new PurchaseBatchError("Informe o custo pago por peça.");
  }
  if (new Set(items.map((item) => item.productId)).size !== items.length) throw new PurchaseBatchError("Cada peça só pode aparecer uma vez no lote.");
  return { supplier, purchaseDate, notes: String(body.notes || "").trim().slice(0, 200), items };
}
