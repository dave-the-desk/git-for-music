import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getConfig, getPublicConfig, resetConfigForTests } from '@git-for-music/shared';

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

test('getConfig parses development defaults and feature flags', () => {
  const keys = [
    'NODE_ENV',
    'DATABASE_URL',
    'REDIS_URL',
    'OBJECT_STORAGE_BUCKET_NAME',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_PUBLIC_URL',
    'OBJECT_STORAGE_INTERNAL_URL',
    'DAW_ASSET_UPLOAD_TOKEN_SECRET',
    'DAW_PLUGIN_UPLOAD_TOKEN_SECRET',
    'DAW_WORKER_CALLBACK_SECRET',
    'NEXTAUTH_SECRET',
    'FEATURE_PLUGINS',
  ];
  const snapshot = snapshotEnv(keys);

  try {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gfm-config-test-'));
    const originalCwd = process.cwd();
    process.env.NODE_ENV = 'development';
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.OBJECT_STORAGE_BUCKET_NAME;
    delete process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    delete process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    delete process.env.OBJECT_STORAGE_PUBLIC_URL;
    delete process.env.OBJECT_STORAGE_INTERNAL_URL;
    delete process.env.DAW_ASSET_UPLOAD_TOKEN_SECRET;
    delete process.env.DAW_PLUGIN_UPLOAD_TOKEN_SECRET;
    delete process.env.DAW_WORKER_CALLBACK_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    process.env.FEATURE_PLUGINS = 'true';

    process.chdir(tempDir);
    try {
      resetConfigForTests();
      const config = getConfig();

      assert.equal(config.environment.nodeEnv, 'development');
      assert.equal(config.environment.isProduction, false);
      assert.equal(config.database.url, null);
      assert.equal(config.redis.url, null);
      assert.equal(config.objectStorage, null);
      assert.equal(config.secrets.dawAssetUploadTokenSecret, 'dev-only-daw-asset-token-secret');
      assert.equal(config.secrets.dawPluginUploadTokenSecret, 'dev-only-daw-plugin-token-secret');
      assert.equal(config.secrets.dawWorkerCallbackSecret, 'dev-only-daw-worker-callback-secret');
      assert.equal(config.secrets.nextAuthSecret, 'dev-only-nextauth-secret');
      assert.equal(config.features.plugins, true);
      assert.equal(config.branding.appName, 'Git for Music');
      assert.equal(config.deployment.baseUrl, null);
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    restoreEnv(snapshot);
    resetConfigForTests();
  }
});

test('getConfig throws in production when storage is missing', () => {
  const keys = [
    'NODE_ENV',
    'DATABASE_URL',
    'OBJECT_STORAGE_BUCKET_NAME',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_PUBLIC_URL',
    'OBJECT_STORAGE_INTERNAL_URL',
    'NEXTAUTH_SECRET',
    'DAW_ASSET_UPLOAD_TOKEN_SECRET',
    'DAW_PLUGIN_UPLOAD_TOKEN_SECRET',
    'DAW_WORKER_CALLBACK_SECRET',
  ];
  const snapshot = snapshotEnv(keys);

  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    process.env.NEXTAUTH_SECRET = 'prod-secret';
    process.env.DAW_ASSET_UPLOAD_TOKEN_SECRET = 'prod-asset-secret';
    process.env.DAW_PLUGIN_UPLOAD_TOKEN_SECRET = 'prod-plugin-secret';
    process.env.DAW_WORKER_CALLBACK_SECRET = 'prod-worker-secret';
    delete process.env.OBJECT_STORAGE_BUCKET_NAME;
    delete process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    delete process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    delete process.env.OBJECT_STORAGE_PUBLIC_URL;
    delete process.env.OBJECT_STORAGE_INTERNAL_URL;

    resetConfigForTests();
    assert.throws(() => getConfig(), /Object storage is required in production/);
  } finally {
    restoreEnv(snapshot);
    resetConfigForTests();
  }
});

test('getConfig parses R2 aliases and getPublicConfig exposes the safe subset', () => {
  const keys = [
    'NODE_ENV',
    'DATABASE_URL',
    'NEXT_PUBLIC_APP_URL',
    'OBJECT_STORAGE_BUCKET_NAME',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_PUBLIC_URL',
    'OBJECT_STORAGE_INTERNAL_URL',
    'R2_BUCKET_NAME',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_PUBLIC_URL',
    'R2_ACCOUNT_ID',
    'DAW_ASSET_UPLOAD_TOKEN_SECRET',
    'DAW_PLUGIN_UPLOAD_TOKEN_SECRET',
    'DAW_WORKER_CALLBACK_SECRET',
    'NEXTAUTH_SECRET',
    'FEATURE_PLUGINS',
  ];
  const snapshot = snapshotEnv(keys);

  try {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
    process.env.R2_BUCKET_NAME = 'bucket';
    process.env.R2_ACCESS_KEY_ID = 'access';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_PUBLIC_URL = 'https://storage.example.test';
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.OBJECT_STORAGE_BUCKET_NAME;
    delete process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    delete process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    delete process.env.OBJECT_STORAGE_PUBLIC_URL;
    delete process.env.OBJECT_STORAGE_INTERNAL_URL;
    process.env.DAW_ASSET_UPLOAD_TOKEN_SECRET = 'dev-asset-secret';
    process.env.DAW_PLUGIN_UPLOAD_TOKEN_SECRET = 'dev-plugin-secret';
    process.env.DAW_WORKER_CALLBACK_SECRET = 'dev-worker-secret';
    process.env.NEXTAUTH_SECRET = 'dev-nextauth-secret';
    process.env.FEATURE_PLUGINS = '1';

    resetConfigForTests();
    const config = getConfig();
    const publicConfig = getPublicConfig();

    assert.equal(config.objectStorage?.bucketName, 'bucket');
    assert.equal(config.objectStorage?.accessKeyId, 'access');
    assert.equal(config.objectStorage?.secretAccessKey, 'secret');
    assert.equal(config.objectStorage?.publicUrl, 'https://storage.example.test/');
    assert.equal(config.objectStorage?.internalUrl, 'https://storage.example.test/');
    assert.equal(config.deployment.baseUrl, 'https://app.example.test');
    assert.deepEqual(publicConfig, {
      features: { plugins: true },
      branding: {
        appName: 'Git for Music',
        logoPath: null,
        supportUrl: null,
      },
      deployment: {
        environmentName: 'development',
        baseUrl: 'https://app.example.test',
      },
    });
  } finally {
    restoreEnv(snapshot);
    resetConfigForTests();
  }
});

