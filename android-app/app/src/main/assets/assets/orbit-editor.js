'use strict';
const KEY='usoa-domestic-invoice-v1';
const INVOICE = 'Tax Invoice';
const CHALLAN = 'Delivery Challan';
const PREFIX = { [INVOICE]: 'INV', [CHALLAN]: 'DEV' };
const DEFAULT_NUMBERS = { [INVOICE]: 'INV-001', [CHALLAN]: 'DEV-001' };
const TERMS = "1. Goods once sold are non-returnable, subject to applicable law.\n2. Payment shall be made within the agreed period.\n3. GST shall be applicable as per government regulations.\n4. Any discrepancy must be reported within 7 days of delivery.\n5. Subject to Muzaffarpur jurisdiction, where legally applicable.";
const DECLARATION = "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.";
const SUPPLIER_EMAIL = "usoagroup@gmail.com";
const SUPPLIER_GSTIN = "10PUSPK6683J1ZQ";
const STAMP_SIGNATORY = "USOA GROUP";
const PREVIOUS_INVOICE_TERMS = 'Please pay by the agreed due date and quote the invoice number.\nCheck goods on delivery and report any issues promptly.\nJurisdiction: Competent courts in Muzaffarpur, Bihar, subject to applicable law.';
const CHALLAN_TERMS = 'Please check goods on delivery and report any issues promptly.\nJurisdiction: Competent courts in Muzaffarpur, Bihar, subject to applicable law.';
const PREVIOUS_TERMS = "1. Please make payment by the due date shown on this invoice, or as otherwise agreed in writing.\n2. Please mention the invoice number when making payment and share the payment reference for reconciliation.\n3. Please check the quantity and visible condition of goods at delivery and report any shortage, damage or billing discrepancy promptly, with supporting details.\n4. Returns, replacements and refunds will be handled as agreed in writing and subject to applicable law.\n5. Any change to the order, delivery or payment terms should be confirmed in writing by both parties.\n6. This invoice does not limit any rights or remedies available under applicable law.\nThank you for your business.";
const states=[['01','Jammu and Kashmir'],['02','Himachal Pradesh'],['03','Punjab'],['04','Chandigarh'],['05','Uttarakhand'],['06','Haryana'],['07','Delhi'],['08','Rajasthan'],['09','Uttar Pradesh'],['10','Bihar'],['11','Sikkim'],['12','Arunachal Pradesh'],['13','Nagaland'],['14','Manipur'],['15','Mizoram'],['16','Tripura'],['17','Meghalaya'],['18','Assam'],['19','West Bengal'],['20','Jharkhand'],['21','Odisha'],['22','Chhattisgarh'],['23','Madhya Pradesh'],['24','Gujarat'],['26','Dadra and Nagar Haveli and Daman and Diu'],['27','Maharashtra'],['29','Karnataka'],['30','Goa'],['31','Lakshadweep'],['32','Kerala'],['33','Tamil Nadu'],['34','Puducherry'],['35','Andaman and Nicobar Islands'],['36','Telangana'],['37','Andhra Pradesh'],['38','Ladakh']];
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n),r2=n=>Math.round((n+Number.EPSILON)*100)/100;
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const item=()=>({description:'',hsn:'',qty:1,unit:'Nos',rate:0,discount:0,gst:18});
function fresh(){return {version:1,mode:INVOICE,number:DEFAULT_NUMBERS[INVOICE],numbers:{...DEFAULT_NUMBERS},date:today(),due:'',pos:'',posManual:false,reverse:'No',seller:{"name":"USOA GROUP","address":"SHIVRAHA CHATURBHUJ, JHAPAHA, 842004, MUZAFFARPUR, BIHAR","gstin":"10PUSPK6683J1ZQ","state":"10","contact":"+919142703535 | usoagroup@gmail.com"},buyer:{name:'',address:'',gstin:'',state:'',contact:''},items:[item()],round:true,bank:"BANK OF BARODA BRANCH ZEROMILE, MUZAFFARPUR | USOA GROUP",account:"55160200000727",ifsc:"BARB0ZERMUZ",upi:'',paid:0,notes:TERMS,signatory:STAMP_SIGNATORY,delivery:''}}

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const isState = code => states.some(([stateCode]) => stateCode === code);
const gstState = gstin => GSTIN.test(gstin) && isState(gstin.slice(0, 2)) ? gstin.slice(0, 2) : '';
const stateOptions = [['', 'Select state'], ...states.map(([code, name]) => [code, `${name} (${code})`])];

