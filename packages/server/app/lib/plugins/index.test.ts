import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPluginModuleAccess,
  completePluginUpload,
  createPluginUploadTarget,
  grantPluginToDemo,
  listPluginsForDemo,
  revokePluginFromDemo,
  updatePlugin,
  deletePlugin,
} from '@/app/lib/plugins';

function withObjectStorageEnv() {
  const previous = {
    bucket: process.env.OBJECT_STORAGE_BUCKET_NAME,
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    publicUrl: process.env.OBJECT_STORAGE_PUBLIC_URL,
    internalUrl: process.env.OBJECT_STORAGE_INTERNAL_URL,
  };

  process.env.OBJECT_STORAGE_BUCKET_NAME = 'bucket';
  process.env.OBJECT_STORAGE_ACCESS_KEY_ID = 'access-key';
  process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = 'secret-key';
  process.env.OBJECT_STORAGE_PUBLIC_URL = 'https://storage.example.test';
  process.env.OBJECT_STORAGE_INTERNAL_URL = 'https://storage.example.test';

  return () => {
    process.env.OBJECT_STORAGE_BUCKET_NAME = previous.bucket;
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = previous.accessKeyId;
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = previous.secretAccessKey;
    process.env.OBJECT_STORAGE_PUBLIC_URL = previous.publicUrl;
    process.env.OBJECT_STORAGE_INTERNAL_URL = previous.internalUrl;
  };
}

test('createPluginUploadTarget namespaces plugin storage and signs an upload token', async () => {
  const restoreEnv = withObjectStorageEnv();

  try {
    const target = await createPluginUploadTarget({
      userId: 'user-1',
      fileName: 'delay.mjs',
      contentType: 'application/javascript',
      sizeBytes: 1024,
      projectId: 'project-1',
      demoId: 'demo-1',
    });

    assert.equal(target.method, 'PUT');
    assert.ok(target.pluginId.length > 0);
    assert.ok(target.objectKey.startsWith('plugins/user-1/'));
    assert.ok(target.bundlePrefix.startsWith('plugins/user-1/'));
    assert.ok(target.uploadToken.includes('.'));
  } finally {
    restoreEnv();
  }
});

test('completePluginUpload stores the plugin and auto-grants the demo when requested', async () => {
  const restoreEnv = withObjectStorageEnv();
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response('', { status: 200 })) as typeof fetch;

  try {
    const target = await createPluginUploadTarget({
      userId: 'user-1',
      fileName: 'delay.js',
      contentType: 'application/javascript',
      sizeBytes: 1024,
      projectId: 'project-1',
      demoId: 'demo-1',
      displayName: 'Delay',
    });

    let upsertArgs: unknown = null;
    let grantArgs: unknown = null;

    const db = {
      demo: {
        findFirst: async () => ({
          id: 'demo-1',
          projectId: 'project-1',
          project: {
            group: {
              id: 'group-1',
            },
          },
        }),
      },
      pluginMetadata: {
        upsert: async (args: unknown) => {
          upsertArgs = args;
          return {
            id: target.pluginId,
            pluginKey: `user:user-1:${target.pluginId}`,
            name: 'Delay',
            displayName: 'Delay',
            description: null,
            version: target.pluginId,
            manufacturer: null,
            parameterSchema: {},
            ownerId: 'user-1',
            visibility: 'PRIVATE',
            moduleObjectKey: target.objectKey,
            bundlePrefix: target.bundlePrefix,
            bundleKind: 'SINGLE_MODULE',
            sizeBytes: BigInt(1024),
            checksum: null,
            createdAt: new Date('2026-07-08T00:00:00.000Z'),
            updatedAt: new Date('2026-07-08T00:00:00.000Z'),
          };
        },
      },
      pluginGrant: {
        upsert: async (args: unknown) => {
          grantArgs = args;
          return {
            id: 'grant-1',
            pluginId: target.pluginId,
            demoId: 'demo-1',
            grantedById: 'user-1',
            createdAt: new Date('2026-07-08T00:00:00.000Z'),
          };
        },
      },
    } as never;

    const result = await completePluginUpload(db, {
      userId: 'user-1',
      uploadToken: target.uploadToken,
    });

    assert.equal(result.autoGrantedDemoId, 'demo-1');
    assert.equal(result.plugin.id, target.pluginId);
    assert.equal(result.plugin.moduleObjectKey, target.objectKey);
    assert.equal(result.plugin.bundlePrefix, target.bundlePrefix);
    assert.ok(upsertArgs);
    assert.ok(grantArgs);
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }
});

