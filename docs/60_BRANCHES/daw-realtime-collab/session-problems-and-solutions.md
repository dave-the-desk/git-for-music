# Session Problems and Solutions

This note records the concrete failures encountered while fixing realtime DAW collaboration, along with the corrective changes that resolved them.

## Maintenance Rule

Agents working on realtime sessions, reconnect, accepted operations,
collaborator updates, upload source selection, or version-tree payloads must
update this note when they discover or resolve a related problem. Each new
record must preserve:

- the user-visible or system-visible failure
- the source-verified root cause
- the corrective behavior and affected source paths
- the regression test or other verification that prevents recurrence
- any remaining limitation when the resolution is incomplete

Do not wait for a later documentation pass. Record the problem and solution in
the same task that establishes them, and distinguish confirmed behavior from an
unverified hypothesis.

## 1. First open did not live-update

Problem:

- A client that opened a demo could sit on a stale snapshot until the user manually refreshed.
- Realtime traffic could stall silently, so the page never pulled newer accepted operations.

Solution:

- Added a realtime silence watchdog to `ProjectSyncEngine`.
- Added a periodic catch-up loop so the client re-pulls accepted operations even when the stream stays quiet.
- Triggered an immediate catch-up when the realtime connection opens.
- Added a regression test that verifies the engine catches up on open and reconnects after silence.

## 2. Track cut changes did not sync for other users

Problem:

- Cutting an audio track updated the editor for the local user, but other collaborators did not see the new state until refresh.

Solution:

- Ensured accepted realtime operations are applied through the shared project sync state.
- Reused the same catch-up and reconnect path so quiet or stalled realtime sessions eventually recover without manual refresh.
- Kept a regression test covering the cut/split path in the sync engine.

## 3. Track creation on a blank demo lagged for collaborators

Problem:

- When one user added the first track to a blank demo, other connected users did not see the new track immediately.
- The UI could remain anchored to the old branch head because it waited on the wrong sync state instead of the selected checkout.

Solution:

- Extended the `TRACK_VERSION_CREATED` payload so the server sends the created version node together with the track.
- Updated the reducer so a follow-head client advances to the new branch head as soon as that version lands.
- Changed the demo DAW client to follow `currentVersionId` changes directly.
- Added regression coverage for:
  - a single client receiving a collaborator-created blank-demo track
  - two simultaneous clients staying aligned when one adds a track

## 4. New uploads briefly used stale source state

Problem:

- After a recording or upload, follow-up add-track actions could sometimes source from stale state if the active version sync had not fully caught up yet.

Solution:

- Introduced `resolveUploadSourceVersionId` so uploads and recording source from the selected checkout.
- Kept the selected checkout authoritative for add-track and recording flows while still tracking the latest committed version for fallback cases.
- Added a regression test for the upload source selection helper and the add-track flow.

## 5. Server payload shape did not fully support version-tree updates

Problem:

- The realtime operation payload for track creation was missing the created version snapshot, which limited the client’s ability to update its tree immediately.

Solution:

- Added the version snapshot to the `TRACK_VERSION_CREATED` payload in both upload entry points.
- Updated the shared command API types to match.
- Verified the server package typecheck did not report new errors for those paths.

## 6. Renaming a track could make a later track replace it

Problem:

- After a track was renamed, adding another track could remove one of the two
  lanes from the active version, making the newly added track appear to replace
  the existing track.
- A custom rename could also make the default label generator reuse `Track 1`,
  even though the existing lane was still the first logical track.

Verified cause:

- The first investigation found two genuine identity hazards: blank-track
  cleanup treated normalized `trackName` as a duplicate key, and default naming
  derived its counter only from labels. Correcting those hazards changed the
  reproduced new label from `Track 1` to `Track 2`, but did not stop the
  replacement.
- The follow-up database trace established the destructive sequence with high
  confidence. A populated add-track branch was followed by an `AUTO` or
  `SEMANTIC` child containing zero `TrackVersion` rows. The next add-track branch
  used that empty checkpoint as its parent, copied zero existing tracks, and
  therefore contained only the new `Track 2`.
- `createAutoDemoVersion` explicitly passed `copyTracks: false`. That made an
  automatic checkpoint a metadata-only node even though it became the user's
  active source version.
- Automatic checkpoints were announced only through the ephemeral
  `version_created` event. They did not write a durable `VERSION_NODE_ADDED`
  operation, so a client rebootstrap based on a persisted snapshot plus its
  operation tail could omit the checkpoint node. A later branch then referenced
  a parent absent from the rendered graph and appeared disconnected.

Corrective behavior:

- Duplicate placeholder cleanup now matches only stable logical `trackId`. It
  may replace a blank `TrackVersion` with audio for that same track, but it must
  preserve tracks with different IDs regardless of their names.
- Default track numbering considers durable lane position as well as existing
  generated labels. Renaming a lane changes neither its ID nor its place in the
  creation sequence.
