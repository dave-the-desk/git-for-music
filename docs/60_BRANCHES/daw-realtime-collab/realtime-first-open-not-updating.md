# Bug: Opening an existing demo does not live-update until a manual refresh

Branch: `daw-realtime-collab`

Extends: [realtime-versioning-and-tree](./realtime-versioning-and-tree.md) and
[daw realtime sync model](../../architecture/daw-realtime-sync.md).

## 1. Symptom

- User A opens a demo they did **not** create (an already-existing demo).
- The DAW renders, but nothing another collaborator does appears. Tracks,
  edits, new versions, head moves — none of it streams in.
- The moment User A does a **full browser refresh**, the page starts live
  updating normally for the rest of the session.

The distinguishing detail the report calls out — "a demo they created" works but
"a demo that already exists" does not — is the key clue, and it maps directly to
two different navigation code paths (see §3).

## 2. What is actually correct (so we do not fix the wrong layer)

The durable reduce/render path is sound. When the DAW realtime `EventSource`
is genuinely connected, remote changes flow correctly:

- The server SSE route replays every operation after `afterSeq` on connect and
  then streams live events, buffering live events until the initial replay is
  flushed, so there is **no gap** between bootstrap and the live stream
  (`src/app/pages/api/daw/projects/[projectId]/realtime/index.ts:52-149`).
- `accepted_operation`, `version_created`, `branch_created`, `head_moved`,
  `reverted` are all handled on the client and either reduce into
  `LocalProjectState` or trigger a `rebootstrapFromServer()`
  (`@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/engine/project-sync-engine.ts:605-741`).
- Engine state changes emit to the React subscription, so the UI re-renders
  (`@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:484-488`).
- Follow-head display selection updates `selectedVersionId` when the active
  version moves, so the tree stays focused on the live branch head
  (`@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:1545-1558`).

So the problem is **not** the reducer, the version tree, or the render layer.
The problem is that the realtime channel never becomes live on a first open.

## 3. Root cause

### 3.1 The two navigation paths differ

Creating a demo forces a fresh route load, opening an existing demo does not.

Create (works):

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/project/project-page-client.tsx:92-94
      closeCreateDemoModal();
      router.push(`/groups/${groupSlug}/projects/${projectSlug}/demos/${data.id}`);
      router.refresh();
```

Open existing (broken):

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/project/project-page-client.tsx:135-139
              <Link
                key={demo.id}
                href={`/groups/${groupSlug}/projects/${projectSlug}/demos/${demo.id}`}
                className="block px-6 py-4 transition-colors hover:bg-gray-800/60 focus:bg-gray-800/60 focus:outline-none"
              >
```

The creation path pairs `router.push(...)` with `router.refresh()`, which
invalidates the App Router cache and re-runs the route as a fresh load — close
enough to a hard reload that the realtime channel comes up clean. Opening an
existing demo is a **plain soft client-side navigation** with no refresh. This
is exactly the "created vs already-existing" split in the report.

### 3.2 Why the soft navigation leaves the DAW stream dead

