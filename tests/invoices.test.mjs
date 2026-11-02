import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {handleInvoices,validateInvoice} from '../invoices.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_TEST',INVOICE_ACCESS_CODE:'test-code'};
const id='00000000-0000-0000-0000-000000000001';
const good=()=>({invoice_number:'INV/2026-27/001',invoice_date:'2026-11-02',document:{fields:{buyer:'QA buyer',buyeraddr:'QA address',inv:'INV/2026-27/001',date:'2026-11-02',freight:'0'},rows:[{desc:'Honey',qty:'2',rate:'100',gst:'18'}]}});
const request=(method='POST',body=good(),query='',code='test-code')=>new Request('https://example.com/api/invoices'+query,{method,headers:{'X-Invoice-Access-Code':code,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)});
const realFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=realFetch;});
test('accept valid date and item; normalize stored invoice labels',()=>{const p=validateInvoice(good());assert.equal(p.document.fields.title,'INVOICE');assert.equal(p.invoice_date,'2026-11-02');});
test('reject impossible dates, blank buyer/address/items, invalid numeric amounts',()=>{
 for(const change of [p=>p.invoice_date='2026-02-30',p=>p.document.fields.buyer='',p=>p.document.fields.buyeraddr='',p=>p.document.rows=[],p=>p.document.rows[0].desc='',p=>p.document.rows[0].qty='0',p=>p.document.rows[0].qty='NaN',p=>p.document.rows[0].rate='',p=>p.document.rows[0].rate='-2',p=>p.document.rows[0].gst='101']){const p=good();change(p);assert.throws(()=>validateInvoice(p));}
});
test('missing config and incorrect access code fail without database access',async()=>{globalThis.fetch=()=>{throw Error('must not fetch');};assert.equal((await handleInvoices(request(),{})).status,503);assert.equal((await handleInvoices(request('GET',null,'','wrong'),env)).status,401);});
test('create uses secret key header without invalid JWT; never upserts',async()=>{globalThis.fetch=async(url,init)=>{assert.equal(init.headers.apikey,'sb_secret_TEST');assert.equal(init.headers.Authorization,undefined);assert.equal(init.method,'POST');assert.ok(!String(url).includes('on_conflict'));assert.ok(!init.headers.Prefer.includes('merge'));return Response.json([{id,...good()}],{status:201});};const res=await handleInvoices(request(),env);assert.equal(res.status,201);assert.equal(res.headers.get('cache-control'),'no-store');});
test('duplicate invoice cannot overwrite existing data',async()=>{globalThis.fetch=async()=>Response.json({code:'23505'},{status:409});assert.equal((await handleInvoices(request(),env)).status,409);});
test('edit filters id and previous update time; stale writes fail',async()=>{const p={...good(),id,updated_at:'2026-11-02T18:00:00.000Z'};globalThis.fetch=async(url,init)=>{const u=new URL(url);assert.equal(u.searchParams.get('id'),'eq.'+id);assert.equal(u.searchParams.get('updated_at'),'eq.'+p.updated_at);assert.equal(init.method,'PATCH');return Response.json([]);};assert.equal((await handleInvoices(request('PATCH',p),env)).status,409);});
test('search is escaped, paginated and excludes document payloads',async()=>{globalThis.fetch=async url=>{const u=new URL(url);assert.equal(u.searchParams.get('offset'),'30');assert.equal(u.searchParams.get('limit'),'31');assert.ok(!u.searchParams.get('select').includes('document'));assert.ok(!u.searchParams.get('or').includes(',id.eq'));return Response.json(Array.from({length:31},()=>({id})));};const res=await handleInvoices(request('GET',null,'?q=Honey&offset=30'),env);const data=await res.json();assert.equal(data.invoices.length,30);assert.equal(data.has_more,true);});
test('validation enforced on API before any upstream call',async()=>{globalThis.fetch=()=>{throw Error('must not fetch');};const p=good();p.document.rows=[];assert.equal((await handleInvoices(request('POST',p),env)).status,400);});
test('database errors are safe and do not expose upstream details',async()=>{globalThis.fetch=async()=>Response.json({message:'secret internals'},{status:500});const res=await handleInvoices(request(),env);assert.equal(res.status,502);assert.ok(!(await res.text()).includes('secret internals'));});
test('final invoice script compiles; final labels and backup import agree',()=>{const html=fs.readFileSync(new URL('../b.html',import.meta.url),'utf8');const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];new vm.Script(script);assert.ok(!/Valid Until|validUntil|PI\/YYYY/.test(html));assert.ok(html.includes('o.app !== "usoa-final-invoice"'));assert.ok(html.includes('INV/YYYY-YY/001'));});

