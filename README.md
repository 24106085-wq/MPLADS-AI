# MPLADS AI Monitoring & Analytics Platform

An AI-assisted monitoring platform for MPLADS (Members of Parliament Local
Area Development Scheme) works: KPI analytics, a multi-signal risk engine,
compliance checks, ML anomaly/duplicate detection, predictive delay/cost-
overrun models with explainability, an early-warning layer, prioritized
alerts, a role-oriented dashboard, and downloadable reports.

The backend is **SQLite-backed** for this phase: project data can be loaded
from a CSV (the bundled sample or one you upload via the UI), but every
project, investigation, feedback entry, and piece of evidence is persisted to
a local SQLite database file, and every engine (risk, compliance, ML,
duplicate, predictive, early-warning) reads from that stored project set. See
[Data storage](#data-storage) below.

---

## Project overview

MPLADS AI ingests MPLADS project records (from the bundled sample CSV or an
uploaded CSV) and turns them into actionable oversight: it scores each
project's risk from multiple signals, checks it against compliance rules,
flags statistical/ML anomalies and potential duplicate works, predicts delay
and cost-overrun likelihood with an explanation of why, rolls all of that
into a single early-warning verdict, and surfaces the most urgent projects
first through a prioritized alerts feed and a role-oriented dashboard.
Every finding is presented as a **risk indicator that requires review** —
never as a confirmed finding of fraud.

## Architecture

```
CSV / Uploaded Data
        │
        ▼
   FastAPI Backend (SQLite-backed project store)
        │
        ▼
AI / Risk / Compliance Engines
  (risk_engine, compliance_engine, ml_anomaly, duplicate_detector,
   predictive_model, early_warning, monitoring, alert_prioritizer)
        │
        ▼
   React + Vite Dashboard
  (Dashboard, Alerts, Project Detail, Reports, Role Views)
```

---

## Project structure

```
MPLADS-AI/
├── backend/          FastAPI app (Python)
│   ├── main.py                API routes, CORS, startup, error handling
│   ├── risk_engine.py          Multi-signal risk scoring + rule-based anomalies
│   ├── compliance_engine.py    Compliance rule checks
│   ├── ml_anomaly.py           Isolation Forest anomaly detection
│   ├── duplicate_detector.py   TF-IDF + cosine similarity duplicate detection
│   ├── predictive_model.py     Delay / cost-overrun classifiers + explainability
│   ├── early_warning.py        Combines the above into one early-warning verdict
│   ├── monitoring.py           Unified per-project monitoring + dashboard summary
│   ├── alert_prioritizer.py    Prioritized, deduplicated alert list
│   ├── db.py                    SQLite persistence layer (init_db(), all tables)
│   ├── seed_demo_data.py        Optional one-command demo-data loader
│   ├── data/sample_projects.csv  Sample dataset for seed_demo_data.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
└── frontend/         React + Vite app (JavaScript)
    ├── src/
    │   ├── pages/            Dashboard, Alerts, Reports, ProjectDetails
    │   ├── components/        ProjectModal, ProjectTable, Sidebar, ...
    │   ├── utils/              apiClient.js + client-side mirrors of the
    │   │                       backend engines (risk/compliance/anomaly/
    │   │                       early-warning) so the UI still works if the
    │   │                       backend is temporarily unreachable
    │   └── data/mpladsData.js  Bundled local sample data (offline fallback)
    ├── package.json
    ├── Dockerfile
    └── .env.example

docker-compose.yml   Runs both containers together — see "Run both with
                      Docker Compose" below
```

---

## Backend

### Install dependencies

```bash
cd backend
python -m venv venv          # optional but recommended
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Configure environment variables

```bash
cp .env.example .env
```

Then edit `backend/.env` as needed — every value has a safe default for
local development, so this step is optional locally. See
[Environment variables](#environment-variables) below for the full list.

### Start the backend

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

or, equivalently (respects the `PORT` env var, useful on some hosting
platforms):

```bash
python main.py
```

The API is now available at `http://localhost:8000`. Check
`http://localhost:8000/api/health` to confirm it's serving data.

A fresh database starts with zero projects (see [Data storage](#data-storage)
above) — optionally, run `python seed_demo_data.py` (safe to re-run) to load
`data/sample_projects.csv`'s 18 sample projects and see a populated Dashboard,
Alerts feed and risk map right away.

Four demo user accounts (one per role) are also seeded automatically on
every backend startup — see [Logging in](#logging-in) below.

### Run with Docker

Alternative to the manual steps above — builds the same app into a container
and seeds it automatically:

```bash
cd backend
docker build -t mplads-ai-backend .
docker run --rm -p 8000:8000 -v "$(pwd)/data:/app/data" mplads-ai-backend
```

The API is available at `http://localhost:8000` exactly as above, already
seeded with the 18 sample projects. The `-v` flag persists the SQLite file
on your host at `backend/data/mplads.db` across container restarts. To run
both the backend and frontend together with one command, see
[Run both with Docker Compose](#run-both-with-docker-compose) below.

---

## Frontend

### Install dependencies

```bash
cd frontend
npm install
```

### Configure environment variables

```bash
cp .env.example .env
```

Set `VITE_API_BASE_URL` to your backend's URL (defaults to
`http://localhost:8000` if unset — fine for local development). If the
backend isn't reachable at that address, the app automatically falls back to
bundled local sample data so the UI still works.

### Start the frontend

```bash
npm run dev
```

Open the printed local URL (Vite's default is `http://localhost:5173`). You'll
land on a login screen — see [Logging in](#logging-in) below for the demo
credentials.

### Production build

```bash
npm run build      # outputs static assets to frontend/dist
npm run preview     # optional: serve the production build locally
```

### Run with Docker

Alternative to the manual steps above — builds the production bundle and
serves it as static files:

```bash
cd frontend
docker build -t mplads-ai-frontend --build-arg VITE_API_BASE_URL=http://localhost:8000 .
docker run --rm -p 5173:5173 mplads-ai-frontend
```

Open `http://localhost:5173`. Note that Vite inlines `VITE_API_BASE_URL`
into the build at image-build time, not at container start — pass it as a
`--build-arg` (as above), not as a `docker run -e` flag, if you need to
point at a different backend.

---

## Logging in

The app requires a real, backend-verified login — there's no guest mode and
no client-side role picker. Sign-in posts to `POST /api/auth/login`, which
checks the username/password against a salted, hashed password stored in
SQLite and returns a JWT; the frontend stores that token and sends it as a
`Bearer` header on every subsequent request. The server — never the
client — decides what role and scope (MP name / district / state) a logged-in
user acts as.

Four demo accounts, one per role, are seeded automatically the moment the
backend starts (`auth.seed_demo_users()`, called from `main.py` — idempotent,
so it's safe across restarts and won't duplicate or reset accounts that
already exist):

| Username | Password | Role | Acts as |
|---|---|---|---|
| `mp_demo` | `MpDemo@123` | MP | Ramesh Chandra Yadav |
| `district_demo` | `DistrictDemo@123` | District Authority | Lucknow |
| `state_demo` | `StateDemo@123` | State Nodal Authority | Uttar Pradesh |
| `admin_demo` | `AdminDemo@123` | Ministry / Admin | All projects (unscoped) |

The non-admin accounts only see projects scoped to their identifier, so
they're most useful once `seed_demo_data.py` (or an uploaded CSV containing
matching names/districts/states) has populated the project table — otherwise
they'll correctly see an empty dashboard for their scope. `admin_demo` sees
everything regardless.

These are demo credentials for local evaluation only — intentionally simple,
and printed here rather than kept secret (see `backend/auth.py`'s module
docstring). Don't reuse this login setup as-is (fixed passwords, no
password-reset flow, no account lockout, no SSO) for anything with real
users; see that file for the exact scope of what this auth layer is and
isn't.

A session lasts `JWT_EXPIRES_MINUTES` (default 480 = 8 hours; set in
`backend/.env`) from login. Logging out (the profile menu's Logout button in
the topbar) clears the stored token and returns you to the login screen
immediately; letting the token expire naturally does the same on the next
request. If the backend is briefly unreachable when the app loads, an
already-logged-in session is left alone rather than being logged out — it
re-validates against `/api/auth/me` once the backend is back.

---

## Run both with Docker Compose

The fastest way to get a judge (or yourself) from a clone to a fully
running app, with zero manual configuration — no need to install Python,
Node, or any dependency locally:

```bash
docker-compose up --build
```

This builds and starts both containers using `backend/Dockerfile` and
`frontend/Dockerfile` above:

- **Backend** → `http://localhost:8000`, seeded with the 18 sample projects
  (same `seed_demo_data.py` step as the manual instructions).
- **Frontend** → `http://localhost:5173`, already built with
  `VITE_API_BASE_URL` pointed at the backend above.

`backend/data` is mounted as a volume, so the SQLite database persists
across `docker-compose down` / `up` cycles. `http://localhost:5173` is
already in the backend's default allowed CORS origins (see
[Environment variables](#environment-variables) below), so this works out
of the box with none of the environment variables below set.

To override anything — a different port, a real `FRONTEND_URL` for a
non-default frontend origin, or a `VITE_API_BASE_URL` pointing at a
deployed backend — copy the variables in
[Environment variables](#environment-variables) into a `.env` file next to
`docker-compose.yml` (Compose loads it automatically), for example:

```bash
# .env
BACKEND_PORT=8000
FRONTEND_PORT=5173
FRONTEND_URL=http://localhost:5173
VITE_API_BASE_URL=http://localhost:8000
```

Then run `docker-compose up --build` again to pick up the changes (a
rebuild is required for `VITE_API_BASE_URL` specifically, since Vite bakes
it into the static bundle at build time).

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `FRONTEND_URL` | No | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated list of allowed CORS origins for your deployed frontend. Local dev origins are always allowed in addition to this. |
| `PORT` | No | `8000` | Only used if you run `python main.py` directly (some hosting platforms inject `$PORT`). Not needed with `uvicorn main:app --port 8000`. |
| `DB_PATH` | No | `backend/data/mplads.db` | Path to the SQLite database file. See [Data storage](#data-storage). |

### Frontend (`frontend/.env`)

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `VITE_API_BASE_URL` | No | `http://localhost:8000` | Base URL of the deployed FastAPI backend. |

No API keys, secrets, or database credentials are required anywhere in this
project.

### Data storage

No external database (MongoDB or otherwise) or DB server is part of this
application's architecture — persistence is handled by Python's built-in
`sqlite3` module, so there's no separate service to provision or credentials
to manage. On startup, `backend/db.py`'s `init_db()` creates the SQLite file
at `backend/data/mplads.db` by default (override the location with the
`DB_PATH` env var) and creates any of its tables — `projects`,
`investigations`, `investigation_actions`, `feedback`, `evidence`,
`mlops_events`, `notifications_log`, `notifications`, and `app_settings` —
that don't already exist. `init_db()` is idempotent and safe to call on
every startup: it never drops or recreates an existing table, so it's called
unconditionally each time the backend starts.

A freshly created database starts with zero projects — no sample/demo data
is ever auto-seeded into it. Project records normally arrive via
`POST /api/upload` (CSV) or `POST /api/projects` (single record); optionally,
run `backend/seed_demo_data.py` once to load `backend/data/sample_projects.csv`
(18 varied demo projects) through those same `db.py` functions instead. From
then on every engine
(risk, compliance, ML, duplicate, predictive, early-warning) reads from that
stored project set. Investigation actions, feedback, evidence uploads,
notifications, and app settings are likewise written straight to their
respective tables. All of it **persists across restarts** — stopping and
restarting the backend does not clear any data. To reset to a clean slate,
stop the backend and delete the `.db` file (it will be recreated empty on
next startup).

---

## Production deployment sequence

1. **Configure backend environment variables** — set `FRONTEND_URL` to your
   deployed frontend's origin(s) once you know them (you can deploy the
   backend first with this unset, using the local-dev default, and update it
   afterwards).
2. **Deploy the backend** — e.g. `uvicorn main:app --host 0.0.0.0 --port $PORT`
   (or `python main.py`, which reads `$PORT` itself) on your platform of
   choice. No external database provisioning is needed — SQLite is
   file-based, so just make sure the deployment's disk is persistent if you
   want data to survive redeploys (not just process restarts).
3. **Obtain the backend's public URL.**
4. **Set the frontend's `VITE_API_BASE_URL`** to that URL and run
   `npm run build`.
5. **Deploy the frontend's build output** (`frontend/dist`) as a static site.
6. **Set the backend's `FRONTEND_URL`** to the deployed frontend's URL (and
   redeploy/restart the backend) so CORS allows it.

---

## Notes

- This is an AI-assisted, rule-based / ML-prototype system. Risk scores,
  compliance findings, ML anomaly flags, duplicate matches, predictions and
  early warnings are all **risk indicators that require human review** —
  never a confirmed finding of fraud.
- If the backend is unreachable, most of the UI (Dashboard, Alerts,
  ProjectModal) automatically falls back to client-side computations mirroring
  the backend's rule engines, using bundled sample data — this is by design,
  not an error state, though ML anomaly detection and the predictive models
  have no client-side equivalent and will show as unavailable offline.
- Basic per-IP rate limiting (`slowapi`, 10 requests/minute) is applied to
  `/api/upload` and the alert/notification-listing endpoints
  (`/api/alerts`, `/api/notifications`) as a baseline abuse guard; it isn't
  tuned or applied API-wide, and there's no distributed rate-limit store
  (in-memory only), which is a known gap for a real multi-instance
  deployment.
