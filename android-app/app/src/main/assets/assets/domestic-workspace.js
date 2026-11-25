'use strict';
const dialog=$('cloud-dialog');
function selectView(preview){document.body.classList.toggle('previewing',preview);$('edit-view').setAttribute('aria-pressed',String(!preview));$('preview-view').setAttribute('aria-pressed',String(preview));}
$('edit-view').onclick=()=>selectView(false);$('preview-view').onclick=()=>selectView(true);$('restore-button').onclick=()=>$('restore').click();$('new').addEventListener('click',()=>selectView(false));
function archive(){if(!data.number.trim())return alert('Enter a document number first');AndroidExport.archive('domestic',JSON.stringify(data));}
$('save-online').onclick=archive;
$('saved-bills').onclick=()=>{const list=$('bill-list');list.replaceChildren();let entries=JSON.parse(AndroidExport.history('domestic'));for(const entry of entries){const d=JSON.parse(entry.payload);const btn=document.createElement('button');btn.textContent=d.mode+' | '+d.number+' | '+d.date+' | '+(d.buyer.name||'No buyer');btn.style.cssText='display:block;width:100%;margin:8px 0;text-align:left';btn.onclick=()=>{if(confirm('Open this record? Current draft will be replaced.')){data=normalize(d);detachBill();setup();save();dialog.close();}};list.append(btn);}if(!entries.length)list.textContent='No saved documents yet.';dialog.showModal();};
$('close-cloud').onclick=()=>dialog.close();
