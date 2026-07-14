# Public Repo Architecture & Baseline Plan

This document plans two workstreams for making this repository a reliable public baseline that a private, hosted-product fork can pull from:

1. **Downstream customization architecture** — separate core from product code, add extension points, centralize configuration, and add a feature registry.
2. **Public baseline reliability** — tests, lint, type checking, CI, and a tagged stable release.

The ordered implementation checklist lives in [public-repo-implementation-checklist.md](public-repo-implementation-checklist.md).
The downstream private-repo setup guide lives in [downstream-private-repo-setup.md](downstream-private-repo-setup.md).

## Downstream Model (context for every decision below)

The private repo is a **git clone of this repo with two remotes**: `origin` (private) and `upstream` (this public repo, push-disabled). It pulls public changes via `git fetch upstream && git merge upstream/main`.

Design consequence: **downstream customizations must live in a small, dedicated set of files that upstream rarely touches**, so merges from upstream stay conflict-free. Everything in this plan is shaped by that constraint.

---

## Part 1 — Architecture for Downstream Customization

### 1.1 Core vs. product boundaries

Current layout already has good seams. We formalize them:

| Layer | Paths | Classification |
|---|---|---|
| DAW client core | `src/app/lib/daw/` (engine, state, rendering, utils, hooks) | **Core** — downstream should never edit |
| DAW server core | `packages/server/app/lib/daw/` (commands, snapshot-builder, versioning, realtime-gateway, assets, jobs) | **Core** |
| Shared contracts | `packages/shared/` | **Core** |
| DB schema | `packages/db/` | **Core** (downstream adds migrations additively) |
| App shell & routes | `src/app/`, `src/app/pages/` | **Core with extension hooks** |
| Auth | `packages/server/app/lib/auth/` | **Core default, replaceable via provider** |
| Product surface | `src/app/product/` (new) | **Downstream-editable** — the only directory the private repo is expected to modify |

Deliverable: a short `docs/architecture/core-vs-product-boundaries.md` note (or a section appended to the repo README) stating these boundaries so contributors and downstream maintainers know where changes belong.

### 1.2 Typed configuration module (env → config)

**Problem:** `process.env` is read ad hoc across the codebase, e.g.:

- `packages/server/app/lib/daw/server/assets/storage-provider.ts` (`OBJECT_STORAGE_*`, `R2_*`)
- `packages/server/app/lib/plugins/index.ts` (`DAW_PLUGIN_UPLOAD_TOKEN_SECRET`, `DAW_ASSET_UPLOAD_TOKEN_SECRET`, `NEXTAUTH_SECRET`, with a dev fallback)
- `DATABASE_URL`, `REDIS_URL`, worker callback secrets

**Plan:** add `packages/shared/src/config/`:

- `schema.ts` — typed config shape: `database`, `redis`, `objectStorage`, `secrets`, `features` (see 1.4), `branding` overrides, `deployment` (base URL, environment name).
- `load.ts` — parses and validates `process.env` **once at startup**; throws descriptive errors for missing required values in production; permits dev fallbacks only when `NODE_ENV !== 'production'`.
- `index.ts` — exports a `getConfig()` singleton for server code. A serialized, safe subset (feature flags, branding) is passed to the client via server components.

**Migration:** replace direct `process.env` reads in `storage-provider.ts`, `plugins/index.ts`, and any other hits from a repo-wide `process.env` audit with `getConfig()` calls. Keep the existing env variable names so current deployments and `docker-compose.yml` keep working unchanged.

### 1.3 Extension points (provider interfaces)

Add `packages/server/app/lib/extensions/` containing narrow interfaces plus default implementations. Core code calls the interface; the binding is resolved through one product-owned module (see 1.5).

