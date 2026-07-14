import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOrCreateDemoUserActiveVersionState } from './demo-user-active-version';

function makeDemoVersionFindFirst(versionLabels: Record<string, string>) {
  return async ({ where }: { where: { id: string } }) => {
    const label = versionLabels[where.id];
    if (!label) return null;
    return {
      id: where.id,
      label,
    };
  };
}

test('loadOrCreateDemoUserActiveVersionState preserves an existing per-user checkout on reload when following head is enabled', async () => {
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        currentVersionId: 'version-branch-head',
        versions: [
          {
            id: 'version-branch-head',
            label: 'Branch label',
            parentId: 'version-branch-old',
            createdAt: '2025-01-03T00:00:00.000Z',
          },
          {
            id: 'version-branch-old',
            label: 'Branch label',
            parentId: 'version-root',
            createdAt: '2025-01-02T00:00:00.000Z',
          },
          {
            id: 'version-root',
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => ({
        activeVersionId: 'version-branch-old',
        isFollowingHead: true,
      }),
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-branch-old',
          isFollowingHead: true,
          activeVersion: {
            label: 'Branch label',
          },
        };
      },
    },
    demoVersion: {
      findFirst: makeDemoVersionFindFirst({
        'version-root': 'Root',
        'version-branch-old': 'Branch label',
        'version-branch-head': 'Branch label',
      }),
    },
  } as const;

  const result = await loadOrCreateDemoUserActiveVersionState(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
  });

  assert.equal(upsertArgs, null);
  assert.equal(result.activeVersionId, 'version-branch-old');
  assert.equal(result.isFollowingHead, true);
  assert.equal(result.activeBranchName, 'Branch label');
});

test('loadOrCreateDemoUserActiveVersionState preserves a pinned checkout on reload', async () => {
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        currentVersionId: 'version-branch-head',
        versions: [
          {
            id: 'version-branch-head',
            label: 'Branch label',
            parentId: 'version-branch-old',
            createdAt: '2025-01-03T00:00:00.000Z',
          },
          {
            id: 'version-branch-old',
            label: 'Branch label',
            parentId: 'version-root',
            createdAt: '2025-01-02T00:00:00.000Z',
          },
          {
            id: 'version-root',
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => ({
        activeVersionId: 'version-branch-old',
        isFollowingHead: false,
      }),
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-branch-old',
          isFollowingHead: false,
          activeVersion: {
            label: 'Branch label',
          },
        };
      },
    },
    demoVersion: {
      findFirst: makeDemoVersionFindFirst({
        'version-root': 'Root',
        'version-branch-old': 'Branch label',
        'version-branch-head': 'Branch label',
      }),
    },
  } as const;

  const result = await loadOrCreateDemoUserActiveVersionState(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
  });

  assert.equal(result.activeVersionId, 'version-branch-old');
  assert.equal(result.isFollowingHead, false);
  assert.equal(result.activeBranchName, 'Branch label');
  assert.equal(upsertArgs, null);
});

test('loadOrCreateDemoUserActiveVersionState keeps a pinned user on branch A instead of jumping to branch B head', async () => {
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        currentVersionId: 'version-branch-b-head',
        versions: [
          {
            id: 'version-root',
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          {
            id: 'version-branch-a',
            label: 'Branch A',
            parentId: 'version-root',
            createdAt: '2025-01-02T00:00:00.000Z',
          },
          {
            id: 'version-branch-b',
            label: 'Branch B',
            parentId: 'version-root',
            createdAt: '2025-01-03T00:00:00.000Z',
          },
          {
            id: 'version-branch-b-head',
            label: 'Branch B',
            parentId: 'version-branch-b',
            createdAt: '2025-01-04T00:00:00.000Z',
          },
        ],
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => ({
        activeVersionId: 'version-branch-a',
        isFollowingHead: false,
      }),
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-branch-a',
          isFollowingHead: true,
          activeVersion: {
            label: 'Branch A',
          },
        };
      },
    },
    demoVersion: {
      findFirst: makeDemoVersionFindFirst({
        'version-root': 'Root',
        'version-branch-a': 'Branch A',
        'version-branch-b': 'Branch B',
        'version-branch-b-head': 'Branch B',
      }),
    },
  } as const;

  const result = await loadOrCreateDemoUserActiveVersionState(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
  });

  assert.equal(result.activeVersionId, 'version-branch-a');
  assert.equal(result.isFollowingHead, false);
  assert.equal(result.activeBranchName, 'Branch A');
  assert.equal(upsertArgs, null);
});

