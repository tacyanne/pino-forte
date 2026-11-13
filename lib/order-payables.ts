// Conta a pagar automática ao fornecedor quando uma OS com peças de revenda é entregue.
// Módulo puro (sincronização e testes). Tudo em centavos inteiros.

// Fornecedor usado quando o Custo revenda da peça não informa nenhum.
export const DEFAULT_RESALE_SUPPLIER = "USIART";

// Peça de revenda vendida na OS: custo unitário (valor de compra + frete), quantidade e fornecedor.
export type ResaleLine = { supplier: string; unitCostCents: number; quantity: number };

export type PlannedOrderPayable = {
  supplier: string;
  description: string;
  purchaseDate: string;
  dueDate: string;
  competenceMonth: string;
  amountCents: number;
  installmentNumber: number;
  notes: string;
};

// Itens da OS a partir do campo product_code: lista em JSON (OS com várias peças) ou código único.
export function parseOrderItems(productCode: unknown, quantity: unknown): { code: string; quantity: number }[] {
  const raw = String(productCode ?? "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const list = JSON.parse(raw) as { code?: unknown; quantity?: unknown }[];
      return Array.isArray(list)
        ? list
            .map((item) => ({ code: String(item?.code ?? "").trim(), quantity: Number(item?.quantity) || 0 }))
            .filter((item) => item.code && item.quantity > 0)
        : [];
    } catch {
      return [];
    }
  }
  const single = Number(quantity) || 0;
  return single > 0 ? [{ code: raw, quantity: single }] : [];
}

const supplierName = (value: string) => String(value || "").trim().replace(/\s+/g, " ").toUpperCase() || DEFAULT_RESALE_SUPPLIER;

// Divide em centavos; a última parcela absorve o resto do arredondamento.
function splitEqually(totalCents: number, parts: number) {
  const base = Math.floor(totalCents / parts);
  const amounts = Array.from({ length: parts }, () => base);
  amounts[parts - 1] += totalCents - base * parts;
  return amounts;
}

// Uma conta por fornecedor e por parcela da OS, com os mesmos vencimentos da OS.
// Valor: custo revenda x quantidade das peças de revenda, dividido igual entre as parcelas.
export function planOrderPayables(input: {
  orderNumber: string;
  deliveryDate: string;
  dueDates: string[];
  lines: ResaleLine[];
}): PlannedOrderPayable[] {
  const dueDates = input.dueDates.map((date) => String(date || "").slice(0, 10)).filter(Boolean);
  if (!dueDates.length) return [];
  const totals = new Map<string, number>();
  for (const line of input.lines) {
    const amount = Math.round(line.unitCostCents) * Math.round(line.quantity);
    if (!(amount > 0)) continue;
    const supplier = supplierName(line.supplier);
    totals.set(supplier, (totals.get(supplier) ?? 0) + amount);
  }
  const planned: PlannedOrderPayable[] = [];
  for (const [supplier, totalCents] of [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    splitEqually(totalCents, dueDates.length).forEach((amountCents, index) => {
      if (amountCents <= 0) return;
      const label = dueDates.length > 1 ? ` (parcela ${index + 1}/${dueDates.length})` : "";
      planned.push({
        supplier,
        description: `Peças de revenda da ${input.orderNumber}${label}`,
        purchaseDate: input.deliveryDate.slice(0, 10),
        dueDate: dueDates[index],
        competenceMonth: dueDates[index].slice(0, 7),
        amountCents,
        installmentNumber: index + 1,
        notes: `Gerada automaticamente na entrega da ${input.orderNumber}.`,
      });
    });
  }
  return planned;
}
