import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  getConfig,
  isFeatureEnabled,
  listFeatures,
  registerFeature,
  resetConfigForTests,
  resetFeatureRegistryForTests,
  overrideFeature,
} from '@git-for-music/shared';

function snapshotEnv(keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

test('registerFeature rejects duplicate IDs', () => {
  resetFeatureRegistryForTests();

  registerFeature({
    id: 'plugins',
    description: 'Plugin subsystem',
    enabledByDefault: true,
  });

  assert.throws(
    () =>
      registerFeature({
        id: 'plugins',
        description: 'Plugin subsystem duplicate',
        enabledByDefault: false,
      }),
    /already registered/,
  );
});

test('public feature registrations load the plugins default', async () => {
  const keys = ['NODE_ENV', 'FEATURE_PLUGINS'];
  const snapshot = snapshotEnv(keys);

  try {
    process.env.NODE_ENV = 'development';
    delete process.env.FEATURE_PLUGINS;

    resetConfigForTests();
    resetFeatureRegistryForTests();
    await import('../../../../src/app/product/register-features');

    assert.deepEqual(
      listFeatures().map((feature) => feature.id),
      ['plugins'],
    );
    assert.equal(isFeatureEnabled('plugins', getConfig()), true);
  } finally {
    restoreEnv(snapshot);
    resetConfigForTests();
    resetFeatureRegistryForTests();
  }
});

test('feature env overrides registration defaults', () => {
  const keys = ['NODE_ENV', 'DATABASE_URL', 'NEXTAUTH_SECRET', 'DAW_ASSET_UPLOAD_TOKEN_SECRET', 'DAW_PLUGIN_UPLOAD_TOKEN_SECRET', 'DAW_WORKER_CALLBACK_SECRET', 'FEATURE_PLUGINS'];
  const snapshot = snapshotEnv(keys);

  try {
    process.env.NODE_ENV = 'development';
    process.env.FEATURE_PLUGINS = 'false';
    delete process.env.DATABASE_URL;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.DAW_ASSET_UPLOAD_TOKEN_SECRET;
    delete process.env.DAW_PLUGIN_UPLOAD_TOKEN_SECRET;
    delete process.env.DAW_WORKER_CALLBACK_SECRET;

    resetConfigForTests();
    resetFeatureRegistryForTests();
    registerFeature({
      id: 'plugins',
      description: 'Plugin subsystem',
      enabledByDefault: true,
      envVar: 'FEATURE_PLUGINS',
    });

    assert.equal(getConfig().features.plugins, false);
  } finally {
    restoreEnv(snapshot);
    resetConfigForTests();
    resetFeatureRegistryForTests();
  }
});

test('overrideFeature replaces the registered definition', () => {
  resetFeatureRegistryForTests();

  registerFeature({
    id: 'plugins',
    description: 'Plugin subsystem',
    enabledByDefault: false,
  });

  overrideFeature({
    id: 'plugins',
    description: 'Plugin subsystem',
    enabledByDefault: true,
  });

  const keys = ['NODE_ENV', 'FEATURE_PLUGINS'];
  const snapshot = snapshotEnv(keys);

  try {
    process.env.NODE_ENV = 'development';
    delete process.env.FEATURE_PLUGINS;

    resetConfigForTests();
    assert.equal(isFeatureEnabled('plugins', getConfig()), true);
  } finally {
    restoreEnv(snapshot);
    resetConfigForTests();
    resetFeatureRegistryForTests();
  }
});
