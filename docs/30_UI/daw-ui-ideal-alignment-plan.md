# DAW UI Alignment Plan — Toward the Ideal Design

> **Scope:** A theoretical UI/UX plan that evolves *this project's* DAW editor toward the research-grounded reference in [ideal-daw-ui-ux-design.md](ideal-daw-ui-ux-design.md).
>
> **Status:** Planning document only. Not an implementation contract. No source has been changed.
>
> **Hard constraint:** *Nothing currently in the DAW is removed.* Every existing capability — especially the **version history tree** — is preserved and, where possible, promoted to a more prominent, first-class position. This is a re-arrangement and augmentation plan, not a rewrite.

## 1. Source of truth

- Reference design: [docs/30_UI/ideal-daw-ui-ux-design.md](ideal-daw-ui-ux-design.md)
- Current implementation: [src/app/pages/groups/demo/components/daw/DemoDawClient.tsx](../../src/app/pages/groups/demo/components/daw/DemoDawClient.tsx) and its sibling components.
- Feature context: [docs/40_FEATURES/daw-editor.md](../40_FEATURES/daw-editor.md), [src/app/lib/daw/README.md](../../src/app/lib/daw/README.md)

## 2. Current UI inventory (what exists today — must all survive)

Captured from `DemoDawClient.tsx` and its component files:

