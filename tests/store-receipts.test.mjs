import {test,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "../worker.js";
import {retryMail} from "../store-receipts.js";

const origin="https://usoagroup.in";
const realFetch=globalThis.fetch;
const customer={name:"Store test",email:"buyer@example.test",phone:"9000000000",street:"Test Street 42",city:"Patna",region:"Bihar",postcode:"800001",country:"India"};
let env,db,orders,mails,paid,providerOK,override;
beforeEach(()=>{
  db=new DatabaseSync(":memory:");db.exec(readFileSync(new URL("../store-schema.sql",import.meta.url),"utf8"));
  env={CASHFREE_CLIENT_ID:"local",CASHFREE_CLIENT_SECRET:"test",CASHFREE_ENV:"sandbox",STORE_RECEIPT_MAIL_KEY:"test",
    PORTAL_SUPABASE_URL:"https://portal.example.test",PORTAL_SUPABASE_SECRET_KEY:"test",PORTAL_SUPABASE_PUBLISHABLE_KEY:"test",
    STORE_RECEIPTS:{prepare(sql){const stmt=db.prepare(sql);const run=(args)=>({run:()=>({meta:stmt.run(...args)}),first:()=>stmt.get(...args),all:()=>({results:stmt.all(...args)})});return {...run([]),bind:(...args)=>run(args)};}}};
  orders=new Map();mails=[];paid=false;providerOK=true;override={};
  globalThis.fetch=async(url,options={})=>{
    const path=new URL(url).pathname;
    if (path==="/emails/batch") {
      if (!providerOK) return Response.json({name:"rate_limit"},{status:429});
      mails.push(JSON.parse(options.body));return Response.json({data:[{id:"buyer"},{id:"business"}]});
    }
    if (path==="/auth/v1/user")return Response.json({id:"account",email:customer.email,email_confirmed_at:"today"});
    if (path==="/rest/v1/portal_orders") return new Response(null,{status:201});
    assert.equal(options.headers["x-api-version"],"2025-01-01");
    if (path==="/pg/orders") {
      const order=JSON.parse(options.body);orders.set(order.order_id,order);
      return Response.json({...order,payment_session_id:"session"});
    }
    assert.ok(path.startsWith("/pg/orders/"));
    const order=orders.get(path.split("/").pop());
    return Response.json({...order,order_status:paid?"PAID":"ACTIVE",...override});
  };
});
after(()=>{globalThis.fetch=realFetch;});
async function call(path,body,headers={}) {
  const request=new Request(origin+path, {method:body?"POST":"GET",headers:{Origin:origin,...headers},body:body?JSON.stringify(body):undefined});
  const response=await worker.fetch(request,env);return {status:response.status,...await response.json()};
}
async function webhook(id,signed) {
  const body={data:{order:{order_id:id},payment:{payment_status:"SUCCESS"}}};
  const raw=JSON.stringify(body), timestamp="1730000000";
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode("test"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=Buffer.from(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+raw))).toString("base64");
  return call("/api/cashfree-webhook",body,{"x-webhook-timestamp":timestamp,"x-webhook-signature":signed?sig:"invalid"});
}
test("Enquiry receipt retries a failed send and accepts a duplicate submission only once",async()=>{
  const body={...customer,mobile:customer.phone,requirement:"Honey",message:"Availability for wholesale",requestKey:crypto.randomUUID()};
  providerOK=false;
  const first=await call("/api/enquiries",body);
  assert.equal(first.status,200);assert.equal(first.sent,false);
  providerOK=true;db.exec("UPDATE store_receipts SET next_attempt=0");
  await retryMail(env);
  const second=await call("/api/enquiries",body);
  assert.equal(second.id,first.id);assert.equal(second.sent,true);assert.equal(mails.length,1);
  assert.deepEqual(mails[0].map(m=>m.to[0]),[customer.email,"usoagroup@gmail.com"]);
  assert.match(mails[0][0].from,/contact@usoagroup.in/);
  assert.equal((await call("/api/enquiries",{...body,email:"bad"})).status,400);
});
for(const cart of [false,true]) test((cart?"Account cart":"Guest")+" checkout verifies totals, address, signature, recipients and duplicate payment events",async()=>{
  const requestKey=crypto.randomUUID();
  const body={requestKey,customer,productId:"honey500",items:[{id:"honey500",quantity:2}]};
  const path=cart?"/api/portal/checkout":"/api/create-order";
  const auth=cart?{Authorization:"Bearer test"}:{};
  const bad=await call(path,{...body,customer:{...customer,postcode:"X"}},auth);assert.equal(bad.status,400);
  const order=await call(path,body,auth);assert.equal(order.status,200);
  assert.equal(order.amount,cart?798:399);
  const payload=orders.get(order.order_id);
  assert.equal(payload.order_meta.notify_url,origin+"/api/cashfree-webhook");
  assert.match(payload.order_meta.return_url,/payment-success.html\?order_id=USOA_/);
  const again=await call(path,body,auth);assert.equal(again.order_id,order.order_id);
  const statusPath="/api/order-status?order_id="+order.order_id;
  assert.equal((await call(statusPath)).order_status,"ACTIVE");assert.equal(mails.length,0);
  assert.equal((await webhook(order.order_id,false)).status,401);
  paid=true;
  override={order_currency:"USD"};assert.equal((await webhook(order.order_id,true)).status,503);assert.equal(mails.length,0);override={};
  assert.equal((await webhook(order.order_id,true)).status,200);
  assert.equal((await webhook(order.order_id,true)).status,200);
  assert.equal((await call(statusPath)).receipt,undefined);
  const receipt=(await call(statusPath,null,{"X-Receipt-Key":requestKey})).receipt;
  assert.equal(receipt.email,customer.email);assert.equal(receipt.sent,true);assert.match(receipt.address,/800001/);
  assert.equal(mails.length,1);assert.match(mails[0][0].from,/sales@usoagroup.in/);assert.match(mails[0][1].text,/Test Street 42/);
});
