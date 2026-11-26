'use strict';
const dialog=$('cloud-dialog');
function selectView(preview){document.body.classList.toggle('previewing',preview);$('edit-view').setAttribute('aria-pressed',String(!preview));$('preview-view').setAttribute('aria-pressed',String(preview));}
$('edit-view').onclick=()=>selectView(false);$('preview-view').onclick=()=>selectView(true);$('restore-button').onclick=()=>$('restore').click();$('new').addEventListener('click',()=>selectView(false));
function archive(){const problems=issues().filter(x=>!x.startsWith('Reverse charge'));if(problems.length)return alert(problems.join('\n'));AndroidExport.archive('domestic',JSON.stringify(data));}
$('save-online').onclick=archive;
$('saved-bills').onclick=()=>{const list=$('bill-list');list.replaceChildren();let entries=JSON.parse(AndroidExport.history('domestic'));for(const entry of entries){const d=JSON.parse(entry.payload);const btn=document.createElement('button');btn.textContent=d.mode+' | '+d.number+' | '+d.date+' | '+(d.buyer.name||'No buyer');btn.style.cssText='display:block;width:100%;margin:8px 0;text-align:left';btn.onclick=()=>{if(confirm('Open this record? Current draft will be replaced.')){data=normalize(d);detachBill();setup();save();dialog.close();}};list.append(btn);}if(!entries.length)list.textContent='No saved documents yet.';dialog.showModal();};
$('close-cloud').onclick=()=>dialog.close();

window.AndroidFlush=persist;window.AndroidArchive=archive;window.AndroidRestore=raw=>{try{data=normalize(JSON.parse(raw));detachBill();setup();save();}catch(e){alert('Invalid record');}};

const reserveButton=document.createElement('button');reserveButton.textContent='Reserve device number';reserveButton.onclick=()=>{if(!confirm('Reserve a new number only for an unissued draft?'))return;const n=AndroidExport.reserveNumber(data.mode===CHALLAN?'challan':'gst',data.date);if(n.startsWith('!'))return alert(n.slice(1));data.number=n;data.numbers[data.mode]=n;setup();save();};$('new').after(reserveButton);

/* Local encrypted business masters. No data is sent to a third party by this editor. */
const masterDialog=document.createElement('dialog');
masterDialog.style.cssText='width:min(95vw,650px);max-height:80vh;overflow:auto;border:1px solid #bbb;border-radius:14px;padding:16px';
document.body.append(masterDialog);
function masterNode(tag,text,parent=masterDialog){const el=document.createElement(tag);if(text!==null)el.textContent=text;parent.append(el);return el;}
function masterAction(label,fn,parent=masterDialog){const b=masterNode('button',label,parent);b.type='button';b.style.margin='4px';b.onclick=fn;return b;}
function masterTitle(title){masterDialog.replaceChildren();masterNode('h2',title);masterAction('Close',()=>masterDialog.close());}
function masterList(kind){
    masterTitle(kind==='customer'?'Customer master':'Product master');
    masterNode('p','Local encrypted register. Cloud transfer of master entries is not enabled in this build.');
    const result=AndroidExport.masters(kind);
    if(result.startsWith('!')){masterNode('p',result.slice(1));return;}
    let rows;
    try{rows=JSON.parse(result);}catch(e){masterNode('p','Invalid master register');return;}
    const current=kind==='customer'?{...data.buyer}:{...data.items[0]};
    masterAction('Add new entry',()=>masterEditor(kind,'',{}));
    masterAction(kind==='customer'?'Save current buyer':'Save first invoice item',()=>masterEditor(kind,'',current));
    if(!rows.length)masterNode('p','No saved entries.');
    for(const entry of rows){
        const div=masterNode('div',null);div.style.cssText='border-top:1px solid #ddd;padding:8px 0';
        const v=entry.value;
        masterNode('strong',kind==='customer'?v.name:v.description,div);
        masterNode('p',kind==='customer'?(v.gstin||'Unregistered')+' · '+v.state:v.unit+' · '+money(v.rate)+' · GST '+v.gst+'%',div);
        masterAction('Use in draft',()=>{
            if(kind==='customer'){
                if(!confirm('Replace current buyer with this customer?'))return;
                data.buyer={...data.buyer,...v};if(!data.posManual)data.pos=v.state;
            }else{
                const next={...item(),...v,qty:1,discount:0};
                if(data.items.length===1&&!data.items[0].description.trim())data.items[0]=next;
                else{if(data.items.length>=500)return alert('Maximum 500 rows');data.items.push(next);}
            }
            setup();save();masterDialog.close();
        },div);
        masterAction('Edit',()=>masterEditor(kind,entry.id,v),div);
    }
}
function masterEditor(kind,id,value){
    masterTitle((id?'Edit ':'New ')+kind);
    const fields=kind==='customer'?[['name','Name'],['address','Address and PIN'],['gstin','GSTIN'],['state','State code'],['contact','Phone / email']]:[['description','Description'],['hsn','HSN/SAC'],['unit','Unit'],['rate','Rate INR'],['gst','GST %']];
    const inputs={};
    for(const [key,label] of fields){
        const row=masterNode('label',label);row.style.cssText='display:block;margin:8px 0';
        const el=document.createElement(key==='state'?'select':key==='address'?'textarea':'input');
        if(key==='state')for(const [code,name] of stateOptions){const opt=document.createElement('option');opt.value=code;opt.textContent=name;el.append(opt);}
        if(['rate','gst'].includes(key)){el.type='number';el.min=0;el.step='0.01';el.max=key==='gst'?100:1e9;}
        el.value=value[key]??(key==='gst'?18:key==='rate'?0:key==='unit'?'Nos':'');
        el.style.cssText='display:block;width:100%;padding:7px';row.append(el);inputs[key]=el;
    }
    masterAction('Save entry',()=>{
        const payload=Object.fromEntries(Object.entries(inputs).map(([k,el])=>[k,['rate','gst'].includes(k)?Number(el.value):el.value]));
        const result=AndroidExport.saveMaster(kind,id,JSON.stringify(payload));
        if(result.startsWith('!'))return alert(result.slice(1));
        masterList(kind);
    });
    masterAction('Back',()=>masterList(kind));
}
const masterBar=document.createElement('div');masterBar.style.cssText='display:flex;gap:4px;flex-wrap:wrap;margin:8px 0';$('new').after(masterBar);
masterAction('Customers',()=>{masterList('customer');masterDialog.showModal();},masterBar);
masterAction('Products',()=>{masterList('product');masterDialog.showModal();},masterBar);
