# DAW UI Layout Guide

This note defines **where UI elements and buttons should be located** in the Git for Music DAW. It is a layout/placement reference only. It does not cover visual styling, color, motion, or component behavior. For visual tone see [[30_UI/current-daw-ui-explanation]]. For the broader research rationale see [[30_UI/ideal-daw-ui-ux-design]] and [[30_UI/daw-ui-ideal-alignment-plan]].

## Sources

Layout decisions are grounded in the DAW manuals in `docs/papers/daw-UI/`:

- Ableton Live 11 manual (`ableton_live_intro_manual_en.pdf`, `live11-manual-en.pdf`) — Arrangement vs Session, mixer availability in both views.
- Avid Pro Tools intro (`Intro_to_Pro_Tools (1).pdf`) — Edit Window vs Mix Window separation.
- Reaper user guide (`ReaperUserGuide740c.pdf`) — transport bar, track control panel layout.
- Bitwig Studio user guide (`Bitwig_Studio_User_Guide_English_oPSjcZw.pdf`) — task-based views (Arrange/Mix), vertical mixer.
- Cubase / Studio One reference manuals — channel strip and inspector conventions.
- MasteringAudio (`MasteringAudio (1).pdf`) — non-destructive, source-preserving region model.

## Core Layout Principle

Git for Music should feel like a **music workspace first, a version-control system second**. The timeline is the visual center. Versioning, comments, and processing appear as badges, overlays, and collapsible side panels around the timeline, never as the primary interaction surface.

## Global Frame (stable across all views)

The frame stays constant so users never lose transport or navigation when switching tasks.

```
+-----------------------------------------------------------------------+
|  TOP TRANSPORT BAR                                                     |
+-------+-------------------------------------------------+-------------+
|       |                                                 |             |
| LEFT  |             CENTER WORK SURFACE                 |   RIGHT     |
| RAIL  |             (per-view content)                  |   PANEL     |
|       |                                                 |             |
+-------+-------------------------------------------------+-------------+
|  BOTTOM DETAIL / EDITOR PANEL (contextual, collapsible)               |
+-----------------------------------------------------------------------+
```

- **View switcher** lives at the top, inside or immediately below the transport bar (Bitwig task-view model): `Arrange | Mix | Versions | Review | Session Planning`.
- **Left rail**, **right panel**, and **bottom panel** are all collapsible. The center surface always remains.

## Top Transport Bar

A single stable bar across all main views. Left-to-right grouping:

- **Left group (playback):** play, stop, record, loop toggle, return-to-start.
- **Center-left group (musical grid):** tempo, key, time signature, metronome toggle, snap/grid selector.
- **Center group (project identity):** project/demo name, current branch/version label.
- **Right group (collaboration + status):** local mic/input selector, processing-status indicator, active-collaborator avatars, save/commit action.

Rule: transport controls stay in the same position regardless of the active view.

## Left Rail — Track Headers + Asset Browser

The left rail has two stacked responsibilities. In **Arrange** and **Mix** it shows track headers aligned to the timeline rows. It also hosts the asset/browser tab.

### Track header controls (per track row, aligned to timeline)

- Track name + role label (top of the header).
- Creator/owner avatar.
- Mute, solo, arm-record buttons (grouped together).
- Gain and pan (compact) for quick decisions while arranging.
- Input source selector.
- Lock-state toggle.
- Branch/version status badge and conflict badge (right edge of the header, adjacent to the timeline).

### Asset / browser tab

- Uploaded audio, takes, stems, reference tracks, processing outputs, reusable materials.
- Upload action lives at the top of this tab.
- Assets are staged here (Ableton Session-style ideas) before being placed into a DemoVersion on the timeline.

## Center Surface — Per View

### Arrange view (default)

- Tracks stacked vertically, time moving horizontally, aligned to a shared beat/time grid.
- Clips/segments render as regions on their track lane.
- Per-segment inline affordances: edit handles (trim), fade handles, split marker, selected-range highlight.
- Comment and annotation markers attach to musical time on the relevant lane.
- Version/conflict overlays appear on the affected time range, not as separate blocks.

### Mix view

- Center becomes a **vertical mixer** (Bitwig/Pro Tools model), replacing the timeline as the visual center.
- Each track = one channel strip, laid out left-to-right, controls top-to-bottom:
  - insert/effect slots (top)
  - sends
  - pan
  - meter + volume fader
  - mute / solo / arm
  - output routing selector (bottom)
- Master/output strip pinned to the far right.
- Timeline stays available as context (thin strip or collapsed), but is not the focus.

### Versions view

- Center shows the branch/version graph.
- Buttons for compare, revert, merge, and conflict resolution live in the graph header, above the graph body.
- Graph body scrolls inside a fixed-height viewport.

### Review view

- Center lists comments, lyric segments, transcription, annotations, and processing outputs as structured rows (Ardour Region-List model).
- Each row exposes: time range, track, creator, operation type, and comment count.

### Session Planning view

- Center lists equipment requirements, missing gear, and recording preparation notes.

## Right Panel — Collaboration + Version

Collapsible. Stacked top-to-bottom:

- Comments and annotations (primary block, top).
- Track-scope selector for comment entry.
- Branch/version tree access shortcut.
- Active collaborators.
- Pending operations and conflict-resolution prompts.

Rule: the right panel can be collapsed so recording/arranging stays uninterrupted until a versioning issue needs attention.

## Bottom Panel — Contextual Detail / Editor

Collapsible and context-driven.

- **No selection:** collapsed, or shows project-level info.
- **Segment selected:** shows clip-specific controls — trim values, fade in/out, gain, processing state, comments, annotations, transcription, lyric segments, and source/version metadata.

Rule: advanced per-clip detail lives here, keeping the timeline uncluttered.

## Placement Rules Summary

- **Transport** → top bar, always visible, fixed order.
- **View switcher** → top, next to transport.
- **Track identity + quick controls** → left rail headers, aligned to timeline rows.
- **Assets/ideas** → left rail browser tab, staged before timeline placement.
- **Primary work surface** → center, reorganized per view (timeline for Arrange, mixer for Mix).
- **Deep mix controls** → Mix view channel strips, not the Arrange timeline.
- **Collaboration + versioning** → right panel, collapsible.
- **Per-segment detail** → bottom panel, contextual.
- **Version graph actions** (compare/revert/merge/resolve) → Versions view graph header.

## Related Notes

- [[30_UI/current-daw-ui-explanation]]
- [[30_UI/ideal-daw-ui-ux-design]]
- [[30_UI/daw-ui-ideal-alignment-plan]]
- [[30_UI/ui-routing]]
