import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({entryPoints:['lib/piece-types.ts'],outfile:'.sites-runtime/piece-types-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
const {savePieceType,validateProductType}=await import('../.sites-runtime/piece-types-test.mjs');
test('registered types reject duplicates and unknown names, preserve inactive assignments and allow renames',async()=>{
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://types-test.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
 const rows=[{id:1,name:'Pino',active:true},{id:2,name:'Bucha',active:false}];
 globalThis.fetch=async(url,options={})=>{
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/products'))return Response.json([{piece_type:'Bucha'}]);
  assert.ok(parsed.pathname.endsWith('/piece_types'));
  if(options.method==='POST'){const row={id:3,active:true,...JSON.parse(options.body)};rows.push(row);return Response.json([row]);}
  if(options.method==='PATCH'){const row=rows.find(x=>'eq.'+x.id===parsed.searchParams.get('id'));Object.assign(row,JSON.parse(options.body));return Response.json([row]);}
  return Response.json(rows);
 };
 try{
  await assert.rejects(()=>savePieceType({name:' pino '}),e=>e.status===409);
  await assert.rejects(()=>validateProductType('Inexistente'));
  await assert.rejects(()=>validateProductType('Bucha'));
  assert.equal(await validateProductType('Bucha',27),'Bucha');
  assert.equal((await savePieceType({name:'  Eixo  especial '})).name,'Eixo especial');
  assert.equal((await savePieceType({id:1,name:'Pino reforçado'},true)).name,'Pino reforçado');
  await assert.rejects(()=>validateProductType('Pino'));
  assert.equal(await validateProductType('Pino reforçado'),'Pino reforçado');
  await savePieceType({id:1,active:false},true);
  await assert.rejects(()=>validateProductType('Pino reforçado'));
 }finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});