function normalize(o) {
  if (!o || o.version !== 1 || !Array.isArray(o.items) || o.items.length > 500) {
    throw Error('Invalid invoice backup');
  }
  const d = fresh();
  for (const key of Object.keys(d)) {
    if (['seller', 'buyer', 'items', 'numbers'].includes(key)) continue;
    if (typeof o[key] === typeof d[key]) d[key] = o[key];
  }
  if (!Object.hasOwn(PREFIX, d.mode)) d.mode = INVOICE;
  for (const mode of Object.keys(PREFIX)) {
    if (typeof o.numbers?.[mode] === 'string') d.numbers[mode] = o.numbers[mode].slice(0, 16);
  }
  if (typeof o.number === 'string' && o.number.trim()) {
    const isOldChallanDefault = !o.numbers && d.mode === CHALLAN && o.number === DEFAULT_NUMBERS[INVOICE];
    if (!isOldChallanDefault) d.numbers[d.mode] = o.number.slice(0, 16);
  }
  d.number = d.numbers[d.mode];
  for (const party of ['seller', 'buyer']) {
    for (const key of Object.keys(d[party])) {
      if (typeof o[party]?.[key] === 'string') d[party][key] = o[party][key].slice(0, 10000);
    }
    d[party].gstin = d[party].gstin.trim().toUpperCase();
    const code = gstState(d[party].gstin);
    d[party].state = code || (isState(d[party].state) ? d[party].state : '');
  }
  const emptyBuyer = !['name', 'address', 'gstin'].some(key => d.buyer[key].trim());
  if (!o.numbers && emptyBuyer && d.pos === d.buyer.state) d.buyer.state = '';
  d.posManual = typeof o.posManual === 'boolean' ? o.posManual :
    isState(o.pos) && isState(o.buyer?.state) && o.pos !== o.buyer.state;
  d.pos = d.posManual && isState(d.pos) ? d.pos : d.buyer.state;

  d.items = o.items.map(line => {
    const row = item();
    for (const key of Object.keys(row)) {
      const value = line?.[key];
      if (typeof row[key] === 'string') row[key] = String(value ?? '').slice(0, 10000);
      else row[key] = Math.max(0, Math.min(['discount', 'gst'].includes(key) ? 100 : 1e9, Number(value) || 0));
    }
    return row;
  });
  if (!d.items.length) d.items = [item()];
  d.seller.contact = d.seller.contact.replace(
    /(^|[\s|,;])prakritihoney@gmail\.com(?=$|[\s|,;])/gi,
    (_, separator) => separator + SUPPLIER_EMAIL
  );
  if (typeof o.notes !== 'string' || d.notes === PREVIOUS_TERMS || d.notes === PREVIOUS_INVOICE_TERMS) {
    d.notes = d.mode === CHALLAN ? CHALLAN_TERMS : TERMS;
  }
  d.paid = Math.max(0, Math.min(1e12, d.paid));
  return d;
}
let data=fresh();let storageOK=true;
let online = {id:null, revision:0, dirty:false};
try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    data = normalize(saved);
    if (saved.online?.id && Number.isSafeInteger(saved.online.revision)) online = saved.online;
  }
} catch { storageOK = false; }

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({...data, online}));
    storageOK = true;
  } catch { storageOK = false; }
  $('status').textContent = !storageOK ? 'Device storage unavailable · download a backup' :
    online.revision && !online.dirty ? 'Saved online and on this device' :
    online.revision ? 'Changes on this device · save online to sync' : 'Draft on this device';
}
function save() { online.dirty = true; persist(); }
function detachBill() { online = {id:null, revision:0, dirty:true}; }
function setPartyState(party, code) {
  data[party].state = code;
  $(party + '-state').value = code;
  if (party === 'buyer' && !data.posManual) {
    data.pos = code;
    $('meta-pos').value = code;
  }
}

function changeMode(previous) {
  data.numbers[previous] = data.number;
  data.number = data.numbers[data.mode];
  $('meta-number').value = data.number;
  if (data.notes === TERMS || data.notes === CHALLAN_TERMS) {
    data.notes = data.mode === CHALLAN ? CHALLAN_TERMS : TERMS;
    $('payment-notes').value = data.notes;
  }
}

