# Branch: `daw-realtime-collab`

Branch-scoped design context for combining real-time collaborative editing with
git-like versioning and a commit-graph Tree tab.

## Notes

- [Realtime editing + git-like versioning + Tree tab visualization](./realtime-versioning-and-tree.md)
- [Implementation record](./implementation-record.md) - source map, verified outcomes, and the phased history behind the current design.
- [Session Problems and Solutions](./session-problems-and-solutions.md) - required, actively maintained regression context for first-open recovery, reconnect, collaborator track creation, upload source selection, and version-tree payloads. Add new failures and verified solutions during the task that discovers them.
- [Version-tree initial-scroll findings](./version-history-tree-initial-scroll-findings.md) - historical diagnosis retained for regression context.

## Scope

- Keep automatic version saving, non-destructive revert, and branches that live
  concurrently with `main`.
- Move the live editing loop toward the OT/Jupiter model from `docs/papers/`.
- Visually represent the version DAG under the DAW **Tree** tab using the
  DoltHub commit-graph row/column layout with centered forks.
