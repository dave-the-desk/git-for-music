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
- Version-tree design: [docs/60_BRANCHES/daw-realtime-collab/realtime-versioning-and-tree.md](../60_BRANCHES/daw-realtime-collab/realtime-versioning-and-tree.md) — the commit-graph model this plan promotes to a first-class rail (see §10).
- Research grounding (see §11):
  - Oviatt (2006), *Human-Centered Design Meets Cognitive Load Theory* — [docs/papers/general-ui-design-practices/1180639.1180831.pdf](../papers/general-ui-design-practices/1180639.1180831.pdf).
  - Brooke (1996), *SUS: A quick and dirty usability scale* — [docs/papers/general-ui-design-practices/systemusabilityscale%28sus%29_comp%5B1%5D.pdf](../papers/general-ui-design-practices/systemusabilityscale%28sus%29_comp%5B1%5D.pdf).
- Platform / framework guidelines (see §11):
  - Apple **Human Interface Guidelines** — https://developer.apple.com/design/human-interface-guidelines
  - React DOM **common components** reference — https://react.dev/reference/react-dom/components/common

## 2. Current UI inventory (what exists today — must all survive)

Captured from `DemoDawClient.tsx` and its component files:

- **Top header** — back button, demo title + description, microphone status, `AudioInputSelector`.
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:3192-3227`
- **Multi-rail body** — browser, timeline canvas, version tree rail, and inspector remain visible as separate zones.
  - `@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:3456-3708`
- **Browser / section controls** — left rail navigation for upload, plugins, and members; `DawToolbarTabs` remains a supporting sibling component.
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
| **1. Representation freedom** | Waveform/clip view only | Keep the editing surface non-modal and readable; additional representations are out of scope for this alignment pass. |
| **2. Metaphor as hint, not cage** | Timeline + clip metaphor is clear | Keep; add plain-language labels and expert shortcuts. |
| **3. Progressive disclosure** | Tools are visible in the rail shell | Fine baseline; keep a clean default surface and avoid cluttering the visible rails. |
| **4. Multi-parameter control** | One mouse fader at a time (`Vol` per track) | Add mixer with grouped/rubber-band fader selection later; hardware/touch parity is aspirational. |
| **5. Ear-first counterbalance** | Visual timeline dominant | Add audition-on-hover in browser, solo-in-place (solo exists), optional focus/dim mode. |
| **6. Non-destructive everywhere** | **Strong** — versioning + tree already core | This is the project's superpower; make the tree/history **always visible**, not tab-hidden. |
| **7. Defaults visible & escapable** | Tempo shown; grid implicit | Surface grid/meter/tempo in the ruler with one-click toggles. |
| **8. One fluid environment** | Capture + edit + arrange in one page | Keep; reduce mode friction between panels. |
| **9. Room for happy accidents** | None yet | Future experiments can live outside this alignment pass. |
| **10. Consistency & recall** | Stable single-page layout | Add nameable/colorable tracks (rename exists), and a command palette later. |

**Headline finding:** the project already nails the ideal's hardest principle - **non-destructive versioning (§2.6, §4)** - but still benefits from a clearer visual hierarchy. The plan's spine is to promote the tree to a persistent, first-class zone while tightening the browser, canvas, inspector, and top-bar presentation.

## 4. Target layout (adapts the ideal §3.1 frame to this app)

Re-map the ideal's browser · canvas · inspector frame onto existing pieces. The **version tree becomes a first-class rail** — this is the git-for-music differentiator and satisfies §4's "visible history timeline."

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR: back · demo name · transport · time · tempo (shared+local) ·          │
│          metronome · record-mode · mic/AudioInputSelector · view/focus toggle  │
├───────────┬──────────────────────────────────────────┬──────────────────────┬──────────────────┤
│ LEFT      │ MAIN CANVAS — Arrange / Timeline         │ VERSION TREE RAIL    │ RIGHT INSPECTOR  │
│ BROWSER   │ • TimelineRuler (grid/tempo/meter)       │ • Commit graph       │ • Track/clip props│
│ (Upload · │ • Per-track lanes (label rail: name,     │ • Branch head /      │ • Volume/pan/gain │
│  Plugins ·│   R/M/S, Vol) + clips/waveforms/comments │   checkout / revert  │ • Comments (ctx)  │
│  Members ·│ • Timeline tools: select/split/merge/fade│ • Expand / collapse  │ • future device   │
│  Files)   │                                          │   full screen         │   chain, sends    │
├───────────┴──────────────────────────────────────────┴──────────────────────┴──────────────────┤
│ VERSION TREE RAIL (first-class): commit-graph VersionHistoryTree — branch/checkout/revert,       │
│ rename/follow-head/scrub, per-branch color, topological rows, column-assigned branches/merges.    │
│ Collapsible, expandable full-screen, never removed. (See §10 for the visual model.)              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Body + collapsible rails** gives the spatial stability the ideal calls for (§3.1, §2.10) and matches Apple HIG's *depth*/consistency foundations (§11.2).
- Every existing feature keeps a home: tabs (`upload/plugins/members`) migrate into the **left browser**; comments become a **context inspector panel** and keep their timeline markers; timing/transport/metronome consolidate into the **top bar**; the version tree remains a first-class rail.
- **The tree is promoted, not moved out of reach** — it graduates from a tab to a dockable, collapsible rail rendered as a **commit-graph** (row/column DAG) per [realtime-versioning-and-tree.md](../60_BRANCHES/daw-realtime-collab/realtime-versioning-and-tree.md); it can also expand full-screen. Full visual spec in §10.
- Clicking a node opens a version-details pop-up; the checkout action lives in that pop-up rather than as an inline node control.

## 5. Phased implementation plan

Each phase is independently shippable, additive, and preserves all current behavior. Run the relevant tests after each phase (see §8).

### Phase 0 — Layout scaffolding (no feature change)
- Introduce a multi-rail shell wrapper around the existing content (CSS grid / flex), with each rail **collapsible and persisted per project + per user** (localStorage keyed by `projectId`).
- Keep all current components mounted; only relocate their containers. Verify `DemoDawClient.interaction.test.tsx` still passes.

### Phase 1 — Promote the version tree to a first-class rail (commit-graph)
- Move `VersionHistoryTree` out of the `tree` tab into a persistent, collapsible rail (default expanded on wide screens).
- Keep the `tree` tab as a redundant entry point (or redirect it to focus/expand the rail) so nothing is lost.
- Adopt the **commit-graph visual model** from [realtime-versioning-and-tree.md §8](../60_BRANCHES/daw-realtime-collab/realtime-versioning-and-tree.md): topological rows, head→root column assignment, per-branch color, live refresh on `version_created`/`branch_created`/`head_moved`/`reverted`. Detailed spec in §10.
- This directly realizes the ideal's "visible history timeline" (§4) using the app's existing strength, and gives the git-for-music differentiator a self-explanatory metaphor (Apple HIG *clarity*, §11.2) at low cognitive load (Oviatt, §11.1).

### Phase 2 — Consolidate the top bar
- Fold `TransportControls`, `ProjectTimingControls`, metronome, record-mode, and `AudioInputSelector` into a single sticky top bar.
- Make grid/tempo/meter **visibly editable in the ruler** with one-click enable/disable (§1.5, §2.7). Local vs. shared tempo semantics are unchanged.

### Phase 3 — Left browser zone
- Reparent `upload`, `plugins`, and `members` tab content into a left browser panel (tabbed or accordion).
- Add **taggable/searchable** scaffolding and **audition-on-hover** hooks for future sample/loop/preset browsing (§3.6). Upload flow and tempo-analysis prompt unchanged.

### Phase 4 — Right inspector zone
- Add a context inspector bound to the selected track/clip: name, `Vol`/gain, mute/solo/record-arm mirrored here, plus space for future pan, device chain, and sends (§3.4, §3.5).
- Comments become an inspector panel; timeline comment markers stay.

## 6. Component-level change map

| Area | File | Change |
|---|---|---|
| Shell / zones | `DemoDawClient.tsx` | Wrap existing sections in a multi-rail grid; add collapse state + persistence. |
| Tree rail | `VersionHistoryTree.tsx`, `version-tree-layout.ts`, `DemoDawClient.tsx` | Render tree in a persistent rail as a commit-graph (row/column DAG, per-branch color, live refresh); keep tab as alias. See §10. |
| Top bar | `TransportControls.tsx`, `ProjectTimingControls.tsx`, `AudioInputSelector.tsx` | Compose into one sticky bar; add ruler grid/tempo toggles. |
| Left browser | `DawToolbarTabs.tsx` | Repurpose tabs into browser sections (upload/plugins/members) + search. |
| Inspector | new `TrackInspector.tsx` (proposed) | Selected-track props; mirror R/M/S/Vol; host `CommentInput`. |
| Ruler | `TimelineRuler.tsx` | Make grid/tempo/meter visibly toggleable. |

New components are **additive**; no existing component is deleted.

## 7. Feature Preservation Inventory

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
- Add commit-graph layout tests (column assignment with branch + merge children) alongside the tree-rail work (§10, §11.3).
- Manual pass: confirm every §7 item is reachable and functional.
- Run a **SUS pass per phase** and gate merges on the score trend (§12); SUS is designed exactly for version-to-version comparison of one product.

## 9. Anti-patterns to avoid (from ideal §5)

- **Metaphor lock-in** — keep views swappable; never trap edits in a modal.
- **Silent defaults** — surface grid/tempo/meter; don't hide 4/4 @ 120.
- **Eye-over-ear tunnel vision** — pair the visual timeline with audition/focus tools.
- **Regression by relocation** — every move must keep the feature reachable; the tree must never be less accessible than today.

## 10. Version tree UI & visual display (commit-graph)

The version tree is git-for-music's differentiator, so the plan promotes it from a tab to a first-class rail **and** upgrades its visual model to a real commit-graph. This section imports the design from [realtime-versioning-and-tree.md §8](../60_BRANCHES/daw-realtime-collab/realtime-versioning-and-tree.md) into this UI plan; that note remains the authoritative source for the layout algorithm and data model.

### 10.1 What the rail shows

- The full version DAG for the demo: versions (commits), branches, and — when merging lands — merges, all read live from `LocalProjectState.versions` (never stale props).
- The git↔DAW mapping the tree makes visible: `Demo`≈repository, `DemoVersion`≈commit (`parentId` → DAG edge), branch head `DemoVersion`≈branch pointer, per-user `DemoUserActiveVersion`≈HEAD/checkout, and revert as a **new** node whose content equals an ancestor.
- Provenance/kind per node (`auto` | `semantic` | `explicit` | `revert` | `branch` | `merge`) so autosave checkpoints, named saves, and reverts are visually distinguishable.

### 10.2 Commit-graph layout (adapt DoltHub row/column model)

Keeps the centered commit-graph layout in `version-tree-layout.ts`:

- **Build relations** — from `versions[]` build a `childrenMap` keyed by `parentId`; keep multi-parent support so merges render later.
- **Rows = topological order** — sort by (`createdAt`, `operationSeq`, `id`) as `compareVersions` does; row index = y. Pick newest-at-top or -bottom and keep it stable.
- **Columns via a head→root pass** — branch head (no children) → new column; multiple branch children → center the parent between those branch children; a single branch child → keep that column; only merge children → search rightward from the leftmost child's column for the first free column so merge edges point right-to-left.
- **Color per branch/column** — keep the current semantic palette as the baseline: current branch blue, current branch head lighter blue, other-branch nodes lighter yellow, other-branch heads darker yellow. Selection is secondary and should not replace branch meaning.

### 10.3 Rendering & affordances (all preserved, promoted)

- Keep the SVG approach: `<circle>`/node cards for versions, `<line>`/`<path>` for parent→child edges (already driven by a `nodeById` map).
- Keep the badges aligned to the current semantic palette: **current branch head**, **current branch**, **other branch nodes**, **other branch heads**.
- Keep node details in a pop-up with the checkout action at the bottom; the node itself stays visually simple with only its title and user.
- Preserve **pan/scroll** for wide graphs and the **expand/minimize** toggle; in the new layout the rail can also expand full-screen.

### 10.4 Live updates

- On `version_created` / `branch_created` / `head_moved` / `reverted`, the tree recomputes layout and animates the new node in — no reload.
- Auto-checkpoints (debounce + operation-count + semantic boundaries) surface as new nodes; audio blobs never enter the realtime transport, so the tree stays lightweight.

### 10.5 Why this fits the ideal + research

- **Non-destructive-everywhere made visible** (ideal §2.6/§4): a persistent DAG is the strongest possible "visible history timeline."
- **Low cognitive load** (Oviatt, §11.1): a stable, spatially consistent graph with per-branch color offloads memory to the display instead of the user's working memory.
- **Clarity & depth** (Apple HIG, §11.2): topological rows + colored columns communicate structure at a glance; expand/collapse gives depth without clutter.

## 11. Design foundations from research & platform guidelines

New grounding layered onto the ideal's ten principles (§3). These are *design constraints*, not new features.

### 11.1 Cognitive-load & human-centered design (Oviatt 2006)

Core claim: minimize **extraneous** cognitive load (imposed by the interface) so users' limited working-memory and attention go to the **intrinsic** task (making music). Applied here:

- **Cut extraneous complexity of output** — a clean default surface; advanced controls via progressive disclosure (ideal §2.3). Don't show every feature at once.
- **Minimize interruptions** — avoid modal dialogs and blocking error messages mid-flow; prefer inline, non-blocking feedback (reinforces the "never trap edits in a modal" anti-pattern, §9). "Continuous partial attention" is the enemy of creative flow.
- **Design out errors instead of reporting them** — structured, constrained inputs (e.g., ruler tempo/meter toggles, typed fields) reduce error states rather than surfacing them after the fact.
- **Multimodal / flexible input** — let users choose the input that is least error-prone for them (mouse, keyboard shortcuts, touch later); parity across modes lowers load and errors. Backs the multi-parameter control aspiration (ideal §2.4).
- **Leverage existing engrained behavior** — reuse the git mental model and DAW timeline metaphors users already know rather than inventing new ones.

### 11.2 Apple Human Interface Guidelines

Adopt the HIG's core design pillars and foundations as review criteria for every phase:

- **Clarity** — legible type, precise iconography, purposeful use of color; the version tree and transport must be self-explanatory. Prefer plain-language labels (ideal §2.2).
- **Deference** — the UI defers to content: the waveform/timeline and the music are the focus; chrome (rails, toolbars) is quiet and collapsible.
- **Depth** — layering and transitions (collapsible rails, expandable tree, highlighted selection states) communicate hierarchy without overwhelming; movement is meaningful, not decorative.
- **Foundations to honor:**
  - **Accessibility** — keyboard operability, focus order, sufficient contrast, and Dynamic-Type-style scalable text; every control reachable without a mouse (see §11.3).
  - **Consistency** — stable placement of transport/tempo/tools so muscle memory holds (ideal §2.10); same control means the same thing everywhere.
  - **Feedback** — immediate, proportionate response to every action (play/record state, checkpoint created, branch created), matching the optimistic-local-apply realtime model.
  - **Layout & hit targets** — comfortable spacing and adequately sized targets for faders, R/M/S, and tree nodes; responsive from wide (rail-based) to narrow (stacked) screens.
  - **Color & Dark Mode** — per-branch tree colors and state accents must remain distinguishable in light/dark and for color-vision deficiencies (pair color with shape/label).

### 11.3 React DOM implementation guidance (common components)

Concrete, framework-level rules for building the above accessibly and correctly, from the React DOM common-components reference:

- **Accessibility props** — apply `aria-*` and `role` attributes on custom controls (tree nodes, faders, toolbar buttons) so they expose name/state/role; React passes ARIA and `data-*` attributes straight through to the DOM.
- **Keyboard events** — implement `onKeyDown`/`onKeyUp` for tree navigation (arrow keys between nodes), transport (space to play/pause), and tools; never rely on `onClick`-only. Keyboard support is required for the HIG accessibility foundation (§11.2).
- **Focus management** — use `onFocus`/`onBlur` and managed focus (via `ref`) when opening the inspector or expanding the tree, so focus lands predictably and returns on close (avoids the "interruption" load in §11.1).
- **Pointer over mouse events** — prefer `onPointerDown`/`onPointerMove`/`onPointerUp` for faders, clip drag, split/merge, and tree pan so touch, pen, and mouse work from one code path (the multimodal-parity point in §11.1/ideal §2.4).
- **Controlled inputs** — keep tempo, rename, and comment fields controlled (value + `onChange`) so they stay in sync with `LocalProjectState`; this preserves the realtime "render from live state" rule.
- **`style` vs `className`** — use `className` (Tailwind) for static styling and the `style` prop only for dynamic values not known ahead of time (e.g., computed node x/y, fader position, waveform width). Node positions from the §10.2 layout are exactly this dynamic case.
- **`ref` for imperative needs** — use a `ref` (object or callback) to measure/scroll the tree SVG, focus inputs, and drive canvas/waveform rendering; avoid reading the DOM outside refs.
- **Avoid `dangerouslySetInnerHTML`** — never inject user-authored comment/label content as raw HTML (XSS risk); render as text. Use `suppressHydrationWarning` only as a narrow escape hatch (e.g., timestamps), never broadly.

## 12. Success metrics & usability measurement (SUS)

Use the **System Usability Scale** (Brooke 1996) as the lightweight, quantitative gate for the re-arrangement, because SUS is explicitly built to compare *versions of the same product* quickly and reliably.

- **Instrument** — the standard 10-item Likert scale (5-point agree/disagree) with alternating positive/negative wording; scored to a single **0–100** number. It measures subjective usability, complementing task-based effectiveness/efficiency (ISO 9241-11).
- **Cadence** — run SUS with a small set of representative users after each phase (§5) on the same core tasks: record a take, edit/split a clip, add a comment, create a branch, revert to an earlier version.
- **Gate** — a phase should not regress the SUS trend; the tree-promotion (Phase 1) and top-bar consolidation (Phase 2) specifically target higher scores by lowering cognitive load (§11.1).
- **Caveats from the paper** — SUS gives a *global* usability read, not diagnostics; don't over-interpret a single administration, and pair it with task success rates and qualitative notes to know *what* to fix. Avoid cross-product comparisons ("apples vs oranges"); only compare our own successive versions.

## 13. References

- Oviatt, S. (2006). *Human-Centered Design Meets Cognitive Load Theory: Designing Interfaces that Help People Think.* ACM Multimedia '06. — [PDF](../papers/general-ui-design-practices/1180639.1180831.pdf)
- Brooke, J. (1996). *SUS: A "quick and dirty" usability scale.* — [PDF](../papers/general-ui-design-practices/systemusabilityscale%28sus%29_comp%5B1%5D.pdf)
- Apple. *Human Interface Guidelines.* — https://developer.apple.com/design/human-interface-guidelines
- React. *Common components (e.g. `<div>`).* React DOM reference. — https://react.dev/reference/react-dom/components/common
- [Realtime editing + git-like versioning + tree tab visualization](../60_BRANCHES/daw-realtime-collab/realtime-versioning-and-tree.md)
- [Ideal DAW UI/UX design](ideal-daw-ui-ux-design.md)
