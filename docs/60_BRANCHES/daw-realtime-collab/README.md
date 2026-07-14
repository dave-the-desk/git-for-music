# Branch: `daw-realtime-collab`

Branch-scoped design context for combining real-time collaborative editing with
git-like versioning and a commit-graph Tree tab.

## Notes

- [Realtime editing + git-like versioning + Tree tab visualization](./realtime-versioning-and-tree.md)
- [Implementation checklist](./implementation-checklist.md) — grounded, phased tasks to modify the current repo toward the design.

## Scope

- Keep automatic version saving, non-destructive revert, and branches that live
  concurrently with `main`.
- Move the live editing loop toward the OT/Jupiter model from `docs/papers/`.
- Visually represent the version DAG under the DAW **Tree** tab using the
  DoltHub commit-graph row/column layout with centered forks.
