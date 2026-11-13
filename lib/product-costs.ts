// Custo por peça com histórico de vigência (tabela product_cost_history).
// Módulo puro: sem acesso a banco, para ser usado na API, na tela e nos testes.

// Origem do custo: peça fabricada por nós ou comprada pronta de outro fornecedor para revenda.
export const COST_SOURCES = ["fabricada", "comprada"] as const;
export type CostSource = (typeof COST_SOURCES)[number];

export const costSourceOf = (value: unknown): CostSource => (value === "comprada" ? "comprada" : "fabricada");

export const COST_SOURCE_LABEL: Record<CostSource, string> = {
  fabricada: "Custo fabricação",
  comprada: "Custo revenda",
};

export type ProductCost = {
  id: number;
  productId: number;
  rawMaterialCostCents: number;
  freightCents: number;
  additionalCostsCents: number;
  unitCostCents: number;
  startsAt: string;
  endsAt: string | null;
  source: CostSource;
  supplier: string;
};

export type ProductCostInput = {
  materialCents: number;
  laborCents: number;
  freightCents: number;
  startsAt: string;
  source: CostSource;
  supplier: string;
};

// Escolha de qual custo a peça usa (revenda ou fabricação) a partir de uma data.
export type CostUse = { id: number; productId: number; source: CostSource; startsAt: string };
export type CostUseInput = { source: CostSource; startsAt: string };
export type CostUsePlan = { kind: "none" } | { kind: "update"; id: number } | { kind: "insert" };

export type ProductCostPlan =
  | { kind: "none" }
  | { kind: "update"; id: number }
  | { kind: "insert"; closeId: number | null; closeEndsAt: string | null };

// Meta padrão de lucro sobre o custo usada nos alertas da tela.
export const TARGET_PROFIT_ON_COST = 0.3;

const MAX_COST_CENTS = 100_000_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ProductCostError extends Error {
  status = 400;
}

const brDate = (iso: string) => iso.split("-").reverse().join("/");

function costCents(value: unknown, label: string) {
  const cents = Number(value ?? 0);
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_COST_CENTS)
    throw new ProductCostError(`Informe um valor válido para ${label}.`);
  return Math.round(cents);
}

export function parseProductCostInput(raw: unknown, today: string, source: CostSource = "fabricada"): ProductCostInput | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") throw new ProductCostError("Custo da peça inválido.");
  const body = raw as Record<string, unknown>;
  const startsAt = String(body.startsAt || today).slice(0, 10);
  if (!ISO_DATE.test(startsAt) || Number.isNaN(new Date(`${startsAt}T12:00:00Z`).getTime()))
    throw new ProductCostError("Informe uma data válida para o início do custo.");
  return {
    materialCents: costCents(body.materialCents, "o material"),
    laborCents: costCents(body.laborCents, "a mão de obra"),
    freightCents: costCents(body.freightCents, "o frete"),
    startsAt,
    source,
    supplier: String(body.supplier || "").trim().slice(0, 120),
  };
}

export const totalCostCents = (input: Pick<ProductCostInput, "materialCents" | "laborCents" | "freightCents">) =>
  input.materialCents + input.laborCents + input.freightCents;

export function previousDay(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function parseCostUseInput(raw: unknown, today: string): CostUseInput | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") throw new ProductCostError("Custo em uso inválido.");
  const body = raw as Record<string, unknown>;
  if (!COST_SOURCES.includes(body.source as CostSource)) throw new ProductCostError("Escolha o custo em uso: revenda ou fabricação.");
  const startsAt = String(body.startsAt || today).slice(0, 10);
  if (!ISO_DATE.test(startsAt) || Number.isNaN(new Date(`${startsAt}T12:00:00Z`).getTime()))
    throw new ProductCostError("Informe uma data válida para o custo em uso.");
  return { source: body.source as CostSource, startsAt };
}

// Escolha mais recente da peça (a de maior data de início).
export function latestCostUse(uses: CostUse[], productId: number) {
  let match: CostUse | null = null;
  for (const row of uses) {
    if (row.productId !== productId) continue;
    if (!match || row.startsAt > match.startsAt) match = row;
  }
  return match;
}

// Custo escolhido para a peça em uma data: a escolha mais recente que já começou.
export function costUseAt(uses: CostUse[], productId: number, date: string) {
  const day = date.slice(0, 10);
  let match: CostUse | null = null;
  for (const row of uses) {
    if (row.productId !== productId || row.startsAt > day) continue;
    if (!match || row.startsAt > match.startsAt) match = row;
  }
  return match;
}

// Decide o que gravar: nada, corrigir a escolha atual ou registrar uma nova a partir da data.
export function planCostUseChange(latest: CostUse | null, input: CostUseInput): CostUsePlan {
  if (!latest) return { kind: "insert" };
  if (latest.source === input.source) return latest.startsAt === input.startsAt ? { kind: "none" } : { kind: "update", id: latest.id };
  if (input.startsAt === latest.startsAt) return { kind: "update", id: latest.id };
  if (input.startsAt < latest.startsAt)
    throw new ProductCostError(`A data do custo em uso deve ser igual ou posterior a ${brDate(latest.startsAt)}, data da escolha atual.`);
  return { kind: "insert" };
}

