import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAuthProvider,
  getAnalyticsProvider,
  getBillingProvider,
  getStorageProvider,
  resetExtensionBindingsForTests,
} from '@git-for-music/server/app/lib/extensions';
import { bindDefaultProviders } from './providers';

test('bindDefaultProviders installs the default provider bindings', async () => {
  resetExtensionBindingsForTests();
  bindDefaultProviders();

  const authProvider = getAuthProvider();
  const analyticsProvider = getAnalyticsProvider();
  const billingProvider = getBillingProvider();
  const storageProvider = getStorageProvider();

  const sessionCookie = authProvider.createSessionCookie('user-1');

  assert.equal(sessionCookie.name, 'gfm_session');
  assert.equal(sessionCookie.value, 'user-1');
  assert.equal(typeof authProvider.hashPassword, 'function');
  assert.equal(typeof storageProvider.createSignedUploadUrl, 'function');
  assert.equal(typeof analyticsProvider.track, 'function');
  assert.equal(typeof billingProvider.checkLimit, 'function');
  await analyticsProvider.track('test', { enabled: true });
  assert.equal(await billingProvider.checkLimit('user-1', 'asset_uploads'), true);

  resetExtensionBindingsForTests();
});
