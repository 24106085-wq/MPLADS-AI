# backend/Dockerfile
#
# Builds the FastAPI backend (see main.py). The app runs fully in-memory /
# SQLite-backed — no external database service is required (see README.md
# "Data storage"), so this is the only container needed on the backend side.

FROM python:3.11-slim

WORKDIR /app

# System deps needed to build a couple of the pinned scientific-Python
# packages (e.g. scikit-learn/shap) on some platforms; removed again in the
# same layer to keep the final image small.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# backend/data holds the SQLite file (data/mplads.db) and the bundled
# sample_projects.csv — make sure it exists even if .dockerignore trims it.
RUN mkdir -p data

# Optional, safe-to-re-run demo seed (see seed_demo_data.py) so a fresh
# container has something to look at immediately, then start the API.
# DB_PATH is left at its default (data/mplads.db, see db.py) unless
# overridden — docker-compose.yml mounts ./backend/data as a volume so it
# persists across container restarts.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "python seed_demo_data.py && uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
