# Shared Repository

Package: `@git-for-music/shared`

This package holds shared enums, request and response shapes, storage helpers, and queue/protocol contracts.

## Read First

- [packages/shared/src/index.ts](../../packages/shared/src/index.ts)
- [packages/shared/src/protocol/index.ts](../../packages/shared/src/protocol/index.ts)
- [packages/shared/src/queue.ts](../../packages/shared/src/queue.ts)
- [packages/shared/src/storage.ts](../../packages/shared/src/storage.ts)

## Important Paths

| Path | Role |
|---|---|
| `packages/shared/src/index.ts` | Main shared export surface |
| `packages/shared/src/protocol/` | Protocol-level types and contracts |
| `packages/shared/src/queue.ts` | Queue payload and job helper types |
| `packages/shared/src/storage.ts` | Storage path and object key helpers |

## Practical Notes

- Several enums are manually kept in sync with Prisma schema values.
- This package is a cross-cutting handoff layer between browser code, server code, and workers.

## Inventory

Use [docs/20_GENERATED_INVENTORIES/packages-shared-inventory.md](../20_GENERATED_INVENTORIES/packages-shared-inventory.md) for the current source-file map.

