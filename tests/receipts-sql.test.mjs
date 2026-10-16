import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from 'drizzle-orm/pglite';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const runtime = new URL('../.sites-runtime/', import.meta.url);
await mkdir(runtime, {recursive:true});
await build({entryPoints:['lib/finance.ts'],outfile:fileURLToPath(new URL('finance-sync.mjs',runtime)),
  bundle:true,platform:'node',format:'esm',packages:'external'});
const { syncReceivablesFromOrders } = await import(new URL('finance-sync.mjs',runtime));

// Embedded PostgreSQL, no sockets, environment credentials or persistent files.
const db = new PGlite();
before(async () => {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await db.exec(readFileSync(new URL('../supabase/migrations/001_pino_forte_supabase_foundation.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261014163624_atomic_receipts.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => {
  await db.exec(`DROP TRIGGER IF EXISTS fail_cash ON cash_movements;
    DROP TRIGGER IF EXISTS fail_audit ON audit_logs;
    TRUNCATE receipt_requests, audit_logs, cash_movements, receipts, accounts_receivable, service_orders, app_users CASCADE;
    INSERT INTO app_users(id,name,email,password_hash,salt,role) VALUES (1,'Ficticio','fake@example.invalid','fake','fake','user');
    INSERT INTO service_orders(id,number,customer_name,origin,product_code,quantity,unit_price,total,received,delivery_date,delivery_type,payment_method)
      VALUES (1,'TEST-1','Ficticio','Teste','TEST',1,100,100,0,'2099-01-01','Retirada no local','Carteira'),
             (2,'TEST-2','Ficticio','Teste','TEST',1,100,100,0,'2099-01-01','Retirada no local','Carteira');
    INSERT INTO accounts_receivable(id,service_order_id,issued_at,due_date,original_amount_cents,received_amount_cents,balance_cents)
      VALUES (1,1,'2026-01-01','2099-01-01',10000,0,10000),(2,2,'2026-01-01','2099-01-01',10000,0,10000);`);
});
after(() => db.close());
const payment = (changes = {}) => ({ id: 1, amountCents: 3000, expectedBalanceCents: 10000, paymentMethod: 'Pix', receiptDate: '2026-10-14', notes: '', ...changes });
const receive = async (payments = [payment()], key = crypto.randomUUID(), actor = 1) =>
  (await db.query('SELECT public.receive_payments($1, $2, $3::jsonb) AS result', [actor,key,JSON.stringify(payments)])).rows[0].result;
const snapshot = async () => (await db.query(`SELECT
  (SELECT coalesce(sum(amount_cents),0)::int FROM receipts) receipts,
  (SELECT coalesce(sum(amount_cents),0)::int FROM cash_movements) cash,
  (SELECT count(*)::int FROM audit_logs) audits,
  (SELECT count(*)::int FROM receipt_requests) requests,
  (SELECT sum(received_amount_cents)::int FROM accounts_receivable) received,
  (SELECT sum(received_cents)::int FROM service_orders) orders`)).rows[0];

test('partial receipt and settlement keep account, order, receipt and cash aligned', async () => {
  const first = await receive();
  assert.equal(first.payments[0].accountReceivable.balance_cents,7000);
  assert.deepEqual(await snapshot(),{receipts:3000,cash:3000,audits:1,requests:1,received:3000,orders:3000});
  const last = await receive([payment({amountCents:7000,expectedBalanceCents:7000,paymentMethod:'Boleto'})]);
  assert.equal(last.payments[0].accountReceivable.status,'Pago');
  const order = (await db.query('SELECT total,received,balance_cents,payment_method FROM service_orders WHERE id=1')).rows[0];
  assert.deepEqual(order,{total:100,received:100,balance_cents:0,payment_method:'Boleto'});
  assert.deepEqual(await snapshot(),{receipts:10000,cash:10000,audits:2,requests:2,received:10000,orders:10000});
});
test('small residual writes off only the balance, never invents cash', async () => {
  const result = await receive([payment({amountCents:9950})]);
  assert.equal(result.payments[0].accountReceivable.original_amount_cents,9950);
  assert.equal(result.payments[0].accountReceivable.balance_cents,0);
  assert.equal((await snapshot()).cash,9950);
});
test('retry returns the original response even after a later receipt', async () => {
  const key = crypto.randomUUID(), payments=[payment()];
  const first = await receive(payments,key);
  await receive([payment({amountCents:2000,expectedBalanceCents:7000})]);
  assert.deepEqual(await receive(payments,key),first);
  assert.equal((await snapshot()).cash,5000);
  await assert.rejects(receive([payment({amountCents:3100})],key),{code:'PT409'});
});
test('two queued calls using the same key create one receipt (not a multi-connection concurrency test)', async () => {
  const key=crypto.randomUUID();
  const [a,b]=await Promise.all([receive([payment()],key),receive([payment()],key)]);
  assert.deepEqual(a,b);
  assert.equal((await snapshot()).audits,1);
});
test('a different key with stale balance cannot charge twice', async () => {
  await receive();
  await assert.rejects(receive(),{code:'PT409'});
  assert.equal((await snapshot()).cash,3000);
});
test('legacy sync after a receipt never replaces balances or creates another initial receipt', async () => {
  await receive();
  const before = await snapshot();
  await drizzle(db).transaction(tx => syncReceivablesFromOrders(tx,1));
  assert.deepEqual(await snapshot(),before);
  assert.equal((await db.query('SELECT balance_cents FROM accounts_receivable WHERE id=1')).rows[0].balance_cents,7000);
});
test('a wallet batch commits all accounts together', async () => {
  const result = await receive([payment({amountCents:10000}),payment({id:2,amountCents:2000})]);
  assert.equal(result.payments.length,2);
  assert.deepEqual(await snapshot(),{receipts:12000,cash:12000,audits:2,requests:1,received:12000,orders:12000});
});
for (const table of ['cash_movements','audit_logs']) {
  test(`failure in ${table} rolls back the entire batch and permits retry`,async()=>{
    const before=await snapshot(), key=crypto.randomUUID();
    await db.exec(`CREATE OR REPLACE FUNCTION pg_temp.fail_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected test failure'; END; $$;
      CREATE TRIGGER ${table==='cash_movements'?'fail_cash':'fail_audit'} BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_write();`);
    await assert.rejects(receive([payment(),payment({id:2})],key),/injected test failure/);
    assert.deepEqual(await snapshot(),before);
    await db.exec(`DROP TRIGGER ${table==='cash_movements'?'fail_cash':'fail_audit'} ON ${table}`);
    await receive([payment(),payment({id:2})],key);
    assert.equal((await snapshot()).cash,6000);
  });
}
test('failure on second account rolls back the first account too', async()=>{
  const before=await snapshot();
  await assert.rejects(receive([payment(),payment({id:2,expectedBalanceCents:9000})]),{code:'PT409'});
  assert.deepEqual(await snapshot(),before);
});
test('canceled, overpaid, missing and inactive inputs never write',async()=>{
  await assert.rejects(receive([payment({amountCents:10001})]),{code:'PT409'});
  await assert.rejects(receive([payment({id:99})]),{code:'PT404'});
  await db.exec("UPDATE accounts_receivable SET status='Cancelado' WHERE id=1");
  await assert.rejects(receive(),{code:'PT409'});
  await db.exec('UPDATE app_users SET active=false WHERE id=1');
  await assert.rejects(receive(),{code:'PT403'});
  assert.equal((await snapshot()).requests,0);
});
test('public roles cannot invoke the RPC or read idempotency data',async()=>{
  for(const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    try {
      await assert.rejects(receive(),{code:'42501'});
      await assert.rejects(db.query('SELECT * FROM receipt_requests'),{code:'42501'});
    } finally { await db.exec('RESET ROLE'); }
  }
});
