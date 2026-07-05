# Current DAW UI Explanation

This note explains how the DAW demo currently looks and feels in the app. It is a snapshot of the live UI, not the aspirational research plan in `ideal-daw-ui-ux-design.md`.

## Overall Shape

- The page uses a dark, high-contrast shell with rounded panels, subtle borders, and a restrained neon accent palette.
- The layout is organized as three stable zones:
  - left browser rail
  - center workspace / version history / timeline area
  - right inspector rail
- The top demo shell stays pinned while the rest of the workspace scrolls beneath it.

## Visual Tone

- Backgrounds are deep navy and slate, with lighter slate borders and soft panel fills.
- Primary accents are cyan, emerald, amber, rose, indigo, and violet.
- Controls favor rounded pills, soft glows, and light shadows instead of hard-edged chrome.
- Text hierarchy is compact and functional: uppercase micro-labels for section headers, bold white section titles, muted slate helper text.

## Shell Hierarchy

- The top shell carries the page identity, project timing, and recording controls.
- The top control row is intentionally compact and dense, but the main title remains large and readable.
- Sticky behavior matters: the shell should feel always available and visually anchored above the workspace.

## Left Browser Rail

- The browser rail is a focused control surface for upload, plugins, and members.
- The old search/filter row is removed; the left rail opens directly into tab controls and content.
- The upload state is presented as a cleaner form card:
  - short explanatory text
  - track name field
  - custom file-picker card
  - prominent upload action
- The file picker is styled as a card with a visible `Choose file` affordance and inline selected-file text.
- Primary action buttons are clearly separated from the form fields and use stronger fills and rounded corners.

## Center Workspace

- The center area is the most visually dense region.
- The version history rail is treated as a first-class UI block, not a secondary tab strip.
- The version tree header is clean and compact:
  - section title
  - color key chips directly below the title
  - action buttons directly below the key
- The inner collapse toggle was removed; the rail-level collapse button remains in the rail header.
- The graph body is scrollable inside a fixed-height viewport.
- The workspace should feel like an active canvas with enough space for nodes, links, and history cards to breathe.

## Right Inspector Rail

- The inspector is a stacked information rail with a single primary comments block.
- The comments card is the most important card in the inspector and defines the visual height relationship used by the version history rail.
- The current inspector content is intentionally lean:
  - comment metadata
  - track scope selector
  - comment entry area
- Card surfaces use rounded borders, modest padding, and subdued slate fills.

## Button Language

- Primary actions use filled pills or filled rounded rectangles.
- Secondary actions use border-first pills with gentler fills.
- Danger or destructive actions use rose accents.
- Toggle buttons are visually explicit, but still small enough to fit the dense DAW shell.

## Form Language

- Inputs use dark fills, light borders, and soft focus rings.
- Forms are compact and vertically disciplined.
- The UI prefers short helper copy over verbose instructions.
- File input treatment should feel custom, not browser-default.

## Motion And Feedback

- Motion is minimal and functional.
- Hover states, subtle scale changes, and attention highlights are the main feedback mechanisms.
- The UI should not rely on animation to explain structure.

## Practical Notes

- Preserve the pinned top shell.
- Preserve the left / center / right layout.
- Preserve the current version-history height match to the inspector comments block.
- Keep the browser rail focused on task entry, not on search or extra chrome.
- Keep the version tree readable, scrollable, and visually dense without adding extra controls back into the tree body.