| Provider | Interface sketch | Public default |
|---|---|---|
| **Auth** | `AuthProvider`: `getUserFromRequest(req)`, `createSession(userId)`, `destroySession(req)`, `hashPassword`/`verifyPassword` | Existing cookie-session code in `packages/server/app/lib/auth/` refactored to implement the interface. Behavior unchanged. |
| **Storage** | `StorageProvider`: `createSignedUploadUrl`, `createSignedDownloadUrl`, `deleteObject`, `getObjectStream` | Existing S3-compatible signer in `assets/storage-provider.ts`, configured from the config module. |
| **Analytics** | `AnalyticsProvider`: `track(event, props)`, `identify(userId, traits)` | No-op. Core emits a small, documented set of events (signup, project created, demo version committed, etc.) — added incrementally, not exhaustively. |
| **Billing** | `BillingProvider`: `getEntitlements(userId)`, `checkLimit(userId, limitKey)` | No-op returning "everything allowed". Core consults it only at the few choke points where a hosted product would enforce limits (e.g. upload size, project count) — added as guard calls, not business logic. |
| **Branding** | `BrandingConfig` (data, not a provider): app name, logo path, colors/theme tokens, support links | Current "Git for Music" branding. Consumed by `src/app/pages/layouts/root-layout.tsx` and auth pages instead of hard-coded strings. |

Rules:

- Interfaces stay **minimal** — only methods core actually calls today plus the obvious hosted-product needs above. No speculative surface.
- **Backend authorization stays separate from frontend feature visibility.** Providers and feature flags never replace server-side permission checks.
- Default implementations live next to the interfaces so the public repo remains fully functional with zero configuration beyond `.env`.

### 1.4 Feature registry + typed feature flags

Per the agreed scope (runtime registry + env-driven flags, no DB flags, intentionally small):

**Location:** `packages/shared/src/features/` for types + registry (usable from both server and client), with registration modules in the product surface (1.5).

- `types.ts` — `FeatureId` (string-literal union), `FeatureDefinition` (`id`, `description`, `enabledByDefault`, optional `envVar`).
- `registry.ts` — `registerFeature(def)` (throws on duplicate IDs), `overrideFeature(def)` (explicit downstream override API), `isFeatureEnabled(id, config)`, `listFeatures()`.
- Env flags: `FEATURE_<NAME>=true|false` parsed by the config module (1.2) into `config.features`; env overrides registration defaults deployment-wide.

**Usage policy:** the registry is only for substantial optional systems or replaceable integrations (e.g. plugins system, cloud export), not per-component UI toggles.

**Initial registered features:** start with `plugins` (the WAM plugin system is a genuine optional subsystem) and wire `FEATURE_PLUGINS` through the plugin routes/UI. Add others only when a real need appears.

**Tests (see 2.3):** registration, duplicate-ID rejection, env disable, downstream override.

### 1.5 The single downstream-editable surface

Create `src/app/product/`:

- `register-features.ts` — calls `registerFeature(...)` for all public defaults. **This is the one documented downstream entry point**: the private repo appends/overrides registrations here (or in a sibling `register-features.private.ts` it adds, imported from this file behind a guarded dynamic import — decide during implementation for merge-friendliness).
- `providers.ts` — binds `AuthProvider`, `StorageProvider`, `AnalyticsProvider`, `BillingProvider` to their default implementations. Downstream swaps bindings here.
- `branding.ts` — exports the `BrandingConfig`.

Core files import from `src/app/product/*` (or via a thin re-export in `packages/server` for server-only bindings) and are otherwise never edited downstream. This directory should change rarely upstream, keeping merges clean.

### 1.6 Deployment/environment behavior

- `docker-compose.yml` remains the public dev/self-host default (Postgres, Redis, MinIO).
- All deployment-specific values (URLs, buckets, secrets) flow through the config module; **no hosted-product hostnames, secrets, or vendor SDKs land in this repo**.
- `.env.example` and `.env.production.example` are updated with every new variable (`FEATURE_*`, any renamed secrets) and stay the authoritative variable list.

---

## Part 2 — Reliable Public Baseline

### 2.1 Make existing tests runnable as suites

Current state: ~38 test files exist, but only Vitest interaction tests (`src/vitest.config.ts`, include pattern `app/**/*.interaction.test.tsx`) have a package script. `node:test` files in `packages/server` and `src` are run manually per-file (`pnpm exec tsx --test <file>`, per README).

**Plan:**

- `packages/server/package.json`: add `"test": "tsx --test \"app/**/*.test.ts\""` (plus `tsx` devDependency).
- `src/package.json`: add `"test:unit": "tsx --test \"app/**/*.test.ts\""` for the non-interaction `node:test` files; keep `"test"` as Vitest for interaction tests, or unify naming (`test:interaction`, `test:unit`) — pick one convention and document it.
- Root `package.json`: add `"test": "..."` orchestrating all suites, plus granular `test:server`, `test:web`, `test:unit` scripts.
- Verify every existing test file is picked up by exactly one suite and passes.

