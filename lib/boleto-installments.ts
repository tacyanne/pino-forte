// Lógica pura do boleto parcelado (sem acesso a banco): 25/50/75 dias = 1/2/3 parcelas a cada 25 dias.
export const BOLETO_TERMS = [25, 50, 75] as const;
export type BoletoTerm = (typeof BOLETO_TERMS)[number];
export const BOLETO_STEP_DAYS = 25;

export type PlannedInstallment = {
  number: number;
  totalInstallments: number;
  dueDate: string;
  amountCents: number;
  receivedCents: number;
  balanceCents: number;
  status: "Pago" | "Vencido" | "Pendente";
};

export type ExistingInstallment = {
  number: number;
  amountCents: number;
  receivedCents: number;
};

export function parseBoletoTerm(value: unknown): BoletoTerm | null {
  const term = Number(value);
  return (BOLETO_TERMS as readonly number[]).includes(term) ? (term as BoletoTerm) : null;
}

export function installmentCount(termDays: number) {
  return Math.max(1, Math.round(termDays / BOLETO_STEP_DAYS));
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

// Divide em centavos; a última parcela absorve o resto do arredondamento.
export function splitCents(totalCents: number, parts: number) {
  const total = Math.max(0, Math.round(totalCents));
  const base = Math.floor(total / parts);
  const amounts = Array.from({ length: parts }, () => base);
  amounts[parts - 1] += total - base * parts;
  return amounts;
}

function installmentStatus(balanceCents: number, dueDate: string, today: string) {
  if (balanceCents <= 0) return "Pago" as const;
  if (dueDate < today) return "Vencido" as const;
  return "Pendente" as const;
}

/**
 * Plano de parcelas de uma OS. Idempotente: pode ser recalculado a cada alteração.
 * - Valores: divisão igual do total; parcela já quitada mantém seu valor e as demais dividem o restante.
 * - Recebido: parte do que cada parcela já recebeu e ajusta ao total recebido da OS
 *   (diferença a mais entra na parcela mais antiga com saldo; a menos sai das mais novas).
 */
export function planInstallments(input: {
  totalCents: number;
  receivedCents: number;
  issuedAt: string;
  termDays: number;
  existing?: ExistingInstallment[];
  today: string;
}): PlannedInstallment[] {
  const count = installmentCount(input.termDays);
  const total = Math.max(0, Math.round(input.totalCents));
  const receivedTarget = Math.min(Math.max(0, Math.round(input.receivedCents)), total);
  const previous = new Map(
    (input.existing || []).filter((item) => item.number <= count).map((item) => [item.number, item]),
  );
  const sameShape = (input.existing || []).length === count;

  const amounts = Array.from({ length: count }, () => 0);
  const fixed = new Set<number>();
  if (sameShape) {
    for (let index = 0; index < count; index += 1) {
      const old = previous.get(index + 1);
      if (old && old.receivedCents > 0 && old.receivedCents >= old.amountCents) {
        amounts[index] = old.receivedCents;
        fixed.add(index);
      }
    }
  }
  const fixedSum = amounts.reduce((sum, value) => sum + value, 0);
  const open = Array.from({ length: count }, (_, index) => index).filter((index) => !fixed.has(index));
  if (open.length) {
    const split = splitCents(Math.max(0, total - fixedSum), open.length);
    open.forEach((index, position) => {
      amounts[index] = split[position];
    });
  } else {
    amounts[count - 1] += total - amounts.reduce((sum, value) => sum + value, 0);
  }

  const received = amounts.map((amount, index) =>
    sameShape ? Math.min(previous.get(index + 1)?.receivedCents ?? 0, amount) : 0,
  );
  let diff = receivedTarget - received.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < count && diff > 0; index += 1) {
    const add = Math.min(diff, amounts[index] - received[index]);
    received[index] += add;
    diff -= add;
  }
  for (let index = count - 1; index >= 0 && diff < 0; index -= 1) {
    const remove = Math.min(-diff, received[index]);
    received[index] -= remove;
    diff += remove;
  }

  return amounts.map((amountCents, index) => {
    const dueDate = addDays(input.issuedAt, BOLETO_STEP_DAYS * (index + 1));
    const balanceCents = Math.max(0, amountCents - received[index]);
    return {
      number: index + 1,
      totalInstallments: count,
      dueDate,
      amountCents,
      receivedCents: received[index],
      balanceCents,
      status: installmentStatus(balanceCents, dueDate, input.today),
    };
  });
}

// Vencimento e status agregados da conta a receber a partir das parcelas.
export function summarizeInstallments(installments: PlannedInstallment[]) {
  const open = installments.filter((item) => item.balanceCents > 0);
  const dueDate = (open[0] || installments[installments.length - 1]).dueDate;
  const status = !open.length
    ? ("Pago" as const)
    : open.some((item) => item.status === "Vencido")
      ? ("Vencido" as const)
      : ("Pendente" as const);
  return { dueDate, status };
}

// Vencimento da primeira parcela (usado como vencimento inicial da OS/conta a receber).
export const boletoFirstDueDate = (issuedAt: string) => addDays(issuedAt, BOLETO_STEP_DAYS);

// Parcela já recebida trava troca de prazo/forma de pagamento. Retorna a mensagem de bloqueio ou null.
export function boletoTermChangeBlockedReason(
  rows: { receivedCents: number }[],
  nextTerm: BoletoTerm | null,
) {
  if (!rows.some((row) => row.receivedCents > 0)) return null;
  if (nextTerm === null)
    return "Esta OS já tem parcela de boleto recebida; não é possível trocar a forma de pagamento.";
  if (nextTerm !== rows.length * BOLETO_STEP_DAYS)
    return "Esta OS já tem parcela de boleto recebida; não é possível alterar o prazo do boleto.";
  return null;
}