- The upload branch builder appends when `existingTrackId` is null and replaces
  only when an existing ID is supplied explicitly.
- Automatic checkpoints now clone the source version's immutable track rows.
  The logical `trackId`, renamed display name, placement, clips, and plugin
  snapshot are preserved, while each checkpoint receives new `TrackVersion`
  and segment IDs.
- Each automatic checkpoint is recorded as a durable `VERSION_NODE_ADDED`
  operation containing its parent and cloned tracks. The accepted operation is
  emitted before the `version_created` refresh signal, so live replay,
  reconnect, and snapshot-tail bootstrap all materialize the connected node.
- Current-state bootstrap also reconciles version nodes from the durable
  `DemoVersion` table. This restores parents created by the older event-only
  implementation, while historical operation-sequence reads intentionally
  remain isolated from later database nodes.

Affected source:

- `src/app/lib/daw/utils/track-duplicate-cleanup.ts`
- `packages/server/app/lib/daw/server/track-duplicate-cleanup.ts`
- `src/app/lib/daw/utils/track-names.ts`
- `src/app/lib/daw/state/operation-reducer.ts` through its cleanup call
- `packages/server/app/lib/daw/server/commands/upload-track.ts` and
  `packages/server/app/lib/daw/server/assets/complete-upload.ts` through their
  server cleanup calls
- `packages/server/app/lib/daw/server/versioning.ts`
- `packages/server/app/lib/daw/server/command-api.ts`
- `packages/server/app/lib/daw/server/snapshot-builder.ts`

Regression evidence:

- `src/app/lib/daw/state/operation-reducer.test.ts` replays rename, branch, and
  create operations and asserts the old and new logical IDs both remain.
- `src/app/lib/daw/state/timeline-edit-transforms.test.ts` asserts rename keeps
  both `trackId` and `trackVersionId` unchanged.
- Client and server cleanup tests assert same-name, different-ID tracks survive
  while same-ID blank/audio copies still reconcile.
- `src/app/lib/daw/utils/track-names.test.ts` asserts a renamed first lane yields
  `Track 2` for the next default label.
- `packages/server/app/lib/daw/server/commands/upload-track.test.ts` asserts a
  renamed source track and a newly created track keep distinct IDs.
- `packages/server/app/lib/daw/server/versioning.test.ts` proves the automatic
  checkpoint preserves the renamed logical `trackId`, creates a distinct
  `TrackVersion`, retains the source parent, and supplies that track to the next
  add-track branch clone.
- `packages/server/app/lib/daw/server/command-api.test.ts` proves the automatic
  node is durably recorded as `VERSION_NODE_ADDED` with its connected parent and
  cloned track payload.
- `packages/server/app/lib/daw/server/snapshot-builder.test.ts` proves current
  bootstrap restores a durable node missing from an older operation tail while
  retaining its parent, kind, and operation sequence.

## Validation Used

- `pnpm --filter @git-for-music/web test -- src/app/lib/daw/engine/project-sync-engine.test.ts`
- `pnpm --filter @git-for-music/web test -- src/app/lib/daw/state/operation-reducer.test.ts`
- `pnpm --filter @git-for-music/web test -- src/app/pages/groups/demo/components/daw/DemoDawClient.interaction.test.tsx`
- `pnpm --filter @git-for-music/web exec node --import tsx --test app/lib/daw/utils/track-duplicate-cleanup.test.ts app/lib/daw/utils/track-names.test.ts app/lib/daw/state/timeline-edit-transforms.test.ts app/lib/daw/state/operation-reducer.test.ts`
- `pnpm --filter @git-for-music/server exec node --import tsx --test app/lib/daw/server/track-duplicate-cleanup.test.ts app/lib/daw/server/commands/upload-track.test.ts`
- `git diff --check`

## Outcome

- Collaborator edits now propagate through the live DAW without requiring refresh for the cases covered above.
- The session left behind direct regression coverage for first open recovery, blank-demo track creation, and two-client alignment.
- Track names are display metadata only; rename and creation reconciliation now
  preserve distinct logical IDs.

## 7. Moving a clip to another track changed its audio source

Problem:

- Cross-track `SEGMENT_MOVED` replay already transferred one stable segment ID
  between lanes, but the durable segment row identified only its destination
  `TrackVersion`.
- Playback consequently loaded the destination track version's audio file, so
  a moved clip kept its trim numbers while playing samples from the wrong asset.
- The legacy segment-position route could not name a destination track, and
  same-track undo submitted the old placement as both the current and restored
  bounds, causing authoritative stale-bound validation to reject it.

Verified cause:

- `Segment.trackVersionId` served two incompatible roles: timeline ownership
  and audio-source identity. Reassigning it was sufficient for lane rendering
  and collaboration replay but necessarily changed the buffer selected by the
  playback engine.
