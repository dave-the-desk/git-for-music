# DAW Version-State Debugging Protocol

Use this protocol when the DAW shows replaced or duplicated tracks, missing
audio, an incorrect checkout, a disconnected history node, or state that
changes after realtime reconciliation or reload.

The central rule is: debug the durable state transition, not only the rendered
symptom. A DAW view can be wrong because creation, version cloning, operation
replay, bootstrap, or UI projection lost state at different times.

## 1. State the behavioral invariants first

Write down what must remain stable and what must be newly allocated before
reading implementation details.

| Field | Meaning | Expected behavior |
|---|---|---|
| `trackName` | Mutable display metadata | May change or be reused |
| `trackId` | Stable logical lane identity | Rename preserves it; new-track creation allocates a distinct value |
| `trackVersionId` | Immutable track state inside a version | Version cloning allocates a new value while preserving `trackId` |
| `DemoVersion.id` | Version-history node identity | Every new version boundary allocates a new value |
| `DemoVersion.parentId` | Version graph edge | Must reference the actual source version |
| operation sequence | Durable replay order | Must contain every state transition needed to rebuild the current graph |

Do not use names, positions, labels, or array indexes as identity evidence.

## 2. Reproduce precisely and record symptom changes

Capture the shortest sequence that produces the problem, including the active
checkout and visible history state before every action. Record:

- selected and active version IDs
- old and new track names
- old and new logical track IDs when available
- whether the failure appears immediately, after an accepted operation, after
  a tree refresh, or only after reload
- whether the new history node has a visible parent

If a change alters the symptom but does not remove the failure, do not declare
the issue fixed. For example, changing a recreated lane from `Track 1` to
`Track 2` proves the naming path changed; it does not prove the original lane
survived.

## 3. Trace every layer that can transform the state

Follow the action from its source to its rendered result:

1. UI action and selected checkout
2. upload or command request payload
3. source-version resolution
4. `DemoVersion` creation and `parentId`
5. source `TrackVersion` cloning
6. new logical track creation or explicit existing-track targeting
7. durable operation-log payload
8. accepted-operation emission
9. client reducer application
10. bootstrap or reconnect reconstruction
11. final projection and duplicate cleanup

Search for both creation and deletion/replacement behavior. A correct UUID
allocation can still appear broken if a later cleanup pass removes the old
entry.

Useful searches include:

```sh
rg -n "trackId|trackVersionId|sourceVersionId|parentId" src/app/lib/daw packages/server/app/lib/daw
rg -n "TRACK_VERSION_CREATED|VERSION_NODE_ADDED|version_created" src/app packages/server/app/lib/daw
rg -n "duplicate|cleanup|prune|replace|filter" src/app/lib/daw packages/server/app/lib/daw
```

## 4. Build a read-only durable-state timeline

When the UI and source inspection leave more than one plausible cause, inspect
the local database without mutating it. Do not print connection strings or
secret-bearing environment variables.

For the affected demo, list version nodes in creation order with:

- version ID
- parent ID
- kind
- label
- operation sequence
- creation time
- count of attached `TrackVersion` rows

Then inspect the corresponding operation-log types and sequences. The useful
shape is a timeline, not a raw row dump:

```text
root        parent=null       tracks=0
branch A    parent=root       tracks=1
checkpoint parent=branch A   tracks=0
branch B    parent=checkpoint tracks=1
```

That pattern proves the loss happened when the checkpoint was created, before
the next branch or client reducer handled it. In contrast, two populated rows
in the database but one rendered lane points toward replay, projection, or
cleanup.

Always compare database evidence with source. A suspicious row pattern becomes
a high-confidence cause when the creation code explicitly produces that exact
pattern.

## 5. Separate the primary cause from adjacent defects

A single reproduction can expose multiple real bugs. Classify each finding:

- Primary cause: the transition that first violates the invariant.
- Amplifier: behavior that makes the damage more visible or more likely.
- Presentation defect: the durable state is correct but replay or rendering is
  incomplete.
