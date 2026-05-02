# Git for Music

Music collaboration and versioning platform.

## Prerequisites

- [pnpm](https://pnpm.io/) >= 9
- [Docker](https://www.docker.com/) (for local Postgres + Redis)
- [Node.js](https://nodejs.org/) >= 20
- Python >= 3.11 (for audio workers)

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env files
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# 3. Start Postgres + Redis
docker compose up -d

# 4. Generate Prisma client and push schema
pnpm db:generate
pnpm db:push

# 5. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

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
  -v /absolute/path/to/apps/web/public:/data/public \
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
