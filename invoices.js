// Final invoices use a server-only Supabase key. No credential is sent to browsers.
const MAX_BODY = 3 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fieldNames = ('title company address ie gst fssai uam apeda mandi nbb nbbreg phone mobile email buyer buyeraddr exim pan supply inv code freight payment incoterms loading discharge shipment contact contactno bankname account branch ifsc adcode swift jurisdiction website supplyType exportTax nameFont date').split(' ');
const rowNames = 'desc hsn qty unit rate gst packs range netWt grossWt'.split(' ');
function reply(data, status = 200) {
  return Response.json(data, {status, headers:{'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}});
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function text(value) { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''; }
export function validateInvoice(data) {
  const doc = data?.document;
  if (!doc || !doc.fields || !Array.isArray(doc.rows)) throw new Error('Invoice details are required.');
  const fields = Object.fromEntries(fieldNames.map(k => [k, text(doc.fields[k])]));
  const number = text(data.invoice_number), date = text(data.invoice_date);
  if (!number || number.length > 100 || /[\x00-\x1f]/.test(number)) throw new Error('Enter an invoice number (up to 100 characters).');
  if (!validDate(date)) throw new Error('Enter a valid invoice date.');
  if (!fields.buyer || !fields.buyeraddr) throw new Error('Enter the buyer name and address.');
  if (fields.buyer.length > 300 || Object.values(fields).some(v => v.length > 10000)) throw new Error('Invoice text is too long.');
  if (!doc.rows.length || doc.rows.length > 200) throw new Error('Add between 1 and 200 items.');
  const rows = doc.rows.map((row, i) => {
    const r = Object.fromEntries(rowNames.map(k => [k, text(row?.[k])]));
    if (!r.desc || r.desc.length > 10000 || !r.qty || !Number.isFinite(Number(r.qty)) || Number(r.qty) <= 0 || !r.rate || !Number.isFinite(Number(r.rate)) || Number(r.rate) < 0 || !Number.isFinite(Number(r.gst)) || Number(r.gst) < 0 || Number(r.gst) > 100) throw new Error(`Item ${i+1}: enter a description, positive quantity, non-negative rate and valid GST.`);
    if (Object.values(r).some(v => v.length > 10000) || !Number.isFinite(Number(r.qty)*Number(r.rate))) throw new Error(`Item ${i+1} is too large.`);
    return r;
  });
  if (fields.freight && (!Number.isFinite(Number(fields.freight)) || Number(fields.freight) < 0)) throw new Error('Freight must be a non-negative amount.');
  const sig = doc.sig || null;
  if (sig && (typeof sig !== 'string' || sig.length > 2800000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(sig))) throw new Error('Use a smaller PNG or JPG signature.');
  fields.inv = number; fields.date = date; fields.title = 'INVOICE';
  return {invoice_number:number, invoice_date:date, buyer_name:fields.buyer, document:{fields,rows,sig}};
}
async function database(env, query, init = {}) {
  const key = env.SUPABASE_SECRET_KEY.trim();
  const headers = {apikey:key, 'Content-Type':'application/json', ...init.headers};
  // Modern sb_secret keys are API keys, not JWTs. Legacy compatibility is temporary.
  if (!key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + key;
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/invoices?' + query, {...init,headers,signal:AbortSignal.timeout(15000)});
  return {response, body:await response.json().catch(() => null)};
}
export async function handleInvoices(request, env) {
  const url = new URL(request.url);
  if (![env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,env.INVOICE_ACCESS_CODE].every(v => typeof v === 'string' && v.trim())) return reply({success:false,message:'Invoice storage is not configured. Contact the site administrator.'},503);
  if (request.headers.get('x-invoice-access-code') !== env.INVOICE_ACCESS_CODE) return reply({success:false,message:'Incorrect invoice access code. Please try again.'},401);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return reply({success:false,message:'Use the invoice page on this website.'},403);
  try {
    if (request.method === 'GET') {
      const id = url.searchParams.get('id'), number = url.searchParams.get('number');
      const params = new URLSearchParams();
      if (id || number) {
        if (id && !uuid.test(id)) return reply({success:false,message:'Invalid invoice ID.'},400);
        params.set('select','*'); params.set(id ? 'id' : 'invoice_number','eq.'+(id || number)); params.set('limit','1');
      } else {
        const offset = Math.max(0,Math.min(1000000,parseInt(url.searchParams.get('offset'),10)||0));
        const q = (url.searchParams.get('q')||'').slice(0,100).replace(/[^\p{L}\p{N}\s/_.-]/gu,' ').trim();
        params.set('select','id,invoice_number,invoice_date,buyer_name,updated_at');
        params.set('order','updated_at.desc,id.desc'); params.set('limit','31'); params.set('offset',String(offset));
        if(q) params.set('or',`(invoice_number.ilike.*${q.replace(/_/g,'\\_')}*,buyer_name.ilike.*${q.replace(/_/g,'\\_')}*)`);
      }
      const {response,body} = await database(env,params,{method:'GET'});
      if (!response.ok || !Array.isArray(body)) return reply({success:false,message:'Could not read saved invoices. Please retry.'},502);
      return reply({success:true,invoices:body.slice(0,30),has_more:body.length>30});
    }
    if (request.method === 'POST' || request.method === 'PATCH') {
      if (Number(request.headers.get('content-length')) > MAX_BODY) return reply({success:false,message:'Invoice is too large. Use a smaller signature image.'},413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY) return reply({success:false,message:'Invoice is too large. Use a smaller signature image.'},413);
      let data, payload;
      try { data = JSON.parse(raw); payload = validateInvoice(data); } catch (e) { return reply({success:false,message:e instanceof SyntaxError ? 'Invalid invoice data.' : e.message},400); }
      const params = new URLSearchParams({select:'*'});
      if (request.method === 'PATCH') {
        if (!uuid.test(data.id || '') || typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at))) return reply({success:false,message:'Reopen the saved invoice before updating it.'},400);
        params.set('id','eq.'+data.id); params.set('updated_at','eq.'+data.updated_at);
      }
      const {response,body} = await database(env,params,{method:request.method,headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});
      if (response.status === 409) return reply({success:false,message:'This invoice number already exists. Open it from Saved Invoices to edit it, or choose a new number.'},409);
      if (!response.ok || !Array.isArray(body)) return reply({success:false,message:'Could not save the invoice. Please retry.'},502);
      if (!body[0]) return reply({success:false,message:'This invoice changed on another device. Reopen it before saving; your current draft is still here.'},409);
      return reply({success:true,invoice:body[0]},request.method === 'POST' ? 201 : 200);
    }
    return reply({success:false,message:'Method not allowed.'},405);
  } catch { return reply({success:false,message:'Invoice storage could not be reached. Your draft is still in this browser; please retry.'},502); }
}

