import {
  supabaseDelete,
  supabaseGetOne,
  supabasePatch,
  supabaseSelect,
} from "../../../../lib/supabase-rest";

type Row = Record<string, unknown>;

const authorized = (request: Request) => {
  const expected = process.env.PAYMENT_CORRECTION_TOKEN || "";
  return Boolean(expected) && request.headers.get("x-correction-token") === expected;
};

async function inspect() {
  const order = await supabaseGetOne<Row>("service_orders", {
    select: "*",
    number: "eq.OS-2026-000001",
  });
  if (!order) throw new Error("OS-2026-000001 não encontrada.");
  const orderId = Number(order.id);
  const receipts = await supabaseSelect<Row>("receipts", {
    select: "*",
    service_order_id: `eq.${orderId}`,
    receipt_date: "eq.2026-08-03",
    payment_method: "eq.Boleto",
    order: "id.asc",
  });
  const receivable = await supabaseGetOne<Row>("accounts_receivable", {
    select: "*",
    service_order_id: `eq.${orderId}`,
  });
  return { order, orderId, receipts, receivable };
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const state = await inspect();
    return Response.json({
      order: {
        id: state.orderId,
        number: state.order.number,
        totalCents: state.order.total_cents,
        receivedCents: state.order.received_cents,
        balanceCents: state.order.balance_cents,
        status: state.order.financial_status,
      },
      receipts: state.receipts.map((row) => ({
        id: row.id,
        date: row.receipt_date,
        method: row.payment_method,
        amountCents: row.amount_cents,
      })),
      receivable: state.receivable,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha na conferência." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const state = await inspect();
    const sorted = [...state.receipts].sort((a, b) => Number(b.amount_cents) - Number(a.amount_cents));
    if (
      sorted.length !== 2 ||
      Number(sorted[0].amount_cents) !== 29300 ||
      Number(sorted[1].amount_cents) !== 40
    ) {
      return Response.json({ error: "Correção bloqueada: os dois lançamentos esperados não foram encontrados.", receipts: state.receipts }, { status: 409 });
    }

    const keepId = Number(sorted[0].id);
    const removeId = Number(sorted[1].id);
    await supabasePatch("receipts", { id: `eq.${keepId}` }, {
      amount_cents: 29340,
      notes: "Pagamento unificado após correção de lançamento",
    });
    await supabaseDelete("receipts", { id: `eq.${removeId}` });

    const keepMovement = await supabaseGetOne<Row>("cash_movements", {
      select: "id",
      legacy_source_key: `eq.receipt:${keepId}`,
    });
    if (keepMovement?.id) {
      await supabasePatch("cash_movements", { id: `eq.${keepMovement.id}` }, { amount_cents: 29340 });
    }
    const removeMovement = await supabaseGetOne<Row>("cash_movements", {
      select: "id",
      legacy_source_key: `eq.receipt:${removeId}`,
    });
    if (removeMovement?.id) await supabaseDelete("cash_movements", { id: `eq.${removeMovement.id}` });

    const totalCents = Number(state.order.total_cents || 29340);
    await supabasePatch("service_orders", { id: `eq.${state.orderId}` }, {
      received: 293.4,
      received_cents: 29340,
      balance_cents: Math.max(0, totalCents - 29340),
      financial_status: totalCents <= 29340 ? "Pago" : "Parcial",
      updated_at: new Date().toISOString(),
    });
    if (state.receivable?.id) {
      await supabasePatch("accounts_receivable", { id: `eq.${state.receivable.id}` }, {
        received_amount_cents: 29340,
        balance_cents: Math.max(0, Number(state.receivable.original_amount_cents || totalCents) - 29340),
        status: Number(state.receivable.original_amount_cents || totalCents) <= 29340 ? "Pago" : "Parcial",
        updated_at: new Date().toISOString(),
      });
    }

    const after = await inspect();
    return Response.json({
      ok: true,
      order: { number: after.order.number, receivedCents: after.order.received_cents, balanceCents: after.order.balance_cents, status: after.order.financial_status },
      receipts: after.receipts.map((row) => ({ id: row.id, amountCents: row.amount_cents, date: row.receipt_date, method: row.payment_method })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha na correção." }, { status: 500 });
  }
}
