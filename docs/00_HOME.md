# Documentation Home

This is the human and agent entrypoint for Git for Music documentation. Start
with the shortest path that matches your goal, then confirm implementation
details in source.

## Product Readers

- [Product thesis](40_FEATURES/product-thesis.md) explains what the product is.
- [Using the app](guides/using-the-app.md) covers the current user journey.
- [Product feel](40_FEATURES/product-feel.md) and
  [what good looks like](40_FEATURES/what-good-looks-like.md) describe the
  intended experience.
- [Versioning mental model](40_FEATURES/versioning-mental-model.md) explains the
  core collaboration metaphor.

## Contributors and Agents

- [Context index](00_MAPS/git-for-music-context-index.md) routes by domain.
- [AI start here](01_PROTOCOLS/ai-start-here.md) gives the minimum context set.
- [Non-negotiable rules](01_PROTOCOLS/non-negotiable-rules.md) defines product
  invariants.
- [DAW version-state debugging](01_PROTOCOLS/daw-version-state-debugging.md)
  provides the evidence-driven workflow for track, replay, and history failures.
- [Workspace map](00_MAPS/workspace-map.md) and
  [generated inventories](20_GENERATED_INVENTORIES/README.md) locate source.
- [Architecture](architecture/README.md) contains source-verified system design.
- [Latest daily log](daily-logging/2026-07-15.md) records the most recent work.

## Topic Routing

| Need | Start here |
|---|---|
| Web app and routes | [Web app](10_REPOS/web-app.md), [UI routing](30_UI/ui-routing.md) |
| DAW editor | [DAW editor](40_FEATURES/daw-editor.md), [DAW UI layout](30_UI/daw-ui-layout-guide.md) |
| Realtime sync and versioning | [Debugging protocol](01_PROTOCOLS/daw-version-state-debugging.md), [realtime architecture](architecture/daw-realtime-sync.md), [session regressions](60_BRANCHES/daw-realtime-collab/session-problems-and-solutions.md), [versioning model](40_FEATURES/versioning-mental-model.md) |
| Server | [Server package](10_REPOS/server.md) |
| Database | [Database package](10_REPOS/db.md) |
| Shared contracts | [Shared package](10_REPOS/shared.md) |
| Processing jobs | [Processing-job architecture](architecture/processing-jobs.md), [feature context](40_FEATURES/processing-jobs.md) |
| Plugins | [Plugin branch context](60_BRANCHES/plugins/README.md) |
| Downstream private fork | [Public baseline](architecture/public-repo-baseline.md), [setup guide](guides/downstream-private-repo-setup.md) |

## Documentation Sections

| Folder | Purpose | Update policy |
|---|---|---|
| `00_MAPS/` | Navigation and workspace orientation | Update when routes or ownership move |
| `01_PROTOCOLS/` | Invariants, operating rules, and decisions | Update when team rules or decisions change |
| `10_REPOS/` | Package-level context | Update when package responsibilities change |
| `20_GENERATED_INVENTORIES/` | Generated file and symbol lookup | Regenerate after structural source changes |
| `30_UI/` | Current UI, design references, and presentation plans | Keep current behavior distinct from proposed design |
| `40_FEATURES/` | Product and feature-domain context | Prefer durable behavior over task tracking |
| `50_TEMPLATES/` | Reusable documentation templates | Use as structure, not product truth |
| `60_BRANCHES/` | Deep design and historical diagnostics for scoped work | Link from daily history when relevant |
| `architecture/` | Source-verified technical architecture | Trust after source and repo README |
| `guides/` | User and operator procedures | Keep aligned with visible product behavior |
| `daily-logging/` | Chronological implementation history | Do not treat old entries as current truth |
| `papers/` | Research sources and summaries | Use for rationale, not implementation claims |
| `fixtures/` | Documentation samples and test assets | Not production source |

## Trust and Freshness

Use this order when documents disagree:

1. Source code and committed schema.
2. Root README and source-adjacent architecture documents.
3. Durable notes under `docs/`.
4. Branch records and daily history.
5. Plans and research references.

Generated inventories locate files quickly but do not prove behavior. Open the
referenced source before making an implementation decision. Historical notes
retain past filenames and decisions only when the historical context matters.
