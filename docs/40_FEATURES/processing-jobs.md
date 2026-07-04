# Processing Jobs

This note points to the current job model and the server-side job plumbing.

## Read First

- [docs/processing-jobs.md](../processing-jobs.md)
- [packages/server/app/lib/processing/index.ts](../../packages/server/app/lib/processing/index.ts)
- [packages/server/app/lib/daw/server/jobs/index.ts](../../packages/server/app/lib/daw/server/jobs/index.ts)
- [packages/shared/src/index.ts](../../packages/shared/src/index.ts)

## Useful Source Paths

- [packages/server/app/lib/processing/jobs.ts](../../packages/server/app/lib/processing/jobs.ts)
- [packages/server/app/lib/daw/server/jobs/create-processing-job.ts](../../packages/server/app/lib/daw/server/jobs/create-processing-job.ts)
- [packages/server/app/lib/daw/server/jobs/upload-processing.ts](../../packages/server/app/lib/daw/server/jobs/upload-processing.ts)
- [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma)

## Practical Notes

- The repo-local processing doc is the primary description of the current and future job model.
- Shared payloads in `packages/shared/src/index.ts` and schema enums in `packages/db/prisma/schema.prisma` should stay aligned.
