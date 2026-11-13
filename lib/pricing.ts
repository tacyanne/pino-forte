// Simulação de preço e margem das peças, comparando a peça fabricada com a comprada pronta.
// Módulo puro (tela e testes). Tudo em centavos inteiros.

export type PricingSource = "fabricada" | "comprada";

// Meta padrão de lucro sobre o custo, usada enquanto nenhuma meta foi salva.
export const DEFAULT_TARGET_PROFIT_RATE = 0.35;
const MAX_TARGET_RATE = 10;

// Lê a meta salva (0,35 = 35%). Valor ausente ou inválido cai no padrão.
export function targetRateOf(value: unknown) {
  const rate = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(rate) && rate >= 0 && rate <= MAX_TARGET_RATE
    ? rate
    : DEFAULT_TARGET_PROFIT_RATE;
}

// "35", "35,5" ou "35%" viram 0,35 e 0,355. Devolve null se não for um percentual válido.
export function parsePercent(text: string) {
  const clean = String(text ?? "").replace("%", "").replace(/\s/g, "").replace(",", ".");
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value / 100 : null;
}

// Lucro sobre o custo: (preço - custo) / custo.
export const marginOnCost = (priceCents: number, costCents: number | null) =>
  costCents && costCents > 0 ? (priceCents - costCents) / costCents : null;

// Lucro sobre o preço: (preço - custo) / preço.
export const marginOnPrice = (priceCents: number, costCents: number | null) =>
  costCents && costCents > 0 && priceCents > 0 ? (priceCents - costCents) / priceCents : null;

// Preço que entrega a margem desejada sobre o custo.
export const priceForMargin = (costCents: number, rate: number) => Math.round(costCents * (1 + rate));

export type SourceSimulation = {
  source: PricingSource;
  costCents: number | null;
  profitCents: number | null;
  onCost: number | null;
  onPrice: number | null;
  // Abaixo deste preço a peça dá prejuízo.
  minPriceCents: number | null;
  // Preço que atinge a meta.
  targetPriceCents: number | null;
  reachesTarget: boolean | null;
};

function simulateSource(source: PricingSource, priceCents: number, costCents: number | null, targetRate: number): SourceSimulation {
  const cost = costCents && costCents > 0 ? costCents : null;
  const onCost = marginOnCost(priceCents, cost);
  return {
    source,
    costCents: cost,
    profitCents: cost === null ? null : priceCents - cost,
    onCost,
    onPrice: marginOnPrice(priceCents, cost),
    minPriceCents: cost,
    targetPriceCents: cost === null ? null : priceForMargin(cost, targetRate),
    reachesTarget: onCost === null ? null : onCost >= targetRate,
  };
}

export type PriceSimulation = {
  priceCents: number;
  fabricada: SourceSimulation;
  comprada: SourceSimulation;
  // Origem com o menor custo, quando as duas estão cadastradas.
  cheaper: PricingSource | null;
  // Quanto a origem mais barata economiza por peça.
  savingCents: number | null;
};

export function simulatePrice(input: {
  priceCents: number;
  fabricatedCostCents: number | null;
  purchasedCostCents: number | null;
  targetRate: number;
}): PriceSimulation {
  const priceCents = Math.max(0, Math.round(input.priceCents) || 0);
  const fabricada = simulateSource("fabricada", priceCents, input.fabricatedCostCents, input.targetRate);
  const comprada = simulateSource("comprada", priceCents, input.purchasedCostCents, input.targetRate);
  const both = fabricada.costCents !== null && comprada.costCents !== null;
  const cheaper: PricingSource | null = !both
    ? null
    : fabricada.costCents === comprada.costCents
      ? null
      : fabricada.costCents! < comprada.costCents!
        ? "fabricada"
        : "comprada";
  return {
    priceCents,
    fabricada,
    comprada,
    cheaper,
    savingCents: both ? Math.abs(fabricada.costCents! - comprada.costCents!) : null,
  };
}

// Reajuste em percentual. Com "ninety", o preço termina em ,90 (o ,90 mais próximo).
export function adjustPrice(priceCents: number, rate: number, ending: "exact" | "ninety" = "exact") {
  const raw = Math.max(0, Math.round(priceCents * (1 + rate)));
  if (ending === "exact" || raw === 0) return raw;
  const below = Math.floor((raw - 90) / 100) * 100 + 90;
  const above = below + 100;
  const nearest = raw - below <= above - raw ? below : above;
  return nearest > 0 ? nearest : 90;
}

// Frase curta de comparação entre as duas origens.
export function sourceComparison(simulation: PriceSimulation, money: (value: number) => string) {
  if (simulation.fabricada.costCents === null && simulation.comprada.costCents === null) return "Falta cadastrar o custo";
  if (simulation.comprada.costCents === null) return "Falta o custo comprando pronta";
  if (simulation.fabricada.costCents === null) return "Falta o custo fabricando";
  if (simulation.cheaper === null) return "As duas custam o mesmo";
  const saving = money((simulation.savingCents ?? 0) / 100);
  return simulation.cheaper === "comprada" ? `Comprar pronta sai ${saving} mais barato` : `Fabricar sai ${saving} mais barato`;
}
