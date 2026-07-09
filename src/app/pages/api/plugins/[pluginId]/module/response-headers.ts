export function createPluginModuleResponseHeaders(contentLength?: string | null) {
  const headers = new Headers();
  headers.set('content-type', 'text/javascript; charset=utf-8');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'private, no-store, max-age=0');

  if (contentLength) {
    headers.set('content-length', contentLength);
  }

  return headers;
}
