# Findings: version-history tree opens scrolled down (not at its root/top) on the demo DAW page

Status: resolved/historical as of 2026-07-11. The current source has a single
inner version-history scroll container in `VersionHistoryTree.tsx`, a rail
layout reset signal from `DemoDawClient.tsx`, and interaction coverage that
resets `scrollTop` when that layout signal changes.

## 2026-07-15 follow-up: initial full-height graph then shrinking viewport

Status: resolved.

This was a separate viewport-height initialization bug in the same rail. The
graph is a custom DOM/SVG visualization, not a graph-library canvas: node
coordinates come from `buildGraphLayout`, edges are SVG paths, zoom is a CSS
`scale()`, and pan is native scrolling. There are no `fitView`, `setViewport`,
`setCenter`, `zoomTo`, or bounds-to-viewport calls.

### Observed failure and verified cause

`DemoDawClient` initially rendered the graph column without a height. A
`useLayoutEffect` then measured `inspectorScrollRef` and wrote
`measurement + 45px` as an inline height on `version-tree-rail`. A
`ResizeObserver` repeated that write whenever the inspector changed size.

The measured inspector and the graph rail occupy the same auto-sized CSS Grid
row. Changing the graph height therefore changed the grid row, which changed
the inspector measurement, which produced the next graph height. The graph's
full intrinsic height participated in the first row calculation, and the
observer feedback then converged through multiple browser frames toward the
smaller side-rail height. This was the visible full-graph viewport followed by
slow shrinking. React Strict Mode could repeat observer setup, but it was not
the primary cause. No transform transition or graph zoom animation was
involved.

### Corrective behavior

- Removed `inspectorScrollHeightPx`, its layout effect and `ResizeObserver`,
  the arbitrary `+45px`, and the rail's post-render inline height.
- Applied desktop CSS size containment to the graph grid item. Its graph
  contents can no longer contribute their full intrinsic height to grid-row
  sizing, while normal grid stretch gives it the final sibling-established
  height during the browser's first layout.
- Gave the single-column/narrow layout an explicit 32rem viewport because size
  containment is only appropriate when the three desktop columns share a row.
- Scoped scroll reset identity to `demoId` plus expanded/collapsed state.
  Ordinary live graph-data changes no longer reset a user's viewport; opening a
  different demo or reopening the rail still resets it deliberately.
- Preserved header zoom controls and node attention animations. Zoom continues
  to update only the inner graph's CSS scale.

Affected source:

- `src/app/pages/groups/demo/components/daw/DemoDawClient.tsx`
- `src/app/pages/groups/demo/components/daw/DemoDawClient.interaction.test.tsx`
- `src/app/pages/groups/demo/components/daw/VersionHistoryTree.interaction.test.tsx`

### Regression and browser evidence

- Strict Mode interaction coverage asserts the graph is size-constrained on
  the initial render and never receives a measured inline height.
- Live-data coverage adds a version to an open graph and verifies the user's
  scroll viewport is preserved when graph identity is unchanged.
- Production Chromium sampling recorded the rail on every animation frame:
  - 27-version graph hard navigation: one unique height (`511px`) across 42
    samples; first sample at 10ms; graph content height `4352px` inside a
    `355px` scroller.
  - 1-version graph hard navigation: one unique height (`511px`); first sample
    at 7ms.
  - client-side navigation into the 27-version graph: one unique height
    (`511px`) across 70 samples; first visible sample at 271ms after navigation.
  - switching from a 2-version demo to the 27-version demo: each graph had one
    unique `511px` height from its first visible sample.
  - resizing to a narrow viewport produced one stable `512px` viewport with
    containment disabled; resizing back produced the desktop contained
    viewport without an inline height.
  - collapse/expand preserved the stable viewport; user zoom still changed the
    inner transform to `scale(0.875)`.

No temporary diagnostics remain in the product source.

Investigation of why the version-history graph in the demo DAW right-hand rail does **not**
start at its natural top on first render, and instead appears pre-scrolled to a lower part of
the tree before the user interacts with it.

## Historical Summary (95% confidence)

There is already a scroll-reset in `VersionHistoryTree`, but **it resets the wrong element**,
so it is a no-op in a real browser. The component resets its own inner
`treeScrollRef` container to `scrollTop = 0`, but because of the height/`overflow` chain in
`DemoDawClient`, that inner container never becomes the element that actually scrolls. The
element that actually overflows and scrolls is an **outer `overflow-auto` wrapper in
`DemoDawClient`** (the rail body), and nothing ever resets it.

On top of that, the rail's height is applied **after mount** (it starts `null`, then a
`useLayoutEffect` + `ResizeObserver` sets a fixed pixel height). So the sequence is:

1. First paint: the rail section has **no fixed height** (`inspectorScrollHeightPx === null`),
   so it grows to fit the entire tall graph and the outer wrapper does not overflow.
2. After mount, the height is measured and applied, the section shrinks to a fixed height, and
   the outer `overflow-auto` wrapper suddenly becomes a scroll container around content that is
   taller than it.
