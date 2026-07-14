# Public Repo Implementation Checklist

Ordered implementation steps for [public-repo-architecture-plan.md](public-repo-architecture-plan.md). Complete phases in order; steps within a phase are ordered too. Each phase should end with green tests before moving on.

## Phase 0 — Documentation groundwork

- [x] Publish the downstream private-repo setup guide ([downstream-private-repo-setup.md](downstream-private-repo-setup.md)) and link it from the README. ([plan: Downstream Model](public-repo-architecture-plan.md#downstream-model-context-for-every-decision-below))
- [x] Write `docs/architecture/core-vs-product-boundaries.md` declaring core vs. downstream-editable paths. ([plan §1.1](public-repo-architecture-plan.md#11-core-vs-product-boundaries))

## Phase 1 — Test suites, lint, and type checking (baseline safety net first)

- [x] Add `test` script to `packages/server` running all `node:test` files via `tsx --test`. ([plan §2.1](public-repo-architecture-plan.md#21-make-existing-tests-runnable-as-suites))
- [x] Add a unit-test script to `src` for non-interaction `node:test` files; keep Vitest for `*.interaction.test.tsx`. ([plan §2.1](public-repo-architecture-plan.md#21-make-existing-tests-runnable-as-suites))
- [x] Add root `test`, `test:server`, `test:unit` orchestration scripts; confirm every existing test file runs in exactly one suite and passes. ([plan §2.1](public-repo-architecture-plan.md#21-make-existing-tests-runnable-as-suites))
- [x] Extend ESLint coverage to `packages/server`, `packages/shared`, `packages/db/src`; add root `lint` script. ([plan §2.2](public-repo-architecture-plan.md#22-lint-and-type-checking-everywhere))
- [x] Add `typecheck` (`tsc --noEmit`) scripts to `src` and each package plus a root orchestrator; fix surfaced errors. ([plan §2.2](public-repo-architecture-plan.md#22-lint-and-type-checking-everywhere))

Status: the test, lint, and typecheck scripts are wired and green across `src/` and all packages.

## Phase 2 — Typed configuration module

- [x] Create `packages/shared/src/config/` (schema, loader with production validation, `getConfig()` singleton). ([plan §1.2](public-repo-architecture-plan.md#12-typed-configuration-module-env--config))
- [x] Audit all `process.env` reads; migrate `storage-provider.ts`, `plugins/index.ts`, and remaining call sites to `getConfig()` without renaming env vars. ([plan §1.2](public-repo-architecture-plan.md#12-typed-configuration-module-env--config))
- [x] Add the `no-process-env` ESLint rule allow-listed to the config module. ([plan: Risks](public-repo-architecture-plan.md#risks--mitigations))
- [x] Unit tests: parsing, validation errors, dev fallbacks blocked in production mode. ([plan §2.3](public-repo-architecture-plan.md#23-new-test-coverage))
- [x] Update `.env.example` and `.env.production.example`. ([plan §1.6](public-repo-architecture-plan.md#16-deploymentenvironment-behavior))

Status: typed config is in place, the remaining env reads have been routed through it, the validation tests pass, and the example env files are current.

## Phase 3 — Feature registry and flags

- [x] Create `packages/shared/src/features/` (`FeatureId`, `FeatureDefinition`, registry with duplicate-ID rejection and explicit override API). ([plan §1.4](public-repo-architecture-plan.md#14-feature-registry--typed-feature-flags))
- [x] Parse `FEATURE_*` env vars into `config.features`; env overrides registration defaults. ([plan §1.4](public-repo-architecture-plan.md#14-feature-registry--typed-feature-flags))
- [x] Create `src/app/product/register-features.ts` with public default registrations; register `plugins` and gate the plugin routes/UI on it. ([plan §1.4](public-repo-architecture-plan.md#14-feature-registry--typed-feature-flags), [§1.5](public-repo-architecture-plan.md#15-the-single-downstream-editable-surface))
- [x] Tests: registration, disabling via env, duplicate IDs, downstream override. ([plan §2.3](public-repo-architecture-plan.md#23-new-test-coverage))
- [x] Document the registry usage policy and add `FEATURE_PLUGINS` to `.env.example`. ([plan §1.4](public-repo-architecture-plan.md#14-feature-registry--typed-feature-flags))

Status: feature registry defaults, env overrides, and app-wide registration are wired; the registry and override behavior are covered by tests and the phase is complete.

## Phase 4 — Extension points (providers) and product surface

- [x] Create `packages/server/app/lib/extensions/` with `AuthProvider`, `StorageProvider`, `AnalyticsProvider`, `BillingProvider` interfaces. ([plan §1.3](public-repo-architecture-plan.md#13-extension-points-provider-interfaces))
- [x] Refactor existing cookie-session auth to implement `AuthProvider` (behavior unchanged); route all call sites through the interface. ([plan §1.3](public-repo-architecture-plan.md#13-extension-points-provider-interfaces))
- [x] Wrap the existing S3-compatible signer as the default `StorageProvider`. ([plan §1.3](public-repo-architecture-plan.md#13-extension-points-provider-interfaces))
- [x] Add no-op `AnalyticsProvider` and `BillingProvider` defaults with minimal initial call sites. ([plan §1.3](public-repo-architecture-plan.md#13-extension-points-provider-interfaces))
- [x] Create `src/app/product/providers.ts` binding all defaults; core resolves providers only through it. ([plan §1.5](public-repo-architecture-plan.md#15-the-single-downstream-editable-surface))
- [x] Create `src/app/product/branding.ts`; replace hard-coded app name/branding in layouts and auth pages. ([plan §1.3](public-repo-architecture-plan.md#13-extension-points-provider-interfaces))
- [x] Tests: default provider bindings resolve, auth behavior regression-tested, branding renders from config. ([plan §2.3](public-repo-architecture-plan.md#23-new-test-coverage))

Status: provider interfaces, default bindings, product branding, and their regression coverage are in place.

## Phase 5 — Collaboration, sync, and regression coverage

- [x] Multi-client convergence test through `operation-reducer`. ([plan §2.3](public-repo-architecture-plan.md#23-new-test-coverage))
- [x] Offline-reconnect / operation-tail replay test for `ProjectSyncEngine`. ([plan §2.3](public-repo-architecture-plan.md#23-new-test-coverage))
- [x] Realtime-gateway fan-out and unsubscribe tests. ([plan §2.3](public-repo-architecture-plan.md#23-new-test-coverage))
- [x] Extend conflict-rule coverage for concurrent same-segment/track edits. ([plan §2.3](public-repo-architecture-plan.md#23-new-test-coverage))
- [x] Verify (and fill gaps in) regression coverage for: segment-move identity, follow-head checkout, duplicate-track-after-recording. ([plan §2.3](public-repo-architecture-plan.md#23-new-test-coverage))
- [x] Add the Postgres+MinIO integration suite (`*.integration.test.ts`) with the end-to-end command flow. ([plan §2.3](public-repo-architecture-plan.md#23-new-test-coverage))

## Phase 6 — CI

- [x] Add `.github/workflows/ci.yml` with `lint`, `typecheck`, `unit`, `integration` (Postgres + MinIO services), and `build` jobs. ([plan §2.4](public-repo-architecture-plan.md#24-public-ci-workflow-github-actions))
- [ ] Confirm all jobs pass on a PR and on `main`; note recommended branch protection in the README. ([plan §2.4](public-repo-architecture-plan.md#24-public-ci-workflow-github-actions))

## Phase 7 — Release

- [ ] Bump all workspace versions to `1.0.0`. ([plan §2.5](public-repo-architecture-plan.md#25-tag-the-stable-release))
- [ ] Update README (releases note, downstream setup link, extension-point overview). ([plan §2.5](public-repo-architecture-plan.md#25-tag-the-stable-release))
- [ ] Tag `v1.0.0`, push the tag, and create the GitHub Release. ([plan §2.5](public-repo-architecture-plan.md#25-tag-the-stable-release))
