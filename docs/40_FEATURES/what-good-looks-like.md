# What Good Looks Like

A good implementation:

- Makes the current version clear
- Makes branch state clear
- Makes processing state clear
- Preserves original audio
- Makes conflicts understandable
- Lets users recover from mistakes
- Keeps collaborators in sync
- Does not surprise users by moving them to another branch
- Does not hide failed processing jobs
- Does not create duplicate tracks unexpectedly
- Does not mutate shared state from local-only actions

A bad implementation:

- Directly mutates audio state without a version
- Creates invisible local-only edits
- Moves all users to a new version unexpectedly
- Treats undo as local-only when the action was shared
- Stores important edit state only in React state
- Makes processing look finished before files are ready
- Allows overlapping edits to silently overwrite each other

## Related Context

- [[40_FEATURES/product-feel]]
- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]

