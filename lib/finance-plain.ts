// Financeiro em linguagem simples: quanto vendi, quanto gastei e quanto sobrou.
// Módulo puro, usado pela tela e pelos testes.

// Contas a pagar nestas categorias são gasto de fabricação (aço, serviço de torneiro).
// O resultado usa o que foi realmente pago; a categoria só separa fabricação das outras contas.
export const FABRICATION_CATEGORY_NAMES = ["Custo de fabricacao", "Materia-prima"];

export type FinancePeriod = "this" | "last" | "all";

type Category = { id: number; name: string; type?: string | null; active?: boolean | null };
type Payable = { amountCents: number; status: string; categoryId?: number | null };

const plain = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

const fabricationNames = FABRICATION_CATEGORY_NAMES.map(plain);

export function fabricationCategoryIds(categories: Category[]) {
  return categories.filter((category) => fabricationNames.includes(plain(category.name))).map((category) => category.id);
}

// Categoria usada quando o cadastro responde "sim, é gasto para fabricar peça".
export function preferredFabricationCategoryId(categories: Category[]) {
  for (const name of fabricationNames) {
    const match = categories.find((category) => plain(category.name) === name && category.active !== false);
    if (match) return match.id;
  }
  return null;
}

// Separa as contas pagas entre gasto de fabricação e outras contas.
export function splitPaidExpenses(payables: Payable[], fabricationIds: number[]) {
  const split = { fabricationCents: 0, otherCents: 0, totalCents: 0 };
  for (const payable of payables) {
    if (payable.status !== "Pago") continue;
    const amount = Number(payable.amountCents) || 0;
    split.totalCents += amount;
    if (payable.categoryId != null && fabricationIds.includes(payable.categoryId)) split.fabricationCents += amount;
    else split.otherCents += amount;
  }
  return split;
}

export function plainResult(input: {
  salesCents: number;
  receivedCents: number;
  fabricationCents: number;
  otherExpensesCents: number;
}) {
  // Gasto = contas realmente pagas (fabricação + outras), não o custo estimado por peça.
  const spentCents = input.fabricationCents + input.otherExpensesCents;
  const leftCents = input.salesCents - spentCents;
  return {
    salesCents: input.salesCents,
    receivedCents: input.receivedCents,
    toReceiveCents: Math.max(0, input.salesCents - input.receivedCents),
    fabricationCents: input.fabricationCents,
    otherExpensesCents: input.otherExpensesCents,
    spentCents,
    leftCents,
    // Quanto sobra (ou falta) de cada R$ 100 vendidos, em centavos.
    leftPer100Cents: input.salesCents > 0 ? Math.round((leftCents / input.salesCents) * 10000) : null,
  };
}

// Mês (AAAA-MM) de cada opção de período; "tudo" não filtra.
export function periodMonth(period: FinancePeriod, todayIso: string) {
  if (period === "all") return "";
  const [year, month] = todayIso.slice(0, 7).split("-").map(Number);
  if (period === "this") return todayIso.slice(0, 7);
  const previous = month === 1 ? [year - 1, 12] : [year, month - 1];
  return `${previous[0]}-${String(previous[1]).padStart(2, "0")}`;
}

export function activePeriod(month: string, todayIso: string): FinancePeriod | null {
  if (!month) return "all";
  if (month === periodMonth("this", todayIso)) return "this";
  if (month === periodMonth("last", todayIso)) return "last";
  return null;
}

// Dias de uma data até outra (positivo quando "to" é depois de "from").
export function daysBetween(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso.slice(0, 10)}T12:00:00Z`).getTime();
  const to = new Date(`${toIso.slice(0, 10)}T12:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

const dayCount = (days: number) => (days === 1 ? "1 dia" : `${days} dias`);

export function overdueSentence(name: string, amount: string, daysLate: number) {
  return daysLate > 0
    ? `${name} está devendo ${amount} há ${dayCount(daysLate)}.`
    : `${name} está devendo ${amount}.`;
}

export function payableSentence(supplier: string, amount: string, daysUntilDue: number) {
  const start = `A conta de ${supplier}, de ${amount},`;
  if (daysUntilDue < 0) return `${start} venceu há ${dayCount(-daysUntilDue)}.`;
  if (daysUntilDue === 0) return `${start} vence hoje.`;
  if (daysUntilDue === 1) return `${start} vence amanhã.`;
  return `${start} vence em ${dayCount(daysUntilDue)}.`;
}

export function leftSentence(leftPer100Cents: number | null, money: (value: number) => string) {
  if (leftPer100Cents === null) return "Nenhuma venda entregue neste período.";
  return leftPer100Cents >= 0
    ? `De cada R$ 100 vendidos, sobraram ${money(leftPer100Cents / 100)}.`
    : `De cada R$ 100 vendidos, faltaram ${money(-leftPer100Cents / 100)}.`;
}

export function pieceResultLabel(profitCents: number | null, money: (value: number) => string) {
  if (profitCents === null) return "falta cadastrar o custo";
  return profitCents >= 0 ? `sobrou ${money(profitCents / 100)}` : `perdeu ${money(-profitCents / 100)}`;
}

// Divide o que foi pago em contas no período entre as peças vendidas.
// O peso de cada peça é o custo cadastrado dela (custo unitário x quantidade); peça sem
// custo cadastrado entra pelo valor vendido, na mesma proporção custo/venda das demais.
// A soma dos valores devolvidos é exatamente o total pago.
export function allocateSpent(
  pieces: { key: string; revenueCents: number; costCents: number | null }[],
  spentCents: number,
) {
  const result = new Map<string, number>();
  if (!pieces.length) return result;
  const costed = pieces.filter((piece) => (piece.costCents ?? 0) > 0);
  const costedRevenue = costed.reduce((sum, piece) => sum + piece.revenueCents, 0);
  const costedCost = costed.reduce((sum, piece) => sum + (piece.costCents ?? 0), 0);
  const ratio = costedRevenue > 0 ? costedCost / costedRevenue : 1;
  const weights = pieces.map((piece) => ((piece.costCents ?? 0) > 0 ? (piece.costCents as number) : Math.max(0, piece.revenueCents) * ratio));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const total = Math.max(0, Math.round(spentCents));
  if (totalWeight <= 0) {
    pieces.forEach((piece) => result.set(piece.key, 0));
    result.set(pieces[0].key, total);
    return result;
  }
  const exact = weights.map((weight) => (total * weight) / totalWeight);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);
  // Os centavos que sobram do arredondamento vão para as maiores frações.
  const order = exact.map((value, index) => ({ index, fraction: value - floors[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const item of order) {
    if (remainder <= 0) break;
    floors[item.index] += 1;
    remainder -= 1;
  }
  pieces.forEach((piece, index) => result.set(piece.key, floors[index]));
  return result;
}
