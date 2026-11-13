// Painel de controle executivo: o que precisa de ação hoje e o que vem nos próximos dias.
// Módulo puro (tela e testes). Valores em centavos inteiros.

export type ActionTone = "red" | "amber" | "blue";
export type ActionTarget = "order" | "payables" | "stock" | "pricing" | "products" | "batch";

export type DashboardAction = {
  key: string;
  tone: ActionTone;
  title: string;
  detail: string;
  button: string;
  target: ActionTarget;
  orderId?: number | null;
  batchId?: number;
};

// Situação de um lote de compra, vinda do estudo do lote.
export type BatchSignal = { id: number; supplier: string; totalCents: number; stockQty: number; boughtQty: number };

// Lote com 80% ou mais vendido está acabando.
export const BATCH_ENDING_SHARE = 0.8;

export type OpenReceivable = {
  key: string;
  orderId: number | null;
  orderNumber: string;
  customerName: string;
  installmentLabel: string;
  dueDate: string;
  balanceCents: number;
};

export type OpenPayable = { id: number; supplier: string; dueDate: string; amountCents: number; orderId?: number | null };

export type StockSignal = {
  code: string;
  status: "sem-contagem" | "falta" | "zerado" | "baixo" | "ok";
  available: number | null;
  missing: number;
  monthlyPace: number;
};

// OS aguardando entrega.
export type QueuedOrder = { orderId: number; orderNumber: string; customerName: string; totalCents: number; createdAt: string };

// Lucro sobre o custo em uso no preço atual (null = peça sem custo cadastrado).
export type PieceMargin = { code: string; onCost: number | null };

type Formatters = {
  money: (value: number) => string;
  brDate: (iso: string) => string;
  percent: (rate: number) => string;
};

export const ACTION_WINDOW_DAYS = 7;
export const FORECAST_DAYS = 30;
const MAX_STOCK_ACTIONS = 3;