// Custo vigente de uma peça em uma data.
// Com a escolha de custo em uso registrada, vale o custo dessa origem. Sem escolha (ou sem
// custo cadastrado na origem escolhida), vale o custo que começou por último; no empate, a revenda.
export function costAt(history: ProductCost[], productId: number, date: string, uses: CostUse[] = []): ProductCost | null {
  const day = date.slice(0, 10);
  const chosen = costUseAt(uses, productId, day);
  if (chosen) {
    const chosenCost = costAt(history.filter((row) => costSourceOf(row.source) === chosen.source), productId, day);
    if (chosenCost) return chosenCost;
  }
  let match: ProductCost | null = null;
  for (const row of history) {
    if (row.productId !== productId) continue;
    if (row.startsAt > day) continue;
    if (row.endsAt && row.endsAt < day) continue;
    if (!match || row.startsAt > match.startsAt || (row.startsAt === match.startsAt && costSourceOf(row.source) === "comprada"))
      match = row;
  }
  return match;
}

// Custo vigente de uma origem específica (fabricada ou comprada) em uma data.
export function costOfSourceAt(history: ProductCost[], productId: number, source: CostSource, date: string) {
  return costAt(history.filter((row) => costSourceOf(row.source) === source), productId, date);
}

// Vigência em aberto (sem data de fim) de uma peça, em uma das origens.
export function openCost(history: ProductCost[], productId: number, source: CostSource = "fabricada") {
  let match: ProductCost | null = null;
  for (const row of history) {
    if (row.productId !== productId || row.endsAt || costSourceOf(row.source) !== source) continue;
    if (!match || row.startsAt > match.startsAt) match = row;
  }
  return match;
}

// Decide o que gravar: nada, corrigir a vigência atual ou abrir uma nova vigência.
export function planProductCostChange(open: ProductCost | null, input: ProductCostInput): ProductCostPlan {
  if (!open) {
    return totalCostCents(input) > 0 ? { kind: "insert", closeId: null, closeEndsAt: null } : { kind: "none" };
  }
  const sameValues =
    open.rawMaterialCostCents === input.materialCents &&
    open.additionalCostsCents === input.laborCents &&
    open.freightCents === input.freightCents;
  // Só a data de início ou o fornecedor mudou: corrige a vigência atual, sem abrir outra.
  if (sameValues)
    return input.startsAt !== open.startsAt || (input.supplier ?? "") !== (open.supplier ?? "")
      ? { kind: "update", id: open.id }
      : { kind: "none" };
  if (input.startsAt === open.startsAt) return { kind: "update", id: open.id };
  if (input.startsAt < open.startsAt)
    throw new ProductCostError(
      `A data de início do custo deve ser igual ou posterior a ${brDate(open.startsAt)}, início do custo atual.`,
    );
  return { kind: "insert", closeId: open.id, closeEndsAt: previousDay(input.startsAt) };
}

// Lucro sobre o custo: (preço - custo) / custo. Sem custo, não há percentual.
export function profitOnCost(priceCents: number, unitCostCents: number) {
  return unitCostCents > 0 ? (priceCents - unitCostCents) / unitCostCents : null;
}

// "RN 180", "PF-RN-180" e "pf rn 180" são a mesma peça (OS antigas usam o código sem prefixo).
export function normalizePieceCode(code: string) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^PF/, "");
}

export type SaleLine = { code: string; quantity: number; revenueCents: number; date: string };

export type ProductProfit = {
  key: string;
  code: string;
  productId: number | null;
  quantity: number;
  revenueCents: number;
  costCents: number | null;
  profitCents: number | null;
};

export type SalesProfit = {
  revenueCents: number;
  coveredRevenueCents: number;
  uncoveredRevenueCents: number;
  costCents: number;
  profitCents: number;
  byProduct: ProductProfit[];
};

// Lucro bruto das vendas: receita menos o custo vigente na data de cada venda.
// Vendas de peças sem custo cadastrado ficam fora do lucro e entram em "uncovered".
export function summarizeSalesProfit(
  lines: SaleLine[],
  products: { id: number; code: string }[],
  history: ProductCost[],
  uses: CostUse[] = [],
): SalesProfit {
  const productByKey = new Map(products.map((product) => [normalizePieceCode(product.code), product]));
  const byKey = new Map<string, ProductProfit>();
  const summary: SalesProfit = {
    revenueCents: 0,
    coveredRevenueCents: 0,
    uncoveredRevenueCents: 0,
    costCents: 0,
    profitCents: 0,
    byProduct: [],
  };

  for (const line of lines) {
    const quantity = Number(line.quantity) || 0;
    const revenueCents = Math.round(Number(line.revenueCents) || 0);
    const key = normalizePieceCode(line.code);
    const product = productByKey.get(key) || null;
    const cost = product ? costAt(history, product.id, line.date, uses) : null;
    const row =
      byKey.get(key) ||
      ({
        key,
        code: product?.code || line.code,
        productId: product?.id ?? null,
        quantity: 0,
        revenueCents: 0,
        costCents: null,
        profitCents: null,
      } satisfies ProductProfit);
    byKey.set(key, row);
    row.quantity += quantity;
    row.revenueCents += revenueCents;
    summary.revenueCents += revenueCents;

    if (cost && cost.unitCostCents > 0) {
      const lineCost = cost.unitCostCents * quantity;
      row.costCents = (row.costCents ?? 0) + lineCost;
      row.profitCents = (row.profitCents ?? 0) + revenueCents - lineCost;
      summary.coveredRevenueCents += revenueCents;
      summary.costCents += lineCost;
      summary.profitCents += revenueCents - lineCost;
    } else {
      summary.uncoveredRevenueCents += revenueCents;
    }
  }

  summary.byProduct = [...byKey.values()].sort(
    (a, b) =>
      (b.profitCents ?? Number.NEGATIVE_INFINITY) - (a.profitCents ?? Number.NEGATIVE_INFINITY) ||
      b.quantity - a.quantity,
  );
  return summary;
}
