import assert from 'node:assert/strict';
import test from 'node:test';
import { branding } from './branding';

test('branding exports the public app identity', () => {
  assert.equal(branding.appName, 'Git for Music');
  assert.equal(branding.logoPath, null);
  assert.equal(branding.supportUrl, null);
});