export function daysFrom(today: string, date: string) {
  const start = new Date(`${today.slice(0, 10)}T12:00:00Z`).getTime();
  const end = new Date(`${date.slice(0, 10)}T12:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

function dueText(days: number, date: string, brDate: (iso: string) => string) {
  if (days < 0) return `venceu há ${plural(-days, "dia", "dias")}`;
  if (days === 0) return "vence hoje";
  if (days === 1) return `vence amanhã (${brDate(date).slice(0, 5)})`;
  return `vence em ${days} dias (${brDate(date).slice(0, 5)})`;
}

const pace = (value: number) => String(value).replace(".", ",");

// Lista curta de ações, da mais urgente para a menos urgente.
// Entra o que está vencido ou vence em até 7 dias, e o que trava venda ou lucro.
export function buildDashboardActions(input: {
  today: string;
  receivables: OpenReceivable[];
  payables: OpenPayable[];
  queue?: QueuedOrder[];
  batches?: BatchSignal[];
  stock: StockSignal[];
  pieces: PieceMargin[];
  targetRate: number;
  format: Formatters;
}): DashboardAction[] {
  const { today, format } = input;
  const ranked: { rank: number; action: DashboardAction }[] = [];
  const push = (rank: number, action: DashboardAction) => ranked.push({ rank, action });

  for (const row of input.receivables) {
    if (row.balanceCents <= 0 || !row.dueDate) continue;
    const days = daysFrom(today, row.dueDate);
    if (days > ACTION_WINDOW_DAYS) continue;
    const label = row.installmentLabel ? ` · ${row.installmentLabel}` : "";
    push(days < 0 ? days - 1000 : days, {
      key: `receber-${row.key}`,
      tone: days < 0 ? "red" : "amber",
      title: `${days < 0 ? "Cobrar" : "Receber de"} ${row.customerName}: ${format.money(row.balanceCents / 100)}`,
      detail: `${row.orderNumber}${label} ${dueText(days, row.dueDate, format.brDate)}`,
      button: "Ver OS",
      target: "order",
      orderId: row.orderId,
    });
  }

  for (const row of input.payables) {
    if (row.amountCents <= 0 || !row.dueDate) continue;
    const days = daysFrom(today, row.dueDate);
    if (days > ACTION_WINDOW_DAYS) continue;
    const text = dueText(days, row.dueDate, format.brDate);
    push(days < 0 ? days - 1000 : days + 0.5, {
      key: `pagar-${row.id}`,
      tone: days < 0 ? "red" : "amber",
      title: `Pagar ${row.supplier}: ${format.money(row.amountCents / 100)}`,
      detail: text.charAt(0).toUpperCase() + text.slice(1),
      button: "Pagar",
      target: "payables",
    });
  }

  // OS na fila: da mais antiga para a mais nova.
  for (const order of input.queue ?? []) {
    const waiting = Math.max(0, -daysFrom(today, order.createdAt));
    push(10 - Math.min(waiting, 9) / 10, {
      key: `fila-${order.orderId}`,
      tone: "blue",
      title: `Entregar ${order.orderNumber}: ${order.customerName}`,
      detail: `Na fila ${waiting === 0 ? "desde hoje" : `há ${plural(waiting, "dia", "dias")}`} · ${format.money(order.totalCents / 100)}`,
      button: "Ver OS",
      target: "order",
      orderId: order.orderId,
    });
  }

  // Estoque: primeiro o que falta para a fila, depois o que zerou ou está acabando e tem venda.
  const stockAlerts = input.stock
    .filter((row) => row.status === "falta" || ((row.status === "zerado" || row.status === "baixo") && row.monthlyPace > 0))
    .sort((a, b) => Number(b.status === "falta") - Number(a.status === "falta") || (a.available ?? 0) - (b.available ?? 0) || a.code.localeCompare(b.code));
  stockAlerts.slice(0, MAX_STOCK_ACTIONS).forEach((row, index) => {
    const available = Math.max(0, row.available ?? 0);
    push(20 + index, {
      key: `estoque-${row.code}`,
      tone: row.status === "baixo" ? "amber" : "red",
      title:
        row.status === "falta"
          ? `Falta comprar ${row.missing} de ${row.code}`
          : row.status === "zerado"
            ? `${row.code} está sem estoque`
            : `${row.code} está acabando: ${available} em estoque`,
      detail:
        row.status === "falta"
          ? "Para entregar o que está na fila"
          : row.status === "zerado"
            ? `Vende ${pace(row.monthlyPace)} por mês`
            : `Vende ${pace(row.monthlyPace)} por mês · dura menos de 1 mês`,
      button: "Estoque",
      target: "stock",
    });
  });
  if (stockAlerts.length > MAX_STOCK_ACTIONS) {
    push(20 + MAX_STOCK_ACTIONS, {
      key: "estoque-mais",
      tone: "amber",
      title: `Mais ${plural(stockAlerts.length - MAX_STOCK_ACTIONS, "peça", "peças")} com estoque baixo ou zerado`,
      detail: "Veja a lista completa no Estoque",
      button: "Estoque",
      target: "stock",
    });
  }

  // Lotes de compra: o que caminha para prejuízo e o que está acabando.
  for (const batch of input.batches ?? []) {
    if (batch.totalCents < 0)
      push(16, {
        key: `lote-prejuizo-${batch.id}`,
        tone: "red",
        title: `Lote ${batch.supplier} caminha para prejuízo de ${format.money(-batch.totalCents / 100)}`,
        detail: "Veja no estudo do lote quais peças e vendas puxam o resultado para baixo",
        button: "Ver lote",
        target: "batch",
        batchId: batch.id,
      });
    else if (batch.boughtQty > 0 && batch.stockQty > 0 && 1 - batch.stockQty / batch.boughtQty >= BATCH_ENDING_SHARE)
      push(25, {
        key: `lote-acabando-${batch.id}`,
        tone: "amber",
        title: `Lote ${batch.supplier} está acabando: ${plural(batch.stockQty, "peça restante", "peças restantes")}`,
        detail: `${batch.boughtQty - batch.stockQty} de ${batch.boughtQty} já saíram · hora de pensar na próxima compra`,
        button: "Ver lote",
        target: "batch",
        batchId: batch.id,
      });
  }

  const priced = input.pieces.filter((piece) => piece.onCost !== null) as { code: string; onCost: number }[];
  const below = priced.filter((piece) => piece.onCost < input.targetRate).sort((a, b) => a.onCost - b.onCost || a.code.localeCompare(b.code));
  if (below.length) {
    const worst = below[0];
    const losing = below.filter((piece) => piece.onCost < 0).length;
    push(losing ? 15 : 30, {
      key: "margem",
      tone: losing ? "red" : "amber",
      title: losing
        ? `${plural(losing, "peça dá prejuízo", "peças dão prejuízo")} no preço atual`
        : `${plural(below.length, "peça", "peças")} com lucro abaixo da meta de ${format.percent(input.targetRate)}`,
      detail: `A menor: ${worst.code}, ${format.percent(worst.onCost)} sobre o custo`,
      button: "Simular",
      target: "pricing",
    });
  }

  const noCost = input.pieces.filter((piece) => piece.onCost === null).map((piece) => piece.code).sort();
  if (noCost.length) {
    push(40, {
      key: "sem-custo",
      tone: "blue",
      title: `${plural(noCost.length, "peça", "peças")} sem custo cadastrado`,
      detail: `${noCost.slice(0, 3).join(", ")}${noCost.length > 3 ? ` e mais ${noCost.length - 3}` : ""} · o lucro não entra na conta`,
      button: "Cadastrar",
      target: "products",
    });
  }

  return ranked.sort((a, b) => a.rank - b.rank || a.action.key.localeCompare(b.action.key)).map((item) => item.action);
}

export type DashboardForecast = {
  inCents: number;
  outCents: number;
  balanceCents: number;
  // Contas de fornecedor que vencem antes ou no mesmo dia em que a OS que as gerou será recebida.
  tightCents: number;
  tightOrders: string[];
};

// A receber x a pagar até 30 dias à frente; o que já venceu também entra, porque ainda está em aberto.
export function forecastAhead(input: { today: string; receivables: OpenReceivable[]; payables: OpenPayable[]; days?: number }): DashboardForecast {
  const limit = input.days ?? FORECAST_DAYS;
  const inWindow = (date: string) => Boolean(date) && daysFrom(input.today, date) <= limit;
  const receivables = input.receivables.filter((row) => row.balanceCents > 0 && inWindow(row.dueDate));
  const payables = input.payables.filter((row) => row.amountCents > 0 && inWindow(row.dueDate));
  const inCents = receivables.reduce((sum, row) => sum + row.balanceCents, 0);
  const outCents = payables.reduce((sum, row) => sum + row.amountCents, 0);

  let tightCents = 0;
  const tightOrders = new Set<string>();
  for (const payable of payables) {
    if (!payable.orderId) continue;
    const pending = input.receivables.filter((row) => row.orderId === payable.orderId && row.balanceCents > 0 && row.dueDate >= payable.dueDate);
    if (!pending.length) continue;
    tightCents += payable.amountCents;
    tightOrders.add(pending[0].orderNumber);
  }
  return { inCents, outCents, balanceCents: inCents - outCents, tightCents, tightOrders: [...tightOrders].sort() };
}

// Frase do alerta de caixa apertado (vazia quando não há).
export function tightSentence(forecast: DashboardForecast, money: (value: number) => string) {
  if (forecast.balanceCents < 0)
    return `Atenção: nos próximos dias você tem mais a pagar do que a receber. Faltam ${money(-forecast.balanceCents / 100)}.`;
  if (forecast.tightCents <= 0) return "";
  const orders = forecast.tightOrders.join(" e ");
  return `Atenção: ${money(forecast.tightCents / 100)} ao fornecedor vencem no mesmo dia ou antes de você receber ${
    forecast.tightOrders.length === 1 ? `a ${orders}` : `as ${orders}`
  }. Se o cliente atrasar, falta caixa.`;
}

// "outubro: R$ 320,00" ao lado do número do mês atual.
export function previousLabel(monthName: string, cents: number | null, money: (value: number) => string) {
  return cents === null ? "sem mês anterior" : `${monthName}: ${money(cents / 100)}`;
}
