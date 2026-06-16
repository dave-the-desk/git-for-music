# Git for Music

Music collaboration and versioning platform.

## Prerequisites

- [pnpm](https://pnpm.io/) >= 10.33.0
- [Docker](https://www.docker.com/) (for the Compose stack)
- [Node.js](https://nodejs.org/) 22.21.1 (managed via `.nvmrc`)

`pnpm` is pinned through the root `packageManager` field and provided by
Corepack. If the command is missing in a fresh shell, run `corepack enable`
once after switching to the repo's Node version.

## Quick start

Host workflow:

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env files
cp .env.example .env
cp src/.env.example src/.env.local
```

The example app env already points asset uploads at local MinIO on
`http://localhost:9000`.

```bash
# 3. Start Postgres, Redis, and MinIO
docker compose up -d postgres redis minio minio-init

# 4. Generate Prisma client and push schema
pnpm db:generate
pnpm db:push

# 5. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Docker Compose

The containerized stack brings up Postgres, Redis, MinIO, and the Next.js app:

```bash
docker compose up --build
```

Run that from the repository root. It will start the database, Redis, MinIO,
and the web app together.

The first container startup also runs one-shot `db-init` and `minio-init`
jobs so the Prisma schema is pushed into the local Postgres volume and the
MinIO bucket + CORS config are created automatically. The web service uses
`postgres`, `redis`, and `minio` as service names inside the Compose network.
The Compose file also sets the dev-only upload, callback, and object storage
secrets so the stack works without extra local env setup.

## Workspace layout

| Path | Description |
|---|---|
| `src` | Next.js frontend + API routes |
| `packages/db` | Prisma schema and client singleton |
| `packages/server` | Server-side auth, DAW domain logic, realtime, and jobs |
| `packages/shared` | Shared TypeScript types |

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
| MinIO API | 9000 |
| MinIO console | 9001 |
| Web | 3000 |
