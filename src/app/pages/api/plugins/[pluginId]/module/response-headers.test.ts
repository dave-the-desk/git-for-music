import { describe, expect, it } from 'vitest';
import { createPluginModuleResponseHeaders } from './response-headers';

describe('createPluginModuleResponseHeaders', () => {
  it('sets import-safe module response headers without a CSP sandbox', () => {
    const headers = createPluginModuleResponseHeaders('123');

    expect(headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(headers.get('content-length')).toBe('123');
    expect(headers.get('content-security-policy')).toBeNull();
  });
});
