(() => {
  const message = document.querySelector("#form-message");
  let pdfTask,expiryTimer;
  const viewer=document.querySelector('#document-viewer');
  const pdf=document.querySelector('#pdf-viewer');
  const image=document.querySelector('#image-viewer');
  const download=document.querySelector('#download-link');
  const previewStatus=document.querySelector('#preview-status');
  async function clearViewer() {
    clearTimeout(expiryTimer);
    if(pdfTask){await pdfTask.destroy().catch(()=>{});pdfTask=null;}
    if(viewer)viewer.hidden=true;
    if(pdf){pdf.replaceChildren();pdf.hidden=true;}
    if(image){image.removeAttribute('src');image.hidden=true;}
    if(download)download.removeAttribute('href');
    if(previewStatus)previewStatus.textContent='';
  }
  async function previewPdf(url) {
    const pdfjs=await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';
    // Render pages as canvases, so mobile browsers cannot turn the first view into a download.
    pdfTask=pdfjs.getDocument({url,withCredentials:true,isEvalSupported:false,enableXfa:false,disableAutoFetch:true,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/'});
    const document=await pdfTask.promise;
    pdf.hidden=false;
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);entry.target.renderPage();}
    },{rootMargin:'500px'});
    for(let number=1;number<=document.numPages;number++){
      const wrapper=window.document.createElement('section');wrapper.className='pdf-page';wrapper.setAttribute('aria-label',`Page ${number} of ${document.numPages}`);
      const label=window.document.createElement('p');label.textContent=`Page ${number} / ${document.numPages}`;wrapper.append(label);
      wrapper.renderPage=async()=>{
        try{
          const page=await document.getPage(number),base=page.getViewport({scale:1});
          const scale=Math.min((pdf.clientWidth-28)/base.width,1.6),ratio=Math.min(window.devicePixelRatio||1,1.5);
          const viewport=page.getViewport({scale:Math.max(.2,scale)}),canvas=window.document.createElement('canvas');
          canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);
          canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`Document page ${number}`);
          wrapper.append(canvas);await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:null}).promise;page.cleanup();
        }catch{label.textContent=`Page ${number} could not load. Verify the VPIN again to refresh access.`;}
      };
      pdf.append(wrapper);if(number===1)await wrapper.renderPage();else observer.observe(wrapper);
    }
  }
  const setMessage = (text, type = "") => { if (message) { message.textContent = text; message.className = `form-message ${type}`; } };

  const uploadForm = document.querySelector("#upload-form");
  if (uploadForm) {
    uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = uploadForm.querySelector("button[type=submit]");
      const formData = new FormData(uploadForm);
      const file = formData.get("document");
      if(!uploadForm.reportValidity())return;
      if (!file || !file.size) return setMessage("Choose a document to upload.", "error");
      if (file.size > 10 * 1024 * 1024) return setMessage("The document must be 10 MB or smaller.", "error");
      submit.disabled = true; setMessage("Uploading and protecting your document…");
      try {
        const response = await fetch("/api/documents/upload", { method: "POST", body: formData });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Upload failed. Please try again.");
        uploadForm.reset(); setMessage("Document uploaded successfully. Keep the VPIN safe; it cannot be recovered.", "success");
      } catch (error) { setMessage(error.message, "error"); }
      finally { submit.disabled = false; }
    });
  }

  const verifyForm = document.querySelector("#verify-form");
  if (verifyForm) {
    const submit = verifyForm.querySelector("button[type=submit]");

    function prefillVpin() {
      if (submit.disabled) return;
      const params = new URLSearchParams(window.location.hash.slice(1));
      const vpin = params.get("vpin");
      if (vpin === null) return;

      // A QR carries the VPIN in a fragment, which is omitted from HTTP requests.
      const verifyUrl = new URL(window.location.href);
      verifyUrl.hash = "";
      window.history.replaceState(window.history.state, "", verifyUrl);
      if (/^[A-Za-z0-9!@#$%^&*_-]{8,64}$/.test(vpin)) {
        verifyForm.elements.namedItem("vpin").value = vpin;
        if (params.get("auto") === "1") {
          verifyForm.requestSubmit();
        } else {
          setMessage("VPIN filled from the QR link. Select Verify and view document to continue.");
        }
      }
    }

    verifyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled || !verifyForm.reportValidity()) return;
      const vpin = new FormData(verifyForm).get("vpin");
      submit.disabled = true; setMessage("Verifying secure access…");
      try {
        await clearViewer();
        const response = await fetch("/api/documents/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vpin }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Verification failed.");
        document.querySelector("#document-name").textContent = result.fileName;
        download.href = result.downloadUrl; download.download = result.fileName;
        viewer.hidden = false;
        if (result.contentType === "application/pdf") {
          previewStatus.textContent='Opening PDF inside this page…';
          try {await previewPdf(result.documentUrl);previewStatus.textContent='PDF opened below. Access lasts 5 minutes; verify again to refresh.';}
          catch{previewStatus.textContent='PDF preview could not open. The PDF may be encrypted or damaged. Verify again or use Download document.';}
        } else {
          image.src=result.documentUrl;image.hidden=false;
          image.onerror=()=>{previewStatus.textContent='Image preview could not load. Verify again to refresh access.';};
        }
        expiryTimer=setTimeout(async()=>{await clearViewer();setMessage('Secure access expired. Enter your VPIN again to reopen the document.');},Math.max(0,result.expiresAt-Date.now()));
        viewer.scrollIntoView({ behavior: "smooth", block: "start" });
        verifyForm.reset(); setMessage("Document verified. It is displayed below; download only if needed.", "success");
      } catch (error) { setMessage(error.message, "error"); }
      finally {
        submit.disabled = false;
        prefillVpin();
      }
    });
    prefillVpin();
    window.addEventListener("hashchange", prefillVpin);
  }
})();