function field(container, key, label, type = 'text', options = null, full = false, target = container) {
  const group = ['seller', 'buyer'].includes(container) ? data[container] : data;
  const l = document.createElement('label');
  l.textContent = label;
  if (full) l.className = 'span';
  const el = document.createElement(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
  el.id = container + '-' + key;
  if (!options && type !== 'textarea') el.type = type;
  if (options) {
    for (const [value, title] of options) {
      const op = document.createElement('option');
      op.value = value;
      op.textContent = title;
      el.append(op);
    }
  }
  el.value = group[key];
  if (type === 'number') {
    el.min = 0;
    el.step = '0.01';
  }
  if (key === 'number') el.maxLength = 16;
  if (key === 'gstin' || key === 'ifsc') el.autocapitalize = 'characters';
  if (type === 'number') el.inputMode = 'decimal';
  if (key === 'gstin') el.maxLength = 15;

  el.addEventListener('input', () => {
    const previous = group[key];
    group[key] = type === 'number' ? Math.max(0, Number(el.value) || 0) : el.value;
    if (key === 'gstin') {
      group[key] = el.value.trim().toUpperCase();
      el.value = group[key];
      const code = gstState(group[key]);
      if (code) setPartyState(container, code);
    }
    if (key === 'state') setPartyState(container, el.value);
    if (key === 'pos') {
      data.posManual = Boolean(el.value);
      if (!data.posManual) {
        data.pos = data.buyer.state;
        el.value = data.pos;
      }
    }
    if (key === 'mode' && previous !== data.mode) changeMode(previous);
    if (key === 'number') data.numbers[data.mode] = data.number;
    save();
    render();
  });
  l.append(el);
  $(target).append(l);
}
function setup() {
  for (const id of ['meta', 'seller', 'buyer', 'payment', 'optional']) $(id).replaceChildren();

  field('meta', 'mode', 'Document type', 'text', [[INVOICE, 'Tax invoice'], [CHALLAN, 'Delivery challan']]);
  field('meta', 'number', 'Invoice / challan number');
  field('meta', 'date', 'Issue date', 'date');
  field('meta', 'pos', 'Place of supply · State / code', 'text', stateOptions);

  field('buyer', 'name', 'Buyer name');
  field('buyer', 'gstin', 'GSTIN (blank for unregistered buyer)');
  field('buyer', 'address', 'Address & PIN code', 'textarea');
  field('buyer', 'state', 'State / code', 'text', stateOptions);

  field('seller', 'name', 'Business name');
  field('seller', 'gstin', 'Seller GSTIN');
  field('seller', 'address', 'Address & PIN code', 'textarea');
  field('seller', 'state', 'State / code', 'text', stateOptions);
  field('seller', 'contact', 'Phone / email (optional)', 'text', null, true);

  for (const [key, label, type] of [
    ['bank', 'Bank & branch', 'text'],
    ['account', 'Account number', 'text'],
    ['ifsc', 'IFSC', 'text'],
    ['upi', 'UPI ID (optional)', 'text'],
    ['paid', 'Amount received ₹', 'number'],
    ['signatory', 'Authorised signatory name', 'text'],
    ['notes', 'Terms & conditions', 'textarea'],
  ]) {
    field('payment', key, label, type, null, type === 'textarea');
  }

  field('meta', 'due', 'Due date (optional)', 'date', null, false, 'optional');
  field('meta', 'reverse', 'Reverse charge', 'text', [['No', 'No'], ['Yes', 'Yes']], false, 'optional');
  field('buyer', 'contact', 'Buyer phone / email (optional)', 'text', null, false, 'optional');
  field('payment', 'delivery', 'Delivery address, if different (optional)', 'textarea', null, true, 'optional');

  $('round').checked = data.round;
  drawItems();
  render();
  $('status').textContent = !storageOK ? 'Device storage unavailable · download a backup' :
    online.revision && !online.dirty ? 'Saved online and on this device' : 'Draft on this device';
}
const itemLabels = {description:'Description', hsn:'HSN / SAC', qty:'Quantity', unit:'Unit', rate:'Rate ₹', discount:'Discount %', gst:'GST %'};

function drawItems() {
  const body = $('items').tBodies[0];
  body.replaceChildren();
  data.items.forEach((line, index) => {
    const tr = body.insertRow();
    tr.dataset.item = 'Item ' + (index + 1);
    for (const [key, label] of Object.entries(itemLabels)) {
      const cell = tr.insertCell();
      cell.dataset.label = label;
      const input = document.createElement('input');
      input.setAttribute('aria-label', label + ' for item ' + (index+1));
      input.className = key;
      input.value = line[key];
      if (typeof line[key] === 'number') {
        input.type = 'number';
        input.inputMode = 'decimal';
        input.min = 0;
        input.max = ['discount','gst'].includes(key) ? 100 : 1e9;
        input.step = key === 'qty' ? '0.001' : '0.01';
      }
      input.addEventListener('input', () => {
        line[key] = input.type === 'number' ? Math.min(Number(input.max), Math.max(0, Number(input.value) || 0)) : input.value;
        save(); render();
      });
      cell.append(input);
    }
    const value = tr.insertCell();
    value.id = 'line-' + index;
    value.dataset.label = 'Taxable value';
    value.className = 'num';
    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.className = 'remove';
    remove.setAttribute('aria-label', 'Remove item ' + (index+1));
    remove.onclick = () => {
      data.items.splice(index, 1);
      if (!data.items.length) data.items.push(item());
      drawItems(); save(); render();
    };
    tr.insertCell().append(remove);
  });
}
function bounded(value,max){const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(0,n)):0;}
function calculate(d){const known=isState(d.seller.state)&&isState(d.pos),intra=known&&d.seller.state===d.pos;let gross=0,discount=0,taxable=0,cgst=0,sgst=0,igst=0;const lines=d.items.map(x=>{const qty=bounded(x.qty,1e9),rate=bounded(x.rate,1e9),gst=bounded(x.gst,100),g=r2(qty*rate),disc=r2(g*bounded(x.discount,100)/100),base=r2(Math.max(0,g-disc)),c=intra?r2(base*gst/200):0,s=c,it=known&&!intra?r2(base*gst/100):0;gross+=g;discount+=disc;taxable+=base;cgst+=c;sgst+=s;igst+=it;return {g,disc,base,c,s,it,tax:r2(c+s+it),total:r2(base+c+s+it)}});const pre=r2(taxable+cgst+sgst+igst),grand=d.round?Math.round(pre):pre;return {known,intra,lines,gross:r2(gross),discount:r2(discount),taxable:r2(taxable),cgst:r2(cgst),sgst:r2(sgst),igst:r2(igst),pre,round:r2(grand-pre),grand,balance:r2(grand-d.paid)}}
const ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'],tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function intWords(n){if(n<20)return ones[n]||'Zero';if(n<100)return tens[Math.floor(n/10)]+(n%10?' '+ones[n%10]:'');for(const [v,w] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand'],[100,'Hundred']])if(n>=v)return intWords(Math.floor(n/v))+' '+w+(n%v?' '+intWords(n%v):'')}
function words(n){const p=Math.round(n*100),ru=Math.floor(p/100),pa=p%100;return 'Indian Rupees '+intWords(ru)+(pa?' and '+intWords(pa)+' Paise':'')+' Only'}
function state(c){return isState(c) ? states.find(s=>s[0]===c)[1]+' ('+c+')' : 'State not selected'}
function issues(){const a=[];if(!data.number||!/^[A-Za-z0-9/-]{1,16}$/.test(data.number))a.push('Enter a document number of 1–16 letters, digits, / or -.');if(!data.date)a.push('Enter an issue date.');if(!isState(data.pos))a.push('Select the place of supply to calculate GST.');for(const p of ['seller','buyer']){if(!data[p].name.trim()||!data[p].address.trim())a.push(`Complete ${p} name and address.`);if(!isState(data[p].state))a.push(`Select ${p} state.`);const g=data[p].gstin;if(p==='seller'&&!g&&data.mode==='Tax Invoice')a.push('Enter seller GSTIN for a GST tax invoice.');if(g&&(!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)||g.slice(0,2)!==data[p].state))a.push(`Check ${p} GSTIN format and state code.`)}if(data.items.some(x=>!x.description.trim()||x.qty<=0))a.push('Each item needs a description and quantity greater than zero.');if(data.mode==='Tax Invoice'&&data.items.some(x=>!x.hsn.trim()))a.push('Enter the applicable HSN / SAC for each item.');if(data.reverse==='Yes')a.push('Reverse charge selected: displayed GST is informational and excluded from the amount payable.');return a}
function row(label,val,cls=''){return `<div class="totalrow ${cls}"><span>${label}</span><strong>${money(val)}</strong></div>`}
function approval(challan) {
  const showStamp = false;
  const signature = showStamp
    ? `<img class="sign-stamp" src="${STAMP_IMAGE}" width="610" height="409" alt="USOA GROUP stamp and USOA GROUP’s signature">`
    : `<strong>${esc(data.signatory || data.seller.name)}</strong>`;
  const declaration = challan ? '' :
    `<section class="declaration"><h3>Declaration</h3><div>${esc(DECLARATION)}</div></section>`;

  return `<div class="document-approval">
    ${declaration}
    <div class="signature">${signature}<div>Authorised signatory</div></div>
  </div>`;
}

