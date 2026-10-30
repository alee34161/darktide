# darktide-api setup

Run these from the `darktide-api` folder on your PC. Wrangler is Cloudflare's
command-line tool; `npx` runs it from this folder, nothing global is installed.

1. `npm install`
2. `npx wrangler login` (opens the browser once to sign in to Cloudflare)
3. `npx wrangler d1 create darktide`. It prints a `database_id`.
4. Copy `wrangler.example.jsonc` to `wrangler.jsonc` (git-ignored). Paste the
   `database_id`, and put your webapp's address in `ALLOWED_ORIGINS`
   (for example `https://your-site.pages.dev`).
5. `npm run db:init` creates the tables in the remote database.
6. Make an upload token and store it as a Worker secret:
   - `python -c "import secrets; print(secrets.token_urlsafe(32))"`
   - `npx wrangler secret put UPLOAD_TOKEN` and paste the token when asked.
7. `npm run deploy`. It prints the Worker URL, e.g. `https://darktide-api.<you>.workers.dev`.

Then:
- **Uploader `.env`:** `DT_API_URL=<Worker URL>` and `DT_UPLOAD_TOKEN=<the token>`.
- **Webapp:** set `VITE_API_URL=<Worker URL>` in Cloudflare and redeploy. Delete
  `VITE_SHEET_ID` and `VITE_API_KEY`.
- **Old data:** `python migrate_from_sheets.py --dry-run`, then `python migrate_from_sheets.py`.

Local testing: `npm run db:init:local`, put `UPLOAD_TOKEN="any-test-value"` in
`.dev.vars` (git-ignored), then `npm run dev`.