test('getConfig throws in production when required secrets are missing', () => {
  const keys = [
    'NODE_ENV',
    'DATABASE_URL',
    'OBJECT_STORAGE_BUCKET_NAME',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_PUBLIC_URL',
    'OBJECT_STORAGE_INTERNAL_URL',
    'NEXTAUTH_SECRET',
    'DAW_ASSET_UPLOAD_TOKEN_SECRET',
    'DAW_PLUGIN_UPLOAD_TOKEN_SECRET',
    'DAW_WORKER_CALLBACK_SECRET',
  ];
  const snapshot = snapshotEnv(keys);

  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    process.env.OBJECT_STORAGE_BUCKET_NAME = 'bucket';
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = 'access';
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = 'secret';
    process.env.OBJECT_STORAGE_PUBLIC_URL = 'https://storage.example.test';
    process.env.OBJECT_STORAGE_INTERNAL_URL = 'https://storage.example.test';
    process.env.DAW_ASSET_UPLOAD_TOKEN_SECRET = 'prod-asset-secret';
    process.env.DAW_PLUGIN_UPLOAD_TOKEN_SECRET = 'prod-plugin-secret';
    process.env.DAW_WORKER_CALLBACK_SECRET = 'prod-worker-secret';
    delete process.env.NEXTAUTH_SECRET;

    resetConfigForTests();
    assert.throws(() => getConfig(), /NEXTAUTH_SECRET is required in production/);
  } finally {
    restoreEnv(snapshot);
    resetConfigForTests();
  }
});

test('getConfig skips production enforcement during the Next.js build phase', () => {
  const keys = [
    'NODE_ENV',
    'NEXT_PHASE',
    'DATABASE_URL',
    'OBJECT_STORAGE_BUCKET_NAME',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_PUBLIC_URL',
    'OBJECT_STORAGE_INTERNAL_URL',
    'NEXTAUTH_SECRET',
    'DAW_ASSET_UPLOAD_TOKEN_SECRET',
    'DAW_PLUGIN_UPLOAD_TOKEN_SECRET',
    'DAW_WORKER_CALLBACK_SECRET',
  ];
  const snapshot = snapshotEnv(keys);

  try {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gfm-config-test-'));
    const originalCwd = process.cwd();
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PHASE = 'phase-production-build';
    delete process.env.DATABASE_URL;
    delete process.env.OBJECT_STORAGE_BUCKET_NAME;
    delete process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    delete process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    delete process.env.OBJECT_STORAGE_PUBLIC_URL;
    delete process.env.OBJECT_STORAGE_INTERNAL_URL;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.DAW_ASSET_UPLOAD_TOKEN_SECRET;
    delete process.env.DAW_PLUGIN_UPLOAD_TOKEN_SECRET;
    delete process.env.DAW_WORKER_CALLBACK_SECRET;

    process.chdir(tempDir);
    try {
      resetConfigForTests();
      const config = getConfig();

      assert.equal(config.environment.nodeEnv, 'production');
      assert.equal(config.environment.isProduction, true);
      assert.equal(config.database.url, null);
      assert.equal(config.objectStorage, null);
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    restoreEnv(snapshot);
    resetConfigForTests();
  }
});

test('getConfig does not fall back to dev plugin secrets in production', () => {
  const keys = [
    'NODE_ENV',
    'DATABASE_URL',
    'OBJECT_STORAGE_BUCKET_NAME',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_PUBLIC_URL',
    'OBJECT_STORAGE_INTERNAL_URL',
    'NEXTAUTH_SECRET',
    'DAW_ASSET_UPLOAD_TOKEN_SECRET',
    'DAW_PLUGIN_UPLOAD_TOKEN_SECRET',
    'DAW_WORKER_CALLBACK_SECRET',
  ];
  const snapshot = snapshotEnv(keys);

  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    process.env.OBJECT_STORAGE_BUCKET_NAME = 'bucket';
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = 'access';
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = 'secret';
    process.env.OBJECT_STORAGE_PUBLIC_URL = 'https://storage.example.test';
    process.env.OBJECT_STORAGE_INTERNAL_URL = 'https://storage.example.test';
    process.env.NEXTAUTH_SECRET = 'prod-secret';
    process.env.DAW_ASSET_UPLOAD_TOKEN_SECRET = 'prod-asset-secret';
    delete process.env.DAW_PLUGIN_UPLOAD_TOKEN_SECRET;
    process.env.DAW_WORKER_CALLBACK_SECRET = 'prod-worker-secret';

    resetConfigForTests();
    assert.throws(() => getConfig(), /DAW_PLUGIN_UPLOAD_TOKEN_SECRET is required in production/);
  } finally {
    restoreEnv(snapshot);
    resetConfigForTests();
  }
});