function render(){const c=calculate(data),challan=data.mode==='Delivery Challan',rc=data.reverse==='Yes';let pay=rc?c.taxable:c.pre;let grand=data.round?Math.round(pay):pay;let rounding=r2(grand-pay),balance=r2(grand-data.paid);const tax=!c.known?'':c.intra?row('CGST',c.cgst)+row('SGST / UTGST',c.sgst):row('IGST',c.igst);const totals=row('Subtotal',c.gross)+(c.discount?row('Discount',-c.discount):'')+row('Taxable value',c.taxable)+tax+(rc?row('GST payable by recipient',-(c.cgst+c.sgst+c.igst)):'')+row('Round off',rounding)+row(challan?'Declared value':'Grand total',grand,'grand')+(!challan?row('Amount received',data.paid)+row(balance<0?'Overpayment':'Balance due',Math.abs(balance)):'');$('totals').innerHTML=totals;$('running-amount').textContent=money(grand);$('document-ref').textContent=data.number||'Unnumbered';$('amount-label').textContent=challan?'Declared value':'Grand total';$('taxhint').textContent=(!c.known?'Select seller state and place of supply to calculate GST.':c.intra?'Same state · CGST + SGST / UTGST':'Interstate · IGST')+(challan?' · Values shown for declaration.':'');c.lines.forEach((x,i)=>{if($('line-'+i))$('line-'+i).textContent=money(x.base)});const warnings=issues();$('warnings').hidden=!warnings.length;$('warnings').textContent=warnings.join('\n');const party=(p,title)=>`<div><div class="tag">${title}</div><div class="name">${esc(p.name||'Business / customer name')}</div><div class="address">${esc(p.address||'Address & PIN code')}</div><div>GSTIN: ${esc(p.gstin||'Unregistered / not entered')}</div><div>${esc(state(p.state))}</div>${p.contact?`<div>${esc(p.contact)}</div>`:''}</div>`;let rates={};data.items.forEach((x,i)=>{const k=String(x.gst);if(!rates[k])rates[k]={base:0,c:0,s:0,it:0};for(const f of ['base','c','s','it'])rates[k][f]=r2(rates[k][f]+c.lines[i][f])});const bank=[['Bank',data.bank],['Account',data.account],['IFSC',data.ifsc],['UPI',data.upi]].filter(x=>x[1]).map(x=>`<div><strong>${x[0]}:</strong> ${esc(x[1])}</div>`).join('');$('paper').innerHTML=`<div class="document-body"><div class="top"><div><div class="tag">Domestic India</div><h2>${esc(data.mode)}</h2>${challan?'<div>For movement of goods · not a tax invoice</div>':''}</div><div><strong>${esc(data.number)}</strong><div>Issue date: ${esc(data.date)}</div>${data.due?`<div>Due date: ${esc(data.due)}</div>`:''}<div>Place of supply: ${esc(state(data.pos))}</div><div>Reverse charge: ${esc(data.reverse)}</div></div></div><div class="parties">${party(data.seller,'From / Seller')}${party(data.buyer,'Bill to / Buyer')}</div>${data.delivery?`<p><strong>Deliver to:</strong> ${esc(data.delivery)}</p>`:''}<div class="preview-table" tabindex="0" aria-label="Invoice items"><table><thead><tr><th style="width:5%">#</th><th style="width:23%">Description</th><th style="width:11%">HSN/SAC</th><th class="num">Qty / Unit</th><th class="num">Rate ₹</th><th class="num">Disc %</th><th class="num">GST %</th><th class="num">Taxable ₹</th><th class="num">GST ₹</th></tr></thead><tbody>${data.items.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.description)}</td><td data-label="HSN / SAC">${esc(x.hsn)}</td><td class="num" data-label="Qty / Unit">${esc(x.qty)} ${esc(x.unit)}</td><td class="num" data-label="Rate">${money(x.rate)}</td><td class="num" data-label="Discount %">${esc(x.discount)}</td><td class="num" data-label="GST %">${esc(x.gst)}</td><td class="num" data-label="Taxable value">${money(c.lines[i].base)}</td><td class="num" data-label="GST amount">${money(c.lines[i].tax)}</td></tr>`).join('')}</tbody></table></div></div><div class="document-summary"><div class="words"><strong>Amount in words:</strong> ${esc(words(grand))}</div>${c.known?`<table><thead><tr><th>GST rate</th><th class="num">Taxable value</th>${c.intra?'<th class="num">CGST rate / amount</th><th class="num">SGST / UTGST rate / amount</th>':'<th class="num">IGST rate / amount</th>'}</tr></thead><tbody>${Object.entries(rates).map(([r,x])=>`<tr><td>${esc(r)}%</td><td class="num">${money(x.base)}</td>${c.intra?`<td class="num">${Number(r)/2}% / ${money(x.c)}</td><td class="num">${Number(r)/2}% / ${money(x.s)}</td>`:`<td class="num">${esc(r)}% / ${money(x.it)}</td>`}</tr>`).join('')}</tbody></table>` : ''}<div class="bottom"><div>${bank?'<h3>Payment details</h3>'+bank:''}${data.notes?'<h3 class="terms-heading">TERMS &amp; CONDITIONS</h3><div class="address">'+esc(data.notes)+'</div>':''}</div><div>${totals}</div></div>${approval(challan)}<div class="foot">${challan?'Delivery challan — not a demand for payment.':'All amounts in Indian Rupees (INR).'}${rc?' GST payable by recipient under reverse charge.':''}</div></div>`}
$('add').onclick=()=>{if(data.items.length>=500)return alert('Maximum 500 rows.');data.items.push(item());drawItems();save();render();$('items').tBodies[0].lastElementChild.querySelector('input').focus()};$('round').onchange=e=>{data.round=e.target.checked;save();render()};$('print').onclick=()=>{const a=issues().filter(x=>!x.startsWith('Reverse charge'));if(a.length&&!confirm('Some details need attention:\n\n'+a.join('\n')+'\n\nPrint this draft anyway?'))return;document.title=data.number+' - '+data.mode;AndroidExport.print()};
function download(content,name,type){if(window.AndroidExport){AndroidExport.save(content,name,type);return;}const u=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}
$('backup').onclick=()=>download(JSON.stringify(data,null,2),(data.number||'invoice').replace(/[^a-z0-9_-]/gi,'-')+'.json','application/json');$('restore').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>5*1024*1024)throw Error('File too large');const next=normalize(JSON.parse(await f.text()));if(confirm('Replace the current draft with this backup?')){detachBill();data=next;setup();save()}}catch(err){alert('Could not restore: '+err.message)}e.target.value=''};function nextNumber(mode, number) {
  const match = new RegExp('^' + PREFIX[mode] + '-(\\d{1,9})$').exec(number);
  return match ? PREFIX[mode] + '-' + String(Number(match[1]) + 1).padStart(3, '0') : '';
}

$('new').onclick = () => {
  if (!confirm('Start a new document? Save to history or download a backup first if you need this draft.')) return;
  const previous = data;
  detachBill();
  data = fresh();
  data.mode = previous.mode;
  data.numbers = { ...previous.numbers, [data.mode]: nextNumber(data.mode, previous.number) };
  data.number = data.numbers[data.mode];
  data.notes = data.mode === CHALLAN ? CHALLAN_TERMS : TERMS;
  data.seller = { ...previous.seller };
  for (const key of ['bank', 'account', 'ifsc', 'upi', 'signatory']) data[key] = previous[key];
  $('extra-details').open = false;
  setup();
  save();
};
// Supplier stamp used in the preview and print layout.
const STAMP_IMAGE = "";
setup();
