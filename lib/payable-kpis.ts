// Indicadores da tela Contas a pagar. Módulo puro (tela e testes).

export type KpiPayable = {
  supplier: string;
  amountCents: number;
  status: string;
  dueDate: string;
  categoryId?: number | null;
};

export type SupplierTotal = { supplier: string; totalCents: number; count: number };

const DUE_SOON_DAYS = 7;

function daysUntil(todayIso: string, dueDate: string) {
  const from = new Date(`${todayIso.slice(0, 10)}T12:00:00Z`).getTime();
  const to = new Date(`${dueDate.slice(0, 10)}T12:00:00Z`).getTime();
  return Number.isNaN(from) || Number.isNaN(to) ? 0 : Math.round((to - from) / 86_400_000);
}

// Totais das contas listadas: o que já foi pago, o que falta pagar (com atraso e
// vencimento próximo), quanto é gasto de fabricação e para quem foi o dinheiro.
export function payableKpis(rows: KpiPayable[], fabricationIds: number[], todayIso: string) {
  const kpis = {
    totalCents: 0,
    count: 0,
    paidCents: 0,
    paidCount: 0,
    openCents: 0,
    openCount: 0,
    overdueCents: 0,
    dueSoonCents: 0,
    fabricationCents: 0,
    otherCents: 0,
    fabricationShare: null as number | null,
    suppliers: [] as SupplierTotal[],
  };
  const bySupplier = new Map<string, SupplierTotal>();

  for (const row of rows) {
    if (row.status === "Cancelado") continue;
    const amount = Number(row.amountCents) || 0;
    kpis.totalCents += amount;
    kpis.count += 1;
    if (row.status === "Pago") {
      kpis.paidCents += amount;
      kpis.paidCount += 1;
    } else {
      kpis.openCents += amount;
      kpis.openCount += 1;
      const days = daysUntil(todayIso, row.dueDate);
      if (days < 0) kpis.overdueCents += amount;
      else if (days <= DUE_SOON_DAYS) kpis.dueSoonCents += amount;
    }
    if (row.categoryId != null && fabricationIds.includes(row.categoryId)) kpis.fabricationCents += amount;
    else kpis.otherCents += amount;

    const name = row.supplier.trim() || "Sem fornecedor";
    const supplier = bySupplier.get(name) || { supplier: name, totalCents: 0, count: 0 };
    supplier.totalCents += amount;
    supplier.count += 1;
    bySupplier.set(name, supplier);
  }

  kpis.fabricationShare = kpis.totalCents > 0 ? kpis.fabricationCents / kpis.totalCents : null;
  kpis.suppliers = [...bySupplier.values()].sort(
    (a, b) => b.totalCents - a.totalCents || a.supplier.localeCompare(b.supplier, "pt-BR"),
  );
  return kpis;
}

export function wholePercent(share: number | null) {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

export function countLabel(count: number) {
  return count === 1 ? "1 conta" : `${count} contas`;
}

// Frase curta do cartão "A pagar": atraso primeiro, depois vencimento próximo.
export function openHint(
  kpis: { openCount: number; overdueCents: number; dueSoonCents: number },
  money: (value: number) => string,
) {
  if (!kpis.openCount) return "Nenhuma conta em aberto";
  if (kpis.overdueCents > 0) return `${money(kpis.overdueCents / 100)} em atraso`;
  if (kpis.dueSoonCents > 0) return `${money(kpis.dueSoonCents / 100)} vencem em até 7 dias`;
  return `${countLabel(kpis.openCount)} no prazo`;
}
