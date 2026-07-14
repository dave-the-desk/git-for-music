# Public Repo Implementation Record

Historical delivery record for [public-repo-baseline.md](public-repo-baseline.md).
The phase grouping preserves implementation context; current behavior belongs
in the baseline document and source.

## Phase 0 — Documentation groundwork

- **Completed:** Published the [downstream private-repo setup guide](../guides/downstream-private-repo-setup.md) and linked it from the README. ([architecture: Downstream Model](public-repo-baseline.md#downstream-model))
- **Completed:** Wrote [core-vs-product-boundaries.md](core-vs-product-boundaries.md), declaring core and downstream-editable paths. ([architecture section 1.1](public-repo-baseline.md#11-core-vs-product-boundaries))

## Phase 1 — Test suites, lint, and type checking (baseline safety net first)

- **Completed:** Add `test` script to `packages/server` running all `node:test` files via `tsx --test`. ([architecture §2.1](public-repo-baseline.md#21-test-suites))
- **Completed:** Add a unit-test script to `src` for non-interaction `node:test` files; keep Vitest for `*.interaction.test.tsx`. ([architecture §2.1](public-repo-baseline.md#21-test-suites))
- **Completed:** Add root `test`, `test:server`, `test:unit` orchestration scripts; confirm every existing test file runs in exactly one suite and passes. ([architecture §2.1](public-repo-baseline.md#21-test-suites))
- **Completed:** Extend ESLint coverage to `packages/server`, `packages/shared`, `packages/db/src`; add root `lint` script. ([architecture §2.2](public-repo-baseline.md#22-static-checks))
- **Completed:** Add `typecheck` (`tsc --noEmit`) scripts to `src` and each package plus a root orchestrator; fix surfaced errors. ([architecture §2.2](public-repo-baseline.md#22-static-checks))

Status: the test, lint, and typecheck scripts are wired and green across `src/` and all packages.

## Phase 2 — Typed configuration module

- **Completed:** Create `packages/shared/src/config/` (schema, loader with production validation, `getConfig()` singleton). ([architecture §1.2](public-repo-baseline.md#12-typed-configuration))
- **Completed:** Audit all `process.env` reads; migrate `storage-provider.ts`, `plugins/index.ts`, and remaining call sites to `getConfig()` without renaming env vars. ([architecture §1.2](public-repo-baseline.md#12-typed-configuration))
- **Completed:** Add the `no-process-env` ESLint rule allow-listed to the config module. ([plan: Risks](public-repo-baseline.md#maintenance-risks))
- **Completed:** Unit tests: parsing, validation errors, dev fallbacks blocked in production mode. ([architecture §2.3](public-repo-baseline.md#23-regression-and-integration-coverage))
- **Completed:** Update `.env.example` and `.env.production.example`. ([architecture §1.6](public-repo-baseline.md#16-deployment-behavior))

Status: typed config is in place, the remaining env reads have been routed through it, the validation tests pass, and the example env files are current.

## Phase 3 — Feature registry and flags

- **Completed:** Create `packages/shared/src/features/` (`FeatureId`, `FeatureDefinition`, registry with duplicate-ID rejection and explicit override API). ([architecture §1.4](public-repo-baseline.md#14-feature-registry))
- **Completed:** Parse `FEATURE_*` env vars into `config.features`; env overrides registration defaults. ([architecture §1.4](public-repo-baseline.md#14-feature-registry))
- **Completed:** Create `src/app/product/register-features.ts` with public default registrations; register `plugins` and gate the plugin routes/UI on it. ([architecture §1.4](public-repo-baseline.md#14-feature-registry), [§1.5](public-repo-baseline.md#15-downstream-editable-surface))
- **Completed:** Tests: registration, disabling via env, duplicate IDs, downstream override. ([architecture §2.3](public-repo-baseline.md#23-regression-and-integration-coverage))
- **Completed:** Document the registry usage policy and add `FEATURE_PLUGINS` to `.env.example`. ([architecture §1.4](public-repo-baseline.md#14-feature-registry))

Status: feature registry defaults, env overrides, and app-wide registration are wired; the registry and override behavior are covered by tests and the phase is complete.

## Phase 4 — Extension points (providers) and product surface

- **Completed:** Create `packages/server/app/lib/extensions/` with `AuthProvider`, `StorageProvider`, `AnalyticsProvider`, `BillingProvider` interfaces. ([architecture §1.3](public-repo-baseline.md#13-extension-providers))
- **Completed:** Refactor existing cookie-session auth to implement `AuthProvider` (behavior unchanged); route all call sites through the interface. ([architecture §1.3](public-repo-baseline.md#13-extension-providers))
- **Completed:** Wrap the existing S3-compatible signer as the default `StorageProvider`. ([architecture §1.3](public-repo-baseline.md#13-extension-providers))
- **Completed:** Add no-op `AnalyticsProvider` and `BillingProvider` defaults with minimal initial call sites. ([architecture §1.3](public-repo-baseline.md#13-extension-providers))
- **Completed:** Create `src/app/product/providers.ts` binding all defaults; core resolves providers only through it. ([architecture §1.5](public-repo-baseline.md#15-downstream-editable-surface))
- **Completed:** Create `src/app/product/branding.ts`; replace hard-coded app name/branding in layouts and auth pages. ([architecture §1.3](public-repo-baseline.md#13-extension-providers))
- **Completed:** Tests: default provider bindings resolve, auth behavior regression-tested, branding renders from config. ([architecture §2.3](public-repo-baseline.md#23-regression-and-integration-coverage))

Status: provider interfaces, default bindings, product branding, and their regression coverage are in place.

## Phase 5 — Collaboration, sync, and regression coverage

- **Completed:** Multi-client convergence test through `operation-reducer`. ([architecture §2.3](public-repo-baseline.md#23-regression-and-integration-coverage))
- **Completed:** Offline-reconnect / operation-tail replay test for `ProjectSyncEngine`. ([architecture §2.3](public-repo-baseline.md#23-regression-and-integration-coverage))
- **Completed:** Realtime-gateway fan-out and unsubscribe tests. ([architecture §2.3](public-repo-baseline.md#23-regression-and-integration-coverage))
- **Completed:** Extend conflict-rule coverage for concurrent same-segment/track edits. ([architecture §2.3](public-repo-baseline.md#23-regression-and-integration-coverage))
- **Completed:** Verify (and fill gaps in) regression coverage for: segment-move identity, follow-head checkout, duplicate-track-after-recording. ([architecture §2.3](public-repo-baseline.md#23-regression-and-integration-coverage))
- **Completed:** Add the Postgres+MinIO integration suite (`*.integration.test.ts`) with the end-to-end command flow. ([architecture §2.3](public-repo-baseline.md#23-regression-and-integration-coverage))

## Phase 6 — CI

- **Completed:** Add `.github/workflows/ci.yml` with `lint`, `typecheck`, `unit`, `integration` (Postgres + MinIO services), and `build` jobs. ([architecture §2.4](public-repo-baseline.md#24-continuous-integration))
- **Completed:** Confirm all jobs pass on a PR and on `main`; note recommended branch protection in the README. ([architecture §2.4](public-repo-baseline.md#24-continuous-integration))

## Phase 7 — Release

- **Completed:** Bump all workspace versions to `1.0.0`. ([architecture §2.5](public-repo-baseline.md#25-release-baseline))
- **Completed:** Update README (releases note, downstream setup link, extension-point overview). ([architecture §2.5](public-repo-baseline.md#25-release-baseline))
- **Completed:** Tag `v1.0.0`, push the tag, and create the GitHub Release. ([architecture §2.5](public-repo-baseline.md#25-release-baseline))

Status: the stable public baseline has been tagged and released as `v1.0.0`.