- Compatibility defect: the new write path is correct, but already persisted
  data still reconstructs incorrectly.

Fixing an adjacent defect is worthwhile, but it does not close the incident
until the earliest invariant violation is corrected.

## 6. Turn the durable timeline into regression tests

Add tests at the smallest useful boundaries, then add one sequence test that
matches the observed failure.

Recommended coverage:

- Identity transform: rename changes only `trackName`.
- Creation helper: adding without an explicit existing ID appends a distinct
  `trackId`.
- Clone helper: a new version preserves logical `trackId` and allocates a new
  `trackVersionId`.
- Operation payload: a version node includes its parent and complete track
  snapshot.
- Reducer replay: rename, branch creation, and track creation leave both logical
  tracks present.
- Bootstrap compatibility: current state restores durable nodes omitted from
  an older operation tail, while historical sequence reads do not gain future
  nodes.
- End-to-end sequence: populated version -> checkpoint -> next branch retains
  the old track -> new track is appended with a distinct ID.

Whenever possible, write or modify the regression so it fails against the
identified bad behavior before applying the production fix. Do not preserve a
test that asserts the buggy state merely because it was previously green.

## 7. Fix the earliest broken boundary and its replay contract

For versioned DAW state, a complete fix normally needs all of these:

- correct durable rows
- correct parent relationship
- correct stable and immutable identifiers
- a complete durable operation payload
- live accepted-operation delivery
- reconnect/bootstrap reconstruction
- compatibility behavior for already persisted nodes when safe

An ephemeral tree-refresh event is not a substitute for a replayable operation.
If the client can only learn about a node from a live event, reload and reconnect
can produce a different graph.

Keep historical reads isolated. Compatibility reconciliation against current
database truth belongs only in current-state bootstrap, not in a request for an
older operation sequence.

## 8. Validate from focused tests outward

Run focused regressions first, then the package suites and static checks:

```sh
pnpm --filter @git-for-music/server exec node --import tsx --test path/to/regression.test.ts
pnpm --filter @git-for-music/web exec node --import tsx --test path/to/regression.test.ts
pnpm --filter @git-for-music/server test
pnpm --filter @git-for-music/web test:unit
pnpm --filter @git-for-music/web test
pnpm --filter @git-for-music/server typecheck
pnpm --filter @git-for-music/web typecheck
pnpm lint
git diff --check
```

Before handoff, explicitly confirm:

- rename preserved the original `trackId`
- the cloned version created a new `trackVersionId`
- new-track creation used a different logical `trackId`
- both tracks exist in the resulting branch
- every non-root history node resolves its parent
- current bootstrap and operation replay converge on the same graph

## 9. Calibrate confidence from independent evidence

Use confidence as an evidence summary, not intuition.

- Low: symptom and speculative source reading only.
- Medium: a focused test reproduces the failure or database rows show a likely
  transition.
- High, approximately 95%: repeated reproduction, durable-state timeline,
  source code that deterministically explains the rows, a regression that
  fails for the bad behavior, and passing focused plus package-level checks.

Reserve uncertainty for anything not exercised, such as a manual browser pass,
production-only infrastructure, or existing data that requires migration.

## 10. Record the incident for the next agent

For realtime, accepted-operation, track-creation, upload-source, or version-tree
issues, update
[Session Problems and Solutions](../60_BRANCHES/daw-realtime-collab/session-problems-and-solutions.md)
with:

- observed failure
- verified durable-state sequence
- cause and rejected hypotheses
- corrective behavior
- affected source
- regression evidence and commands

Also update the relevant feature or architecture note and the current daily
log. Documentation should explain why the fix is correct, not only list changed
files.

## Related Context

- [[01_PROTOCOLS/agent-implementation-guide]]
- [[01_PROTOCOLS/non-negotiable-rules]]
- [[40_FEATURES/timeline-editing-model]]
- [DAW realtime architecture](../architecture/daw-realtime-sync.md)
- [Session Problems and Solutions](../60_BRANCHES/daw-realtime-collab/session-problems-and-solutions.md)