- **Top header** — back button, demo title + description, microphone status, `AudioInputSelector`.
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:3192-3227`
- **Two-column grid body** (`xl:grid-cols-[1.35fr_1fr]`).
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:3229-3272`
- **Tabbed panel** — `DawToolbarTabs` with tabs `edit | upload | plugins | tree | comments | members`.
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DawToolbarTabs.tsx:3-17`
- **Project timing** — shared demo tempo (fixed) + local tempo input.
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/ProjectTimingControls.tsx:14-43`
- **Transport** — stop / play-pause / time readout, with `RecordingControls` in the leading slot and a metronome toggle in the trailing slot.
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/TransportControls.tsx:30-72`
- **Timeline** — heading + Add Comment, `TimelineRuler`, project-level comment markers.
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:3809-3906`
- **Per-track lane** — label rail (name/rename, `Derived` badge, `R` record-arm, `M` mute, `S` solo, `Vol` slider) plus the clip lane (playhead, blank-track ticks, `RecordingTrackLane`, `TrackSegmentClip`, comment markers, waveforms).
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:3908-4139`
- **Timeline tools** — `select | split | merge | fade`.
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:318`
- **Version history tree** — `VersionHistoryTree` (branching, checkout, revert, rename, follow-head, history scrubbing), currently reached via the `tree` tab.
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/VersionHistoryTree.tsx:70-110`
- **Add track** — `AddTrackButton`; **Comments** — `CommentInput`; **Upload** — upload form + tempo-analysis prompt.

## 3. Gap analysis — current vs. the ideal's ten principles

| Ideal principle (ref §2) | Today | Gap / opportunity |
|---|---|---|
| **1. Representation freedom** | Waveform/clip view only | No piano roll / notation / spectral / automation. Add a swappable **detail/edit pane** (tabs), never modal. |
| **2. Metaphor as hint, not cage** | Timeline + clip metaphor is clear | Keep; add plain-language labels and expert shortcuts. |
| **3. Progressive disclosure** | Tools live behind the `edit` tab | Fine baseline; keep a clean default surface, reveal advanced controls on demand. |
| **4. Multi-parameter control** | One mouse fader at a time (`Vol` per track) | Add mixer with grouped/rubber-band fader selection later; hardware/touch parity is aspirational. |
| **5. Ear-first counterbalance** | Visual timeline dominant | Add audition-on-hover in browser, solo-in-place (solo exists), optional focus/dim mode. |
| **6. Non-destructive everywhere** | **Strong** — versioning + tree already core | This is the project's superpower; make the tree/history **always visible**, not tab-hidden. |
| **7. Defaults visible & escapable** | Tempo shown; grid implicit | Surface grid/meter/tempo in the ruler with one-click toggles. |
| **8. One fluid environment** | Capture + edit + arrange in one page | Keep; reduce mode friction between panels. |
| **9. Room for happy accidents** | None yet | Future: humanize/randomize, generative helpers. |
| **10. Consistency & recall** | Stable single-page layout | Add nameable/colorable tracks (rename exists), and a command palette later. |

**Headline finding:** the project already nails the ideal's hardest principle — **non-destructive versioning (§2.6, §4)** — but hides its differentiator (the tree) inside a tab. The plan's spine is to promote the tree to a persistent, first-class zone while adopting the ideal's **three-zone frame** and **representation-freedom** editor.

## 4. Target layout (adapts the ideal §3.1 frame to this app)

Re-map the ideal's browser · canvas · inspector frame onto existing pieces. The **version tree becomes a first-class rail** — this is the git-for-music differentiator and satisfies §4's "visible history timeline."

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR: back · demo name · transport · time · tempo (shared+local) ·          │
│          metronome · record-mode · mic/AudioInputSelector · view/focus toggle  │
├───────────┬────────────────────────────────────────────────┬──────────────────┤
│ LEFT      │  MAIN CANVAS — Arrange / Timeline               │ RIGHT INSPECTOR  │
│ BROWSER   │  • TimelineRuler (grid/tempo/meter visible)     │ • Track/clip props│
│ (Upload · │  • Per-track lanes (label rail: name, R/M/S,    │ • Volume/pan/gain │
│  Plugins ·│    Vol) + clips/waveforms/recording/comments    │ • (future) device │
│  Members ·│  • Timeline tools: select/split/merge/fade      │   chain, sends    │
│  Files)   ├────────────────────────────────────────────────┤ • Comments (ctx)  │
│           │  DETAIL/EDIT PANE (tabs, non-modal):            │                   │
│           │  waveform (now) → piano roll/notation/          │                   │
│           │  automation/spectral (future)                   │                   │
├───────────┴────────────────────────────────────────────────┴──────────────────┤
│ VERSION HISTORY RAIL (first-class): VersionHistoryTree — branch/checkout/       │
│ revert/rename/follow-head/scrub. Collapsible, never removed.                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Three-zone body + collapsible rails** gives the spatial stability the ideal calls for (§3.1, §2.10).
- Every existing feature keeps a home: tabs (`upload/plugins/members`) migrate into the **left browser**; comments become a **context inspector panel** and keep their timeline markers; timing/transport/metronome consolidate into the **top bar**.
- **The tree is promoted, not moved out of reach** — it graduates from a tab to a dockable, collapsible bottom (or right) rail that can also expand full-screen.

## 5. Phased implementation plan

Each phase is independently shippable, additive, and preserves all current behavior. Run the relevant Jest tests after each phase (see §8).

### Phase 0 — Layout scaffolding (no feature change)
- Introduce a three-zone shell wrapper around the existing content (CSS grid / flex), with each zone **collapsible and persisted per project + per user** (localStorage keyed by `projectId`).
- Keep all current components mounted; only relocate their containers. Verify `DemoDawClient.interaction.test.tsx` still passes.

### Phase 1 — Promote the version tree to a first-class rail
- Move `VersionHistoryTree` out of the `tree` tab into a persistent, collapsible rail (default expanded on wide screens).
- Keep the `tree` tab as a redundant entry point (or redirect it to focus/expand the rail) so nothing is lost.
- This directly realizes the ideal's "visible history timeline" (§4) using the app's existing strength.

### Phase 2 — Consolidate the top bar
- Fold `TransportControls`, `ProjectTimingControls`, metronome, record-mode, and `AudioInputSelector` into a single sticky top bar.
- Make grid/tempo/meter **visibly editable in the ruler** with one-click enable/disable (§1.5, §2.7). Local vs. shared tempo semantics are unchanged.

### Phase 3 — Left browser zone
- Reparent `upload`, `plugins`, and `members` tab content into a left browser panel (tabbed or accordion).
- Add **taggable/searchable** scaffolding and **audition-on-hover** hooks for future sample/loop/preset browsing (§3.6). Upload flow and tempo-analysis prompt unchanged.

### Phase 4 — Right inspector zone
- Add a context inspector bound to the selected track/clip: name, `Vol`/gain, mute/solo/record-arm mirrored here, plus space for future pan, device chain, and sends (§3.4, §3.5).
- Comments become an inspector panel; timeline comment markers stay.

### Phase 5 — Detail/edit pane (representation freedom)
- Add a non-modal, tabbed detail pane below the canvas. Ship **waveform** first (wraps existing `TrackWaveform`/`TrackSegmentClip` rendering).
- Stub tabs for **piano roll**, **notation**, **automation**, **spectral** — disabled/"coming soon" until backed by data, so the frame exists without faking capability (§3.3, anti-pattern: dead-end stubs must be labeled).

### Phase 6 — Ear-first + happy-accident affordances (optional/aspirational)
- Focus/dim ("eyes-closed") mode, solo-in-place polish, and later humanize/randomize + generative helpers (§4, §2.9).

## 6. Component-level change map

| Area | File | Change |
|---|---|---|
| Shell / zones | `DemoDawClient.tsx` | Wrap existing sections in a three-zone grid; add collapse state + persistence. |
| Tree rail | `VersionHistoryTree.tsx`, `DemoDawClient.tsx` | Render tree in a persistent rail; keep tab as alias. |
| Top bar | `TransportControls.tsx`, `ProjectTimingControls.tsx`, `AudioInputSelector.tsx` | Compose into one sticky bar; add ruler grid/tempo toggles. |
| Left browser | `DawToolbarTabs.tsx` | Repurpose tabs into browser sections (upload/plugins/members) + search. |
| Inspector | new `TrackInspector.tsx` (proposed) | Selected-track props; mirror R/M/S/Vol; host `CommentInput`. |
| Detail pane | new `DetailEditPane.tsx` (proposed) | Tabbed, non-modal; waveform now, others stubbed. |
| Ruler | `TimelineRuler.tsx` | Make grid/tempo/meter visibly toggleable. |

New components are **additive**; no existing component is deleted.

## 7. Preservation checklist (nothing lost)

- Version history tree — **preserved and promoted** (Phase 1).
- Timeline + per-track lanes, clips, waveforms, recording lane — preserved (moved into canvas).
- Track controls: rename, `Derived` badge, record-arm, mute, solo, volume — preserved (canvas + mirrored in inspector).
- Timeline tools select/split/merge/fade — preserved.
- Upload + tempo-analysis prompt, plugins, members, comments (+ markers) — preserved (relocated into browser/inspector).
- Transport, metronome, shared/local tempo, microphone selector — preserved (top bar).
- Realtime sync behavior (render from live `LocalProjectState`) — **unchanged**; this is a presentation-layer plan only.

## 8. Verification

- After each phase, run the DAW interaction tests:
  - `pnpm jest DemoDawClient.interaction`
  - `pnpm jest VersionHistoryTree`
- Add layout/collapse persistence tests as zones are introduced.
- Manual pass: confirm every §7 item is reachable and functional.

## 9. Anti-patterns to avoid (from ideal §5)

- **Metaphor lock-in** — keep views swappable; never trap edits in a modal.
- **Silent defaults** — surface grid/tempo/meter; don't hide 4/4 @ 120.
- **Dead-end stubs** — label unbuilt editor tabs clearly; don't fake capability.
- **Eye-over-ear tunnel vision** — pair the visual timeline with audition/focus tools.
- **Regression by relocation** — every move must keep the feature reachable; the tree must never be less accessible than today.
