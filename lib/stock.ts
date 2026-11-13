// Estoque de peças prontas. Módulo puro (API, tela e testes).
//
// O saldo de cada peça parte da última contagem e segue sozinho:
//   contagem + entradas lançadas − saídas lançadas − peças de OS entregues depois da contagem.
// A contagem vale como "fim do dia": vendas do próprio dia já estão fora do que foi contado.

export const STOCK_KINDS = ["contagem", "entrada", "saida"] as const;
export type StockKind = (typeof STOCK_KINDS)[number];

export type StockMovement = {
  id: number;
  productId: number;
  kind: StockKind;
  quantity: number;
  movementDate: string;
  notes: string;
};

export type StockMovementInput = Omit<StockMovement, "id">;

// Peças de uma OS, já ligadas ao cadastro: vendidas (OS entregue) ou prometidas (OS na fila).
export type StockLine = { productId: number; quantity: number; date: string };

export type StockStatus = "sem-contagem" | "falta" | "zerado" | "baixo" | "ok";

export type StockRow = {
  productId: number;
  countedAt: string | null;
  balance: number | null;
  reserved: number;
  available: number | null;
  missing: number;
  monthlyPace: number;
  coverageMonths: number | null;
  status: StockStatus;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QUANTITY = 1_000_000;
const PACE_DAYS = 90;

export class StockError extends Error {
  status = 400;
}

export function parseStockMovement(raw: unknown, today: string): StockMovementInput {
  if (!raw || typeof raw !== "object") throw new StockError("Lançamento de estoque inválido.");
  const body = raw as Record<string, unknown>;
  const productId = Number(body.productId);
  if (!Number.isInteger(productId) || productId <= 0) throw new StockError("Escolha a peça.");
  const kind = String(body.kind || "") as StockKind;
  if (!STOCK_KINDS.includes(kind)) throw new StockError("Escolha o tipo de lançamento.");
  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY)
    throw new StockError("Informe a quantidade em número inteiro.");
  if (kind !== "contagem" && quantity === 0) throw new StockError("Informe uma quantidade maior que zero.");
  const movementDate = String(body.movementDate || today).slice(0, 10);
  if (!ISO_DATE.test(movementDate) || Number.isNaN(new Date(`${movementDate}T12:00:00Z`).getTime()))
    throw new StockError("Informe uma data válida.");
  if (movementDate > today) throw new StockError("A data não pode ser no futuro.");
  return { productId, kind, quantity, movementDate, notes: String(body.notes || "").trim().slice(0, 200) };
}

function daysAgo(todayIso: string, days: number) {
  const date = new Date(`${todayIso.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// Lançamento mais recente entre dois: pela data e, no mesmo dia, pela ordem em que foi gravado.
const isAfter = (movement: StockMovement, reference: StockMovement) =>
  movement.movementDate > reference.movementDate ||
  (movement.movementDate === reference.movementDate && movement.id > reference.id);

export function stockPosition(input: {
  productIds: number[];
  movements: StockMovement[];
  sold: StockLine[];
  reserved: StockLine[];
  today: string;
}): StockRow[] {
  const paceStart = daysAgo(input.today, PACE_DAYS);
  return input.productIds.map((productId) => {
    const movements = input.movements.filter((movement) => movement.productId === productId);
    const sold = input.sold.filter((line) => line.productId === productId);
    const reserved = input.reserved.filter((line) => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0);
    const count = movements
      .filter((movement) => movement.kind === "contagem")
      .reduce<StockMovement | null>((last, movement) => (!last || isAfter(movement, last) ? movement : last), null);

    let balance: number | null = null;
    if (count) {
      balance = count.quantity;
      for (const movement of movements) {
        if (movement.kind === "contagem" || !isAfter(movement, count)) continue;
        balance += movement.kind === "entrada" ? movement.quantity : -movement.quantity;
      }
      for (const line of sold) if (line.date.slice(0, 10) > count.movementDate) balance -= line.quantity;
    }

    const soldRecently = sold.filter((line) => line.date.slice(0, 10) > paceStart).reduce((sum, line) => sum + line.quantity, 0);
    const monthlyPace = Math.round((soldRecently / (PACE_DAYS / 30)) * 10) / 10;
    const available = balance === null ? null : balance - reserved;
    const missing = balance === null ? 0 : Math.max(0, reserved - Math.max(0, balance));
    const coverageMonths = available !== null && available > 0 && monthlyPace > 0 ? Math.round((available / monthlyPace) * 10) / 10 : null;
    const status: StockStatus =
      balance === null || available === null
        ? "sem-contagem"
        : available < 0
          ? "falta"
          : balance <= 0
            ? "zerado"
            : coverageMonths !== null && coverageMonths < 1
              ? "baixo"
              : "ok";
    return { productId, countedAt: count?.movementDate ?? null, balance, reserved, available, missing, monthlyPace, coverageMonths, status };
  });
}

export function stockTotals(rows: StockRow[]) {
  return rows.reduce(
    (totals, row) => ({
      inStock: totals.inStock + Math.max(0, row.balance ?? 0),
      reserved: totals.reserved + row.reserved,
      missing: totals.missing + row.missing,
      uncounted: totals.uncounted + (row.balance === null ? 1 : 0),
    }),
    { inStock: 0, reserved: 0, missing: 0, uncounted: 0 },
  );
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  "sem-contagem": "Sem contagem",
  falta: "Falta",
  zerado: "Zerado",
  baixo: "Baixo",
  ok: "Em dia",
};

export const STOCK_KIND_LABEL: Record<StockKind, string> = {
  contagem: "Contagem",
  entrada: "Entrada",
  saida: "Saída",
};

// Frase do ritmo de venda: quanto sai por mês e quanto tempo o disponível dura.
export function paceSentence(row: Pick<StockRow, "monthlyPace" | "coverageMonths" | "available">) {
  if (row.monthlyPace <= 0) return "Sem venda nos últimos 3 meses";
  const pace = `Vende ${String(row.monthlyPace).replace(".", ",")} por mês`;
  if (row.coverageMonths === null) return pace;
  if (row.coverageMonths < 1) return `${pace} · dura menos de 1 mês`;
  const months = String(row.coverageMonths).replace(".", ",");
  return `${pace} · dura ${months} ${row.coverageMonths === 1 ? "mês" : "meses"}`;
}
