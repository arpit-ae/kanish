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