### 2.2 Lint and type checking everywhere

- **Lint:** ESLint currently only covers `src/` (`src/eslint.config.mjs`). Add flat configs (or a shared root config) covering `packages/server`, `packages/shared`, `packages/db/src`. Root script: `"lint": "..."` running all of them.
- **Type check:** add `"typecheck": "tsc --noEmit"` to `src` and each package (each already has `typescript` as a devDependency; add `tsconfig` refinements as needed), plus a root `"typecheck"` orchestrator. Fix any errors surfaced.

### 2.3 New test coverage

- **Config & features (from Part 1):** unit tests for env parsing/validation errors, feature registration, duplicate IDs, env disable, downstream override, provider default bindings.
- **Collaboration & synchronization:**
  - Multi-client convergence: two simulated clients applying interleaved operations through `operation-reducer` reach identical `LocalProjectState`.
  - Offline reconnect: `ProjectSyncEngine` replays the operation tail from a stale snapshot correctly (extend `project-sync-engine.test.ts`).
  - Realtime fan-out: `realtime-gateway` delivers accepted operations and presence to all subscribers; unsubscribed clients receive nothing.
  - Conflict rules: extend `conflict-rules.test.ts` for concurrent edits to the same segment/track across branches.
- **Regression tests for known issues** (from `docs/40_FEATURES/active-problems.md` history — all currently fixed; verify coverage exists and add gaps):
  - Segment moves preserve track/source identity (`applySegmentMove`, covered in `operation-reducer.test.ts` — verify).
  - Follow-head checkout behavior (`DemoUserActiveVersion` — verify).
  - Blank duplicate track after recording (`track-duplicate-cleanup.test.ts` exists in both client and server — verify both).
- **Integration tests (real services):** a small suite (`packages/server/**/*.integration.test.ts`, separate glob) that runs against real Postgres + MinIO: signup → group → project → demo → upload-track command → snapshot bootstrap → version branch/revert round-trip. Skipped locally unless `DATABASE_URL` points at a test DB; run in CI (2.4).

### 2.4 Public CI workflow (GitHub Actions)

Add `.github/workflows/ci.yml` triggered on `push` to `main` and all PRs:

| Job | Steps |
|---|---|
| `lint` | pnpm install (with store cache) → `pnpm lint` |
| `typecheck` | install → `pnpm db:generate` → `pnpm typecheck` |
| `unit` | install → `pnpm db:generate` → node:test suites + Vitest interaction tests |
| `integration` | Postgres 16 + MinIO as job services → `prisma migrate deploy` (or `db push`) → integration suite with test env vars |
| `build` | install → `pnpm db:generate` → `pnpm build` (`next build`) |

Details: Node 20 (`.nvmrc`), `pnpm/action-setup` pinned to `pnpm@10.x`, jobs run in parallel, all required for merge. Optionally add a branch protection note to the README rather than assuming repo settings.

### 2.5 Tag the stable release

Once CI is green on `main` with all of the above merged:

1. Bump versions to `1.0.0` in root and workspace `package.json` files.
2. Update README with a short "Releases" note and the downstream setup link.
3. `git tag -a v1.0.0 -m "First stable public baseline"` and push the tag.
4. Create a GitHub Release from the tag summarizing the baseline guarantees (tests, CI, extension points).

Downstream repos should merge from tagged releases, not arbitrary `main` commits.

---

## Non-goals (explicitly out of scope for this iteration)

- Per-user or per-group database feature flags, admin UI, or gradual rollout tooling.
- Publishing npm packages.
- Any vendor-specific auth/analytics/billing integrations (those belong in the private repo's `src/app/product/` overrides).
- Rewriting the realtime layer or persistence model.

## Risks & mitigations

- **Refactor churn breaking downstream merges later:** do the provider/config refactors *before* tagging `v1.0.0` so the private fork starts from the post-refactor shape.
- **Hidden `process.env` reads missed in migration:** enforce with an ESLint rule (`no-process-env`) scoped to app code, allow-listed only in `packages/shared/src/config/`.
- **Integration tests flaky in CI:** keep the suite minimal and deterministic; use health checks on services before running.
