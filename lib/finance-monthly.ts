// Lucro e caixa mês a mês, em linguagem simples. Módulo puro (tela e testes).

export type MonthlySale = { month: string; revenueCents: number };
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
  fabricationCents: number;
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

// Quanto sobrou em cada mês: vendas do mês menos as contas pagas no mês (fabricação e outras).
// O gasto é o que saiu de verdade em Contas a pagar, não o custo estimado de cada peça.
export function monthlyResult(sales: MonthlySale[], payables: MonthlyPayable[], currentMonth: string): MonthlyResultRow[] {
  const paid = payables.filter((payable) => payable.paid);
  const months = monthsOf([...sales.map((sale) => sale.month), ...paid.map((payable) => payable.month)], currentMonth);
  let accumulatedCents = 0;
  return months.map((month) => {
    const salesCents = sales.filter((sale) => sale.month === month).reduce((sum, sale) => sum + sale.revenueCents, 0);
    const monthPaid = paid.filter((payable) => payable.month === month);
    const fabricationCents = monthPaid.filter((payable) => payable.isFabrication).reduce((sum, payable) => sum + payable.amountCents, 0);
    const otherCents = monthPaid.filter((payable) => !payable.isFabrication).reduce((sum, payable) => sum + payable.amountCents, 0);
    const spentCents = fabricationCents + otherCents;
    const leftCents = salesCents - spentCents;
    accumulatedCents += leftCents;
    return { month, salesCents, fabricationCents, otherCents, spentCents, leftCents, accumulatedCents };
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

// O recebimento automático de uma OS só nasce quando ela tem valor recebido e ainda não
// tem nenhum recebimento gravado. Sem a segunda condição, o recebimento lançado à mão
// era repetido na sincronização seguinte.
export function needsInitialReceipt(input: { receivedCents: number; hasReceivable: boolean; alreadyHasReceipt: boolean }) {
  return input.receivedCents > 0 && input.hasReceivable && !input.alreadyHasReceipt;
}

// Valor em centavos de uma OS. O valor em reais é o que aparece na tela e manda:
// se o campo em centavos gravado ficou diferente dele (OS editada depois), é ignorado.
export function trustedCents(amount: unknown, storedCents: unknown) {
  const fromAmount = Math.round((Number(amount) || 0) * 100);
  const stored = Math.round(Number(storedCents) || 0);
  return stored > 0 && Math.abs(stored - fromAmount) <= 1 ? stored : fromAmount;
}

// Divide um total em centavos na proporção dos pesos, sem sobrar nem faltar centavo:
// os centavos do arredondamento vão para as maiores frações.
export function distributeCents(totalCents: number, weights: number[]) {
  if (!weights.length) return [];
  const total = Math.round(totalCents);
  const safe = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const sum = safe.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0) return safe.map((_, index) => (index === 0 ? total : 0));
  const exact = safe.map((weight) => (total * weight) / sum);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = total - parts.reduce((acc, value) => acc + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - parts[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const item of order) {
    if (remainder <= 0) break;
    parts[item.index] += 1;
    remainder -= 1;
  }
  return parts;
}

// OS sem boleto parcelado pode ter uma parcela única (criada na migração). Ela deve
// espelhar a conta a receber: mesmo valor, mesmo recebido, mesmo saldo.
export function singleInstallmentValues(totalCents: number, receivedCents: number) {
  const received = Math.min(Math.max(0, receivedCents), totalCents);
  const balanceCents = Math.max(0, totalCents - received);
  return { amountCents: totalCents, receivedCents: received, balanceCents, status: balanceCents <= 0 ? "Pago" : "Pendente" };
}

// Com poucos dias de mês, multiplicar o ritmo dá um número sem sentido.
export const FORECAST_MIN_DAYS = 5;

// Previsão do mês em andamento: as vendas mantêm o ritmo dos dias já passados; o gasto é
// o que já foi pago no mês mais as contas que ainda vencem nele.
export function forecastCurrentMonth(
  row: MonthlyResultRow | undefined,
  todayIso: string,
  pendingCents: number,
) {
  if (!row || row.salesCents <= 0) return null;
  const [year, month, day] = todayIso.slice(0, 10).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!day || day < FORECAST_MIN_DAYS || day >= daysInMonth) return null;
  const salesCents = Math.round((row.salesCents * daysInMonth) / day);
  const spentCents = row.spentCents + pendingCents;
  return { day, daysInMonth, salesCents, spentCents, leftCents: salesCents - spentCents };
}

export type CashForecastRow = {
  month: string;
  isCurrent: boolean;
  inCents: number;
  outCents: number;
  netCents: number;
  balanceCents: number;
};

// Previsão de caixa: o resto do mês atual e os próximos meses, só com o que já está lançado
// (contas a receber e contas a pagar em aberto, pelo vencimento). O que está atrasado entra
// no mês atual. Vendas e contas que ainda não existem não são previstas.
export function cashForecast(input: {
  receivables: { dueDate: string; balanceCents: number }[];
  payables: { dueDate: string; amountCents: number }[];
  todayIso: string;
  startBalanceCents: number;
  monthsAhead?: number;
}): CashForecastRow[] {
  const current = input.todayIso.slice(0, 7);
  const months = [current];
  for (let index = 0; index < (input.monthsAhead ?? 3); index += 1) months.push(nextMonth(months[months.length - 1]));
  const last = months[months.length - 1];
  const monthOf = (dueDate: string) => {
    const month = dueDate.slice(0, 7);
    return month < current ? current : month;
  };
  let balanceCents = input.startBalanceCents;
  return months.map((month) => {
    const inCents = input.receivables
      .filter((item) => item.balanceCents > 0 && monthOf(item.dueDate) === month && month <= last)
      .reduce((sum, item) => sum + item.balanceCents, 0);
    const outCents = input.payables
      .filter((item) => item.amountCents > 0 && monthOf(item.dueDate) === month && month <= last)
      .reduce((sum, item) => sum + item.amountCents, 0);
    const netCents = inCents - outCents;
    balanceCents += netCents;
    return { month, isCurrent: month === current, inCents, outCents, netCents, balanceCents };
  });
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
