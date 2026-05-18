# Git for Music

Music collaboration and versioning platform.

## Prerequisites

- [pnpm](https://pnpm.io/) >= 10.33.0
- [Docker](https://www.docker.com/) (for the Compose stack)
- [Node.js](https://nodejs.org/) >= 20
- Python >= 3.11 (for audio workers)

## Quick start

Host workflow:

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env files
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# 3. Start Postgres + Redis
docker compose up -d postgres redis

# 4. Generate Prisma client and push schema
pnpm db:generate
pnpm db:push

# 5. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Docker Compose

The containerized stack brings up Postgres, Redis, the Next.js app, and the
audio worker:

```bash
docker compose up --build
```

The first container startup also runs a one-shot `db-init` job so the Prisma
schema is pushed into the local Postgres volume automatically. The web service
uses `postgres` and `redis` as service names inside the Compose network.

## Workspace layout

| Path | Description |
|---|---|
| `apps/web` | Next.js frontend + API routes |
| `packages/db` | Prisma schema and client singleton |
| `packages/shared` | Shared TypeScript types |
| `workers/audio` | Python audio processing worker (placeholder) |

## Common commands

```bash
# Run from repo root
pnpm dev            # Start web dev server
pnpm build          # Build web app
pnpm lint           # Lint web app

pnpm db:generate    # Re-generate Prisma client after schema changes
pnpm db:push        # Push schema to dev database (no migration file)
pnpm db:migrate     # Create + apply a named migration
pnpm db:studio      # Open Prisma Studio
```

`pnpm db:*` commands load database env vars from the root `.env`.

## Docker services

| Service | Port |
|---|---|
| Postgres | 5432 |
| Redis | 6379 |
| Web | 3000 |
| Audio worker | n/a |

## Audio worker (Python)

```bash
cd workers/audio
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Docker build and run:

```bash
docker build -t git-for-music-audio-worker ./workers/audio
docker run --rm \
  --env-file workers/audio/.env.example \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/git_for_music \
  -e WEB_PUBLIC_DIR=/data/public \
  -v "$(pwd)/apps/web/public:/data/public" \
  git-for-music-audio-worker
```

If you prefer scripts, use:

```bash
bash workers/audio/run.sh
bash workers/audio/build-and-run.sh
```

The worker uses local DSP libraries for tempo/key analysis and time-stretching.
It polls the `ProcessingJob` table directly, so queued jobs live in Postgres
and can be inspected from the app while they are processing.
You will also want `ffmpeg` installed for decoding compressed audio, and the
Rubber Band CLI (`rubberband`) for higher-quality time-stretching. The worker
falls back to librosa's stretcher if Rubber Band is unavailable, but Rubber Band
is the recommended setup for production-like results.

If you deploy the worker separately from the web app, mount the same uploads
directory into the container or switch the storage layer to an object-store URL
that both services can reach.
