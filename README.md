# Git for Music

Git for Music is a web-native music collaboration and versioning platform. The
core idea is a DAW-style editor backed by Git-like demo history: users can
upload or record tracks, edit timeline regions, collaborate in realtime, and
preserve musical ideas through versions, branches, and non-destructive reverts.

The repo is a pnpm monorepo with one Next.js app and shared packages for the
database, server domain logic, and shared contracts.

## What Is In This Repo

| Area | Path | Purpose |
|---|---|---|
| Web app | `src/` | Next.js app router, API routes, UI, DAW client engines, Vitest tests |
| Database package | `packages/db/` | Prisma schema, migrations, generated Prisma client setup |
| Server package | `packages/server/` | Auth helpers, DAW command handling, snapshots, realtime, processing jobs, plugin services |
| Shared package | `packages/shared/` | Shared payloads, queue contracts, storage helpers, protocol types |
| Documentation vault | `docs/` | Architecture notes, feature context, generated inventories, branch notes, daily logs |

## Prerequisites

- [Node.js](https://nodejs.org/) `22.21.1`, matching `.nvmrc`
- [pnpm](https://pnpm.io/) `>= 10.33.0`
- [Docker](https://www.docker.com/) for local Postgres, Redis, and MinIO

`pnpm` is pinned in `package.json` through the `packageManager` field. Corepack
usually provides it:

```bash
corepack enable
```

## Recommended Local Setup

The recommended development workflow runs the infrastructure in Docker and the
Next.js app on your host machine. In other words: the database runs with Docker,
then you generate Prisma, push the schema, and start the app with pnpm.

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment files
cp .env.example .env
cp src/.env.example src/.env.local

# 3. Start local services: Postgres, Redis, MinIO, and MinIO bucket/CORS setup
docker compose up -d postgres redis minio minio-init

# 4. Generate Prisma client and push the schema into the Docker Postgres DB
pnpm db:generate
pnpm db:push

# 5. Start the Next.js dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The default env files point to:

- Postgres: `postgresql://postgres:postgres@localhost:5432/git_for_music`
- Redis: `redis://localhost:6379`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`
- MinIO credentials: `minioadmin` / `minioadmin123`

## Full Docker Compose Stack

You can also run the app itself inside Docker:

```bash
docker compose up --build
```

This starts Postgres, Redis, MinIO, one-shot `minio-init`, one-shot `db-init`,
and the production web service. The Compose stack pushes the Prisma schema into
the local Postgres volume automatically through `db-init`.

Use the host workflow above for day-to-day development because it gives faster
Next.js refreshes and simpler test/debug loops.

## Environment Files

Copy both example files before first run:

```bash
cp .env.example .env
cp src/.env.example src/.env.local
```

Root `.env` is used by package-level database commands such as `pnpm db:push`.
`src/.env.local` is used by the Next.js app.

Important local env groups:

- `DATABASE_URL` points Prisma at Docker Postgres.
- `REDIS_URL` points realtime/job helpers at Docker Redis.
- `OBJECT_STORAGE_*` points uploads and plugin modules at local MinIO.
- `DAW_ASSET_UPLOAD_TOKEN_SECRET` and `DAW_WORKER_CALLBACK_SECRET` are dev-only
  secrets used by upload and processing-job flows.

## Common Commands

Run these from the repository root unless noted.

```bash
pnpm dev            # Start the web dev server
pnpm build          # Build the web app
pnpm lint           # Lint the web app
pnpm test:web       # Run the web Vitest suite

pnpm db:generate    # Generate Prisma client
pnpm db:push        # Push schema to local dev database
pnpm db:migrate     # Create/apply a Prisma migration
pnpm db:studio      # Open Prisma Studio
```

Useful service commands:

```bash
docker compose up -d postgres redis minio minio-init
docker compose ps
docker compose logs postgres
docker compose down
```

`docker compose down` keeps named volumes by default. If you intentionally want
to delete local data, use Docker's volume removal options explicitly.

## Testing

The repo uses more than one test harness:

- Web/UI/client tests use Vitest from the `src` package (`*.interaction.test.tsx`
  plus a small set of Vitest-only `*.test.ts` files listed in `src/vitest.config.ts`).
- All other `*.test.ts` files in `src/app` and `packages/server` run on Node's
  built-in test runner through `tsx`.

The `node:test` scripts discover files with POSIX `find` (no extra tooling
required) and explicitly exclude the Vitest-only files, which fail if loaded
outside the Vitest runner. If you add a Vitest-only `*.test.ts` file, add it to
both the `test:unit` exclusion list in `src/package.json` and the `include`
list in `src/vitest.config.ts`.

The full process:

```bash
# Everything (server node:test, web node:test, web Vitest)
pnpm test

# Individual suites
pnpm test:server    # packages/server node:test suite
pnpm test:unit      # src/app node:test suite (excludes Vitest-only files)
pnpm test:web       # src Vitest suite (interaction + Vitest-only files)

# Integration suite (requires RUN_INTEGRATION_TESTS=1 and real service env vars)
pnpm test:integration

# Single files
pnpm --filter @git-for-music/web test -- src/app/lib/daw/state/operation-reducer.test.ts
cd packages/server && pnpm exec tsx --test app/lib/daw/server/command-api.test.ts
```

For frontend interaction work, prefer the existing Vitest/jsdom harness in
`src/` with Testing Library.

## CI

GitHub Actions runs `lint`, `typecheck`, `unit`, `integration`, and `build`
for this repo. If you enable branch protection, require those checks before
merging to `main`.

## Documentation Workflow

The `docs/` directory is an Obsidian-friendly documentation vault. It uses
wikilinks such as `[[40_FEATURES/versioning-mental-model]]`, daily logs, branch
notes, and generated inventories. Reading it in [Obsidian](https://obsidian.md/)
is preferred because backlinks and graph navigation make the context easier to
follow.

Start here:

1. `PROJECT_CONTEXT_ROUTER.md`
2. `docs/00_HOME.md`
3. `docs/00_MAPS/git-for-music-context-index.md`
4. `docs/01_PROTOCOLS/ai-start-here.md`

If you are setting up a private downstream fork, start with
[docs/downstream-private-repo-setup.md](docs/downstream-private-repo-setup.md)
and keep customizations inside [docs/architecture/core-vs-product-boundaries.md](docs/architecture/core-vs-product-boundaries.md).

For implementation work, trust order is:

1. Source code
2. Repo-local architecture docs such as `docs/architecture/codebase-architecture.md`,
   `docs/architecture/daw-realtime-sync.md`, `docs/processing-jobs.md`, and
   `src/app/lib/daw/README.md`
3. Vault notes under `docs/`

Generated inventories live in `docs/20_GENERATED_INVENTORIES/`. They are useful
for file lookup, but should be refreshed from `rg --files` after file layout
changes.

## Product And Architecture Notes

Key concepts:

- Original audio is immutable. Edits create metadata, operations, derived
  assets, `TrackVersion`s, or `DemoVersion`s.
- Revert is non-destructive: it creates a new version whose content matches an
  earlier version.
- The version model is a graph, not a linear undo stack.
- Realtime messages are lightweight: accepted operations, presence, version-tree
  changes, comments, and status metadata. Raw audio stays in object storage.
- Local development uses MinIO as S3-compatible object storage.
- Processing jobs are database-backed locally, with queue-oriented contracts for
  future worker/SQS-style infrastructure.
- Browser plugins are loaded as same-origin, access-gated JavaScript modules and
  are versioned through track plugin state.

## Main Browser Routes

| Route | Purpose |
|---|---|
| `/` | Redirects to `/groups` |
| `/login` / `/signup` | Authentication pages |
| `/account` | Account page |
| `/account/plugins` | Private plugin library |
| `/groups` | Group list |
| `/groups/[groupId]` | Group detail |
| `/groups/[groupId]/projects/[projectId]` | Project detail |
| `/groups/[groupId]/projects/[projectId]/demos/[demoId]` | DAW demo editor |

See `docs/30_UI/ui-routing.md` for source file ownership.

## Troubleshooting

If the app cannot connect to the database:

```bash
docker compose ps
docker compose up -d postgres
pnpm db:push
```

If uploads or plugin modules fail locally, confirm MinIO is running and the
bucket initializer has completed:

```bash
docker compose up -d minio minio-init
docker compose logs minio-init
```

If Prisma types are stale after schema changes:

```bash
pnpm db:generate
```

If the port is already in use, stop the conflicting process or change the
service port mapping in `docker-compose.yml` / app config.

## License

This project is released under the MIT License. See `LICENSE` for the full
license text.

In practical terms, MIT is a permissive open-source license. You may use, copy,
modify, merge, publish, distribute, sublicense, and sell copies of the software,
including in commercial projects, as long as you include the original copyright
notice and license text in copies or substantial portions of the software.

The software is provided "as is", without warranty. The authors are not liable
for damages or claims arising from use of the software.
