const office = "usoagroup@gmail.com";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = new Set(["Honey", "Bee Colony Buy / Sell", "Bee Boxes", "Honey Extractor", "Bee Equipment", "Bee Product", "Wholesale", "Export / Import", "Other"]);

function invalid(message, status = 400) {
  return Object.assign(new Error(message), {status});
}
function field(value, min, max, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) throw invalid("Check " + label + ".");
  return text;
}
export function deliveryAddress(customer) {
  const street = field(customer.street, 5, 220, "the street address");
  const city = field(customer.city, 2, 80, "the town or city");
  const region = field(customer.region, 2, 80, "the state or province");
  const postcode = field(customer.postcode, 3, 12, "the postal code");
  const country = field(customer.country, 2, 80, "the country");
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/.test(postcode) ||
      (/^india$/i.test(country) && !/^[1-9]\d{5}$/.test(postcode))) throw invalid("Enter a valid delivery postal code.");
  return [street,city,region,postcode,country].join(", ");
}
export async function receiptById(env, id) {
  return env.STORE_RECEIPTS.prepare("SELECT * FROM store_receipts WHERE id=?").bind(id).first();
}
async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
}
export async function saveReceipt(env, kind, key, id, data, source = "") {
  if (!uuid.test(key || "")) throw invalid("Reload the form and try again.");
  const payload = JSON.stringify(data);
  const db = env.STORE_RECEIPTS;
  const keyHash = await hash(key);
  await db.prepare(`INSERT INTO store_receipts (id,kind,request_key,payload,source_hash,state)
    SELECT ?,?,?,?,?,? WHERE ?!='enquiry' OR
    (SELECT COUNT(*) FROM store_receipts WHERE source_hash=? AND created_at>unixepoch()-3600)<8
    ON CONFLICT(request_key) DO NOTHING`).bind(id,kind,keyHash,payload,source,kind==="order"?"awaiting_payment":"ready",kind,source).run();
  const row = await db.prepare("SELECT * FROM store_receipts WHERE request_key=?").bind(keyHash).first();
  if (!row) throw invalid("Too many enquiries. Please try again later.",429);
  if (row.payload !== payload || row.kind !== kind) throw invalid("This form has changed. Review it and try again.",409);
  return row;
}
export async function mayReadReceipt(request, row) {
  const token = request.headers.get("X-Receipt-Key");
  return Boolean(row && uuid.test(token || "") && await hash(token) === row.request_key);
}
export async function createEnquiry(request, env) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw invalid("Open the enquiry form on this website.",403);
  const body = await request.json().catch(() => {throw invalid("Check the enquiry form.");});
  if (body.website) throw invalid("Unable to accept this enquiry.");
  const email = field(body.email, 3, 254, "the email address").toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw invalid("Enter a valid email address.");
  if (!categories.has(body.requirement)) throw invalid("Select a requirement.");
  const data = {name:field(body.name,2,100,"your name"), email, mobile:field(body.mobile,6,30,"the mobile number"),
    requirement:body.requirement, quantity:field(body.quantity,0,90,"the quantity"),
    location:field(body.location,0,120,"the delivery location"), message:field(body.message,2,1200,"the message")};
  const source = await hash("enquiry:"+(request.headers.get("CF-Connecting-IP") || email));
  const row = await saveReceipt(env,"enquiry",body.requestKey,"ENQ-"+crypto.randomUUID().slice(0,13).toUpperCase(),data,source);
  const sent = await sendReceipt(env,row);
  return {id:row.id, email, office, from:"contact@usoagroup.in", sent};
}
function messages(row) {
  const d = JSON.parse(row.payload);
  const order = row.kind === "order";
  const from = order ? "sales@usoagroup.in" : "contact@usoagroup.in";
  const heading = order ? "Order confirmation" : "Enquiry received";
  const subject = heading + " · " + row.id;
  const summary = order ? [...d.items.map(i=>i.name+" × "+i.quantity+" · INR "+(i.quantity*i.unitPrice).toFixed(2)),
    "Total paid: INR "+d.amount.toFixed(2),"Delivery address: "+d.address].join("\n") : "Requirement: "+d.requirement;
  const base = {from:"USOA GROUP <"+from+">",subject};
  return [
    {...base,to:[d.email],reply_to:from,text:(order?"Thank you for your order. Cashfree has confirmed your payment.":"Thank you for your enquiry. Our team will reply by email.")+
      "\n\nReference: "+row.id+"\n"+summary+"\n\nUSOA GROUP\n"+from},
    {...base,to:[office],reply_to:d.email,text:heading+"\nReference: "+row.id+"\nCustomer: "+d.name+"\nEmail: "+d.email+
      "\nPhone: "+d.mobile+"\n"+summary+(order?"":"\nQuantity: "+(d.quantity||"—")+"\nLocation: "+(d.location||"—")+"\nMessage: "+d.message)}
  ];
}
export async function sendReceipt(env,row) {
  if (row.state === "sent") return true;
  if (row.state !== "ready") return false;
  const db=env.STORE_RECEIPTS;
  const claim=await db.prepare(`UPDATE store_receipts SET attempts=attempts+1, next_attempt=unixepoch()+min(21600,60*(1<<min(attempts,8)))
    WHERE id=? AND state='ready' AND next_attempt<=unixepoch()`).bind(row.id).run();
  if (!claim.meta.changes) return (await receiptById(env,row.id)).state==="sent";
  try {
    const response=await fetch("https://api.resend.com/emails/batch",{method:"POST",headers:{
      Authorization:"Bearer "+env.STORE_RECEIPT_MAIL_KEY,"Content-Type":"application/json","Idempotency-Key":"usoa/"+row.id},
      body:JSON.stringify(messages(row))});
    const result=await response.json();
    if (!response.ok || result.data?.length!==2 || !result.data.every(m=>m.id)) {
      console.error("Receipt mail deferred",row.id,response.status,result.name || "unconfirmed");
      return false;
    }
    await db.prepare("UPDATE store_receipts SET state='sent',mail_ids=? WHERE id=?").bind(JSON.stringify(result.data.map(m=>m.id)),row.id).run();
    return true;
  } catch {console.error("Receipt mail unavailable",row.id);return false;}
}
export async function confirmPaid(env,id,payment) {
  let row=await receiptById(env,id);
  if (!row) return null; // Payments started before receipts were introduced.
  const details=JSON.parse(row.payload);
  if (row.kind!=="order" || payment.order_id!==id || payment.order_status!=="PAID" ||
      payment.order_currency!=="INR" || Math.round(Number(payment.order_amount)*100)!==Math.round(details.amount*100)) throw invalid("Payment details could not be matched.",502);
  if (row.state==="awaiting_payment") {
    await env.STORE_RECEIPTS.prepare("UPDATE store_receipts SET state='ready' WHERE id=? AND state='awaiting_payment'").bind(id).run();
    row=await receiptById(env,id);
  }
  return {sent:await sendReceipt(env,row),row,details};
}
export async function retryMail(env) {
  const pending=await env.STORE_RECEIPTS.prepare("SELECT * FROM store_receipts WHERE state='ready' AND next_attempt<=unixepoch() ORDER BY next_attempt,created_at LIMIT 15").all();
  for (const row of pending.results) await sendReceipt(env,row);
}
