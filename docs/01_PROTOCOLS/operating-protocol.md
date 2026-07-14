# Operating Protocol

This note captures the working rules for future agents in this workspace.

## Rules

- Read the core context index and AI Start Here note before task-specific notes.
- Read repo-local docs before making assumptions.
- Treat repo-local docs as authoritative.
- Do not edit repo-local docs unless the human explicitly asks.
- Keep vault notes focused on navigation, context, and cross-file relationships.
- Use wikilinks for vault-to-vault navigation.
- Use markdown links for source files and repo-local docs.
- Use generated inventories for discovery, then confirm any important detail in source.
- Use the vault first, then implement inside the repo, then run the relevant tests/checks, then refresh the vault.
- Update the daily log after each implementation pass.
- If branch context exists, keep it in `docs/60_BRANCHES/` and link it from the daily log.

## Recommended Read Order

1. `AGENTS.md`
2. `PROJECT_CONTEXT_ROUTER.md`
3. `docs/00_HOME.md`
4. `docs/00_MAPS/git-for-music-context-index.md`
5. `docs/01_PROTOCOLS/ai-start-here.md`
6. The relevant repo note or feature note
7. The source file or repo-local doc that governs the behavior

## Execution Loop

1. Pull the relevant context from the vault before changing code.
2. Make the code change in the repo.
3. Run the relevant tests/checks for the touched area.
4. If a check fails, fix the implementation and rerun until it passes.
5. Update the vault docs after the implementation is complete.
6. Record the work and verification in the daily log.

## When Code Changes Happen

- Add or update tests for the requested behavior.
- Run the relevant checks for the touched area. Web interaction tests use the Vitest harness; server unit tests commonly use Node's test runner through `tsx`.
- Refresh generated inventories if file layout changed.
- Record the work and verification in the daily log.
