# Public Repository Baseline

This document describes the source-verified architecture released as `v1.0.0`.
It is the durable reference for maintaining a public core while allowing a
private hosted-product fork to pull upstream changes with limited conflicts.

The dated delivery history is in
[public-repo-implementation-record.md](public-repo-implementation-record.md).
The user-facing fork setup is in
[../guides/downstream-private-repo-setup.md](../guides/downstream-private-repo-setup.md).

## Downstream Model

A private deployment is a clone with two remotes: `origin` points to the private
repository and `upstream` points to this public repository with pushes disabled.
Public changes arrive through `git fetch upstream` followed by a merge of
`upstream/main`.

Downstream customizations therefore belong in a small, stable surface that
upstream rarely changes. The detailed path ownership rules live in
[core-vs-product-boundaries.md](core-vs-product-boundaries.md).

## 1.1 Core vs. Product Boundaries

| Layer | Paths | Classification |
|---|---|---|
| DAW client | `src/app/lib/daw/` | Core |
| DAW server | `packages/server/app/lib/daw/` | Core |
| Shared contracts | `packages/shared/` | Core |
| Database | `packages/db/` | Core; downstream migrations remain additive |
| App shell and routes | `src/app/`, `src/app/pages/` | Core with extension hooks |
| Default auth | `packages/server/app/lib/auth/` | Core default selected through a provider |
| Product surface | `src/app/product/` | Downstream-editable bindings and branding |

Private vendor integrations, deployment values, and branding overrides do not
belong in the shared core.

## 1.2 Typed Configuration

`packages/shared/src/config/` owns the typed configuration schema and loader:

- `schema.ts` defines database, Redis, object storage, secrets, features,
  branding, deployment, environment, and operational-toggle shapes.
- `load.ts` parses the existing environment-variable names and exposes a cached
  configuration. Production startup rejects missing required secrets and object
  storage. The Next.js production build phase can collect page data without
  runtime secrets; normal production startup enforcement remains active.
- `index.ts` exports `getConfig()`, cache-reset support for tests, and the public
  client-safe subset.

Application code reads environment-backed configuration through `getConfig()`.
Direct `process.env` access is confined to the loader, tests, framework-required
client environment checks, and tooling configuration. `.env.example` and
`.env.production.example` are the variable references.

## 1.3 Extension Providers

`packages/server/app/lib/extensions/index.ts` defines narrow provider contracts.
`src/app/product/providers.ts` binds the public defaults at application startup.

| Provider | Current contract | Public default |
|---|---|---|
| Auth | Request/session lookup, session-cookie creation and removal, password hash and verification | Existing cookie-session implementation |
| Storage | Signed upload/download URLs, object deletion, object streaming | Existing S3-compatible storage implementation |
| Analytics | `track` and `identify` | No-op |
| Billing | entitlement lookup and limit checks | No-op; limits are allowed |

`src/app/product/branding.ts` separately owns app name, logo/support values, and
theme classes. Authorization remains a server concern: providers and feature
visibility never replace permission checks.

## 1.4 Feature Registry

`packages/shared/src/features/` provides feature definitions, registration,
explicit override, listing, and enablement resolution. Duplicate registration
is rejected. Environment values override registration defaults.

`src/app/product/register-features.ts` currently registers the `plugins` feature
with `FEATURE_PLUGINS`. The registry is reserved for substantial optional
systems, not local component toggles. Tests cover defaults, environment
overrides, duplicate rejection, and downstream overrides.

## 1.5 Downstream-Editable Surface

`src/app/product/` contains the intended customization points:

- `register-features.ts` declares public feature registrations.
- `providers.ts` selects auth, storage, analytics, and billing implementations.
- `branding.ts` supplies product identity and theme values.

Core code consumes these bindings instead of importing private-product
implementations. Downstream changes outside this surface should normally be
contributed upstream or maintained as an explicit, additive integration.

## 1.6 Deployment Behavior

`docker-compose.yml` is the public development and self-host baseline for
Postgres, Redis, and MinIO. Deployment-specific URLs, buckets, and secrets flow
through typed configuration. Hosted-product hostnames, secrets, and vendor SDKs
remain outside the public core.

Committed Prisma migrations are the deployment path. `pnpm db:push` is for
development only; CI and deployments use `pnpm db:migrate:deploy`.

## 2.1 Test Suites

The repository separates browser interaction tests from `node:test` suites:

| Command | Coverage |
|---|---|
| `pnpm test` | Server `node:test`, web unit `node:test`, and web Vitest suites |
| `pnpm test:server` | Server tests discovered with POSIX `find` |
| `pnpm test:unit` | Web non-interaction tests discovered with POSIX `find` |
| `pnpm test:web` | Vitest with jsdom and Testing Library |
| `pnpm test:integration` | Real-service Postgres and MinIO flow when enabled |

The web unit command excludes the two Vitest-specific route tests so each test
file is loaded by its intended harness.

## 2.2 Static Checks

The root `pnpm lint` command uses the shared flat ESLint configuration for the
web app, server, shared package, and database package. Root `pnpm typecheck`
runs `tsc --noEmit` across all four workspaces.

## 2.3 Regression and Integration Coverage

The baseline includes coverage for configuration validation, feature behavior,
provider bindings, branding, multi-client reducer convergence, offline replay,
realtime fan-out and unsubscribe, conflict rules, segment identity, follow-head
checkout, and recording duplication cleanup.

`packages/server/app/lib/daw/server/public-repo.integration.test.ts` exercises
signup, group and project creation, demo creation, upload, snapshot bootstrap,
branching, and revert against real Postgres and object storage. It is skipped
unless `RUN_INTEGRATION_TESTS=1` and the required service configuration is set.

## 2.4 Continuous Integration

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`. Independent
jobs cover lint, typecheck, unit tests, integration tests, and production build.
The integration job applies committed migrations and starts Postgres, Redis, and
MinIO before running the real-service suite.

Repository branch protection is an external setting; README guidance recommends
requiring these checks but the source tree cannot prove the setting itself.

## 2.5 Release Baseline

The root and workspace packages are versioned `1.0.0`. Tag `v1.0.0` identifies
the first stable public baseline. Downstream repositories should prefer tagged
releases over arbitrary commits from `main`.

## Explicit Non-Goals

- Per-user or per-group database feature flags, admin rollout UI, and gradual
  rollout tooling are not part of this baseline.
- The repository does not publish its workspaces as npm packages.
- Vendor-specific auth, analytics, and billing integrations belong in the
  private product bindings.
- This baseline did not redesign realtime persistence or the DAW version model.

## Maintenance Risks

- Downstream merge conflicts increase when private changes escape
  `src/app/product/`.
- New direct environment reads bypass validation; the lint rule and config tests
  protect this boundary.
- Integration reliability depends on deterministic service bootstrap and health
  checks, which are encoded in CI.