3. When that scroll container is created around already-laid-out tall content, the browser's
   scroll-anchoring / late constraint leaves it parked partway down instead of at the top — and
   the only reset in the codebase targets a different, non-scrolling element, so it is never
   corrected.

Net effect: the graph opens showing the lower/middle of the tree, with the root nodes above
the fold.

## The relevant code

### 1. The reset that exists but targets the wrong element

`VersionHistoryTree` resets its own inner scroll container on mount:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/VersionHistoryTree.tsx:191-197
  useLayoutEffect(() => {
    const scrollContainer = treeScrollRef.current;
    if (!scrollContainer) return;

    scrollContainer.scrollTop = 0;
    scrollContainer.scrollLeft = 0;
  }, []);
```

`treeScrollRef` is attached to this inner container (note it is `overflow-auto`):

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/VersionHistoryTree.tsx:313-318
      <div ref={treeScrollRef} data-testid="version-history-scroll-container" className="flex-1 min-h-0 overflow-auto">
        <div className="flex min-h-full min-w-full justify-center">
          <div
            className="relative"
            style={{ width: graphWidth * zoomLevel, height: graphHeight * zoomLevel }}
          >
```

The component root is a `flex-col` with `h-full`:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/VersionHistoryTree.tsx:290-291
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 text-slate-100">
```

### 2. The nested `overflow-auto` wrappers in `DemoDawClient` (the real scroller)

`VersionHistoryTree` is wrapped in **two** additional `overflow-auto` containers:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:4498-4525
              <div
                className={`mt-4 min-h-0 flex-1 rounded-xl border border-slate-800/70 bg-slate-950/70 ${
                  isVersionTreeRailExpanded ? 'overflow-auto' : 'max-h-0 overflow-hidden'
                }`}
              >
                <div className="flex min-h-0 min-w-full flex-1 overflow-auto">
                  <VersionHistoryTree
                    ...
                  />
                </div>
              </div>
```

Call these:

- **Wrapper A** (line 4498): `min-h-0 flex-1 ... overflow-auto`. It is a flex child of the
  fixed-height `section`, so it gets a **fixed** remaining height. It is **not** itself a flex
  container.
- **Wrapper B** (line 4503): `flex min-h-0 min-w-full flex-1 overflow-auto`. Its `flex-1` is
  **ignored** because its parent (Wrapper A) is not a flex container, so its height falls back
  to **content height (auto)**.

### 3. The rail height is applied after mount

The `section` height is driven by `inspectorScrollHeightPx`, which starts `null`:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:4440-4444
            <section
              ref={versionTreeRailRef}
              className="flex h-full min-h-0 flex-col overflow-hidden border-t border-slate-800/80 bg-slate-950/90 px-4 py-4"
              style={inspectorScrollHeightPx ? { height: `${inspectorScrollHeightPx + 45}px` } : undefined}
              data-testid="version-tree-rail"
            >
```

...and is only set after mount by a `useLayoutEffect` + `ResizeObserver`:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:415-427
  useLayoutEffect(() => {
    const element = inspectorScrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    const updateInspectorScrollHeight = () => {
      setInspectorScrollHeightPx(element.getBoundingClientRect().height);
    };

    updateInspectorScrollHeight();
    const observer = new ResizeObserver(updateInspectorScrollHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
```

## Why the inner reset never fires on the real scroller (the height chain)

For a percentage/`flex-1` child to become a scroll container, its height must be **constrained**
by an ancestor. Tracing the chain from the fixed-height `section` down:

- `section` — fixed height (from `inspectorScrollHeightPx`), `flex flex-col`.
- **Wrapper A** — `flex-1` child of the flex-col section, so it has a **fixed** height, and it
  is `overflow-auto`. **This is the element that can and does scroll.** But it is **not** a flex
  container.
- **Wrapper B** — `flex-1` is ignored (parent A is not flex), so B sizes to **content height**.
  Its `overflow-auto` therefore never triggers (it is exactly as tall as its content).
- `VersionHistoryTree` root — `h-full` = 100% of B; since B is content-sized this resolves to
  **content height** (circular percentage → auto).
- `treeScrollRef` (inner) — `flex-1 min-h-0` inside a content-sized parent, so it also grows to
  **content height**. It never overflows, so **its `scrollTop` is meaningless**.

Result: the `useLayoutEffect` sets `treeScrollRef.scrollTop = 0` on an element that has no
overflow, while the element that truly overflows — **Wrapper A** — is never reset. Whatever
scroll offset Wrapper A ends up with (see next section) is left untouched.

## Why Wrapper A ends up scrolled down rather than at 0

Two mount-order facts combine:

1. **Children's effects run before parents'.** `VersionHistoryTree`'s `useLayoutEffect` (the
   reset) runs first; at that moment the rail height has not been applied yet, so Wrapper A is
   not even a scroll container. The reset touches a non-scrolling inner element and finishes.
2. **The rail height is applied afterwards.** `DemoDawClient`'s
   `inspectorScrollHeightPx` `useLayoutEffect` then measures and sets the fixed section height.
   This shrinks the section, and Wrapper A — now shorter than its already-laid-out, tall content
   — becomes an active scroll container. Browsers do not guarantee `scrollTop = 0` when a
   scroll container is newly constrained around pre-existing taller content (scroll anchoring
   can keep previously-visible content in view), so Wrapper A can settle partway down.

