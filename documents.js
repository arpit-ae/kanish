(() => {
  const message = document.querySelector("#form-message");
  const setMessage = (text, type = "") => { if (message) { message.textContent = text; message.className = `form-message ${type}`; } };

  const uploadForm = document.querySelector("#upload-form");
  if (uploadForm) {
    uploadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = uploadForm.querySelector("button[type=submit]");
      const formData = new FormData(uploadForm);
      const file = formData.get("document");
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
    verifyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = verifyForm.querySelector("button[type=submit]");
      submit.disabled = true; setMessage("Verifying secure access…");
      try {
        const response = await fetch("/api/documents/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vpin: new FormData(verifyForm).get("vpin") }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Verification failed.");
        const viewer = document.querySelector("#document-viewer");
        const pdf = document.querySelector("#pdf-viewer");
        const image = document.querySelector("#image-viewer");
        document.querySelector("#document-name").textContent = result.fileName;
        const download = document.querySelector("#download-link"); download.href = result.downloadUrl; download.download = result.fileName;
        if (result.contentType === "application/pdf") { pdf.src = result.documentUrl; pdf.hidden = false; image.hidden = true; image.removeAttribute("src"); }
        else { image.src = result.documentUrl; image.hidden = false; pdf.hidden = true; pdf.removeAttribute("src"); }
        viewer.hidden = false; viewer.scrollIntoView({ behavior: "smooth", block: "start" });
        verifyForm.reset(); setMessage("Document verified. It is displayed below; download only if needed.", "success");
      } catch (error) { setMessage(error.message, "error"); }
      finally { submit.disabled = false; }
    });
  }
})();
