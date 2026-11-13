// Histórico do preço de venda de cada peça (tabela product_price_history), por vigência.
// Módulo puro: sem acesso a banco, para ser usado na API, na tela e nos testes.

// De onde veio o registro: alteração feita na tela, cadastro da peça ou
// reconstrução a partir dos preços praticados nas vendas antigas.
export const PRICE_SOURCES = ["tela", "cadastro", "vendas"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export type ProductPrice = {
  id: number;
  productId: number;
  priceCents: number;
  startsAt: string;
  endsAt: string | null;
  source: PriceSource;
};

export type ProductPricePlan =
  | { kind: "none" }
  | { kind: "update"; id: number }
  | { kind: "insert"; closeId: number | null; closeEndsAt: string | null };

function previousDay(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export const priceSourceOf = (value: unknown): PriceSource =>
  PRICE_SOURCES.includes(value as PriceSource) ? (value as PriceSource) : "tela";

// Vigência em aberto (sem data de fim) de uma peça.
export function openPrice(history: ProductPrice[], productId: number) {
  let match: ProductPrice | null = null;
  for (const row of history) {
    if (row.productId !== productId || row.endsAt) continue;
    if (!match || row.startsAt > match.startsAt) match = row;
  }
  return match;
}

// Decide o que gravar quando o preço da peça é salvo: nada, corrigir a vigência
// aberta (mesmo dia) ou fechar a anterior e abrir uma nova a partir de hoje.
export function planProductPriceChange(open: ProductPrice | null, priceCents: number, today: string): ProductPricePlan {
  if (!Number.isInteger(priceCents) || priceCents <= 0) return { kind: "none" };
  if (!open) return { kind: "insert", closeId: null, closeEndsAt: null };
  if (open.priceCents === priceCents) return { kind: "none" };
  if (open.startsAt >= today) return { kind: "update", id: open.id };
  return { kind: "insert", closeId: open.id, closeEndsAt: previousDay(today) };
}

export type PriceTimelineItem = ProductPrice & {
  previousCents: number | null;
  deltaCents: number | null;
  deltaRate: number | null;
};

// Linha do tempo da peça, da mudança mais recente para a mais antiga,
// com a variação de cada preço sobre o anterior.
export function priceTimeline(history: ProductPrice[], productId: number): PriceTimelineItem[] {
  const rows = history
    .filter((row) => row.productId === productId)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);
  return rows
    .map((row, index) => {
      const previous = index > 0 ? rows[index - 1].priceCents : null;
      const deltaCents = previous === null ? null : row.priceCents - previous;
      return {
        ...row,
        previousCents: previous,
        deltaCents,
        deltaRate: previous && deltaCents !== null ? deltaCents / previous : null,
      };
    })
    .reverse();
}

// "+R$ 4,00 (+7,4%)" ou "preço inicial".
export function priceChangeLabel(item: Pick<PriceTimelineItem, "deltaCents" | "deltaRate">, money: (value: number) => string) {
  if (item.deltaCents === null) return "preço inicial";
  if (item.deltaCents === 0) return "sem mudança";
  const sign = item.deltaCents > 0 ? "+" : "−";
  const amount = `${sign}${money(Math.abs(item.deltaCents) / 100)}`;
  if (item.deltaRate === null) return amount;
  const percent = (Math.abs(item.deltaRate) * 100).toFixed(1).replace(".", ",");
  return `${amount} (${sign}${percent}%)`;
}