- Move conflict scopes named only the source track version, so overlapping
  concurrent moves into the same destination lane could avoid destination
  overlap detection.

Corrective behavior:

- `Segment.sourceTrackVersionId` now pins the immutable audio origin. Legacy
  null values resolve to the owning track; the first cross-track move records
  the source before changing destination ownership.
- Snapshot, accepted-operation, split, clone, optimistic replay, and reconnect
  paths preserve the source identity and playback URL. A move still updates the
  existing segment row and never creates a duplicate.
- Playback fetches the segment source buffer but connects it to the destination
  track bus, so destination mute, solo, gain, pan, and effects remain
  authoritative.
- Move conflict scopes include source and destination track versions. Invalid
  or deleted destinations are rejected before mutation.
- The legacy position route accepts `toTrackVersionId`, and same-track undo now
  validates from the clip's current placement before restoring the prior one.

Affected source:

- `packages/db/prisma/schema.prisma` and
  `packages/db/prisma/migrations/20260715120000_add_segment_audio_source/migration.sql`
- `packages/server/app/lib/daw/server/command-api.ts`
- `packages/server/app/lib/daw/server/conflict-rules.ts`
- `packages/server/app/lib/daw/server/snapshot-builder.ts`
- `packages/server/app/lib/daw/server/versioning.ts`
- `src/app/lib/daw/state/timeline-edit-transforms.ts`
- `src/app/lib/daw/engine/playback-engine.ts`
- `src/app/pages/groups/demo/components/daw/DemoDawClient.tsx`

Regression evidence:

- Server mutation tests prove an empty-lane move retains one segment ID, trim,
  fades, gain, and source; reject an invalid destination; and reverse the move.
- Snapshot and version-clone tests prove source identity survives replay and
  version boundaries.
- Conflict tests prove concurrent moves consider their shared destination.
- Reducer and project-sync tests prove remote clients rehome the clip once and
  preserve identity without duplicates.
- Playback tests prove source-buffer selection and destination gain, mute,
  solo, and plugin routing.
- Timeline-drag tests prove undo uses the current bounds as its authoritative
  `from` placement and the previous bounds as its destination.

### Follow-up: implicit clips duplicated and loaded destination placeholder audio

Observed failure:

- A newly recorded or uploaded track with no persisted `Segment` rendered one
  implicit full-track clip. Dragging that clip still entered whole-track offset
  mode, so it could not be moved into another lane.
- An empty destination was backed by a generated placeholder WAV that had been
  classified as ordinary `audio/wav`. It therefore rendered as another clip.
- Timeline waveform rendering always passed the destination track's audio URL
  and MIME type to `TrackSegmentClip`, producing a duplicate-looking clip and
  the browser unsupported-format message even though the playback engine used
  the segment source.

Verified cause:

- Segment absence overloaded two states: an untouched track whose whole audio
  should be implicit, and an explicitly edited lane that legitimately contains
  zero clips. Moving the only implicit clip left the source with zero rows, so
  reload recreated it.
- The lane component did not resolve `sourceTrackVersionId` and
  `sourceStorageKey` when constructing its waveform player.

Corrective behavior:

- `TrackVersion.segmentsInitialized` now distinguishes untouched implicit audio
  from explicit clip mode. It is persisted, cloned, serialized, replayed, and
  set by move, split, and delete operations.
- Moving an implicit clip atomically creates exactly one persisted destination
  segment, records the original track as its audio source, publishes the new
  stable ID plus segment snapshot, and initializes both lanes. Reducers replace
  the implicit ID and keep the source lane empty after reconnect.
- Segment pointer-down now starts clip movement for implicit clips. Waveform
  rendering resolves the segment source URL and MIME instead of the destination
  placeholder.
- Empty-track uploads use an explicit source type, and narrow migrations repair
  existing generated placeholders that were stored as ordinary WAV tracks.

Affected source:

- `packages/db/prisma/schema.prisma` and the `20260715143000`,
  `20260715144500`, and `20260715145500` migrations
- `packages/server/app/lib/daw/server/command-api.ts`
- `packages/server/app/lib/daw/server/snapshot-builder.ts`
- `packages/server/app/lib/daw/server/versioning.ts`
- `src/app/lib/daw/state/timeline-edit-transforms.ts`
- `src/app/lib/daw/state/selectors.ts`
- `src/app/pages/groups/demo/components/daw/DemoDawClient.tsx`
- `src/app/pages/api/daw/assets/sign-upload/index.ts`

Regression evidence:

- Server mutation coverage proves an implicit source becomes one stable segment
  on the destination and both lanes enter explicit mode.
- Timeline transform coverage proves accepted replay replaces the implicit ID,
  preserves the source URL, and leaves the source empty.
- Selector coverage proves initialized zero-segment lanes remain empty after
  reload and moved waveforms resolve the source track's URL and MIME.
- The latest `newOne` database state was verified as a WebM source plus a custom
  empty-track destination with zero segments.
