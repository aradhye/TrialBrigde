# TrialBridge (backend prototype)

Zero-dependency Node 18+ app: a small API server plus the TrialBridge web UI.

## Run
```
cp .env.example .env      # paste your TinyFish key (free at agent.tinyfish.ai/api-keys)
node server.js            # then open http://localhost:3000
```

## What each part does
- `GET /api/trials` searches ClinicalTrials.gov API v2 by condition, location and status.
- `GET /api/research?id=NCT…` runs TinyFish Search (public pages outside the registry), then TinyFish Fetch (rendered pages as Markdown), and extracts study IDs, contact lines and status hints.
- `POST /api/saved` stores a snapshot. `GET /api/saved?check=1` re-fetches each trial and reports what changed (status, sites, age/sex limits, edited criteria). `POST /api/saved/:id/ack` marks changes as reviewed.
- Saved studies live in `data/store.json`, keyed by an anonymous browser id. For production, replace `readDb`/`writeDb` in `server.js` with Supabase/Postgres.

## Not built yet
- LLM explanations (plain language is a glossary lookup in `public/index.html`).
- Accounts, notifications, hosting config for Vercel.
