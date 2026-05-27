# DAW Realtime Checklist

Use this checklist when verifying realtime DAW behavior in two browser windows.

## Setup

- [ ] Open the same demo in Browser A and Browser B.
- [ ] Confirm both windows are connected to the same project.
- [ ] Keep the Tree tab open in at least one window.
- [ ] Keep the Members tab open in at least one window.

## Timeline Edits

- [ ] User A uploads a track and User B sees the new track without refresh.
- [ ] User A records and saves a track and User B sees the new track or take update.
- [ ] User A renames a track and User B sees the updated name.
- [ ] User A cuts a segment and User B sees the split.
- [ ] User A moves a segment and User B sees the new position.
- [ ] User A adds a comment and User B sees it.

## Version Tree Edits

- [ ] User A creates a version or branch and User B sees the new node in the Tree tab.
- [ ] User A renames a version and User B sees the updated label in place.
- [ ] User A changes the current version and User B sees the current highlight update if current version is shared.
- [ ] User B performs edits and User A sees the same changes.

## Reconnect And Sync

- [ ] Disconnect or disable realtime in one browser, make edits in the other, then reconnect.
- [ ] Confirm missed timeline operations are replayed after reconnect.
- [ ] Confirm missed version tree operations are replayed after reconnect.
- [ ] Confirm duplicate accepted operations are not applied twice.
- [ ] Confirm a large gap triggers catch-up or rebootstrap instead of a hard refresh.

## Notes

- Presence should remain realtime-only and must not appear in ProjectOperationLog or the Version Tree.
- If a step only works after a manual refresh, note the exact action and file path that needs follow-up.