test('listPluginsForDemo includes a descriptor URL for each available plugin', async () => {
  const db = {
    pluginMetadata: {
      findMany: async () => [
        {
          id: 'plugin-1',
          pluginKey: 'user:user-1:plugin-1',
          name: 'Delay',
          displayName: 'Delay',
          description: null,
          version: 'plugin-1',
          manufacturer: null,
          parameterSchema: {},
          ownerId: 'user-1',
          visibility: 'PRIVATE',
          moduleObjectKey: 'plugins/user-1/plugin-1/plugin-1/delay.js',
          bundlePrefix: 'plugins/user-1/plugin-1/plugin-1',
          bundleKind: 'SINGLE_MODULE',
          sizeBytes: BigInt(1024),
          checksum: null,
          createdAt: new Date('2026-07-08T00:00:00.000Z'),
          updatedAt: new Date('2026-07-08T00:00:00.000Z'),
          grants: [],
        },
      ],
    },
  } as never;

  const plugins = await listPluginsForDemo(db, { demoId: 'demo-1', userId: 'user-1' });
  assert.equal(plugins[0]?.descriptorUrl, '/api/plugins/plugin-1/module?v=1783468800000');
});

test('listPluginsForDemo includes the owner\'s private uploads', async () => {
  const db = {
    pluginMetadata: {
      findMany: async () => [
        {
          id: 'plugin-1',
          pluginKey: 'user:user-1:plugin-1',
          name: 'Delay',
          displayName: 'Delay',
          description: null,
          version: 'plugin-1',
          manufacturer: null,
          parameterSchema: {},
          ownerId: 'user-1',
          visibility: 'PRIVATE',
          moduleObjectKey: 'plugins/user-1/plugin-1/plugin-1/delay.js',
          bundlePrefix: 'plugins/user-1/plugin-1/plugin-1',
          bundleKind: 'SINGLE_MODULE',
          sizeBytes: BigInt(1024),
          checksum: null,
          createdAt: new Date('2026-07-08T00:00:00.000Z'),
          updatedAt: new Date('2026-07-08T00:00:00.000Z'),
          grants: [],
        },
      ],
    },
  } as never;

  const plugins = await listPluginsForDemo(db, { demoId: 'demo-1', userId: 'user-1' });
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0]?.pluginKey, 'user:user-1:plugin-1');
});

test('listPluginsForDemo cache-busts module URLs when a demo grant exists', async () => {
  const db = {
    pluginMetadata: {
      findMany: async () => [
        {
          id: 'plugin-1',
          pluginKey: 'user:user-1:plugin-1',
          name: 'Delay',
          displayName: 'Delay',
          description: null,
          version: 'plugin-1',
          manufacturer: null,
          parameterSchema: {},
          ownerId: 'user-1',
          visibility: 'PRIVATE',
          moduleObjectKey: 'plugins/user-1/plugin-1/plugin-1/delay.js',
          bundlePrefix: 'plugins/user-1/plugin-1/plugin-1',
          bundleKind: 'SINGLE_MODULE',
          sizeBytes: BigInt(1024),
          checksum: null,
          createdAt: new Date('2026-07-08T00:00:00.000Z'),
          updatedAt: new Date('2026-07-08T00:00:00.000Z'),
          grants: [
            {
              createdAt: new Date('2026-07-09T00:00:00.000Z'),
            },
          ],
        },
      ],
    },
  } as never;

  const plugins = await listPluginsForDemo(db, { demoId: 'demo-1', userId: 'user-1' });
  assert.equal(plugins[0]?.descriptorUrl, '/api/plugins/plugin-1/module?v=1783555200000');
});

