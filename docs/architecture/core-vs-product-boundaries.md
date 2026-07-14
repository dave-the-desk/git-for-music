# Core vs Product Boundaries

This repository is the public core baseline for Git for Music. The private hosted-product fork is expected to keep downstream changes in a small, documented surface so upstream merges remain low-conflict.

## Boundary Rules

- Treat source under `src/app/lib/daw/`, `packages/server/app/lib/daw/`, `packages/shared/`, and `packages/db/` as core.
- Treat `src/app/product/` as the only downstream-editable application surface.
- Keep app shell and route code in `src/app/` as core with extension hooks, not as a place for hosted-product forks to diverge freely.
- Prefer additive migrations over edits to shared schema history in downstream forks.
- Do not place hosted-product vendor integrations, branding, or feature-registration overrides in shared core code.

## Directory Classification

| Path | Classification | Notes |
|---|---|---|
| `src/app/lib/daw/` | Core | Client DAW engine, state, rendering, and helpers. |
| `packages/server/app/lib/daw/` | Core | Server DAW commands, snapshots, realtime, storage, and jobs. |
| `packages/shared/` | Core | Shared contracts, helpers, config, and feature registry primitives. |
| `packages/db/` | Core | Prisma schema and database bootstrap. |
| `src/app/` | Core with hooks | App routes, pages, and shell code that can consume product bindings. |
| `src/app/product/` | Downstream editable | Feature registrations, provider bindings, and branding overrides. |

## Expected Downstream Usage

Private forks should confine customizations to:

- `src/app/product/`
- `.env` and other deployment-specific environment files
- Additive database migrations

Anything else should be treated as upstream core and proposed back to the public repository first.
