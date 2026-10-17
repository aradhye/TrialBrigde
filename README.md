# TrialBridge

An AI-assisted clinical trial discovery prototype. TrialBridge brings official registry data and extra web research into one place, explains eligibility criteria in plain language, lets you compare studies, and tracks changes to the trials you save.

Built by **Team Brainrot** for **AZINHACK**.

> TrialBridge helps people understand trials. It does not give medical advice and does not decide eligibility. Always confirm with the study team and your doctor using the official registry record.

## The problem

Clinical trial information is scattered across registries, hospital websites and research platforms. Eligibility criteria are written in medical jargon, and recruitment status is often outdated or unclear. Many patients and caregivers never find studies that could be relevant to them.

## Features

- **Search** trials by condition, location and recruitment status, using live ClinicalTrials.gov data.
- **Fit check** based on the age and sex you enter, shown as a simple tag on each result. It is a rough screen, not an eligibility decision.
- **Plain-language eligibility**: inclusion and exclusion criteria rewritten in simple words, with the original text shown underneath.
- **Web research with TinyFish**: finds public pages beyond the registry (hospital sites, news, FAQs) and extracts study IDs, contact lines and recruitment-status hints.
- **Compare** up to three trials side by side, with differences highlighted.
- **Save and track changes**: stores a snapshot of each saved trial and reports later changes to status, sites, age and sex limits, and edited criteria.
- Every trial links back to its official ClinicalTrials.gov record.

## Tech stack

| Part | Technology |
| --- | --- |
| Frontend | Single-page HTML, CSS and vanilla JavaScript (`public/index.html`) |
| Backend | Node.js 18+ HTTP server with no dependencies (`server.js`) |
| Trial records | ClinicalTrials.gov API v2 |
| Web research | TinyFish Search and Fetch APIs |
| Storage | JSON file (`data/store.json`), meant to be replaced by Supabase/PostgreSQL |

## Project structure

```
trialbridge/
├── server.js          Backend: API routes and static file server
├── package.json
├── .env.example       Template for your environment variables
├── README.md
└── public/
    └── index.html     Frontend
```

## Getting started

You need [Node.js](https://nodejs.org) 18 or newer and a free TinyFish API key from [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys).

1. Clone or download this repository and open a terminal in its folder.
2. Create your environment file:
   - Windows: `copy .env.example .env`
   - Mac/Linux: `cp .env.example .env`
3. Open `.env` and replace `your_key_here` with your TinyFish key.
4. Start the server:
   ```
   node server.js
   ```
5. Open http://localhost:3000.

To use another port, set `PORT` in `.env`.

Never commit your `.env` file. It contains your API key.

## API routes

| Route | What it does |
| --- | --- |
| `GET /api/health` | Reports that the server is up and whether a TinyFish key is loaded |
| `GET /api/trials?q=&loc=&status=` | Searches ClinicalTrials.gov |
| `GET /api/research?id=NCT…&cond=` | Runs TinyFish Search, then Fetch, and extracts IDs, contacts and status hints |
| `GET /api/saved` | Lists saved trials. Add `?check=1` to compare each against the current registry record |
| `POST /api/saved` | Saves a trial and stores a snapshot |
| `DELETE /api/saved/:id` | Removes a saved trial |
| `POST /api/saved/:id/ack` | Marks detected changes as reviewed |

## How it works

1. The user searches for a condition and location in the frontend.
2. The server fetches matching records from ClinicalTrials.gov and normalizes them.
3. On request, TinyFish Search finds related public pages and TinyFish Fetch returns their content, from which the server extracts study IDs, contacts and status hints.
4. Eligibility text is rewritten in plain language in the browser.
5. Saved trials are stored with a snapshot. Later checks compare the snapshot with the current registry record and list what changed.

## Current limitations

- Plain-language explanations use a glossary of common terms, not a language model, so unfamiliar terms stay as written.
- Contact details extracted from third-party pages can be incomplete or wrong. Verify them on the official record.
- Saved trials are tied to an anonymous browser ID. There are no accounts or notifications.
- The fit check only looks at age and sex. It does not read the full criteria.
- The server runs as a plain Node process and is not yet set up for serverless hosting.

## Roadmap

- LLM-based eligibility matching and explanations with source links
- Supabase/PostgreSQL storage and user accounts
- Notifications when a saved trial changes
- TinyFish Agent workflows for hospital pages that need multi-step navigation
- More countries and multilingual support, starting with India

## Team

Team Brainrot

- Charu Singla
- Tarini Bimbrahw
- Shiney Sharma
- Aradhye Bhushan
