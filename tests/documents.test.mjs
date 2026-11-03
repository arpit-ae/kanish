import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {handleDocuments,hashDocumentPin,detectDocumentType,documentPage} from '../documents-api.js';
import worker from '../worker.js';
const realFetch=globalThis.fetch;
const pepper='tests-only-0123456789012345678901234567890123456789';
const upin='Test-admin-321';
const env={DOCS_SUPABASE_URL:'https://documentsonly.supabase.co',SUPABASE_URL:'https://existing.supabase.co',DOCS_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test_only',DOCS_VPIN_LOOKUP_KEY:pepper,DOCS_ADMIN_UPIN_HASH:await hashDocumentPin(upin,pepper)};
const png=new Uint8Array([137,80,78,71,13,10,26,10,0]);
let records,objects,requests,allow,failStore;
beforeEach(()=>{
  records=[];objects=new Map();requests=[];allow=true;failStore=false;
  globalThis.fetch=async(url,init={})=>{
    assert.equal(init.redirect,'manual','Workerd requires supported redirect mode; credentials must not follow redirects');
    const u=new URL(url);requests.push({url:String(url),init});
    if(u.pathname.startsWith('/rest/')||u.pathname.startsWith('/storage/')&&!u.search){
      assert.equal(init.headers.apikey,env.DOCS_SUPABASE_SERVICE_ROLE_KEY);assert.equal(init.headers.Authorization,undefined);
    }
    if(u.pathname==='/rest/v1/rpc/docs_take_attempt')return Response.json(allow);
    if(u.pathname==='/rest/v1/documents'){
      if(init.method==='POST'){
        const doc=JSON.parse(init.body);if(records.some(v=>v.vpin_lookup_hash===doc.vpin_lookup_hash))return new Response('',{status:409});
        records.push(doc);return new Response(null,{status:201});
      }
      const selected=records.filter(r=>(!u.searchParams.get('id')||'eq.'+r.id===u.searchParams.get('id'))&&(!u.searchParams.get('vpin_lookup_hash')||'eq.'+r.vpin_lookup_hash===u.searchParams.get('vpin_lookup_hash')));
      if(init.method==='PATCH'){for(const r of selected)Object.assign(r,JSON.parse(init.body));return new Response(null,{status:204});}
      if(init.method==='DELETE'){records=records.filter(r=>!selected.includes(r));return new Response(null,{status:204});}
      return Response.json(selected.filter(r=>!u.searchParams.has('ready')||r.ready));
    }
    if(u.pathname.includes('/object/sign/')){
      if(init.method==='POST')return Response.json({signedURL:'/object/sign/private-documents/signed-document?token=server-only'});
      return new Response(png,{headers:{'Content-Type':'image/png','Accept-Ranges':'bytes'}});
    }
    if(u.pathname.startsWith('/storage/v1/object/')){
      if(init.method==='POST'){if(failStore)return new Response('',{status:500});objects.set(u.pathname,init.body);return new Response(null,{status:200});}
      return new Response(null,{status:200});
    }
    throw new Error('Unexpected upstream '+url);
  };
});
after(()=>{globalThis.fetch=realFetch;});
function request(path,body,extra={}){return new Request('https://site.test/api/documents/'+path,{method:'POST',body,headers:{'CF-Connecting-IP':'127.0.0.1',...extra}});}
async function upload(vpin='Test-vpin-123',pin=upin,data=png,type='image/png'){
  const form=new FormData();form.set('upin',pin);form.set('vpin',vpin);form.set('document',new File([data],'../private.png',{type}));
  return handleDocuments(request('upload',form),env);
}
test('fails closed with missing or existing-project configuration',async()=>{
  for(const e of [{},{...env,DOCS_SUPABASE_URL:env.SUPABASE_URL}])assert.equal((await handleDocuments(request('verify','{}'),e)).status,503);
  assert.equal(requests.length,0);
});
test('rejects cross-origin, unsupported methods and oversized requests',async()=>{
  assert.equal((await handleDocuments(request('verify','{}',{Origin:'https://evil.test'}),env)).status,403);
  assert.equal((await handleDocuments(new Request('https://site.test/api/documents/upload'),env)).status,405);
  assert.equal((await handleDocuments(request('verify','x'.repeat(1025)),env)).status,413);
});
test('persistent rate limiting fails closed before authorization/storage',async()=>{
  allow=false;const r=await upload();assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'600');assert.equal(records.length,0);
});
test('wrong UPIN and disguised file cannot store data',async()=>{
  assert.equal((await upload('Test-vpin-123','wrong-admin')).status,401);
  assert.equal((await upload('Test-vpin-123',upin,new TextEncoder().encode('<svg/>'))).status,400);
  assert.equal(records.length,0);assert.equal(objects.size,0);
});
test('stores only hashes, unique VPIN cannot overwrite, failure rolls reservation back',async()=>{
  assert.equal((await upload()).status,201);const first=structuredClone(records[0]);
  assert.equal(first.ready,true);assert.ok(!JSON.stringify(first).includes('Test-vpin-123'));assert.match(first.vpin_hash,/^pbkdf2-sha256-peppered/);
  assert.equal((await upload()).status,409);assert.deepEqual(records,[first]);
  failStore=true;assert.equal((await upload('Another-vpin-123')).status,502);assert.equal(records.length,1);
});
test('VPIN opens same-origin inline preview, cookie-bound link and explicit attachment',async()=>{
  await upload();const r=await handleDocuments(request('verify',JSON.stringify({vpin:'Test-vpin-123'})),env);
  assert.equal(r.status,200);const data=await r.json();const cookie=r.headers.get('Set-Cookie');
  assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.match(data.documentUrl,/^\/api\/documents\/view\?token=/);assert.ok(!JSON.stringify(data).includes('supabase.co'));
  assert.equal((await handleDocuments(new Request('https://site.test'+data.documentUrl),env)).status,401);
  const preview=await handleDocuments(new Request('https://site.test'+data.documentUrl,{headers:{Cookie:cookie}}),env);
  assert.equal(preview.status,200);assert.match(preview.headers.get('Content-Disposition'),/^inline/);assert.match(preview.headers.get('Cache-Control'),/no-store/);
  const download=await handleDocuments(new Request('https://site.test'+data.downloadUrl,{headers:{Cookie:cookie}}),env);assert.match(download.headers.get('Content-Disposition'),/^attachment/);
  const tampered=data.documentUrl.replace('token=','token=x');assert.equal((await handleDocuments(new Request('https://site.test'+tampered,{headers:{Cookie:cookie}}),env)).status,401);
});
test('wrong VPIN never issues viewing credentials',async()=>{
  await upload();const r=await handleDocuments(request('verify',JSON.stringify({vpin:'Wrong-vpin-123'})),env);assert.equal(r.status,404);assert.equal(r.headers.get('Set-Cookie'),null);
});
test('clean route preserves asset canonical handling and adds security headers; old routes still work',async()=>{
  let path;const assets={fetch:async(req)=>{path=new URL(req.url).pathname;return new Response('<html>Document centre</html>',{headers:{'Content-Type':'text/html'}});}};
  const page=await documentPage(new Request('https://site.test/documents'),{ASSETS:assets});assert.equal(path,'/documents');assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'self'/);
  assert.equal(documentPage(new Request('https://site.test/about.html'),{ASSETS:assets}),null);
  assert.equal((await worker.fetch(new Request('https://site.test/api/products'),{})).status,200);
  assert.equal((await worker.fetch(new Request('https://site.test/api/invoices'),{})).status,503);
  assert.equal(detectDocumentType(new TextEncoder().encode('%PDF-1.7\nbody\n%%EOF')),'application/pdf');
});
