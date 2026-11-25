(() => {
  "use strict";
  const office = "usoagroup@gmail.com";
  const keys = new WeakMap();
  function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function summary(rows) {
    const dl=node("dl","","receipt-lines");
    for (const [label,value] of rows) {
      if (value) dl.append(node("dt",label),node("dd",String(value)));
    }
    return dl;
  }
  function dialog(title, rows, action, review = false, note = "") {
    return new Promise(resolve => {
      const modal = node("dialog","","store-dialog");
      const h=node("h2",title);
      h.id="receipt-"+crypto.randomUUID();
      modal.setAttribute("aria-labelledby",h.id);
      modal.append(node("p","USOA GROUP","receipt-brand"),h,summary(rows));
      if (note) modal.append(node("p",note,"receipt-note"));
      const actions=node("div","","receipt-actions");
      if (review) {
        const edit=node("button","Edit details","receipt-edit");
        edit.type="button"; edit.onclick=()=>modal.close("edit"); actions.append(edit);
      }
      const ok=node("button",action,"receipt-primary");
      ok.type="button"; ok.onclick=()=>modal.close("ok");actions.append(ok);modal.append(actions);
      document.body.append(modal);
      modal.addEventListener("close",()=>{modal.remove();resolve(modal.returnValue==="ok");},{once:true});
      modal.showModal();
    });
  }
  function requestKey(form, details) {
    const signature=JSON.stringify(details);
    if (keys.get(form)?.signature !== signature) keys.set(form,{signature,key:crypto.randomUUID()});
    return keys.get(form).key;
  }
  function receiptToken(id, key) {
    try {
      if (key) sessionStorage.setItem("usoa-receipt-"+id,key);
      return sessionStorage.getItem("usoa-receipt-"+id) || "";
    } catch {return "";}
  }
  const address = d => [d.street,d.city,d.region,d.postcode,d.country].join(", ");
  async function reviewOrder(details,items,total) {
    return dialog("Review your order",[["Items",items],["Total",total],["Deliver to",details.name+" · "+address(details)],
      ["Mobile",details.phone],["Your receipt",details.email],["Business copy",office]],"Continue to Cashfree",true,
      "Sales will email your order confirmation after Cashfree confirms payment.");
  }
  const mailNote= sent => sent ? "Confirmation emails sent to both recipients." : "Your receipt is saved. Confirmation emails are queued for sending.";
  window.StoreReceipts={dialog,requestKey,receiptToken,reviewOrder,mailNote,office,summary};
  document.addEventListener("DOMContentLoaded",()=>{
    const form=document.getElementById("enquiryForm");
    if (!form) return;
    const params=new URLSearchParams(location.search);
    const category=params.get("category");
    const item=params.get("item")?.trim().slice(0,100);
    if (item && !form.elements.message.value) form.elements.message.value="I would like details about "+item+".";
    if (category && Array.from(form.elements.requirement.options).some(o=>o.value===category)) form.elements.requirement.value=category;
    const status=document.getElementById("enquiry-status");
    const submit=form.querySelector('[type="submit"]');
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled=true;
      const details=Object.fromEntries(new FormData(form));
      try {
        const rows=[["Name",details.name],["Requirement",details.requirement],["Quantity",details.quantity],["Delivery location",details.location],
          ["Mobile",details.mobile],["Message",details.message],["Your receipt",details.email],["Business copy",office]];
        if (!await dialog("Review your enquiry",rows,"Confirm and send",true)) return;
        status.textContent="Sending your enquiry…";
        const response=await fetch("/api/enquiries",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({...details,requestKey:requestKey(form,details)})});
        const result=await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Could not send the enquiry.");
        const receiptRows=[["Reference",result.id],["Requirement",details.requirement],["Your receipt",result.email],["Business copy",result.office],["From",result.from]];
        const note=mailNote(result.sent);
        status.replaceChildren(node("strong","Enquiry received"), summary(receiptRows),node("p",note));
        form.reset();keys.delete(form);
        await dialog("Enquiry receipt",receiptRows,"Done",false,note);
      } catch (error) {status.textContent=error.message || "Please try again.";}
      finally {submit.disabled=false;}
    });
  });
})();
