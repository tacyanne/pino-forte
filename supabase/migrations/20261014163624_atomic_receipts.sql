-- Review and validate on an isolated database before applying.
-- Do not apply to a real database as part of this task.
BEGIN;

CREATE TABLE public.receipt_requests (
  actor_id integer NOT NULL,
  request_key uuid NOT NULL,
  payload jsonb NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_key)
);
ALTER TABLE public.receipt_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.receipt_requests TO service_role;

CREATE FUNCTION public.receive_payments(p_actor_id integer, p_key uuid, p_payments jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = '' AS $$
DECLARE
  request_row public.receipt_requests%ROWTYPE;
  account_row public.accounts_receivable%ROWTYPE;
  order_row public.service_orders%ROWTYPE;
  receipt_row public.receipts%ROWTYPE;
  payment record;
  new_received integer;
  new_balance integer;
  new_original integer;
  new_status text;
  result jsonb := '{"payments": []}'::jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_key IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.app_users WHERE id = p_actor_id AND active = true
  ) THEN RAISE EXCEPTION USING ERRCODE = 'PT403', MESSAGE = 'Inactive actor'; END IF;
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Invalid payments';
  END IF;
  IF jsonb_array_length(p_payments) NOT BETWEEN 1 AND 100 OR
    (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_payments) x) <> jsonb_array_length(p_payments) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Empty, duplicated or oversized batch';
  END IF;

  -- The unique key serializes identical retries, including requests that arrive
  -- before the first transaction commits. A rollback removes the reservation.
  INSERT INTO public.receipt_requests(actor_id, request_key, payload)
    VALUES (p_actor_id, p_key, p_payments) ON CONFLICT DO NOTHING;
  SELECT * INTO request_row FROM public.receipt_requests
    WHERE actor_id = p_actor_id AND request_key = p_key FOR UPDATE;
  IF request_row.payload IS DISTINCT FROM p_payments THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Idempotency key conflict';
  END IF;
  IF request_row.response IS NOT NULL THEN RETURN request_row.response; END IF;

  -- Match the order-before-account lock order used by the legacy importer.
  -- All callers lock in the same order, even for overlapping wallet batches.
  PERFORM o.id FROM public.service_orders o
    JOIN public.accounts_receivable a ON a.service_order_id = o.id
    WHERE a.id IN (SELECT (x->>'id')::integer FROM jsonb_array_elements(p_payments) x)
    ORDER BY o.id FOR UPDATE OF o;
  PERFORM a.id FROM public.accounts_receivable a
    WHERE a.id IN (SELECT (x->>'id')::integer FROM jsonb_array_elements(p_payments) x)
    ORDER BY a.id FOR UPDATE OF a;

  FOR payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS p(
    id integer, "amountCents" integer, "expectedBalanceCents" integer,
    "paymentMethod" text, "receiptDate" text, notes text
  ) ORDER BY id LOOP
    IF payment.id IS NULL OR payment.id <= 0 OR payment."amountCents" IS NULL OR payment."amountCents" <= 0
      OR payment."expectedBalanceCents" IS NULL OR payment."expectedBalanceCents" <= 0
      OR payment."paymentMethod" IS NULL OR payment."paymentMethod" NOT IN ('Pix', 'Dinheiro', 'Cartão', 'Boleto')
      OR payment."receiptDate" IS NULL OR payment."receiptDate" !~ '^\d{4}-\d{2}-\d{2}$'
      OR payment."receiptDate"::date::text <> payment."receiptDate"
      OR payment.notes IS NULL OR length(payment.notes) > 2000 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Invalid payment';
    END IF;
    SELECT * INTO account_row FROM public.accounts_receivable WHERE id = payment.id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Account missing'; END IF;
    SELECT * INTO order_row FROM public.service_orders WHERE id = account_row.service_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Order missing'; END IF;
    IF account_row.status IN ('Pago', 'Cancelado') OR order_row.production_status = 'Cancelada'
      OR account_row.balance_cents <> payment."expectedBalanceCents"
      OR payment."amountCents" > account_row.balance_cents
      OR account_row.original_amount_cents - account_row.received_amount_cents <> account_row.balance_cents
      OR round(order_row.total::numeric * 100) <> account_row.original_amount_cents
      OR round(order_row.received::numeric * 100) <> account_row.received_amount_cents THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Stale or inconsistent account';
    END IF;

    new_received := account_row.received_amount_cents + payment."amountCents";
    new_balance := account_row.original_amount_cents - new_received;
    new_original := account_row.original_amount_cents;
    -- Preserve the existing business rule: write off residuals of at most R$1.
    IF new_balance BETWEEN 1 AND 100 THEN new_balance := 0; new_original := new_received; END IF;
    new_status := CASE WHEN new_balance = 0 THEN 'Pago'
      WHEN account_row.due_date < (current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date::text THEN 'Vencido'
      ELSE 'Pendente' END;

    INSERT INTO public.receipts(account_receivable_id, service_order_id, receipt_date,
      amount_cents, payment_method, notes, created_by)
    VALUES (account_row.id, account_row.service_order_id, payment."receiptDate",
      payment."amountCents", payment."paymentMethod", payment.notes, p_actor_id)
    RETURNING * INTO receipt_row;
    UPDATE public.accounts_receivable SET original_amount_cents = new_original,
      received_amount_cents = new_received, balance_cents = new_balance,
      status = new_status, updated_at = current_timestamp::text
      WHERE id = account_row.id RETURNING * INTO account_row;
    UPDATE public.service_orders SET received_cents = new_received, received = new_received / 100.0,
      total_cents = new_original, total = new_original / 100.0, balance_cents = new_balance,
      financial_status = new_status,
      payment_method = CASE WHEN new_balance = 0 THEN payment."paymentMethod" ELSE payment_method END,
      updated_at = current_timestamp::text WHERE id = account_row.service_order_id;
    INSERT INTO public.cash_movements(type, origin, origin_id, movement_date, amount_cents,
      payment_method, description, legacy_source_key, created_by)
    VALUES ('entrada', 'Recebimento', account_row.id, payment."receiptDate", payment."amountCents",
      payment."paymentMethod", 'Recebimento da OS ' || account_row.service_order_id,
      'receipt:' || receipt_row.id, p_actor_id);
    INSERT INTO public.audit_logs(user_id, action, entity, entity_id, after_values)
    VALUES (p_actor_id, 'receive', 'accounts_receivable', account_row.id,
      jsonb_build_object('updated', to_jsonb(account_row), 'receipt', to_jsonb(receipt_row))::text);
    result := jsonb_set(result, '{payments}', result->'payments' || jsonb_build_array(
      jsonb_build_object('accountReceivable', to_jsonb(account_row), 'receipt', to_jsonb(receipt_row))));
  END LOOP;
  UPDATE public.receipt_requests SET response = result
    WHERE actor_id = p_actor_id AND request_key = p_key;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.receive_payments(integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_payments(integer, uuid, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
