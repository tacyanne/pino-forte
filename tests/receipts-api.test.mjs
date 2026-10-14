import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { receiptCommand } from '../lib/receipt-command.ts';
import { submitReceipts } from '../lib/receipt-client.ts';

const runtime = new URL('../.sites-runtime/',import.meta.url);
await mkdir(runtime,{recursive:true});
await build({entryPoints:['app/api/finance/route.ts'],outfile:fileURLToPath(new URL('receipts-api.mjs',runtime)),
  bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{
    name:'isolated-sql',setup(build){
      build.onResolve({filter:/^(\.\.\/)+db$/},()=>({path:'db',namespace:'fake'}));
      build.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:`
        export const getSql = async () => globalThis.__receiptSql;
        export const getDb = async () => { throw new Error('Unexpected non-atomic database access'); };
      `}));
    },
  }]});
const { PATCH } = await import(new URL('receipts-api.mjs',runtime));
const payment = {id:1,amountCents:3000,expectedBalanceCents:10000,paymentMethod:'Pix',receiptDate:'2026-10-14',notes:''};

test('receipt validation rejects unsafe amounts, dates, duplicates and missing keys',()=>{
  for(const override of [{amountCents:NaN},{amountCents:Infinity},{amountCents:1.5},{amountCents:0},{amountCents:-1},{amountCents:'3000'},
    {expectedBalanceCents:undefined},{amountCents:10001},{id:0},{id:2147483648},{paymentMethod:'Carteira'},{receiptDate:'2026-02-30'},{notes:123}]) {
    assert.throws(()=>receiptCommand({...payment,...override},crypto.randomUUID()));
  }
  assert.throws(()=>receiptCommand(payment,null));
  assert.throws(()=>receiptCommand({payments:[payment,payment]},crypto.randomUUID()));
  assert.throws(()=>receiptCommand({payments:[]},crypto.randomUUID()));
  assert.equal(receiptCommand(payment,crypto.randomUUID()).payments[0].amountCents,3000);
});

for(const adapter of ['rest','postgres']) {
  for(const scenario of ['success','anonymous','invalid','conflict','transport failure']) {
    test(`${adapter} API: ${scenario}`,async(t)=>{
      const env={...process.env}, oldFetch=globalThis.fetch;
      t.after(()=>{process.env=env;globalThis.fetch=oldFetch;delete globalThis.__receiptSql;});
      for(const name of ['DATABASE_URL','SUPABASE_DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_KEY','SUPABASE_ANON_KEY']) delete process.env[name];
      if(adapter==='rest') {process.env.SUPABASE_URL='https://receipt-test.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='fake';}
      const key=crypto.randomUUID();let calls=0;
      const execute=(actor,operationKey,payments)=>{
        calls++;
        assert.equal(actor,7);assert.equal(operationKey,key);assert.deepEqual(payments,[payment]);
        if(scenario==='conflict') throw Object.assign(new Error('private details'),{code:'PT409'});
        if(scenario==='transport failure') throw new Error('private details');
        return {payments:[{accountReceivable:{id:1,balance_cents:7000},receipt:{id:99,amount_cents:3000}}]};
      };
      globalThis.__receiptSql=async(strings,...values)=>{
        const query=strings.join('?');
        if(query.includes('app_sessions')) return [{id:7,role:'user',active:true}];
        assert.match(query,/SELECT public.receive_payments/);
        return [{result:execute(values[0],values[1],JSON.parse(values[2]))}];
      };
      globalThis.fetch=async(input,options)=>{
        assert.equal(adapter,'rest');
        const url=new URL(input);assert.equal(url.origin,'https://receipt-test.invalid');
        if(url.pathname==='/rest/v1/app_sessions') return Response.json([{userId:7,expiresAt:'2099-01-01'}]);
        if(url.pathname==='/rest/v1/app_users') return Response.json([{id:7,role:'user',active:true}]);
        assert.equal(url.pathname,'/rest/v1/rpc/receive_payments');assert.equal(options.method,'POST');
        const args=JSON.parse(options.body);
        try { return Response.json(execute(args.p_actor_id,args.p_key,args.p_payments)); }
        catch(error) { if(error.code) return Response.json({code:error.code,message:error.message},{status:409});throw error; }
      };
      const body={entity:'accountsReceivable',payments:[{...payment,...(scenario==='invalid'?{amountCents:-1}:{})}],actorId:999};
      const headers={'content-type':'application/json','idempotency-key':key};
      if(scenario!=='anonymous') headers.cookie='pino_session=fake';
      const response=await PATCH(new Request('https://receipt-test.invalid/api/finance',{method:'PATCH',headers,body:JSON.stringify(body)}));
      const expected={success:200,anonymous:401,invalid:400,conflict:409,'transport failure':503}[scenario];
      assert.equal(response.status,expected);
      assert.equal(calls,['anonymous','invalid'].includes(scenario)?0:1);
      const result=await response.json();
      assert.doesNotMatch(JSON.stringify(result),/private details/);
      if(scenario==='success') assert.deepEqual(result,{payments:[{accountReceivable:{id:1,balanceCents:7000},receipt:{id:99,amountCents:3000}}]});
    });
  }
}

test('browser retries uncertain and successful submissions with the same key, but new balances get a new key',async(t)=>{
  const oldFetch=globalThis.fetch, descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  const values=new Map(),requests=[];
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
  t.after(()=>{globalThis.fetch=oldFetch;if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);else delete globalThis.sessionStorage;});
  globalThis.fetch=async(url,options)=>{
    requests.push(options);
    if(requests.length===1)throw Error('response lost');
    return Response.json({payments:[]});
  };
  await assert.rejects(submitReceipts(7,[payment]),/response lost/);
  await submitReceipts(7,[payment]);await submitReceipts(7,[payment]);
  assert.equal(requests[0].headers['idempotency-key'],requests[1].headers['idempotency-key']);
  assert.equal(requests[1].headers['idempotency-key'],requests[2].headers['idempotency-key']);
  await submitReceipts(7,[{...payment,expectedBalanceCents:7000}]);
  assert.notEqual(requests[2].headers['idempotency-key'],requests[3].headers['idempotency-key']);
});
