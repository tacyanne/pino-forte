import { getSql } from "../db";
import { hasSupabaseRest, supabaseRpc } from "./supabase-rest";
import { receiptCommand, ReceiptInputError } from "./receipt-command";
import { camelizeRow } from "./supabase-mappers";

type Result = { payments: { accountReceivable: Record<string, unknown>; receipt: Record<string, unknown> }[] };

export async function receivePayments(request: Request, actorId: number, body: Record<string, unknown>) {
  try {
    const command = receiptCommand(body, request.headers.get("idempotency-key"));
    let result: Result;
    if (hasSupabaseRest()) {
      result = await supabaseRpc<Result>("receive_payments", {
        p_actor_id: actorId, p_key: command.key, p_payments: command.payments,
      });
    } else {
      const sql = await getSql();
      const [row] = await sql<{ result: Result }[]>`
        SELECT public.receive_payments(${actorId}::integer, ${command.key}::uuid,
          ${JSON.stringify(command.payments)}::jsonb) AS result
      `;
      result = row.result;
    }
    const payments = result.payments.map((p) => ({
      accountReceivable: camelizeRow(p.accountReceivable), receipt: camelizeRow(p.receipt),
    }));
    return Response.json(body.payments === undefined ? payments[0] : { payments });
  } catch (error) {
    if (error instanceof ReceiptInputError) return Response.json({ error: error.message }, { status: 400 });
    let code = (error as { code?: string })?.code;
    if (!code && error instanceof Error) {
      try { code = JSON.parse(error.message)?.code; } catch { /* transport error */ }
    }
    const errors: Record<string, [number, string]> = {
      PT400: [400, "Recebimento invalido."],
      PT403: [403, "Usuario inativo ou sem acesso."],
      PT404: [404, "Conta a receber nao encontrada."],
      PT409: [409, "Saldo alterado, conta cancelada ou chave reutilizada com outros dados. Atualize o financeiro."],
    };
    const [status, message] = errors[code || ""] || [503, "Recebimento nao confirmado. Tente novamente com os mesmos dados; nao registre outro pagamento para compensar."];
    // No fallback to multiple writes, including when the migration is absent.
    return Response.json({ error: message }, { status });
  }
}
