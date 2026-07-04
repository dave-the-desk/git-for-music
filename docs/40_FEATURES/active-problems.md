# Active Problems

This is a living file for confirmed implementation issues and investigation notes.

Use it for problems that future agents should know about immediately.

## Example Entries

### Moving creates a new track

Expected:
Moving a segment should preserve track identity unless the user explicitly moves it to another existing track.

Problem:
Current behavior creates a new track unexpectedly.

Relevant concepts:

- Track vs TrackVersion
- Segment move operation
- Operation reducer
- Shared realtime operation

### Users should follow branch head

Expected:
A user should automatically follow the head of their selected branch unless they intentionally check out a detached version.

Problem:
Refresh or collaboration state can move users away from the intended branch head.

### Remote edit reducer crash

Error:
Cannot read properties of undefined reading id.

Likely area:
`operation-reducer.ts`

Investigation:
Check whether remote operations assume local-only segment or track structures that are not present after sync.

## Related Context

- [[40_FEATURES/versioning-mental-model]]
- [[40_FEATURES/merge-and-conflict-guide]]
- [[01_PROTOCOLS/agent-implementation-guide]]