test('grant and revoke plugin access validate ownership and membership', async () => {
  const grantCalls: unknown[] = [];
  const revokeCalls: unknown[] = [];
  const db = {
    pluginMetadata: {
      findFirst: async () => ({
        id: 'plugin-1',
      }),
    },
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
      }),
    },
    pluginGrant: {
      upsert: async (args: unknown) => {
        grantCalls.push(args);
        return { id: 'grant-1' };
      },
      deleteMany: async (args: unknown) => {
        revokeCalls.push(args);
        return { count: 1 };
      },
    },
  } as never;

  await grantPluginToDemo(db, {
    userId: 'user-1',
    projectId: 'project-1',
    pluginId: 'plugin-1',
    demoId: 'demo-1',
  });
  await revokePluginFromDemo(db, {
    userId: 'user-1',
    projectId: 'project-1',
    pluginId: 'plugin-1',
    demoId: 'demo-1',
  });

  assert.equal(grantCalls.length, 1);
  assert.equal(revokeCalls.length, 1);
});

test('assertPluginModuleAccess returns a row for an accessible plugin', async () => {
  const db = {
    pluginMetadata: {
      findFirst: async () => ({
        id: 'plugin-1',
        pluginKey: 'user:user-1:plugin-1',
        name: 'Delay',
        displayName: 'Delay',
        description: null,
        version: 'plugin-1',
        manufacturer: null,
        parameterSchema: {},
        ownerId: 'user-1',
        visibility: 'PRIVATE',
        moduleObjectKey: 'plugins/user-1/plugin-1/plugin-1/delay.js',
        bundlePrefix: 'plugins/user-1/plugin-1/plugin-1',
        bundleKind: 'SINGLE_MODULE',
        sizeBytes: BigInt(1024),
        checksum: null,
        createdAt: new Date('2026-07-08T00:00:00.000Z'),
        updatedAt: new Date('2026-07-08T00:00:00.000Z'),
      }),
    },
  } as never;

  const plugin = await assertPluginModuleAccess(db, {
    userId: 'user-1',
    pluginId: 'plugin-1',
  });

  assert.equal(plugin?.id, 'plugin-1');
});

test('updatePlugin and deletePlugin enforce owner-only access', async () => {
  const updateCalls: unknown[] = [];
  const deleteCalls: unknown[] = [];
  const db = {
    pluginMetadata: {
      findFirst: async () => ({ id: 'plugin-1' }),
      update: async (args: unknown) => {
        updateCalls.push(args);
        return {
          id: 'plugin-1',
          pluginKey: 'user:user-1:plugin-1',
          name: 'Delay',
          displayName: 'Delay',
          description: 'A delay plugin',
          version: 'plugin-1',
          manufacturer: null,
          parameterSchema: {},
          ownerId: 'user-1',
          visibility: 'PUBLIC',
          moduleObjectKey: 'plugins/user-1/plugin-1/plugin-1/delay.js',
          bundlePrefix: 'plugins/user-1/plugin-1/plugin-1',
          bundleKind: 'SINGLE_MODULE',
          sizeBytes: BigInt(1024),
          checksum: null,
          createdAt: new Date('2026-07-08T00:00:00.000Z'),
          updatedAt: new Date('2026-07-08T00:00:00.000Z'),
        };
      },
      delete: async (args: unknown) => {
        deleteCalls.push(args);
        return { id: 'plugin-1' };
      },
    },
  } as never;

  await updatePlugin(db, {
    userId: 'user-1',
    pluginId: 'plugin-1',
    updates: {
      displayName: 'Delay',
      description: 'A delay plugin',
      visibility: 'PUBLIC',
    },
  });
  await deletePlugin(db, {
    userId: 'user-1',
    pluginId: 'plugin-1',
  });

  assert.equal(updateCalls.length, 1);
  assert.equal(deleteCalls.length, 1);
});
