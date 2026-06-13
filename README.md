# LinkedIn Engagement Accountability Audit

A fully static, versioned dashboard for tracking LinkedIn community engagement.
No backend, no build framework required — deploys as-is to Vercel (or any static host).

## How it works

```
/
├─ index.html              ← always serves the LATEST report (a copy of the newest snapshot)
├─ audit.html              ← working/master template (edit the data here)
├─ archive.html            ← auto-lists every historical report from the manifest
├─ build-report.js         ← zero-dependency archival script
└─ reports/
   ├─ manifest.json        ← the index the archive page reads (participation, status, etc.)
   └─ YYYY-MM-DD/
      └─ index.html         ← immutable snapshot of that audit
```

- **Latest at root** — `/index.html` is always a copy of the most recent snapshot.
- **Immutable history** — each `/reports/YYYY-MM-DD/index.html` is a self-contained copy
  (data embedded inline) and is never rewritten once created.
- **Self-describing badge** — every report shows a `Latest` / `Archived` pill, computed
  at runtime by comparing its own date against `reports/manifest.json` — so old snapshots
  stay byte-for-byte immutable yet always display the correct status.
- **Archive page** — `/archive.html` fetches `reports/manifest.json` and lists all reports
  with participation %, audit status, member count, valid post count and generated date.

## Publishing a new audit

1. Update the dataset (`members` / `posts`) in `audit.html`.
2. Generate the snapshot, refresh the root, and update the manifest:

   ```bash
   node build-report.js            # uses today's date
   # or pin a date:
   node build-report.js 2026-06-20
   ```

   The script recomputes metrics directly from the embedded data, so the manifest is
   always accurate.
3. Commit the new files and deploy.

## Local preview

`fetch('/reports/manifest.json')` requires HTTP (it does **not** work over `file://`).
Run any static server from the project root:

```bash
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:3000/` (or your chosen port).

## Deploying to Vercel

No configuration needed — it's static output. Either:

- Drag-and-drop the folder in the Vercel dashboard, or
- `vercel` / connect the Git repo. Vercel serves `/`, `/archive.html`, and
  `/reports/<date>/` directly.
