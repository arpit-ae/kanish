# Secure documents setup

This feature is isolated from the website's existing Supabase project. Use only the newly created documents Supabase project.

1. In that project's SQL editor, run `supabase-documents-schema.sql`.
2. The schema creates the private `private-documents` bucket, permissions and atomic rate limiter.
3. Set the following Cloudflare Worker secrets (never commit them or place them in browser code):
   - `DOCS_SUPABASE_URL` — project URL
   - `DOCS_SUPABASE_SERVICE_ROLE_KEY` — project service-role key
   - `DOCS_ADMIN_UPIN_HASH` — peppered PBKDF2 hash generated with `hashDocumentPin` in `documents-api.js`
   - `DOCS_VPIN_LOOKUP_KEY` — a cryptographically random secret of at least 32 bytes
4. Keep `DOCS_SUPABASE_BUCKET=private-documents` and `DOCS_MAX_UPLOAD_BYTES=10485760` as Worker variables, unless a different private bucket or limit is intentionally needed.

The Worker requires a project URL different from the existing `SUPABASE_URL`. It supports modern `sb_secret_` keys and legacy service-role JWTs. Never reuse the existing invoice project or key.

PINs use salted, peppered PBKDF2-SHA256 at Workerd's supported 100,000 iterations. The HMAC pepper is stored only in backend secrets; database dumps alone cannot be used to guess PINs. An HMAC lookup plus a database unique constraint ensures unique VPINs. Each upload accepts only one PDF/JPG/PNG up to 10 MB, with signature checks. File-type detection is not malware scanning; authorized uploaders should use trusted documents.

The atomic database limiter allows 100 upload attempts or 10 verification requests per IP per ten-minute bucket, 6 lookups per VPIN and 120 requests globally per action per bucket. Upload attempts include incorrect UPIN submissions. It fails closed when unavailable. IP addresses are HMAC hashes and counters are pruned after one day. Fixed buckets can allow a burst across a boundary; this is intentionally separate from Cloudflare's optional edge abuse controls.

After verification the browser receives same-origin URLs valid for five minutes, bound to an HttpOnly/Secure/SameSite cookie. Supabase signed URLs last sixty seconds and remain server-side. The backend sets inline disposition for viewing and attachment only for explicit download requests. PDF.js 6.5.438 renders canvases inside `/verify` on desktop and mobile. Image previews are inline. All new document responses use no-store, no-referrer and nosniff. VPINs never appear in URLs, logs, local storage or browser bundles.

The existing Cloudflare Git integration deploys `main`. Vercel routes use the shared backend through `api/server.js`; configure the same DOCS_* variables there only if Vercel is used. Free Workers have CPU/storage limits: validate real uploads after configuring the project. Account-wide quotas and free-project inactivity pauses can affect availability.

Keep the generated initial UPIN privately. It cannot be recovered from its stored hash. To rotate it, use a secure local prompt and the exported `hashDocumentPin(pin, DOCS_VPIN_LOOKUP_KEY)` function, then update only `DOCS_ADMIN_UPIN_HASH`. Rotating the lookup key invalidates existing VPIN lookups and sessions; retain it securely.

Add each value through the Cloudflare dashboard's Worker **Settings → Variables and Secrets**, or `wrangler secret put NAME`. Do not paste the initial UPIN, service-role key, or generated hash into GitHub issues, commits, or chat.
