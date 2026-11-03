# Secure documents setup

This feature is isolated from the website's existing Supabase project. Use only the newly created documents Supabase project.

1. In that project's SQL editor, run `supabase-documents-schema.sql`.
2. In Storage, create a bucket named `private-documents` and leave **Public bucket** off.
3. Set the following Cloudflare Worker secrets (never commit them or place them in browser code):
   - `DOCS_SUPABASE_URL` — project URL
   - `DOCS_SUPABASE_SERVICE_ROLE_KEY` — project service-role key
   - `DOCS_ADMIN_UPIN_HASH` — PBKDF2 hash in the exact format `pbkdf2-sha256$210000$<base64 salt>$<base64 hash>`
   - `DOCS_VPIN_LOOKUP_KEY` — a cryptographically random secret of at least 32 bytes
4. Keep `DOCS_SUPABASE_BUCKET=private-documents` and `DOCS_MAX_UPLOAD_BYTES=10485760` as Worker variables, unless a different private bucket or limit is intentionally needed.

The Worker deliberately has no public Supabase URL/key, no browser Supabase SDK, no public storage bucket, and no route that reveals either PIN. VPINs are stored as salted PBKDF2 hashes; an HMAC lookup value is used only to locate a candidate record. Viewing and downloading each use separate five-minute signed URLs.

Generate the initial UPIN hash locally, never in public chat. Example with Node's interactive prompt:

```powershell
node -e 'const c=require("crypto"),r=require("readline");r.createInterface({input:process.stdin,output:process.stdout}).question("UPIN: ",p=>{const s=c.randomBytes(16),n=210000,h=c.pbkdf2Sync(p,s,n,32,"sha256");console.log("pbkdf2-sha256$"+n+"$"+s.toString("base64")+"$"+h.toString("base64"))})'
```

Add each value through the Cloudflare dashboard's Worker **Settings → Variables and Secrets**, or `wrangler secret put NAME`. Do not paste the initial UPIN, service-role key, or generated hash into GitHub issues, commits, or chat.