The DAW realtime `EventSource` is only ever established as a fire-and-forget
side effect at the tail of `ProjectSyncEngine.bootstrap()`:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/engine/project-sync-engine.ts:693-704
  private openRealtimeConnection() {
    if (!this.projectId || !this.demoId) return;

    this.closeRealtimeConnection();

    const source = new EventSource(
      `/api/daw/projects/${this.projectId}/realtime?demoId=${this.demoId}&afterSeq=${this.getLastSeenOperationSeq()}`,
    );

    source.addEventListener('open', () => {
      this.setState({ isOnline: true, lastError: null });
    });
```

On a soft navigation, the group/project/list pages the user passed through each
hold a **separate long-lived SSE stream** open through `useRealtimeRefresh`
(`src/app/pages/groups/lib/use-realtime-refresh.ts:10-35`), used by
`GroupsClient`, `GroupPageClient`, and `ProjectPageClient`. During a soft
transition the previous route's stream is not torn down as decisively as it is
on a full reload, so the newly-mounted DAW `EventSource` competes for the
browser's per-origin HTTP/1.1 connection budget (6) and can come up "connected
but starved" — it never actually delivers events. A full reload destroys every
in-flight stream at once, freeing the budget, so the DAW stream connects and
starts flowing. That is why the manual refresh reliably fixes it.

### 3.3 There is no recovery net

Even once the stream is starved, nothing forces it back to life:

- The SSE `error` handler only flips `isOnline` to `false`; it does not force a
  reopen or a catch-up
  (`@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/engine/project-sync-engine.ts:733-738`).
- The SSE `open` handler does not run a catch-up, so anything missed while the
  socket was dead is never pulled
  (`@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/engine/project-sync-engine.ts:702-704`).
- The only recovery path, `handleReconnect()` (catch-up + reopen SSE), is wired
  **only** to the browser `online` event and the tab `visibilitychange` event
  (`@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:1001-1008`
  and `:1186-1191`). Neither fires during a same-tab soft navigation, so the
  dead stream is never noticed until the user reloads.

The server already emits a `: ping` heartbeat every 25s
(`src/app/pages/api/daw/projects/[projectId]/realtime/index.ts:85-87`), but the
client never uses it to detect a stalled connection.

## 4. Proper fix (aligned with the realtime spec)

The spec requires the **live editing plane** to be live immediately on open
(realtime-versioning-and-tree §3 and §8.3: "the tree renders from live
`LocalProjectState.versions`" and updates on `version_created` /
`head_moved` / etc.). The fix is to make the live channel reliable regardless of
how the page was reached, not to special-case navigation.

Recommended changes, smallest-to-most-robust:

- **Catch up on connect.** In `openRealtimeConnection()`, on the `open` event,
  run `catchUpFromServer()` so any operations that landed while the socket was
  connecting/starved are pulled immediately. This is a one-line hook into the
  existing recovery method.

- **Add a liveness watchdog.** Track the timestamp of the last received event or
  heartbeat. If nothing arrives within a window (for example ~30s, comfortably
  above the 25s server ping), call `handleReconnect()` (which already does
  catch-up + reopen). This recovers a starved stream on a first open without a
  manual reload, and covers dev-server / transient stalls generally.

- **Recover on `error`.** The `error` handler should schedule a
  `handleReconnect()` (with backoff) instead of only flagging `isOnline: false`,
  so a broken stream self-heals.

- **Reduce concurrent SSE pressure (root of §3.2).** The DAW stream should not
  have to fight the workspace refresh streams for the HTTP/1.1 connection
  budget. Options, in order of preference:
  - Ensure `useRealtimeRefresh` streams are closed synchronously on navigation
    away (verify no lingering `EventSource` after leaving group/project/list
    pages).
  - Serve realtime over HTTP/2 (or a fetch-based stream) so long-lived SSE does
    not count against the 6-connection-per-origin HTTP/1.1 cap.
  - Longer term, consolidate the per-page workspace streams and the DAW stream
    behind a single shared realtime channel per origin.

- **Do not "fix" this by adding `router.refresh()` to the demo `<Link>`.** That
  would mask the defect with a full re-render on every open and still leaves the
  live channel fragile for any later stall. It is a workaround, not the fix.

### Suggested verification

- Two browser sessions on the same demo: with the watchdog + connect-catch-up in
  place, User A opens the existing demo via the demo list `<Link>` (no reload)
  and sees User B's edits/versions stream in within the heartbeat window.
- Kill the DAW stream mid-session (simulate a starved/broken socket) and confirm
  the watchdog reconnects and back-fills missed operations without a reload.
- Add a client-side unit/integration test around `ProjectSyncEngine` that:
  simulates an `open` with intervening server operations and asserts a catch-up
  runs; simulates heartbeat silence and asserts `handleReconnect()` fires.

## 5. Related files

- `src/app/pages/groups/project/project-page-client.tsx` (navigation split)
- `src/app/pages/groups/lib/use-realtime-refresh.ts` (workspace SSE streams)
- `src/app/lib/daw/engine/project-sync-engine.ts` (`openRealtimeConnection`,
  `handleReconnect`, `catchUpFromServer`, `bootstrap`)
- `src/app/pages/groups/demo/components/daw/DemoDawClient.tsx` (reconnect wiring
  on `online` / `visibilitychange`)
- `src/app/pages/api/daw/projects/[projectId]/realtime/index.ts` (SSE route +
  heartbeat)
</CodeContent>
<parameter name="EmptyFile">false
