# Database Repository

Package: `@git-for-music/db`

This package owns the Prisma schema, migrations, and the shared Prisma client singleton.

## Read First

- [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma)
- [packages/db/src/index.ts](../../packages/db/src/index.ts)
- [packages/db/package.json](../../packages/db/package.json)

## Important Paths

| Path | Role |
|---|---|
| `packages/db/prisma/schema.prisma` | Durable data model |
| `packages/db/prisma/migrations/` | Migration history |
| `packages/db/prisma.config.ts` | Prisma configuration |
| `packages/db/src/index.ts` | Prisma client singleton and re-exports |

## Practical Notes

- `packages/db/src/index.ts` loads env files before creating the Prisma client.
- The schema is the source of truth for durable entities and job status enums.
- Keep schema changes and migration history aligned.

## Inventory

Use [docs/20_GENERATED_INVENTORIES/packages-db-inventory.md](../20_GENERATED_INVENTORIES/packages-db-inventory.md) for the current source-file map.

