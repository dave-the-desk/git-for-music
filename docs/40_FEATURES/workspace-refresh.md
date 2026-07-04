# Workspace Refresh

This note covers the non-DAW realtime lane used by the group and project shells.

## Read First

- [docs/architecture/codebase-architecture.md](../architecture/codebase-architecture.md)
- [docs/architecture/daw-realtime-sync.md](../architecture/daw-realtime-sync.md)

## Implementation Paths

- [packages/server/app/lib/workspace-realtime.ts](../../packages/server/app/lib/workspace-realtime.ts) publishes workspace refresh events.
- [src/app/pages/groups/lib/use-realtime-refresh.ts](../../src/app/pages/groups/lib/use-realtime-refresh.ts) subscribes on the client and triggers `router.refresh()`.
- [src/app/api/groups/realtime/route.ts](../../src/app/api/groups/realtime/route.ts) is the top-level app route handler for the refresh stream.
- [src/app/api/groups/[groupSlug]/realtime/route.ts](../../src/app/api/groups/[groupSlug]/realtime/route.ts) and [src/app/api/groups/[groupSlug]/projects/[projectSlug]/realtime/route.ts](../../src/app/api/groups/[groupSlug]/projects/[projectSlug]/realtime/route.ts) expose scoped refresh streams.

## What It Is Not

- It is not the same as DAW `accepted_operation` sync.
- It does not carry timeline or editor state.
- It is for list and shell data such as groups, projects, demos, and membership changes.

## Related Notes

- [[10_REPOS/server]]
- [[30_UI/ui-routing]]