test('loadOrCreateDemoUserActiveVersionState seeds a new checkout from the freshest version even when demo.currentVersionId is stale', async () => {
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        currentVersionId: 'version-root',
        versions: [
          {
            id: 'version-branch-head',
            label: 'Branch label',
            parentId: 'version-branch-old',
            createdAt: '2025-01-03T00:00:00.000Z',
          },
          {
            id: 'version-branch-old',
            label: 'Branch label',
            parentId: 'version-root',
            createdAt: '2025-01-02T00:00:00.000Z',
          },
          {
            id: 'version-root',
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => null,
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-branch-head',
          isFollowingHead: true,
          activeVersion: {
            label: 'Branch label',
          },
        };
      },
    },
    demoVersion: {
      findFirst: makeDemoVersionFindFirst({
        'version-root': 'Root',
        'version-branch-old': 'Branch label',
        'version-branch-head': 'Branch label',
      }),
    },
  } as const;

  const result = await loadOrCreateDemoUserActiveVersionState(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
  });

  assert.equal(result.activeVersionId, 'version-branch-head');
  assert.equal(result.isFollowingHead, true);
  assert.equal(result.activeBranchName, 'Branch label');
  assert.ok(upsertArgs);
  assert.deepEqual((upsertArgs as { create: Record<string, unknown> }).create, {
    demoId: 'demo-1',
    userId: 'user-1',
    activeVersionId: 'version-branch-head',
    isFollowingHead: true,
  });
});

test('loadOrCreateDemoUserActiveVersionState seeds the current demo head when no per-user row exists', async () => {
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        currentVersionId: 'version-root',
        versions: [
          {
            id: 'version-root',
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => null,
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-root',
          isFollowingHead: true,
          activeVersion: {
            label: 'Root',
          },
        };
      },
    },
    demoVersion: {
      findFirst: makeDemoVersionFindFirst({
        'version-root': 'Root',
      }),
    },
  } as const;

  const result = await loadOrCreateDemoUserActiveVersionState(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
  });

  assert.equal(result.activeVersionId, 'version-root');
  assert.equal(result.isFollowingHead, true);
  assert.equal(result.activeBranchName, 'Root');
  assert.ok(upsertArgs);
  assert.deepEqual((upsertArgs as { create: Record<string, unknown> }).create, {
    demoId: 'demo-1',
    userId: 'user-1',
    activeVersionId: 'version-root',
    isFollowingHead: true,
  });
});

test('loadOrCreateDemoUserActiveVersionState repairs an invalid row to the demo head', async () => {
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        currentVersionId: 'version-root',
        versions: [
          {
            id: 'version-root',
            label: 'Current head',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => ({
        activeVersionId: 'version-branch',
        isFollowingHead: false,
      }),
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-root',
          isFollowingHead: false,
          activeVersion: {
            id: 'version-root',
            label: 'Current head',
          },
        };
      },
    },
    demoVersion: {
      findFirst: makeDemoVersionFindFirst({
        'version-root': 'Current head',
        'version-branch': 'Branch',
      }),
    },
  } as const;

  const result = await loadOrCreateDemoUserActiveVersionState(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
  });

  assert.equal(result.activeVersionId, 'version-root');
  assert.equal(result.isFollowingHead, false);
  assert.equal(result.activeBranchName, 'Current head');
  assert.ok(upsertArgs);
  assert.deepEqual((upsertArgs as { create: Record<string, unknown> }).create, {
    demoId: 'demo-1',
    userId: 'user-1',
    activeVersionId: 'version-root',
    isFollowingHead: false,
  });
  assert.deepEqual((upsertArgs as { update: Record<string, unknown> }).update, {
    activeVersionId: 'version-root',
    isFollowingHead: false,
  });
});

test('loadOrCreateDemoUserActiveVersionState honors an explicit checkout request even when a row already exists', async () => {
  let upsertArgs: unknown = null;

  const client = {
    demo: {
      findFirst: async () => ({
        id: 'demo-1',
        currentVersionId: 'version-root',
        versions: [
          {
            id: 'version-root',
            label: 'Root',
            parentId: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
          {
            id: 'version-branch',
            label: 'Branch',
            parentId: 'version-root',
            createdAt: '2025-01-02T00:00:00.000Z',
          },
        ],
      }),
    },
    demoUserActiveVersion: {
      findFirst: async () => ({
        activeVersionId: 'version-root',
        isFollowingHead: true,
      }),
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return {
          activeVersionId: 'version-branch',
          isFollowingHead: true,
          activeVersion: {
            label: 'Branch',
          },
        };
      },
    },
    demoVersion: {
      findFirst: makeDemoVersionFindFirst({
        'version-root': 'Root',
        'version-branch': 'Branch',
      }),
    },
  } as const;

  const result = await loadOrCreateDemoUserActiveVersionState(client as never, {
    projectId: 'project-1',
    demoId: 'demo-1',
    userId: 'user-1',
    currentActiveVersionId: 'version-branch',
    isFollowingHead: true,
  });

  assert.equal(result.activeVersionId, 'version-branch');
  assert.equal(result.isFollowingHead, true);
  assert.equal(result.activeBranchName, 'Branch');
  assert.ok(upsertArgs);
  assert.deepEqual((upsertArgs as { update: Record<string, unknown> }).update, {
    activeVersionId: 'version-branch',
    isFollowingHead: true,
  });
});
