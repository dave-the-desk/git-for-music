# Findings: `[daw][wam] plugin module load failed` when adding a plugin

Status: resolved/historical as of 2026-07-11. The current module proxy headers
are centralized in `src/app/pages/api/plugins/[pluginId]/module/response-headers.ts`
and no longer set `Content-Security-Policy: ... sandbox`.

Investigation of the error thrown on the demo DAW page when adding an uploaded ("fake") WAM plugin to an audio track.

## Historical Summary (95% confidence)

The plugin module HTTP route returns a **valid 200 JavaScript response**, but it also
sets a `Content-Security-Policy` response header that contains the **`sandbox`** directive.
When the browser dynamically `import()`s that module, the `sandbox` directive (delivered
without `allow-same-origin`) forces the module response into an **opaque / `null` origin**,
which makes it cross-origin to the DAW document. The browser therefore refuses to link the
otherwise-valid module into the same-origin module graph, and `import()` rejects — which is
caught and logged as `[daw][wam] plugin module load failed`.

The offending header is set here (identical in both variants of the route):

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/api/plugins/[pluginId]/module/index.ts:42-46
  const headers = new Headers();
  headers.set('content-type', 'text/javascript; charset=utf-8');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('content-security-policy', "default-src 'none'; script-src 'self'; sandbox");
```

Same header in the bundle-path variant:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/api/plugins/[pluginId]/module/[...path]/index.ts:42-46
  const headers = new Headers();
  headers.set('content-type', 'text/javascript; charset=utf-8');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('content-security-policy', "default-src 'none'; script-src 'self'; sandbox");
```

## The load path

**1. Add-plugin handler** calls the loader and logs on failure:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:2687-2714
  async function addPluginToSelectedTrack(pluginDefinition: (typeof pluginDefinitions)[number]) {
    if (!selectedTrack) return;

    try {
      await preloadPluginDefinition(pluginDefinition);
    } catch (error) {
      logPluginModuleLoadFailure({
        source: 'manual-add',
        ...
```

**2. `preloadPluginDefinition` -> `loadWamModule`** performs a native dynamic import of the descriptor URL:

```@/Users/davidriede/PROJECTS/git-for-music/src/app/pages/groups/demo/components/daw/DemoDawClient.tsx:654-663
  const preloadPluginDefinition = useCallback(
    async (pluginDefinition: PluginDefinition) => {
      if (!pluginDefinition.descriptorUrl) {
        return;
      }

      await loadWamModule(pluginDefinition.pluginKey, pluginDefinition.version, pluginDefinition.descriptorUrl);
    },
    [],
  );
```

```@/Users/davidriede/PROJECTS/git-for-music/src/app/lib/daw/engine/wam-host.ts:243-251
  const loadPromise = (async () => {
    const moduleExports = normalizeModuleExports(await import(/* webpackIgnore: true, @vite-ignore */ descriptorUrl));
    return {
      pluginKey,
      version,
      descriptorUrl,
      module: moduleExports,
    } satisfies LoadedWamModule;
  })();
```

**3. `descriptorUrl`** is a same-origin API path built server-side:

```@/Users/davidriede/PROJECTS/git-for-music/packages/server/app/lib/plugins/index.ts:195-202
function buildPluginDescriptorUrl(pluginId: string, cacheBust?: Date | null) {
  const url = `/api/plugins/${pluginId}/module`;
  if (!cacheBust) {
    return url;
  }

  return `${url}?v=${cacheBust.getTime()}`;
}
```

So the browser runs `import('/api/plugins/<id>/module?v=<ts>')`, which returns the JS body plus the `sandbox` CSP.

## Why this is the root cause (and other candidates ruled out)

- **The response body is fine.** Today's daily log records that the endpoint was verified
  to return `200` with the WAM module body
  (`docs/daily-logging/2026-07-09.md`, "Confirmed `/api/plugins/.../module` returns `200`").
  So this is not a 404/500/network/auth failure.
- **The fake plugin modules are valid ES modules** with no throwing top-level code — they
  only touch the AudioContext inside `createInstance`, which runs later, not at import time
  (`docs/fixtures/wam/fake-wam-plugin.js`, `docs/fixtures/wam/fake-wam-plugin.mjs`). So module evaluation does not throw.
- **MIME is correct** (`text/javascript; charset=utf-8`), so `nosniff` and the module-script
  MIME check are satisfied — not a "wrong MIME type" import failure.
- **There is no document-level CSP** anywhere in the app (no middleware, no `<meta>` CSP; a
  repo-wide search finds `content-security-policy` only in these two module routes). If the
  response CSP were simply ignored, the import would succeed and there would be no error.
  Since a valid 200 JS module still fails to import, the response CSP is being enforced, and
  the only unusual, import-hostile token in it is `sandbox`.
- **`sandbox` without `allow-same-origin` = opaque/null origin.** Per the CSP spec/MDN, a
  sandboxed resource "is otherwise treated as being from an opaque origin ... The `Origin` of
  sandboxed resources without the `allow-same-origin` keyword is `null`." A module handed a
  `null` origin cannot be linked into the same-origin (localhost) module graph, so `import()`
  rejects.

This is internally consistent with the recent mitigation work in the same daily log ("added
cache-busting query strings and no-store headers ... so a previously cached module failure
does not linger" and "automatic retry pass for plugin module preloading") — those are
symptoms of a persistent import failure at this exact route, not a transient one.

## Historical Recommended Fix

Remove the `sandbox` directive (and preferably the restrictive `default-src 'none'`) from the
module response so the module keeps its same-origin identity and can be imported. If a CSP is
desired for defense-in-depth on this endpoint, it must at minimum include
`sandbox allow-scripts allow-same-origin` — but note that largely negates the sandbox, so
simply dropping the CSP header (keeping `content-type` + `x-content-type-options: nosniff`) is
the cleaner option. Apply the same change to both
`src/app/pages/api/plugins/[pluginId]/module/index.ts` and
`src/app/pages/api/plugins/[pluginId]/module/[...path]/index.ts`.

## How to confirm in ~30 seconds

1. Reproduce the add-plugin action with DevTools open.
2. Read the `error.message` in the logged `[daw][wam] plugin module load failed` object — it
   should be a dynamic-import/CSP failure (e.g. "Failed to fetch dynamically imported module"
   or a CSP `sandbox`/violation message), not a 404/500.
3. In the Network tab, open the `/api/plugins/<id>/module?v=...` request: status `200`,
   `content-type: text/javascript`, and `content-security-policy: ... sandbox` present.
4. Temporarily removing only the `content-security-policy` header on that response makes the
   import succeed, confirming the cause.
