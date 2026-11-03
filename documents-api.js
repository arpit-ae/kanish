// Documents use only DOCS_* secrets and the separate, private documents project.
const MAX_FILE = 10 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ITERATIONS = 100000; // Workerd's WebCrypto ceiling; keyed pepper protects low-entropy PINs.
const encoder = new TextEncoder();
const cookieName = '__Host-docs-session';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const commonHeaders = {'Cache-Control':'private, no-store, max-age=0', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Robots-Tag':'noindex, nofollow'};
function reply(data, status=200, extra={}) { return Response.json(data,{status,headers:{...commonHeaders,...extra}}); }
function error(message, status=400) { return Object.assign(new Error(message),{status}); }
function b64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
function unb64(value) { return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)); }
function equal(a,b) { if(a.length!==b.length)return false; let d=0; for(let i=0;i<a.length;i++)d|=a[i]^b[i]; return d===0; }
async function hmac(value, secret) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
}
async function derive(pin,salt,pepper) {
  const keyed=await hmac('pin:'+pin,pepper);
  const key=await crypto.subtle.importKey('raw',keyed,'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS},key,256));
}
export async function hashDocumentPin(pin,pepper) {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256-peppered$${ITERATIONS}$${b64(salt)}$${b64(await derive(pin,salt,pepper))}`;
}
async function verifyPin(pin,hash,pepper) {
  const [algorithm,iterations,salt,value]=String(hash).split('$');
  if(algorithm!=='pbkdf2-sha256-peppered'||Number(iterations)!==ITERATIONS) return false;
  try {return equal(await derive(pin,unb64(salt),pepper),unb64(value));} catch{return false;}
}
function config(env) {
  const base=String(env.DOCS_SUPABASE_URL||'').replace(/\/+$/,'');
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base)||base===String(env.SUPABASE_URL||'').replace(/\/+$/,'')) throw error('Document service is awaiting separate-project setup.',503);
  if(!env.DOCS_SUPABASE_SERVICE_ROLE_KEY||!env.DOCS_ADMIN_UPIN_HASH||String(env.DOCS_VPIN_LOOKUP_KEY||'').length<43) throw error('Document service is awaiting secure setup.',503);
  return {base,key:env.DOCS_SUPABASE_SERVICE_ROLE_KEY,bucket:env.DOCS_SUPABASE_BUCKET||'private-documents',pepper:env.DOCS_VPIN_LOOKUP_KEY};
}
async function api(c,path,init={}) {
  const headers={apikey:c.key,...init.headers};
  if(!c.key.startsWith('sb_secret_')) headers.Authorization='Bearer '+c.key;
  // Workerd supports manual/follow, not redirect:error. Never forward secrets to redirects.
  return fetch(c.base+path,{...init,headers,signal:AbortSignal.timeout(20000),redirect:'manual'});
}
async function limitedBody(request,limit) {
  if(Number(request.headers.get('content-length'))>limit) throw error('Request is too large.',413);
  const reader=request.body?.getReader(); if(!reader) throw error('Request body is required.');
  const parts=[];let total=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw error('Request is too large.',413);parts.push(value);}} catch(e){await reader.cancel().catch(()=>{});throw e;}
  return new Blob(parts);
}
async function rateLimit(request,c,action,pinHash='') {
  // Atomic DB counters are shared across isolates and deployments. IPs and PINs are never stored raw.
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const key=b64(await hmac('ip:'+ip,c.pepper));
  const r=await api(c,'/rest/v1/rpc/docs_take_attempt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_ip:key,p_action:action,p_pin:pinHash})});
  if(!r.ok) throw error('Document service could not be reached. Please retry.',503);
  if(await r.json()!==true) throw error('Too many attempts. Please try again in 10 minutes.',429);
}
function pinValid(pin) { return typeof pin==='string'&&/^[A-Za-z0-9!@#$%^&*_-]{8,64}$/.test(pin); }
export function detectDocumentType(bytes) {
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)) return 'image/png';
  if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217) return 'image/jpeg';
  if(bytes.length>=10&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'&&new TextDecoder().decode(bytes.slice(-1024)).includes('%%EOF')) return 'application/pdf';
  return null;
}
function safeName(name,type) {
  const ext=type==='application/pdf'?'pdf':type==='image/png'?'png':'jpg';
  const stem=String(name||'document').replace(/\.[^.]*$/,'').replace(/[^a-z0-9_-]/gi,'-').replace(/-+/g,'-').slice(0,70)||'document';
  return stem+'.'+ext;
}
function objectPath(c,path) {return '/storage/v1/object/'+encodeURIComponent(c.bucket)+'/'+path.split('/').map(encodeURIComponent).join('/');}
async function upload(request,env,c) {
  await rateLimit(request,c,'upload');
  const body=await limitedBody(request,MAX_FILE+65536);
  let form;try{form=await new Response(body,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();}catch{throw error('Invalid upload form.');}
  if([...form.keys()].sort().join(',')!=='document,upin,vpin') throw error('Provide UPIN, VPIN and one document.');
  const upin=form.get('upin'),vpin=form.get('vpin'),file=form.get('document');
  if(!pinValid(upin)||!pinValid(vpin)) throw error('PINs must be 8–64 characters using letters, numbers or !@#$%^&*_- .');
  if(!await verifyPin(upin,env.DOCS_ADMIN_UPIN_HASH,c.pepper)) throw error('Upload authorization was not accepted.',401);
  if(upin===vpin) throw error('Use a VPIN different from the admin UPIN.');
  if(typeof file?.arrayBuffer!=='function'||!file.size||file.size>MAX_FILE||!TYPES.includes(file.type))throw error('Choose a PDF, JPG or PNG up to 10 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),type=detectDocumentType(bytes);
  if(type!==file.type)throw error('File content does not match PDF, JPG or PNG.');
  const id=crypto.randomUUID(),name=safeName(file.name,type),path=id+'/'+name;
  // Unique constraint reserves the VPIN before storing bytes; a pending record cannot be viewed.
  const record={id,storage_path:path,original_name:name,content_type:type,bytes:file.size,vpin_lookup_hash:b64(await hmac('lookup:'+vpin,c.pepper)),vpin_hash:await hashDocumentPin(vpin,c.pepper),ready:false};
  const inserted=await api(c,'/rest/v1/documents',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(record)});
  if(inserted.status===409)throw error('That VPIN is already in use. Choose another.',409);
  if(!inserted.ok)throw error('Unable to register the document.',502);
  let uploaded=false;
  try{
    const stored=await api(c,objectPath(c,path),{method:'POST',headers:{'Content-Type':type,'x-upsert':'false'},body:bytes});
    if(!stored.ok)throw error('Unable to store the document.',502);
    uploaded=true;
    const ready=await api(c,'/rest/v1/documents?id=eq.'+id,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({ready:true})});
    if(!ready.ok)throw error('Unable to finalize the document.',502);
  }catch(e){
    // Compensate only this failed upload, never overwrite an existing document.
    if(uploaded)await api(c,'/storage/v1/object/'+encodeURIComponent(c.bucket),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})}).catch(()=>{});
    await api(c,'/rest/v1/documents?id=eq.'+id,{method:'DELETE'}).catch(()=>{});
    throw e;
  }
  return reply({success:true,message:'Document uploaded.'},201);
}
async function verify(request,env,c) {
  await rateLimit(request,c,'verify');
  let input;try{input=JSON.parse(await (await limitedBody(request,1024)).text());}catch(e){if(e.status)throw e;throw error('Invalid request.');}
  if(!pinValid(input?.vpin))throw error('Enter a valid VPIN (8–64 characters).');
  const lookup=b64(await hmac('lookup:'+input.vpin,c.pepper));
  await rateLimit(request,c,'pin',lookup);
  const r=await api(c,'/rest/v1/documents?select=id,original_name,content_type,vpin_hash&ready=eq.true&vpin_lookup_hash=eq.'+encodeURIComponent(lookup)+'&limit=1');
  if(!r.ok)throw error('Unable to verify the document.',502);
  const rows=await r.json(),doc=rows[0];
  // Dummy KDF keeps misses and incorrect hashes on the same expensive path.
  if(!await verifyPin(input.vpin,doc?.vpin_hash||env.DOCS_ADMIN_UPIN_HASH,c.pepper)||!doc)throw error('VPIN was not accepted.',404);
  const session=b64(crypto.getRandomValues(new Uint8Array(32))),expires=Date.now()+300000;
  const payload=b64(encoder.encode(JSON.stringify({id:doc.id,expires,session:b64(await hmac('session:'+session,c.pepper))})));
  const token=payload+'.'+b64(await hmac('view:'+payload,c.pepper));
  const url='/api/documents/view?token='+token;
  return reply({success:true,fileName:doc.original_name,contentType:doc.content_type,documentUrl:url,downloadUrl:url+'&download=1',expiresAt:expires},200,{'Set-Cookie':`${cookieName}=${session}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=300`});
}
async function view(request,c) {
  const url=new URL(request.url),token=url.searchParams.get('token')||'';
  if(token.length>1024)throw error('Document access has expired. Verify the VPIN again.',401);
  const [payload,signature,...rest]=token.split('.');
  const session=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  let data;try{data=JSON.parse(new TextDecoder().decode(unb64(payload)));}catch{throw error('Verify the VPIN to view this document.',401);}
  let signatureBytes;try{signatureBytes=unb64(signature||'');}catch{throw error('Verify the VPIN again.',401);}
  if(rest.length||!session||!uuid.test(data.id)||!Number.isFinite(data.expires)||data.expires<Date.now()||data.expires>Date.now()+300000||!equal(await hmac('view:'+payload,c.pepper),signatureBytes)||data.session!==b64(await hmac('session:'+session,c.pepper)))throw error('Document access has expired. Verify the VPIN again.',401);
  const r=await api(c,'/rest/v1/documents?select=storage_path,original_name,content_type&id=eq.'+data.id+'&ready=eq.true&limit=1');
  if(!r.ok)throw error('Unable to open the document.',502);
  const [doc]=await r.json();if(!doc||!TYPES.includes(doc.content_type))throw error('Document unavailable.',404);
  const sign=await api(c,objectPath(c,doc.storage_path).replace('/object/','/object/sign/'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});
  if(!sign.ok)throw error('Unable to open the document.',502);
  const signed=await sign.json(),path=signed.signedURL||signed.signedUrl;
  if(typeof path!=='string'||!path.startsWith('/object/sign/'))throw error('Unable to open the document.',502);
  const range=request.headers.get('Range');
  if(range&&!/^bytes=\d+-\d*$/.test(range))throw error('Invalid document range.',416);
  const file=await fetch(c.base+'/storage/v1'+path,{headers:range?{Range:range}:{},signal:AbortSignal.timeout(20000),redirect:'manual'});
  if(![200,206,416].includes(file.status))throw error('Unable to open the document.',502);
  const headers=new Headers({...commonHeaders,'Content-Type':doc.content_type,'Content-Disposition':`${url.searchParams.get('download')==='1'?'attachment':'inline'}; filename="${safeName(doc.original_name,doc.content_type)}"`,'Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'; sandbox"});
  for(const key of ['Content-Length','Content-Range','Accept-Ranges'])if(file.headers.has(key))headers.set(key,file.headers.get(key));
  return new Response(file.body,{status:file.status,headers});
}
export async function handleDocuments(request,env) {
  try{
    const url=new URL(request.url);
    if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)throw error('Use the document centre on this website.',403);
    if(request.headers.get('Sec-Fetch-Site')==='cross-site')throw error('Use the document centre on this website.',403);
    const routes={'/api/documents/upload':upload,'/api/documents/verify':verify};
    if(url.pathname==='/api/documents/view'){
      if(request.method!=='GET')return reply({success:false,message:'Method not allowed.'},405,{Allow:'GET'});
      return await view(request,config(env));
    }
    if(!routes[url.pathname])throw error('Not found.',404);
    if(request.method!=='POST')return reply({success:false,message:'Method not allowed.'},405,{Allow:'POST'});
    return await routes[url.pathname](request,env,config(env));
  }catch(e){return reply({success:false,message:e.status?e.message:'Document service could not be reached. Please retry.'},e.status||502,e.status===429?{'Retry-After':'600'}:{});}
}
export function documentPage(request,env) {
  const url=new URL(request.url),pages={'/documents':'/documents.html','/upload':'/upload.html','/verify':'/verify.html'};
  if(!pages[url.pathname]&&!Object.values(pages).includes(url.pathname))return null;
  return (async()=>{
    const asset=await env.ASSETS.fetch(new Request(url,{method:request.method,headers:request.headers}));
    const headers=new Headers(asset.headers);
    for(const [k,v]of Object.entries(commonHeaders))headers.set(k,v);
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; frame-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    return new Response(asset.body,{status:asset.status,headers});
  })();
}
