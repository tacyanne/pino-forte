// Lucro e caixa mês a mês, em linguagem simples. Módulo puro (tela e testes).

export type MonthlySale = { month: string; revenueCents: number; costCents: number | null };
export type MonthlyPayable = {
  month: string;
  amountCents: number;
  paid: boolean;
  isFabrication: boolean;
};
export type MonthlyReceipt = {
  id: number;
  serviceOrderId: number;
  receiptDate: string;
  amountCents: number;
  status: string;
  legacySourceKey?: string | null;
};

export type MonthlyResultRow = {
  month: string;
  salesCents: number;
  pieceCostCents: number;
  otherCents: number;
  spentCents: number;
  leftCents: number;
  accumulatedCents: number;
};

export type MonthlyCashRow = {
  month: string;
  inCents: number;
  outCents: number;
  netCents: number;
  balanceCents: number;
};

const validMonth = (month: string) => /^\d{4}-\d{2}$/.test(month);

export function nextMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}

// Todos os meses do primeiro ao último, sem buracos.
export function monthRange(first: string, last: string) {
  if (!validMonth(first) || !validMonth(last) || first > last) return [];
  const months = [first];
  while (months[months.length - 1] < last && months.length < 240) months.push(nextMonth(months[months.length - 1]));
  return months;
}

function monthsOf(values: string[], currentMonth: string) {
  const months = values.filter(validMonth).sort();
  if (!months.length) return [];
  const last = months[months.length - 1] > currentMonth ? months[months.length - 1] : currentMonth;
  return monthRange(months[0], last);
}

// Quanto sobrou em cada mês: vendas menos custo das peças vendidas menos outras contas pagas.
// Contas de fabricação (aço, torneiro) já estão no custo da peça e não entram de novo.
export function monthlyResult(sales: MonthlySale[], payables: MonthlyPayable[], currentMonth: string): MonthlyResultRow[] {
  const otherPayables = payables.filter((payable) => payable.paid && !payable.isFabrication);
  const months = monthsOf([...sales.map((sale) => sale.month), ...otherPayables.map((payable) => payable.month)], currentMonth);
  let accumulatedCents = 0;
  return months.map((month) => {
    const monthSales = sales.filter((sale) => sale.month === month);
    const salesCents = monthSales.reduce((sum, sale) => sum + sale.revenueCents, 0);
    const pieceCostCents = monthSales.reduce((sum, sale) => sum + (sale.costCents ?? 0), 0);
    const otherCents = otherPayables.filter((payable) => payable.month === month).reduce((sum, payable) => sum + payable.amountCents, 0);
    const spentCents = pieceCostCents + otherCents;
    const leftCents = salesCents - spentCents;
    accumulatedCents += leftCents;
    return { month, salesCents, pieceCostCents, otherCents, spentCents, leftCents, accumulatedCents };
  });
}

// O sistema já gravou, para a mesma OS, o recebimento lançado à mão e um recebimento
// automático ("initial_receipt") com o mesmo valor. Aqui cada OS conta só até o valor
// que ela mostra como recebido: primeiro saem os automáticos repetidos; se ainda sobrar
// excesso (desconto aplicado depois), o último recebimento é reduzido.
export function dedupeReceipts(receipts: MonthlyReceipt[], orderReceivedCents: Record<number, number>) {
  const byOrder = new Map<number, MonthlyReceipt[]>();
  for (const receipt of receipts) {
    if (receipt.status !== "Confirmado" || receipt.amountCents <= 0) continue;
    const list = byOrder.get(receipt.serviceOrderId) || [];
    list.push({ ...receipt });
    byOrder.set(receipt.serviceOrderId, list);
  }
  const result: MonthlyReceipt[] = [];
  for (const [orderId, list] of byOrder) {
    const limit = orderReceivedCents[orderId];
    let kept = list.slice().sort((a, b) => a.receiptDate.localeCompare(b.receiptDate) || a.id - b.id);
    const total = () => kept.reduce((sum, receipt) => sum + receipt.amountCents, 0);
    if (limit !== undefined && total() > limit) {
      const manual = kept.filter((receipt) => !String(receipt.legacySourceKey || "").endsWith(":initial_receipt"));
      if (manual.length && manual.length < kept.length) kept = manual;
      let excess = total() - limit;
      for (let index = kept.length - 1; index >= 0 && excess > 0; index -= 1) {
        const cut = Math.min(excess, kept[index].amountCents);
        kept[index].amountCents -= cut;
        excess -= cut;
      }
      kept = kept.filter((receipt) => receipt.amountCents > 0);
    }
    result.push(...kept);
  }
  return result.sort((a, b) => a.receiptDate.localeCompare(b.receiptDate) || a.id - b.id);
}

// Dinheiro que entrou (recebimentos) e saiu (contas pagas) em cada mês, com o saldo acumulado.
export function monthlyCash(receipts: MonthlyReceipt[], payables: MonthlyPayable[], currentMonth: string): MonthlyCashRow[] {
  const paid = payables.filter((payable) => payable.paid);
  const months = monthsOf(
    [...receipts.map((receipt) => receipt.receiptDate.slice(0, 7)), ...paid.map((payable) => payable.month)],
    currentMonth,
  );
  let balanceCents = 0;
  return months.map((month) => {
    const inCents = receipts.filter((receipt) => receipt.receiptDate.slice(0, 7) === month).reduce((sum, receipt) => sum + receipt.amountCents, 0);
    const outCents = paid.filter((payable) => payable.month === month).reduce((sum, payable) => sum + payable.amountCents, 0);
    const netCents = inCents - outCents;
    balanceCents += netCents;
    return { month, inCents, outCents, netCents, balanceCents };
  });
}

// Previsão do mês em andamento: mantém o ritmo dos dias já passados e soma as contas
// (que não são de fabricação) ainda por pagar no mês.
export function forecastCurrentMonth(
  row: MonthlyResultRow | undefined,
  todayIso: string,
  pendingOtherCents: number,
) {
  if (!row || row.salesCents <= 0) return null;
  const [year, month, day] = todayIso.slice(0, 10).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!day || day >= daysInMonth) return null;
  const pace = daysInMonth / day;
  const salesCents = Math.round(row.salesCents * pace);
  const pieceCostCents = Math.round(row.pieceCostCents * pace);
  const otherCents = row.otherCents + pendingOtherCents;
  return { day, daysInMonth, salesCents, spentCents: pieceCostCents + otherCents, leftCents: salesCents - pieceCostCents - otherCents };
}

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function shortMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return MONTH_NAMES[number - 1] ? `${MONTH_NAMES[number - 1]}/${String(year).slice(2)}` : month;
}

// Alturas das barras de um gráfico com valores positivos e negativos, em pixels.
export function divergingBars(values: number[], plotHeight: number) {
  const positiveMax = Math.max(0, ...values);
  const negativeMax = Math.max(0, ...values.map((value) => -value));
  const span = positiveMax + negativeMax;
  if (span <= 0) return { positiveArea: plotHeight, negativeArea: 0, heights: values.map(() => 0) };
  const positiveArea = Math.round((plotHeight * positiveMax) / span);
  const heights = values.map((value) => (value === 0 ? 0 : Math.max(2, Math.round((Math.abs(value) / span) * plotHeight))));
  return { positiveArea, negativeArea: plotHeight - positiveArea, heights };
}

export function barHeights(values: number[], plotHeight: number) {
  const max = Math.max(0, ...values);
  return values.map((value) => (max <= 0 || value <= 0 ? 0 : Math.max(2, Math.round((value / max) * plotHeight))));
}