Because nothing resets Wrapper A after this transition, the graph is displayed mid-tree with the
root above the fold — exactly the reported symptom.

## Why the existing test does not catch it

There is a passing test that appears to cover this, which is why the bug is easy to miss:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/VersionHistoryTree.interaction.test.tsx:282-336
  it('resets the tree scroll position to the top on mount', () => {
    ...
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    ...
      expect(scrollTopValue).toBe(0);
      expect(scrollLeftValue).toBe(0);
```

This test:

- Renders `VersionHistoryTree` **in isolation**, without the `DemoDawClient` wrapper chain, so
  the real scrolling element (Wrapper A) does not exist in the test at all.
- Globally stubs `HTMLElement.prototype.scrollTop`, so it only proves the component *assigns*
  `scrollTop = 0` to *some* element — not that the element which actually overflows in the real
  layout is reset.

So it gives false confidence: it verifies the assignment, not the outcome. This is strong
corroboration that the reset is aimed at the wrong element.

## Other candidates ruled out

- **Not a layout/graph-origin bug.** `buildGraphLayout` places the root at `row = 0` / `top =
  paddingY` and lays children downward, so the natural top of the content is the root. The graph
  coordinates are correct; the problem is purely which container is scrolled.
  (`version-tree-layout.ts`, `assignSubtree`/`nodes` mapping.)
- **Not the zoom transform.** Default `versionHistoryZoomLevel` is `1`
  (`DemoDawClient.tsx:342`), and the reserved box height is `graphHeight * zoomLevel`, so zoom
  does not introduce a vertical offset; the box still starts at the top.
- **Not an `autoFocus`/`scrollIntoView` in the tree.** The only `autoFocus` in the tree area is
  inside the details/rename popup, which is not open on first render; there is no
  `scrollIntoView` call on the tree. The single scroll-affecting code path is the (misdirected)
  `treeScrollRef` reset.
- **Not scroll persistence/restoration.** No stored scroll position is read for the tree; the
  only persisted rail state is the expand/collapse boolean.

## Historical Recommended Fix

Make a **single, predictable scroll container** and reset *that* one. Two coordinated changes:

1. **Collapse the redundant scrollers so `treeScrollRef` is the only scroll container.** In
   `DemoDawClient` (lines 4498-4503), remove `overflow-auto` from both Wrapper A and Wrapper B
   and fix the height chain so the constraint reaches `VersionHistoryTree`:
   - Wrapper A: make it a flex column so its child receives its fixed height, e.g.
     `min-h-0 flex-1 flex flex-col` and **drop** `overflow-auto` (keep the `max-h-0
     overflow-hidden` collapsed state).
   - Wrapper B: keep `flex min-h-0 flex-1` (now meaningful, since A is flex) and **drop**
     `overflow-auto`.
   With the height constraint now reaching it, `VersionHistoryTree`'s existing
   `treeScrollRef` (`flex-1 min-h-0 overflow-auto`) becomes the real scroll container, and the
   existing `useLayoutEffect` reset (lines 191-197) starts working as intended.

2. **Reset after the height is applied.** Because the rail height is set post-mount, also re-run
   the reset when the tree first has a real height. The cleanest option is to make the reset in
   `VersionHistoryTree` depend on the layout size (e.g. include `layout.height`/`zoomLevel` in a
   `useLayoutEffect` dependency array, or reset once `treeScrollRef` first reports a non-zero
   `scrollHeight`), so it also fires after the `inspectorScrollHeightPx` transition creates the
   overflow.

**Minimal alternative (lower effort, still correct):** keep the wrappers as-is and instead reset
the element that actually scrolls — Wrapper A — from `DemoDawClient` after
`inspectorScrollHeightPx` is set (attach a ref to the Wrapper A `div` and set
`ref.scrollTop = 0` in a `useLayoutEffect` keyed on `inspectorScrollHeightPx` /
`isVersionTreeRailExpanded`). This fixes the symptom without restructuring the layout, but leaves
three nested scroll containers, which is the underlying fragility.

The first option is recommended because it removes the duplicate/ambiguous scrollers (the root
cause) and makes the existing reset and its test meaningful.

## How to confirm in ~1 minute

1. Open the demo DAW page and, before touching anything, inspect the version-history rail in
   DevTools.
2. Walk up from a graph node and find which ancestor has a non-zero `scrollTop` — it will be the
   **outer** `overflow-auto` wrapper (Wrapper A at `DemoDawClient.tsx:4498`), **not**
   `[data-testid="version-history-scroll-container"]`.
3. Confirm `[data-testid="version-history-scroll-container"]` has `scrollHeight === clientHeight`
   (no overflow), proving the inner reset is a no-op.
4. Manually set the inner container's `scrollTop = 0` — nothing moves. Set Wrapper A's
   `scrollTop = 0` — the graph jumps to the root, confirming Wrapper A is the real scroller.
