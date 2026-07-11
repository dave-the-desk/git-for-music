import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  DawOperationCommitRequest,
  DawProjectBootstrapResponse,
  DawProjectOperationRecord,
} from '@git-for-music/server/app/lib/daw/protocol';
import { dawLocalCache } from '@/app/lib/daw/engine/daw-local-cache';
import { ProjectSyncEngine } from '@/app/lib/daw/engine/project-sync-engine';
import { applyAcceptedProjectOperation, createLocalProjectStateFromBootstrap } from '@/app/lib/daw/state/operation-reducer';
import { createWamPlaybackPluginGraphFactory, loadWamModule } from '@/app/lib/daw/engine/wam-host';
import type {
  DawTrack,
  DawVersion,
  HostedPluginInstanceState,
  TrackTimelineSegment,
} from '@/app/lib/daw/state/local-project-state';

function makeVersion(id: string, overrides: Partial<DawVersion> = {}): DawVersion {
  return {
    id,
    label: overrides.label ?? id,
    name: overrides.name ?? overrides.label ?? id,
    branchName: overrides.branchName ?? overrides.label ?? id,
    operationSummary: overrides.operationSummary ?? null,
    createdBy: overrides.createdBy ?? 'user-a',
    description: overrides.description ?? null,
    parentId: overrides.parentId ?? null,
    parentVersionId: overrides.parentVersionId ?? overrides.parentId ?? null,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    operationSeq: overrides.operationSeq ?? 1,
    isCurrent: overrides.isCurrent ?? false,
    tempoBpm: overrides.tempoBpm ?? 120,
    timeSignatureNum: overrides.timeSignatureNum ?? 4,
    timeSignatureDen: overrides.timeSignatureDen ?? 4,
    musicalKey: overrides.musicalKey ?? null,
    tempoSource: overrides.tempoSource ?? 'MANUAL',
    keySource: overrides.keySource ?? 'MANUAL',
    tracks: overrides.tracks ?? [],
  };
}

function makePlugin(instanceId: string, overrides: Partial<HostedPluginInstanceState> = {}): HostedPluginInstanceState {
  return {
    instanceId,
    pluginKey: overrides.pluginKey ?? 'com.example.delay',
    version: overrides.version ?? '1.0.0',
    backend: overrides.backend ?? 'wam',
    position: overrides.position ?? 0,
    bypassed: overrides.bypassed ?? false,
    params: overrides.params ?? { mix: 0.5 },
    state: overrides.state ?? { preset: 'wide' },
    stateBlobKey: overrides.stateBlobKey ?? null,
  };
}

function makeTrack(trackVersionId: string, overrides: Partial<DawTrack> = {}): DawTrack {
  const segment: TrackTimelineSegment = {
    id: overrides.segments?.[0]?.id ?? `segment-${trackVersionId}`,
    trackVersionId,
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };

  return {
    trackId: overrides.trackId ?? `track-${trackVersionId}`,
    trackName: overrides.trackName ?? `Track ${trackVersionId}`,
    trackPosition: overrides.trackPosition ?? 0,
    trackVersionId,
    storageKey: overrides.storageKey ?? `/tracks/${trackVersionId}.wav`,
    mimeType: overrides.mimeType ?? 'audio/wav',
    durationMs: overrides.durationMs ?? 1000,
    startOffsetMs: overrides.startOffsetMs ?? 0,
    recordedTempoBpm: overrides.recordedTempoBpm ?? null,
    sourceTempoBpm: overrides.sourceTempoBpm ?? null,
    isDerived: overrides.isDerived ?? false,
    operationType: overrides.operationType ?? 'ORIGINAL',
    parentTrackVersionId: overrides.parentTrackVersionId ?? null,
    segments: overrides.segments ?? [segment],
    plugins: overrides.plugins ?? [makePlugin(`plugin-${trackVersionId}`)],
  };
}

function makeBootstrap(versions: DawVersion[], currentVersionId: string): DawProjectBootstrapResponse {
  return {
    project: {
      id: 'project-1',
      slug: 'project-1',
      name: 'Project',
      description: null,
      group: {
        id: 'group-1',
        slug: 'group',
      },
      demoId: 'demo-1',
      currentVersionId,
    },
    latestSnapshot: {
      id: 'snapshot-1',
      projectId: 'project-1',
      demoId: 'demo-1',
      operationSeq: 1,
      snapshot: {
        versions,
        currentVersionId,
        comments: [],
        annotations: [],
        tempoMetadataByTrackVersionId: {},
      },
      createdById: 'user-a',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    activeVersionId: currentVersionId,
    isFollowingHead: true,
    projectState: undefined,
    operationTail: [],
    assets: [],
    pluginDefinitions: [],
    comments: [],
    annotations: [],
    presenceSeed: 'seed',
    permissions: {
      role: 'OWNER',
      canRead: true,
      canWrite: true,
      canManageProject: true,
    },
  };
}

function makeOperation(
  type: DawProjectOperationRecord['type'],
  operationSeq: number,
  payload: unknown,
): DawProjectOperationRecord {
  return {
    id: `op-${operationSeq}`,
    projectId: 'project-1',
    demoId: 'demo-1',
    type,
    createdAt: '2025-01-02T00:00:00.000Z',
    actorUserId: 'user-b',
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 1,
    operationSeq,
    payload: payload as DawProjectOperationRecord['payload'],
    idempotencyKey: `idempotency-${operationSeq}`,
    clientOperationId: `client-${operationSeq}`,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function dataModule(source: string) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

test('ProjectSyncEngine applies remote accepted_operation updates once', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  assert.equal(initial.activeVersionId, root.id);
  assert.equal(initial.isFollowingHead, true);
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = null;
    harness.state = {
      ...engine.getState(),
      projectState: initial,
      lastSyncedOperationSeq: 1,
    };

    const branchVersion = makeVersion('version-branch', {
      label: 'Branch label',
      name: 'Branch label',
      branchName: 'Branch label',
      parentId: root.id,
      parentVersionId: root.id,
      createdAt: '2025-01-02T00:00:00.000Z',
      isCurrent: true,
      operationSeq: 2,
      tracks: [
        makeTrack('track-version-branch', {
          trackId: 'track-branch',
          trackName: 'Branch Track',
        }),
      ],
    });

    const operation = makeOperation('VERSION_BRANCH_CREATED', 2, {
      versionId: branchVersion.id,
      parentVersionId: root.id,
      branchMode: 'fork',
      branchName: branchVersion.branchName,
      label: branchVersion.label,
      createdAt: branchVersion.createdAt,
      createdBy: 'user-b',
      operationSummary: 'Added audio track',
      version: branchVersion,
      sourceVersionId: root.id,
    });

    await engine.receiveAcceptedRemoteOperations([operation]);

    const appliedState = engine.getState().projectState;
    assert.ok(appliedState);
    assert.equal(appliedState?.versions.length, 2);
    assert.equal(appliedState?.currentVersionId, branchVersion.id);
    assert.equal(appliedState?.activeVersionId, root.id);
    assert.equal(appliedState?.lastSeenOperationSeq, 2);
    assert.deepEqual(appliedState?.versions.find((version) => version.id === branchVersion.id)?.tracks[0]?.plugins, [
      makePlugin('plugin-track-version-branch'),
    ]);

    await engine.receiveAcceptedRemoteOperations([operation]);
    const duplicateState = engine.getState().projectState;
    assert.equal(duplicateState?.versions.length, 2);
    assert.equal(duplicateState?.lastSeenOperationSeq, 2);
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
  }
});

test('ProjectSyncEngine bootstrap replays the snapshot tail so plugin chains and params rebuild on reload', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const pluginModuleA = `com.example.replay-a-${crypto.randomUUID()}`;
  const pluginModuleB = `com.example.replay-b-${crypto.randomUUID()}`;
  const connectionLog: Array<{ from: string; to: string }> = [];
  const paramLog: Array<{ plugin: string; values: Record<string, number> }> = [];

  await loadWamModule(
    pluginModuleA,
    '1.0.0',
    dataModule(`
      export function createInstance() {
        return {
          id: 'replay-a',
          connect(target) {
            globalThis.__replayConnectionLog = globalThis.__replayConnectionLog ?? [];
            globalThis.__replayConnectionLog.push({ from: 'replay-a', to: target.id ?? 'unknown' });
            return target;
          },
          disconnect() {
            return undefined;
          },
          setParameterValues(values) {
            globalThis.__replayParamLog = globalThis.__replayParamLog ?? [];
            globalThis.__replayParamLog.push({ plugin: 'replay-a', values });
          },
        };
      }
    `),
  );
  await loadWamModule(
    pluginModuleB,
    '1.0.0',
    dataModule(`
      export function createInstance() {
        return {
          id: 'replay-b',
          connect(target) {
            globalThis.__replayConnectionLog = globalThis.__replayConnectionLog ?? [];
            globalThis.__replayConnectionLog.push({ from: 'replay-b', to: target.id ?? 'unknown' });
            return target;
          },
          disconnect() {
            return undefined;
          },
          setParameterValues(values) {
            globalThis.__replayParamLog = globalThis.__replayParamLog ?? [];
            globalThis.__replayParamLog.push({ plugin: 'replay-b', values });
          },
        };
      }
    `),
  );

  const initialTrack = makeTrack('track-version-1', {
    trackId: 'track-1',
    trackName: 'Track 1',
    plugins: [
      {
        instanceId: 'plugin-a',
        pluginKey: pluginModuleA,
        version: '1.0.0',
        backend: 'wam',
        position: 0,
        bypassed: false,
        params: { mix: 0.25 },
        state: { preset: 'wide' },
        stateBlobKey: null,
      },
      {
        instanceId: 'plugin-b',
        pluginKey: pluginModuleB,
        version: '1.0.0',
        backend: 'wam',
        position: 1,
        bypassed: false,
        params: { mix: 0.5 },
        state: { preset: 'narrow' },
        stateBlobKey: null,
      },
    ],
  });
  const rootVersion = makeVersion(root.id, {
    isCurrent: true,
    tracks: [initialTrack],
  });
  const bootstrap = makeBootstrap([rootVersion], rootVersion.id);
  bootstrap.projectState = undefined;
  bootstrap.latestSnapshot = {
    ...bootstrap.latestSnapshot!,
    snapshot: {
      versions: [rootVersion],
      currentVersionId: rootVersion.id,
      comments: [],
      annotations: [],
      tempoMetadataByTrackVersionId: {},
    },
  };
  bootstrap.operationTail = [
    makeOperation('PLUGIN_REORDERED', 2, {
      trackVersionId: 'track-version-1',
      instanceId: 'plugin-a',
      position: 1,
    }),
    makeOperation('PLUGIN_PARAM_SET', 3, {
      trackVersionId: 'track-version-1',
      instanceId: 'plugin-b',
      paramId: 'mix',
      value: 0.9,
    }),
    makeOperation('PLUGIN_PARAM_SET', 4, {
      trackVersionId: 'track-version-1',
      instanceId: 'plugin-a',
      paramId: 'mix',
      value: 0.75,
    }),
  ];

  const stubbedCache = dawLocalCache as unknown as {
    getProject: () => Promise<null>;
    listAcceptedOperations: () => Promise<DawProjectOperationRecord[]>;
    listPendingOperations: () => Promise<Array<{ createdAt: number; updatedAt: number; key: string }>>;
    putProject: (...args: unknown[]) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
  };
  const originalGetProject = stubbedCache.getProject;
  const originalListAcceptedOperations = stubbedCache.listAcceptedOperations;
  const originalListPendingOperations = stubbedCache.listPendingOperations;
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  stubbedCache.getProject = async () => null;
  stubbedCache.listAcceptedOperations = async () => [];
  stubbedCache.listPendingOperations = async () => [];
  stubbedCache.putProject = async () => {};
  stubbedCache.putPluginDefinitions = async () => {};

  const originalFetch = globalThis.fetch;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async () => jsonResponse(bootstrap);

  (globalThis as Record<string, unknown>).__replayConnectionLog = connectionLog;
  (globalThis as Record<string, unknown>).__replayParamLog = paramLog;

  try {
    const engine = new ProjectSyncEngine();
    await engine.bootstrap({
      projectId: 'project-1',
      demoId: 'demo-1',
      initialProjectState: createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id)),
    });

    const restoredTrack = engine.getState().projectState?.versions[0]?.tracks[0];
    assert.ok(restoredTrack);
    assert.deepEqual(restoredTrack?.plugins.map((plugin) => plugin.instanceId), ['plugin-b', 'plugin-a']);
    assert.equal(restoredTrack?.plugins.find((plugin) => plugin.instanceId === 'plugin-a')?.params.mix, 0.75);
    assert.equal(restoredTrack?.plugins.find((plugin) => plugin.instanceId === 'plugin-b')?.params.mix, 0.9);

    const graph = createWamPlaybackPluginGraphFactory({
      getTrackPlugins: (trackVersionId) =>
        engine.getState().projectState?.versions
          .flatMap((version) => version.tracks)
          .find((track) => track.trackVersionId === trackVersionId)?.plugins ?? [],
    })(
      'track-version-1',
      {
        id: 'input',
        connect(target: { id?: string }) {
          connectionLog.push({ from: 'input', to: target.id ?? 'unknown' });
          return target;
        },
        disconnect() {
          return undefined;
        },
      } as unknown as AudioNode,
      {} as AudioContext,
    );

    assert.equal((graph.outputNode as { id?: string }).id, 'replay-a');
    assert.deepEqual(connectionLog, [
      { from: 'input', to: 'replay-b' },
      { from: 'replay-b', to: 'replay-a' },
    ]);
    assert.deepEqual(paramLog, [
      { plugin: 'replay-b', values: { mix: 0.9 } },
      { plugin: 'replay-a', values: { mix: 0.75 } },
    ]);
  } finally {
    stubbedCache.getProject = originalGetProject;
    stubbedCache.listAcceptedOperations = originalListAcceptedOperations;
    stubbedCache.listPendingOperations = originalListPendingOperations;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('ProjectSyncEngine keeps a follower on their checkout when another user advances the branch', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = makeBootstrap([root], root.id);
    harness.state = {
      ...engine.getState(),
      projectState: initial,
      lastSyncedOperationSeq: 1,
    };

    const branchVersion = makeVersion('version-branch', {
      label: 'Branch label',
      name: 'Branch label',
      branchName: 'Branch label',
      parentId: root.id,
      parentVersionId: root.id,
      createdAt: '2025-01-02T00:00:00.000Z',
      isCurrent: true,
      operationSeq: 2,
    });

    const operation = makeOperation('VERSION_BRANCH_CREATED', 2, {
      versionId: branchVersion.id,
      parentVersionId: root.id,
      branchMode: 'continue',
      branchName: branchVersion.branchName,
      label: branchVersion.label,
      createdAt: branchVersion.createdAt,
      createdBy: 'user-b',
      operationSummary: 'Added audio track',
      version: branchVersion,
      sourceVersionId: root.id,
    });

    const originalFetch = globalThis.fetch;
    let capturedUrl: string | null = null;
    let capturedBody: string | null = null;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedBody = typeof init?.body === 'string' ? init.body : null;
      return new Response(
        JSON.stringify({
          activeVersionId: branchVersion.id,
          isFollowingHead: true,
          activeBranchName: branchVersion.label,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    };

    try {
      await engine.receiveAcceptedRemoteOperations([operation]);

      assert.equal(capturedUrl, null);
      assert.equal(capturedBody, null);
      assert.equal(engine.getState().projectState?.currentVersionId, branchVersion.id);
      assert.equal(engine.getState().projectState?.activeVersionId, root.id);
      assert.equal(engine.getState().projectState?.isFollowingHead, true);
    } finally {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    }
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
  }
});

test('ProjectSyncEngine createVersionBranch updates the creator checkout locally', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const branch = makeVersion('version-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    isCurrent: true,
    operationSeq: 2,
  });
  const bootstrap = makeBootstrap([root], root.id);
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    persistProjectState: () => Promise<void>;
    refreshVersionTreeFromServer: () => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.bootstrapResponse = bootstrap;
  harness.state = {
    projectState: createLocalProjectStateFromBootstrap({
      ...bootstrap,
      activeVersionId: root.id,
      isFollowingHead: true,
    }),
    queue: { entries: [] },
    baseSnapshotId: 'snapshot-1',
    lastSyncedOperationSeq: 1,
    isBootstrapping: false,
    isOnline: true,
    isSyncing: false,
    lastError: null,
  };

  let persistCalls = 0;
  let refreshCalls = 0;
  harness.persistProjectState = async () => {
    persistCalls += 1;
  };
  harness.refreshVersionTreeFromServer = async () => {
    refreshCalls += 1;
  };

  const originalFetch = globalThis.fetch;
  let capturedUrl: string | null = null;
  let capturedBody: string | null = null;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = typeof input === 'string' ? input : input.toString();
    capturedBody = typeof init?.body === 'string' ? init.body : null;
    return new Response(
      JSON.stringify({
        id: branch.id,
        label: branch.label,
        demoId: 'demo-1',
        activeVersionId: branch.id,
        isFollowingHead: true,
        activeBranchName: branch.label,
      }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  };

  try {
    const result = await engine.createVersionBranch({
      sourceVersionId: root.id,
      label: branch.label,
    });

    assert.equal(capturedUrl, '/api/versions');
    assert.ok(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody ?? '{}'), {
      demoId: 'demo-1',
      label: branch.label,
      sourceVersionId: root.id,
    });
    assert.equal(result?.id, branch.id);
    assert.equal(engine.getState().projectState?.activeVersionId, branch.id);
    assert.equal(engine.getState().projectState?.isFollowingHead, true);
    assert.equal(engine.getState().projectState?.currentVersionId, root.id);
    assert.equal(refreshCalls, 1);
    assert.equal(persistCalls, 1);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('ProjectSyncEngine revertToVersion updates the follow-head checkout locally', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const branch = makeVersion('version-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    isCurrent: false,
  });
  const revert = makeVersion('version-revert', {
    parentId: branch.id,
    parentVersionId: branch.id,
    isCurrent: true,
  });
  const bootstrap = makeBootstrap([root, branch], branch.id);
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    persistProjectState: () => Promise<void>;
    refreshVersionTreeFromServer: () => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.bootstrapResponse = bootstrap;
  harness.state = {
    projectState: createLocalProjectStateFromBootstrap({
      ...bootstrap,
      activeVersionId: branch.id,
      isFollowingHead: true,
    }),
    queue: { entries: [] },
    baseSnapshotId: 'snapshot-1',
    lastSyncedOperationSeq: 1,
    isBootstrapping: false,
    isOnline: true,
    isSyncing: false,
    lastError: null,
  };

  let persistCalls = 0;
  let refreshCalls = 0;
  harness.persistProjectState = async () => {
    persistCalls += 1;
  };
  harness.refreshVersionTreeFromServer = async () => {
    refreshCalls += 1;
  };

  const originalFetch = globalThis.fetch;
  let capturedUrl: string | null = null;
  let capturedBody: string | null = null;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = typeof input === 'string' ? input : input.toString();
    capturedBody = typeof init?.body === 'string' ? init.body : null;
    return new Response(
      JSON.stringify({
        id: revert.id,
        label: revert.label,
        demoId: 'demo-1',
        activeVersionId: revert.id,
        isFollowingHead: true,
        activeBranchName: revert.label,
      }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  };

  try {
    const result = await engine.revertToVersion({
      sourceVersionId: root.id,
      label: revert.label,
    });

    assert.equal(capturedUrl, '/api/versions/revert');
    assert.ok(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody ?? '{}'), {
      demoId: 'demo-1',
      sourceVersionId: root.id,
      label: revert.label,
    });
    assert.equal(result?.id, revert.id);
    assert.equal(engine.getState().projectState?.activeVersionId, revert.id);
    assert.equal(engine.getState().projectState?.isFollowingHead, true);
    assert.equal(refreshCalls, 1);
    assert.equal(persistCalls, 1);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('ProjectSyncEngine revertToVersion preserves a pinned checkout locally', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const branch = makeVersion('version-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    isCurrent: false,
  });
  const pinned = makeVersion('version-pinned', {
    parentId: branch.id,
    parentVersionId: branch.id,
    isCurrent: false,
  });
  const bootstrap = makeBootstrap([root, branch], branch.id);
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    persistProjectState: () => Promise<void>;
    refreshVersionTreeFromServer: () => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.bootstrapResponse = bootstrap;
  harness.state = {
    projectState: createLocalProjectStateFromBootstrap({
      ...bootstrap,
      activeVersionId: pinned.id,
      isFollowingHead: false,
    }),
    queue: { entries: [] },
    baseSnapshotId: 'snapshot-1',
    lastSyncedOperationSeq: 1,
    isBootstrapping: false,
    isOnline: true,
    isSyncing: false,
    lastError: null,
  };

  let persistCalls = 0;
  let refreshCalls = 0;
  harness.persistProjectState = async () => {
    persistCalls += 1;
  };
  harness.refreshVersionTreeFromServer = async () => {
    refreshCalls += 1;
  };

  const originalFetch = globalThis.fetch;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'version-revert',
        label: 'Revert to branch',
        demoId: 'demo-1',
        activeVersionId: pinned.id,
        isFollowingHead: false,
        activeBranchName: 'Pinned branch',
      }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

  try {
    const result = await engine.revertToVersion({
      sourceVersionId: root.id,
    });

    assert.equal(result?.id, 'version-revert');
    assert.equal(engine.getState().projectState?.activeVersionId, pinned.id);
    assert.equal(engine.getState().projectState?.isFollowingHead, false);
    assert.equal(persistCalls, 1);
    assert.equal(refreshCalls, 1);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test.skip('ProjectSyncEngine replays pending segment moves into bootstrap state and persists them', async () => {
  const sourceSegment: TrackTimelineSegment = {
    id: 'segment-1',
    trackVersionId: 'track-version-a',
    sourceStartMs: 100,
    sourceEndMs: 900,
    timelineStartMs: 1200,
    timelineEndMs: 2000,
    durationMs: 800,
    startMs: 100,
    endMs: 900,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [sourceSegment],
      }),
      makeTrack('track-version-b', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [],
      }),
    ],
  });
  const bootstrap = makeBootstrap([root], root.id);
  const branchSegment = {
    ...sourceSegment,
    id: 'segment-branch',
    trackVersionId: 'track-version-a-branch',
    timelineStartMs: 3500,
    timelineEndMs: 4300,
  };
  const branchVersion = makeVersion('version-branch', {
    label: 'Moved clip',
    name: 'Moved clip',
    branchName: 'Moved clip',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
    tracks: [
      makeTrack('track-version-a-branch', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [],
      }),
      makeTrack('track-version-b-branch', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [
          {
            ...branchSegment,
            trackVersionId: 'track-version-b-branch',
          },
        ],
      }),
    ],
  });
  const branchBootstrap = makeBootstrap([root, branchVersion], branchVersion.id);
  branchBootstrap.project.currentVersionId = branchVersion.id;
  branchBootstrap.latestSnapshot = {
    id: 'snapshot-2',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 2,
    snapshot: {
      versions: [root, branchVersion],
      currentVersionId: branchVersion.id,
      comments: [],
      annotations: [],
      tempoMetadataByTrackVersionId: {},
    },
    createdById: 'user-b',
    createdAt: '2025-01-02T00:00:00.000Z',
  };
  branchBootstrap.activeVersionId = branchVersion.id;
  branchBootstrap.isFollowingHead = true;
  branchBootstrap.activeBranchName = branchVersion.label;
  branchBootstrap.operationTail = [];
  const pendingRequest: DawOperationCommitRequest = {
    demoId: 'demo-1',
    operationType: 'SEGMENT_MOVED',
    payload: {
      segmentId: 'segment-1',
      fromTrackVersionId: 'track-version-a',
      toTrackVersionId: 'track-version-b',
      fromTimelineStartMs: 1200,
      fromTimelineEndMs: 2000,
      toTimelineStartMs: 3500,
      toTimelineEndMs: 4300,
    },
    baseSnapshotId: 'snapshot-1',
    baseOperationSeq: 1,
    targetTrackId: 'track-b',
    targetSegmentId: 'segment-1',
    affectedTimeRange: {
      startMs: 1200,
      endMs: 4300,
    },
    idempotencyKey: 'pending-move-1',
    clientOperationId: 'client-move-1',
  };
  const movedOperation = {
    ...makeOperation('SEGMENT_MOVED', 2, {
      segmentId: branchSegment.id,
      fromTrackVersionId: branchSegment.trackVersionId,
      toTrackVersionId: 'track-version-b-branch',
      fromTimelineStartMs: 1200,
      fromTimelineEndMs: 2000,
      toTimelineStartMs: 3500,
      toTimelineEndMs: 4300,
    }),
    idempotencyKey: pendingRequest.idempotencyKey,
    clientOperationId: pendingRequest.clientOperationId,
  } satisfies DawProjectOperationRecord;


  const engine = new ProjectSyncEngine();
  const stubbedCache = dawLocalCache as unknown as {
    getProject: (projectId: string, demoId: string) => Promise<null>;
    listAcceptedOperations: (projectId: string, demoId: string, afterSeq: number) => Promise<DawProjectOperationRecord[]>;
    listPendingOperations: (
      projectId: string,
      demoId: string,
    ) => Promise<
      Array<{
        key: string;
        projectId: string;
        demoId: string;
        request: DawOperationCommitRequest;
        status: 'pending' | 'retrying' | 'failed';
        attemptCount: number;
        error: string | null;
        createdAt: number;
        updatedAt: number;
      }>
    >;
    findOperationByIdempotencyKey: (projectId: string, demoId: string, idempotencyKey: string) => Promise<DawProjectOperationRecord | null>;
    putPendingOperation: (...args: unknown[]) => Promise<void>;
    updatePendingOperation: (...args: unknown[]) => Promise<void>;
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (record: {
      projectId: string;
      demoId: string;
      bootstrap: DawProjectBootstrapResponse | null;
      projectState: ReturnType<typeof createLocalProjectStateFromBootstrap> | null;
      latestAcceptedOperationSeq: number;
    }) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
    putAsset: (...args: unknown[]) => Promise<void>;
  };

  const originalGetProject = stubbedCache.getProject;
  const originalListAcceptedOperations = stubbedCache.listAcceptedOperations;
  const originalListPendingOperations = stubbedCache.listPendingOperations;
  const originalFindOperationByIdempotencyKey = stubbedCache.findOperationByIdempotencyKey;
  const originalPutPendingOperation = stubbedCache.putPendingOperation;
  const originalUpdatePendingOperation = stubbedCache.updatePendingOperation;
  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  const originalPutAsset = stubbedCache.putAsset;
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  let activeVersionCalls = 0;
  let bootstrapCalls = 0;
  let persistedProject: {
    projectId: string;
    demoId: string;
    bootstrap: DawProjectBootstrapResponse | null;
    projectState: ReturnType<typeof createLocalProjectStateFromBootstrap> | null;
    latestAcceptedOperationSeq: number;
  } | null = null;

  stubbedCache.getProject = async () => null;
  stubbedCache.listAcceptedOperations = async () => [];
  stubbedCache.listPendingOperations = async () => [
    {
      key: 'project-1:demo-1:pending-move-1',
      projectId: 'project-1',
      demoId: 'demo-1',
      request: pendingRequest,
      status: 'pending',
      attemptCount: 0,
      error: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  stubbedCache.findOperationByIdempotencyKey = async () => null;
  stubbedCache.putPendingOperation = async () => {};
  stubbedCache.updatePendingOperation = async () => {};
  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async (record) => {
    persistedProject = record;
  };
  stubbedCache.putPluginDefinitions = async () => {};
  stubbedCache.putAsset = async () => {};
  (globalThis as typeof globalThis & { EventSource: typeof EventSource }).EventSource = class {
    close() {}
    addEventListener() {}
  } as unknown as typeof EventSource;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/bootstrap')) {
      bootstrapCalls += 1;
      return new Response(JSON.stringify(bootstrapCalls === 1 ? bootstrap : branchBootstrap), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    if (url.includes('/active-version') && init?.method === 'POST') {
      activeVersionCalls += 1;
      return jsonResponse({
        activeVersionId: branchVersion.id,
        isFollowingHead: true,
        activeBranchName: branchVersion.label,
      });
    }

    if (url.includes('/operations') && init?.method === 'POST') {
      return jsonResponse(movedOperation);
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    await engine.bootstrap({
      projectId: 'project-1',
      demoId: 'demo-1',
      initialProjectState: createLocalProjectStateFromBootstrap(bootstrap),
    });

    const state = engine.getState().projectState;
    const sourceTrack = state?.versions.find((version) => version.id === root.id)?.tracks.find(
      (track) => track.trackVersionId === 'track-version-a',
    );
    const targetTrack = state?.versions.find((version) => version.id === root.id)?.tracks.find(
      (track) => track.trackVersionId === 'track-version-b',
    );
    const branchSourceTrack = state?.versions.find((version) => version.id === branchVersion.id)?.tracks.find(
      (track) => track.trackVersionId === 'track-version-a-branch',
    );
    const branchTargetTrack = state?.versions.find((version) => version.id === branchVersion.id)?.tracks.find(
      (track) => track.trackVersionId === 'track-version-b-branch',
    );
    const movedSegment = branchTargetTrack?.segments.find((segment) => segment.id === branchSegment.id);

    assert.ok(state);
    assert.ok(sourceTrack);
    assert.ok(targetTrack);
    assert.ok(branchSourceTrack);
    assert.ok(branchTargetTrack);
    assert.equal(sourceTrack?.segments.some((segment) => segment.id === sourceSegment.id), true);
    assert.equal(sourceTrack?.segments.length, 1);
    assert.ok(movedSegment);
    assert.equal(movedSegment?.trackVersionId, 'track-version-b-branch');
    assert.equal(movedSegment?.timelineStartMs, 3500);
    assert.equal(movedSegment?.timelineEndMs, 4300);
    assert.equal(movedSegment?.startMs, 100);
    assert.equal(movedSegment?.endMs, 900);
    assert.equal(targetTrack?.segments.length, 0);
    assert.equal(branchSourceTrack?.segments.length, 0);
    assert.equal(branchTargetTrack?.segments.length, 1);
    assert.equal(bootstrapCalls, 2);
    assert.equal(activeVersionCalls, 1);
    assert.equal(
      persistedProject?.projectState?.versions.find((version) => version.id === branchVersion.id)?.tracks.find(
        (track) => track.trackVersionId === 'track-version-b-branch',
      )?.segments.find((segment) => segment.id === branchSegment.id)?.timelineStartMs,
      3500,
    );
    assert.equal(engine.getState().queue.entries.length, 1);
    assert.equal(engine.getState().queue.entries[0]?.status, 'accepted');
  } finally {
    stubbedCache.getProject = originalGetProject;
    stubbedCache.listAcceptedOperations = originalListAcceptedOperations;
    stubbedCache.listPendingOperations = originalListPendingOperations;
    stubbedCache.findOperationByIdempotencyKey = originalFindOperationByIdempotencyKey;
    stubbedCache.putPendingOperation = originalPutPendingOperation;
    stubbedCache.updatePendingOperation = originalUpdatePendingOperation;
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    stubbedCache.putAsset = originalPutAsset;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    (globalThis as typeof globalThis & { EventSource?: typeof EventSource }).EventSource = originalEventSource;
  }
});

test('ProjectSyncEngine applies remote segment moves once for connected clients', async () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [
          {
            id: 'segment-1',
            trackVersionId: 'track-version-a',
            sourceStartMs: 100,
            sourceEndMs: 900,
            timelineStartMs: 1200,
            timelineEndMs: 2000,
            durationMs: 800,
            startMs: 100,
            endMs: 900,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            isImplicit: false,
          },
        ],
      }),
      makeTrack('track-version-b', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = makeBootstrap([root], root.id);
    harness.state = {
      ...engine.getState(),
      projectState: initial,
      lastSyncedOperationSeq: 1,
    };

    const moveOperation = makeOperation('SEGMENT_MOVED', 2, {
      segmentId: 'segment-1',
      fromTrackVersionId: 'track-version-a',
      toTrackVersionId: 'track-version-b',
      fromTimelineStartMs: 1200,
      fromTimelineEndMs: 2000,
      toTimelineStartMs: 3500,
      toTimelineEndMs: 4300,
    });

    await engine.receiveAcceptedRemoteOperations([moveOperation]);

    const appliedState = engine.getState().projectState;
    const sourceTrack = appliedState?.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-a');
    const targetTrack = appliedState?.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-b');
    const movedSegment = targetTrack?.segments.find((segment) => segment.id === 'segment-1');

    assert.ok(appliedState);
    assert.ok(sourceTrack);
    assert.ok(targetTrack);
    assert.equal(sourceTrack?.segments.some((segment) => segment.id === 'segment-1'), false);
    assert.equal(sourceTrack?.segments.length, 0);
    assert.ok(movedSegment);
    assert.equal(movedSegment?.trackVersionId, 'track-version-b');
    assert.equal(movedSegment?.timelineStartMs, 3500);
    assert.equal(movedSegment?.timelineEndMs, 4300);
    assert.equal(appliedState?.lastSeenOperationSeq, 2);
    assert.equal(targetTrack?.segments.length, 1);

    await engine.receiveAcceptedRemoteOperations([moveOperation]);
    const duplicateState = engine.getState().projectState;
    assert.equal(duplicateState?.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-b')?.segments.find((segment) => segment.id === 'segment-1')?.timelineStartMs, 3500);
    assert.equal(duplicateState?.lastSeenOperationSeq, 2);
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
  }
});

test.skip('ProjectSyncEngine branches and replays accepted segment moves into the new version', async () => {
  const rootSegment = {
    id: 'segment-1',
    trackVersionId: 'track-version-a',
    sourceStartMs: 100,
    sourceEndMs: 900,
    timelineStartMs: 1200,
    timelineEndMs: 2000,
    durationMs: 800,
    startMs: 100,
    endMs: 900,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  } satisfies TrackTimelineSegment;
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [rootSegment],
      }),
      makeTrack('track-version-b', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [],
      }),
    ],
  });
  const rootBootstrap = makeBootstrap([root], root.id);
  const branchSegment = {
    ...rootSegment,
    id: 'segment-branch',
    trackVersionId: 'track-version-a-branch',
  };
  const branchVersion = makeVersion('version-branch', {
    label: 'Moved clip',
    name: 'Moved clip',
    branchName: 'Moved clip',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 3,
    tracks: [
      makeTrack('track-version-a-branch', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [],
      }),
      makeTrack('track-version-b-branch', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [
          {
            ...branchSegment,
            trackVersionId: 'track-version-b-branch',
            timelineStartMs: 3500,
            timelineEndMs: 4300,
          },
        ],
      }),
    ],
  });
  const branchBootstrap = makeBootstrap([root, branchVersion], branchVersion.id);
  branchBootstrap.project.currentVersionId = branchVersion.id;
  branchBootstrap.latestSnapshot = {
    id: 'snapshot-2',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 3,
    snapshot: {
      versions: [root, branchVersion],
      currentVersionId: branchVersion.id,
      comments: [],
      annotations: [],
      tempoMetadataByTrackVersionId: {},
    },
    createdById: 'user-b',
    createdAt: '2025-01-02T00:00:00.000Z',
  };
  branchBootstrap.activeVersionId = branchVersion.id;
  branchBootstrap.isFollowingHead = true;
  branchBootstrap.activeBranchName = branchVersion.label;
  branchBootstrap.operationTail = [];

  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    findOperationByIdempotencyKey: (projectId: string, demoId: string, idempotencyKey: string) => Promise<DawProjectOperationRecord | null>;
    putPendingOperation: (...args: unknown[]) => Promise<void>;
    updatePendingOperation: (...args: unknown[]) => Promise<void>;
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
    putAsset: (...args: unknown[]) => Promise<void>;
  };

  const originalFindOperationByIdempotencyKey = stubbedCache.findOperationByIdempotencyKey;
  const originalPutPendingOperation = stubbedCache.putPendingOperation;
  const originalUpdatePendingOperation = stubbedCache.updatePendingOperation;
  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  const originalPutAsset = stubbedCache.putAsset;
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;

  stubbedCache.findOperationByIdempotencyKey = async () => null;
  stubbedCache.putPendingOperation = async () => {};
  stubbedCache.updatePendingOperation = async () => {};
  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};
  stubbedCache.putPluginDefinitions = async () => {};
  stubbedCache.putAsset = async () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });

  let bootstrapCalls = 0;
  let activeVersionCalls = 0;
  const movedOperation = {
    ...makeOperation('SEGMENT_MOVED', 3, {
      segmentId: branchSegment.id,
      fromTrackVersionId: branchSegment.trackVersionId,
      toTrackVersionId: 'track-version-b-branch',
      fromTimelineStartMs: 1200,
      fromTimelineEndMs: 2000,
      toTimelineStartMs: 3500,
      toTimelineEndMs: 4300,
    }),
    idempotencyKey: 'move-segment-1',
    clientOperationId: 'client-move-segment-1',
  } satisfies DawProjectOperationRecord;

  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/bootstrap')) {
      bootstrapCalls += 1;
      return jsonResponse(branchBootstrap);
    }

    if (url.includes('/active-version') && init?.method === 'POST') {
      activeVersionCalls += 1;
      return jsonResponse({
        activeVersionId: branchVersion.id,
        isFollowingHead: true,
        activeBranchName: branchVersion.label,
      });
    }

    if (url.includes('/operations') && init?.method === 'POST') {
      return jsonResponse(movedOperation);
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = rootBootstrap;
    harness.state = {
      ...engine.getState(),
      projectState: createLocalProjectStateFromBootstrap(rootBootstrap),
      baseSnapshotId: rootBootstrap.latestSnapshot?.id ?? null,
      lastSyncedOperationSeq: rootBootstrap.latestSnapshot?.operationSeq ?? 0,
      queue: { entries: [] },
      isBootstrapping: false,
      isOnline: true,
      isSyncing: false,
      lastError: null,
    };

    await engine.commitOperation({
      demoId: 'demo-1',
      operationType: 'SEGMENT_MOVED',
      payload: {
        segmentId: rootSegment.id,
        fromTrackVersionId: 'track-version-a',
        toTrackVersionId: 'track-version-b',
        fromTimelineStartMs: rootSegment.timelineStartMs,
        fromTimelineEndMs: rootSegment.timelineEndMs,
        toTimelineStartMs: 3500,
        toTimelineEndMs: 4300,
      },
      baseSnapshotId: rootBootstrap.latestSnapshot?.id ?? null,
      baseOperationSeq: rootBootstrap.latestSnapshot?.operationSeq ?? 0,
      targetTrackId: 'track-b',
      targetSegmentId: rootSegment.id,
      affectedTimeRange: {
        startMs: rootSegment.timelineStartMs,
        endMs: 4300,
      },
      idempotencyKey: 'move-segment-1',
      clientOperationId: 'client-move-segment-1',
    });

    const appliedState = engine.getState().projectState;
    const sourceRootTrack = appliedState?.versions.find((version) => version.id === root.id)?.tracks.find(
      (track) => track.trackVersionId === 'track-version-a',
    );
    const branchSourceTrack = appliedState?.versions.find((version) => version.id === branchVersion.id)?.tracks.find(
      (track) => track.trackVersionId === 'track-version-a-branch',
    );
    const branchTargetTrack = appliedState?.versions.find((version) => version.id === branchVersion.id)?.tracks.find(
      (track) => track.trackVersionId === 'track-version-b-branch',
    );
    const movedSegment = branchTargetTrack?.segments.find((segment) => segment.id === branchSegment.id);

    assert.ok(appliedState);
    assert.equal(bootstrapCalls, 2);
    assert.equal(activeVersionCalls, 1);
    assert.equal(appliedState?.currentVersionId, branchVersion.id);
    assert.equal(appliedState?.activeVersionId, branchVersion.id);
    assert.equal(sourceRootTrack?.segments.some((segment) => segment.id === rootSegment.id), true);
    assert.equal(branchSourceTrack?.segments.some((segment) => segment.id === branchSegment.id), false);
    assert.equal(branchTargetTrack?.segments.find((segment) => segment.id === branchSegment.id)?.timelineStartMs, 3500);
    assert.ok(movedSegment);
    assert.equal(movedSegment?.trackVersionId, 'track-version-b-branch');
    assert.equal(movedSegment?.timelineStartMs, 3500);
    assert.equal(movedSegment?.timelineEndMs, 4300);
    assert.equal(engine.getState().queue.entries.length, 1);
    assert.equal(engine.getState().queue.entries[0]?.status, 'accepted');
  } finally {
    stubbedCache.findOperationByIdempotencyKey = originalFindOperationByIdempotencyKey;
    stubbedCache.putPendingOperation = originalPutPendingOperation;
    stubbedCache.updatePendingOperation = originalUpdatePendingOperation;
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    stubbedCache.putAsset = originalPutAsset;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  }
});

test('ProjectSyncEngine applies accepted segment moves in place without creating a version branch', async () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [
          {
            id: 'segment-1',
            trackVersionId: 'track-version-a',
            sourceStartMs: 100,
            sourceEndMs: 900,
            timelineStartMs: 1200,
            timelineEndMs: 2000,
            durationMs: 800,
            startMs: 100,
            endMs: 900,
            gainDb: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
            isMuted: false,
            position: 0,
            isImplicit: false,
          },
        ],
      }),
      makeTrack('track-version-b', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;
  const capturedUrls: string[] = [];

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });

  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);

    if (url.includes('/operations') && init?.method === 'POST') {
      return jsonResponse({
        ...makeOperation('SEGMENT_MOVED', 2, {
          segmentId: 'segment-1',
          fromTrackVersionId: 'track-version-a',
          toTrackVersionId: 'track-version-b',
          fromTimelineStartMs: 1200,
          fromTimelineEndMs: 2000,
          toTimelineStartMs: 3500,
          toTimelineEndMs: 4300,
        }),
        idempotencyKey: 'move-segment-1',
        clientOperationId: 'client-move-segment-1',
      });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = makeBootstrap([root], root.id);
    harness.state = {
      ...engine.getState(),
      projectState: initial,
      lastSyncedOperationSeq: 1,
    };

    const operation = await engine.commitOperation({
      demoId: 'demo-1',
      operationType: 'SEGMENT_MOVED',
      payload: {
        segmentId: 'segment-1',
        fromTrackVersionId: 'track-version-a',
        toTrackVersionId: 'track-version-b',
        fromTimelineStartMs: 1200,
        fromTimelineEndMs: 2000,
        toTimelineStartMs: 3500,
        toTimelineEndMs: 4300,
      },
      baseSnapshotId: root.id,
      baseOperationSeq: 1,
      targetTrackId: 'track-b',
      targetSegmentId: 'segment-1',
      affectedTimeRange: {
        startMs: 1200,
        endMs: 4300,
      },
      idempotencyKey: 'move-segment-1',
      clientOperationId: 'client-move-segment-1',
    });

    const appliedState = engine.getState().projectState;
    const sourceTrack = appliedState?.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-a');
    const targetTrack = appliedState?.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-b');
    const movedSegment = targetTrack?.segments.find((segment) => segment.id === 'segment-1');

    assert.ok(appliedState);
    assert.equal(operation.type, 'SEGMENT_MOVED');
    assert.deepEqual(capturedUrls, ['/api/daw/projects/project-1/operations']);
    assert.equal(appliedState?.versions.length, 1);
    assert.equal(appliedState?.currentVersionId, root.id);
    assert.equal(appliedState?.activeVersionId, root.id);
    assert.ok(sourceTrack);
    assert.ok(targetTrack);
    assert.equal(sourceTrack?.segments.some((segment) => segment.id === 'segment-1'), false);
    assert.equal(sourceTrack?.segments.length, 0);
    assert.ok(movedSegment);
    assert.equal(movedSegment?.trackVersionId, 'track-version-b');
    assert.equal(movedSegment?.timelineStartMs, 3500);
    assert.equal(movedSegment?.timelineEndMs, 4300);
    assert.equal(appliedState?.lastSeenOperationSeq, 2);
    assert.equal(targetTrack?.segments.length, 1);
    assert.equal(engine.getState().queue.entries.length, 1);
    assert.equal(engine.getState().queue.entries[0]?.status, 'accepted');
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  }
});

test('ProjectSyncEngine applies accepted track offset updates in place without creating a version branch', async () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        startOffsetMs: 0,
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;
  const capturedUrls: string[] = [];

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });

  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);

    if (url.includes('/operations') && init?.method === 'POST') {
      return jsonResponse({
        ...makeOperation('TRACK_OFFSET_UPDATED', 2, {
          trackVersionId: 'track-version-a',
          startOffsetMs: 2450,
        }),
        idempotencyKey: 'track-offset-1',
        clientOperationId: 'client-track-offset-1',
      });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = makeBootstrap([root], root.id);
    harness.state = {
      ...engine.getState(),
      projectState: initial,
      lastSyncedOperationSeq: 1,
    };

    const operation = await engine.commitOperation({
      demoId: 'demo-1',
      operationType: 'TRACK_OFFSET_UPDATED',
      payload: {
        trackVersionId: 'track-version-a',
        startOffsetMs: 2450,
      },
      baseSnapshotId: root.id,
      baseOperationSeq: 1,
      targetTrackId: 'track-a',
      idempotencyKey: 'track-offset-1',
      clientOperationId: 'client-track-offset-1',
    });

    const appliedState = engine.getState().projectState;
    const updatedTrack = appliedState?.versions[0]?.tracks[0];

    assert.ok(appliedState);
    assert.equal(operation.type, 'TRACK_OFFSET_UPDATED');
    assert.deepEqual(capturedUrls, ['/api/daw/projects/project-1/operations']);
    assert.equal(appliedState?.versions.length, 1);
    assert.equal(appliedState?.currentVersionId, root.id);
    assert.equal(appliedState?.activeVersionId, root.id);
    assert.ok(updatedTrack);
    assert.equal(updatedTrack?.trackVersionId, 'track-version-a');
    assert.equal(updatedTrack?.startOffsetMs, 2450);
    assert.equal(appliedState?.lastSeenOperationSeq, 2);
    assert.equal(engine.getState().queue.entries.length, 1);
    assert.equal(engine.getState().queue.entries[0]?.status, 'accepted');
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  }
});

test('ProjectSyncEngine skips queued request-shaped segment splits during replay', () => {
  const sourceSegment: TrackTimelineSegment = {
    id: 'segment-source',
    trackVersionId: 'track-version-a',
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [sourceSegment],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    replayQueuedOperationsIntoProjectState: () => boolean;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.state = {
    ...engine.getState(),
    projectState: initial,
    baseSnapshotId: 'snapshot-1',
    lastSyncedOperationSeq: 1,
    queue: {
      entries: [
        {
          id: 'queued-split-1',
          operationType: 'SEGMENT_SPLIT',
          payload: {
            trackVersionId: 'track-version-a',
            segmentId: 'segment-source',
            segmentStartMs: 0,
            segmentEndMs: 1000,
            splitTimeMs: 500,
          },
          baseSnapshotId: 'snapshot-1',
          baseOperationSeq: 1,
          targetTrackId: 'track-a',
          targetSegmentId: 'segment-source',
          affectedTimeRange: {
            startMs: 0,
            endMs: 1000,
          },
          status: 'optimistic',
          attemptCount: 0,
          error: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          idempotencyKey: 'queued-split-1',
          clientOperationId: 'client-queued-split-1',
        },
      ],
    },
    isBootstrapping: false,
    isOnline: true,
    isSyncing: false,
    lastError: null,
  };

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const replayed = harness.replayQueuedOperationsIntoProjectState();
    const appliedState = engine.getState().projectState;

    assert.equal(replayed, false);
    assert.ok(appliedState);
    assert.equal(appliedState?.versions[0]?.tracks[0]?.segments.length, 1);
    assert.equal(engine.getState().queue.entries[0]?.status, 'optimistic');
  } finally {
    console.warn = originalWarn;
  }
});

test('ProjectSyncEngine applies a remote accepted segment split even when a local request-shaped split is queued', async () => {
  const sourceSegment: TrackTimelineSegment = {
    id: 'segment-source',
    trackVersionId: 'track-version-a',
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [sourceSegment],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;
  const originalWarn = console.warn;

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};
  console.warn = () => {};

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = makeBootstrap([root], root.id);
    harness.state = {
      ...engine.getState(),
      projectState: initial,
      lastSyncedOperationSeq: 1,
      queue: {
        entries: [
          {
            id: 'queued-split-1',
            operationType: 'SEGMENT_SPLIT',
            payload: {
              trackVersionId: 'track-version-a',
              segmentId: 'segment-source',
              segmentStartMs: 0,
              segmentEndMs: 1000,
              splitTimeMs: 500,
            },
            baseSnapshotId: 'snapshot-1',
            baseOperationSeq: 1,
            targetTrackId: 'track-a',
            targetSegmentId: 'segment-source',
            affectedTimeRange: {
              startMs: 0,
              endMs: 1000,
            },
            status: 'optimistic',
            attemptCount: 0,
            error: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            idempotencyKey: 'queued-split-1',
            clientOperationId: 'client-queued-split-1',
          },
        ],
      },
      isBootstrapping: false,
      isOnline: true,
      isSyncing: false,
      lastError: null,
    };

    const acceptedSplit = makeOperation('SEGMENT_SPLIT', 2, {
      trackVersionId: 'track-version-a',
      sourceSegmentId: 'segment-source',
      leftSegment: {
        id: 'segment-left',
        trackVersionId: 'track-version-a',
        startMs: 0,
        endMs: 500,
        timelineStartMs: 0,
        timelineEndMs: 500,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 0,
      },
      rightSegment: {
        id: 'segment-right',
        trackVersionId: 'track-version-a',
        startMs: 500,
        endMs: 1000,
        timelineStartMs: 500,
        timelineEndMs: 1000,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        isMuted: false,
        position: 1,
      },
    });

    await engine.receiveAcceptedRemoteOperations([acceptedSplit]);

    const appliedState = engine.getState().projectState;
    const appliedTrack = appliedState?.versions[0]?.tracks[0];

    assert.ok(appliedState);
    assert.ok(appliedTrack);
    assert.equal(appliedTrack?.segments.length, 2);
    assert.deepEqual(
      appliedTrack?.segments.map((segment) => segment.id),
      ['segment-left', 'segment-right'],
    );
    assert.equal(appliedState?.lastSeenOperationSeq, 2);
    assert.equal(engine.getState().queue.entries[0]?.status, 'optimistic');
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
    console.warn = originalWarn;
  }
});

test('ProjectSyncEngine rebases an optimistic trim when a remote accepted trim lands', async () => {
  const sourceSegment: TrackTimelineSegment = {
    id: 'segment-source',
    trackVersionId: 'track-version-a',
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [sourceSegment],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
  };

  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;

  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.state = {
      ...engine.getState(),
      projectState: initial,
      lastSyncedOperationSeq: 1,
      queue: {
        entries: [
          {
            id: 'queued-trim-1',
            operationType: 'SEGMENT_TRIMMED',
            payload: {
              trackVersionId: 'track-version-a',
              segmentId: 'segment-source',
              from: { startMs: 0, endMs: 1000 },
              to: { startMs: 150, endMs: 850 },
            },
            baseSnapshotId: 'snapshot-1',
            baseOperationSeq: 1,
            targetTrackId: 'track-a',
            targetSegmentId: 'segment-source',
            affectedTimeRange: {
              startMs: 0,
              endMs: 1000,
            },
            status: 'optimistic',
            attemptCount: 0,
            error: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            idempotencyKey: 'queued-trim-1',
            clientOperationId: 'client-queued-trim-1',
          },
        ],
      },
      isBootstrapping: false,
      isOnline: true,
      isSyncing: false,
      lastError: null,
    };

    const acceptedTrim = makeOperation('SEGMENT_TRIMMED', 2, {
      trackVersionId: 'track-version-a',
      segmentId: 'segment-source',
      from: { startMs: 0, endMs: 1000 },
      to: { startMs: 100, endMs: 900 },
    });

    await engine.receiveAcceptedRemoteOperations([acceptedTrim]);

    const appliedState = engine.getState().projectState;
    const appliedSegment = appliedState?.versions[0]?.tracks[0]?.segments[0];

    assert.ok(appliedState);
    assert.ok(appliedSegment);
    assert.equal(appliedSegment?.startMs, 250);
    assert.equal(appliedSegment?.endMs, 750);
    assert.equal(appliedSegment?.timelineEndMs, 500);
    assert.equal(engine.getState().queue.entries[0]?.status, 'optimistic');
  } finally {
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
  }
});

test.skip('ProjectSyncEngine converges on reconnect after a remote accepted trim and a queued local trim', async () => {
  const sourceSegment: TrackTimelineSegment = {
    id: 'segment-source',
    trackVersionId: 'track-version-a',
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [sourceSegment],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const bootstrapTailTrim = makeOperation('SEGMENT_TRIMMED', 2, {
    trackVersionId: 'track-version-a',
    segmentId: 'segment-source',
    from: { startMs: 0, endMs: 1000 },
    to: { startMs: 100, endMs: 900 },
  });
  const bootstrapResponse = makeBootstrap([root], root.id);
  bootstrapResponse.latestSnapshot = {
    id: 'snapshot-2',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 2,
    snapshot: {
      versions: [root],
      currentVersionId: root.id,
      comments: [],
      annotations: [],
      tempoMetadataByTrackVersionId: {},
    },
    createdById: 'user-b',
    createdAt: '2025-01-02T00:00:00.000Z',
  };
  bootstrapResponse.operationTail = [bootstrapTailTrim];
  const acceptedQueuedTrim = makeOperation('SEGMENT_TRIMMED', 3, {
    trackVersionId: 'track-version-a',
    segmentId: 'segment-source',
    from: { startMs: 100, endMs: 900 },
    to: { startMs: 250, endMs: 750 },
  });
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    persistProjectState: () => Promise<void>;
    refreshVersionTreeFromServer: () => Promise<void>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    getProject: (projectId: string, demoId: string) => Promise<null>;
    listAcceptedOperations: (projectId: string, demoId: string, afterSeq: number) => Promise<DawProjectOperationRecord[]>;
    listPendingOperations: (
      projectId: string,
      demoId: string,
    ) => Promise<
      Array<{
        key: string;
        projectId: string;
        demoId: string;
        request: DawOperationCommitRequest;
        status: 'pending' | 'retrying' | 'failed';
        attemptCount: number;
        error: string | null;
        createdAt: number;
        updatedAt: number;
      }>
    >;
    findOperationByIdempotencyKey: (projectId: string, demoId: string, idempotencyKey: string) => Promise<DawProjectOperationRecord | null>;
    putPendingOperation: (...args: unknown[]) => Promise<void>;
    updatePendingOperation: (...args: unknown[]) => Promise<void>;
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (record: {
      projectId: string;
      demoId: string;
      bootstrap: DawProjectBootstrapResponse | null;
      projectState: ReturnType<typeof createLocalProjectStateFromBootstrap> | null;
      latestAcceptedOperationSeq: number;
    }) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
    putAsset: (...args: unknown[]) => Promise<void>;
  };

  const originalGetProject = stubbedCache.getProject;
  const originalListAcceptedOperations = stubbedCache.listAcceptedOperations;
  const originalListPendingOperations = stubbedCache.listPendingOperations;
  const originalFindOperationByIdempotencyKey = stubbedCache.findOperationByIdempotencyKey;
  const originalPutPendingOperation = stubbedCache.putPendingOperation;
  const originalUpdatePendingOperation = stubbedCache.updatePendingOperation;
  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  const originalPutAsset = stubbedCache.putAsset;
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  let bootstrapCalls = 0;
  let persistedProject: {
    projectId: string;
    demoId: string;
    bootstrap: DawProjectBootstrapResponse | null;
    projectState: ReturnType<typeof createLocalProjectStateFromBootstrap> | null;
    latestAcceptedOperationSeq: number;
  } | null = null;

  stubbedCache.getProject = async () => null;
  stubbedCache.listAcceptedOperations = async () => [];
  stubbedCache.listPendingOperations = async () => [
    {
      key: 'project-1:demo-1:queued-trim-1',
      projectId: 'project-1',
      demoId: 'demo-1',
      request: {
        demoId: 'demo-1',
        operationType: 'SEGMENT_TRIMMED',
        payload: {
          trackVersionId: 'track-version-a',
          segmentId: 'segment-source',
          from: { startMs: 0, endMs: 1000 },
          to: { startMs: 150, endMs: 850 },
        },
        baseSnapshotId: 'snapshot-1',
        baseOperationSeq: 1,
        targetTrackId: 'track-a',
        targetSegmentId: 'segment-source',
        affectedTimeRange: {
          startMs: 0,
          endMs: 1000,
        },
        idempotencyKey: 'queued-trim-1',
        clientOperationId: 'client-queued-trim-1',
      },
      status: 'pending',
      attemptCount: 0,
      error: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  stubbedCache.findOperationByIdempotencyKey = async () => null;
  stubbedCache.putPendingOperation = async () => {};
  stubbedCache.updatePendingOperation = async () => {};
  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async (record) => {
    persistedProject = record;
  };
  stubbedCache.putPluginDefinitions = async () => {};
  stubbedCache.putAsset = async () => {};
  (globalThis as typeof globalThis & { EventSource: typeof EventSource }).EventSource = class {
    close() {}
    addEventListener() {}
  } as unknown as typeof EventSource;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/bootstrap')) {
      bootstrapCalls += 1;
      return new Response(JSON.stringify(bootstrapResponse), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    if (url.includes('/operations') && init?.method === 'POST') {
      return jsonResponse(acceptedQueuedTrim);
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    await engine.bootstrap({
      projectId: 'project-1',
      demoId: 'demo-1',
      initialProjectState: initial,
    });

    const state = engine.getState().projectState;
    const track = state?.versions[0]?.tracks[0];

    assert.ok(state);
    assert.ok(track);
    assert.equal(bootstrapCalls, 2);
    assert.equal(track?.segments[0]?.startMs, 250);
    assert.equal(track?.segments[0]?.endMs, 750);
    assert.equal(track?.segments[0]?.timelineEndMs, 500);
    assert.equal(engine.getState().queue.entries[0]?.status, 'accepted');
  } finally {
    stubbedCache.getProject = originalGetProject;
    stubbedCache.listAcceptedOperations = originalListAcceptedOperations;
    stubbedCache.listPendingOperations = originalListPendingOperations;
    stubbedCache.findOperationByIdempotencyKey = originalFindOperationByIdempotencyKey;
    stubbedCache.putPendingOperation = originalPutPendingOperation;
    stubbedCache.updatePendingOperation = originalUpdatePendingOperation;
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    stubbedCache.putAsset = originalPutAsset;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    (globalThis as typeof globalThis & { EventSource?: typeof EventSource }).EventSource = originalEventSource;
  }
});

test('ProjectSyncEngine replays queued local trims against a restored remote-accepted trim state', () => {
  const sourceSegment: TrackTimelineSegment = {
    id: 'segment-source',
    trackVersionId: 'track-version-a',
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [sourceSegment],
      }),
    ],
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const remoteAcceptedTrim = makeOperation('SEGMENT_TRIMMED', 2, {
    trackVersionId: 'track-version-a',
    segmentId: 'segment-source',
    from: { startMs: 0, endMs: 1000 },
    to: { startMs: 100, endMs: 900 },
  });
  const restoredRemoteState = applyAcceptedProjectOperation(initial, remoteAcceptedTrim);
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    replayQueuedOperationsIntoProjectState: () => boolean;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.state = {
    ...engine.getState(),
    projectState: restoredRemoteState,
    lastSyncedOperationSeq: 2,
    queue: {
      entries: [
        {
          id: 'queued-trim-1',
          operationType: 'SEGMENT_TRIMMED',
          payload: {
            trackVersionId: 'track-version-a',
            segmentId: 'segment-source',
            from: { startMs: 0, endMs: 1000 },
            to: { startMs: 150, endMs: 850 },
          },
          baseSnapshotId: 'snapshot-1',
          baseOperationSeq: 1,
          targetTrackId: 'track-a',
          targetSegmentId: 'segment-source',
          affectedTimeRange: {
            startMs: 0,
            endMs: 1000,
          },
          status: 'pending',
          attemptCount: 0,
          error: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          idempotencyKey: 'queued-trim-1',
          clientOperationId: 'client-queued-trim-1',
        },
      ],
    },
    isBootstrapping: false,
    isOnline: true,
    isSyncing: false,
    lastError: null,
  };

  const replayed = harness.replayQueuedOperationsIntoProjectState();
  const track = engine.getState().projectState?.versions[0]?.tracks[0];

  assert.equal(replayed, true);
  assert.ok(track);
  assert.equal(track?.segments[0]?.startMs, 250);
  assert.equal(track?.segments[0]?.endMs, 750);
  assert.equal(track?.segments[0]?.timelineEndMs, 500);
});

test('ProjectSyncEngine marks the client local-only when a commit falls back offline', async () => {
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
      }),
    ],
  });
  const bootstrap = makeBootstrap([root], root.id);
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    findOperationByIdempotencyKey: (projectId: string, demoId: string, idempotencyKey: string) => Promise<DawProjectOperationRecord | null>;
    putPendingOperation: (...args: unknown[]) => Promise<void>;
    updatePendingOperation: (...args: unknown[]) => Promise<void>;
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
    putAsset: (...args: unknown[]) => Promise<void>;
  };

  const originalFindOperationByIdempotencyKey = stubbedCache.findOperationByIdempotencyKey;
  const originalPutPendingOperation = stubbedCache.putPendingOperation;
  const originalUpdatePendingOperation = stubbedCache.updatePendingOperation;
  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  const originalPutAsset = stubbedCache.putAsset;
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;

  stubbedCache.findOperationByIdempotencyKey = async () => null;
  stubbedCache.putPendingOperation = async () => {};
  stubbedCache.updatePendingOperation = async () => {};
  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};
  stubbedCache.putPluginDefinitions = async () => {};
  stubbedCache.putAsset = async () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
  });
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async () => {
    throw new Error('fetch should not be called while offline');
  };

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = bootstrap;
    harness.state = {
      ...engine.getState(),
      projectState: createLocalProjectStateFromBootstrap(bootstrap),
      baseSnapshotId: bootstrap.latestSnapshot?.id ?? null,
      lastSyncedOperationSeq: bootstrap.latestSnapshot?.operationSeq ?? 0,
      queue: { entries: [] },
      isBootstrapping: false,
      isOnline: true,
      isSyncing: false,
      lastError: null,
    };

    const operation = await engine.commitOperation({
      demoId: 'demo-1',
      operationType: 'TRACK_RENAMED',
      payload: {
        trackId: 'track-a',
        trackName: 'Local rename',
      },
      baseSnapshotId: bootstrap.latestSnapshot?.id ?? null,
      baseOperationSeq: bootstrap.latestSnapshot?.operationSeq ?? 0,
      targetTrackId: 'track-a',
      targetSegmentId: null,
      affectedTimeRange: null,
      idempotencyKey: 'rename-offline-1',
      clientOperationId: 'client-rename-offline-1',
    });

    const appliedState = engine.getState().projectState;
    const renamedTrack = appliedState?.versions.find((version) => version.id === root.id)?.tracks.find(
      (track) => track.trackVersionId === 'track-version-a',
    );

    assert.ok(appliedState);
    assert.equal(operation.operationSeq, 0);
    assert.equal(operation.actorUserId, 'local');
    assert.equal(renamedTrack?.trackName, 'Local rename');
    assert.equal(engine.getState().queue.entries[0]?.status, 'optimistic');
    assert.equal(engine.getState().isOnline, false);
  } finally {
    stubbedCache.findOperationByIdempotencyKey = originalFindOperationByIdempotencyKey;
    stubbedCache.putPendingOperation = originalPutPendingOperation;
    stubbedCache.updatePendingOperation = originalUpdatePendingOperation;
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    stubbedCache.putAsset = originalPutAsset;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  }
});

test('ProjectSyncEngine rejected segment moves rebootstrap back to the canonical clip layout', async () => {
  const sourceSegment: TrackTimelineSegment = {
    id: 'segment-1',
    trackVersionId: 'track-version-a',
    sourceStartMs: 100,
    sourceEndMs: 900,
    timelineStartMs: 1200,
    timelineEndMs: 2000,
    durationMs: 800,
    startMs: 100,
    endMs: 900,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };
  const root = makeVersion('version-root', {
    isCurrent: true,
    tracks: [
      makeTrack('track-version-a', {
        trackId: 'track-a',
        trackName: 'Track A',
        segments: [sourceSegment],
      }),
      makeTrack('track-version-b', {
        trackId: 'track-b',
        trackName: 'Track B',
        segments: [],
      }),
    ],
  });
  const bootstrap = makeBootstrap([root], root.id);
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
  };
  const stubbedCache = dawLocalCache as unknown as {
    findOperationByIdempotencyKey: (projectId: string, demoId: string, idempotencyKey: string) => Promise<DawProjectOperationRecord | null>;
    putPendingOperation: (...args: unknown[]) => Promise<void>;
    updatePendingOperation: (...args: unknown[]) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
    putAsset: (...args: unknown[]) => Promise<void>;
  };

  const originalFindOperationByIdempotencyKey = stubbedCache.findOperationByIdempotencyKey;
  const originalPutPendingOperation = stubbedCache.putPendingOperation;
  const originalUpdatePendingOperation = stubbedCache.updatePendingOperation;
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  const originalPutAsset = stubbedCache.putAsset;
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;

  stubbedCache.findOperationByIdempotencyKey = async () => null;
  stubbedCache.putPendingOperation = async () => {};
  stubbedCache.updatePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};
  stubbedCache.putPluginDefinitions = async () => {};
  stubbedCache.putAsset = async () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });

  let bootstrapCalls = 0;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/bootstrap')) {
      bootstrapCalls += 1;
      return jsonResponse(bootstrap);
    }

    if (url.includes('/operations') && init?.method === 'POST') {
      return jsonResponse(
        {
          error: 'Segment bounds no longer match the saved clip',
          conflict: {
            reason: 'Segment bounds no longer match the saved clip',
            conflictingOperationIds: [],
            conflictingOperationSeqs: [],
            branchVersion: null,
          },
        },
        409,
      );
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.bootstrapResponse = bootstrap;
    harness.state = {
      ...engine.getState(),
      projectState: createLocalProjectStateFromBootstrap(bootstrap),
      baseSnapshotId: bootstrap.latestSnapshot?.id ?? null,
      lastSyncedOperationSeq: bootstrap.latestSnapshot?.operationSeq ?? 0,
      queue: { entries: [] },
      isBootstrapping: false,
      isOnline: true,
      isSyncing: false,
      lastError: null,
    };

    await assert.rejects(
      engine.commitOperation({
        demoId: 'demo-1',
        operationType: 'SEGMENT_MOVED',
        payload: {
          segmentId: 'segment-1',
          fromTrackVersionId: 'track-version-a',
          toTrackVersionId: 'track-version-b',
          fromTimelineStartMs: 1200,
          fromTimelineEndMs: 2000,
          toTimelineStartMs: 3500,
          toTimelineEndMs: 4300,
        },
        baseSnapshotId: 'snapshot-1',
        baseOperationSeq: 1,
        targetTrackId: 'track-b',
        targetSegmentId: 'segment-1',
        affectedTimeRange: {
          startMs: 1200,
          endMs: 4300,
        },
        idempotencyKey: 'move-rejected-1',
        clientOperationId: 'client-move-rejected-1',
      }),
      /Segment bounds no longer match the saved clip/,
    );

    const appliedState = engine.getState().projectState;
    const sourceTrack = appliedState?.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-a');
    const targetTrack = appliedState?.versions[0]?.tracks.find((track) => track.trackVersionId === 'track-version-b');

    assert.ok(appliedState);
    assert.ok(sourceTrack);
    assert.ok(targetTrack);
    assert.equal(sourceTrack?.segments.length, 1);
    assert.equal(sourceTrack?.segments.some((segment) => segment.id === 'segment-1'), true);
    assert.equal(targetTrack?.segments.length, 0);
    assert.equal(engine.getState().queue.entries[0]?.status, 'conflicted');
    assert.equal(bootstrapCalls, 1);
  } finally {
    stubbedCache.findOperationByIdempotencyKey = originalFindOperationByIdempotencyKey;
    stubbedCache.putPendingOperation = originalPutPendingOperation;
    stubbedCache.updatePendingOperation = originalUpdatePendingOperation;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    stubbedCache.putAsset = originalPutAsset;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  }
});

test('ProjectSyncEngine setActiveVersion updates the viewer checkout through the active-version route', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const branch = makeVersion('version-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    isCurrent: false,
  });
  const bootstrap = makeBootstrap([root, branch], root.id);
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    persistProjectState: () => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.bootstrapResponse = bootstrap;
  harness.state = {
    projectState: createLocalProjectStateFromBootstrap({
      ...bootstrap,
      activeVersionId: root.id,
      isFollowingHead: true,
    }),
    queue: { entries: [] },
    baseSnapshotId: 'snapshot-1',
    lastSyncedOperationSeq: 1,
    isBootstrapping: false,
    isOnline: true,
    isSyncing: false,
    lastError: null,
  };

  let persistCalls = 0;
  harness.persistProjectState = async () => {
    persistCalls += 1;
  };

  const originalFetch = globalThis.fetch;
  let capturedUrl: string | null = null;
  let capturedBody: string | null = null;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = typeof input === 'string' ? input : input.toString();
    capturedBody = typeof init?.body === 'string' ? init.body : null;
    return new Response(
      JSON.stringify({
        activeVersionId: branch.id,
        isFollowingHead: true,
        activeBranchName: branch.label,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  };

  try {
    const result = await engine.setActiveVersion(branch.id, { isFollowingHead: false });

    assert.equal(capturedUrl, '/api/daw/projects/project-1/active-version');
    assert.ok(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody ?? '{}'), {
      demoId: 'demo-1',
      activeVersionId: branch.id,
      isFollowingHead: false,
    });
    assert.equal(result?.activeVersionId, branch.id);
    assert.equal(engine.getState().projectState?.currentVersionId, root.id);
    assert.equal(engine.getState().projectState?.activeVersionId, branch.id);
    assert.equal(engine.getState().projectState?.isFollowingHead, true);
    assert.equal(persistCalls, 1);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('ProjectSyncEngine rebootstrap preserves an existing checkout when a newer branch exists', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const branch = makeVersion('version-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    isCurrent: true,
    operationSeq: 2,
  });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    refreshVersionTreeFromServer: () => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.bootstrapResponse = makeBootstrap([root], root.id);
  harness.state = {
    ...engine.getState(),
    projectState: {
      ...initial,
      activeVersionId: root.id,
      isFollowingHead: false,
    },
    lastSyncedOperationSeq: 1,
  };

  const bootstrapResponse: DawProjectBootstrapResponse = {
    ...makeBootstrap([root, branch], root.id),
    activeVersionId: root.id,
    isFollowingHead: true,
    latestSnapshot: {
      ...makeBootstrap([root, branch], branch.id).latestSnapshot!,
      id: 'snapshot-2',
      operationSeq: 2,
      snapshot: {
        ...makeBootstrap([root, branch], branch.id).latestSnapshot!.snapshot,
      },
      createdById: 'user-a',
      createdAt: '2025-01-02T00:00:00.000Z',
    },
  };

  const originalFetch = globalThis.fetch;
  const capturedUrls: string[] = [];
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);
    if (url.includes('/operations')) {
      return jsonResponse({
        operations: [],
        latestSnapshotSeq: 2,
        rebootstrapRequired: true,
      });
    }
    if (url.includes('/bootstrap')) {
      return jsonResponse(bootstrapResponse);
    }
    if (url.includes('/active-version')) {
      return jsonResponse({
        activeVersionId: branch.id,
        isFollowingHead: true,
        activeBranchName: branch.label,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    await harness.refreshVersionTreeFromServer();

    assert.deepEqual(capturedUrls, [
      '/api/daw/projects/project-1/operations?demoId=demo-1&afterSeq=1',
      '/api/daw/projects/project-1/bootstrap?demoId=demo-1',
    ]);
    const projectState = engine.getState().projectState;
    assert.ok(projectState);
    assert.equal(projectState?.versions.length, 2);
    assert.equal(projectState?.currentVersionId, branch.id);
    assert.equal(projectState?.activeVersionId, root.id);
    assert.equal(projectState?.isFollowingHead, true);
    assert.equal(engine.getState().lastSyncedOperationSeq, 2);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('ProjectSyncEngine catch-up applies a version-tree change without changing the active checkout', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    refreshVersionTreeFromServer: () => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.bootstrapResponse = makeBootstrap([root], root.id);
  harness.state = {
    ...engine.getState(),
    projectState: {
      ...initial,
      activeVersionId: root.id,
      isFollowingHead: false,
    },
    lastSyncedOperationSeq: 1,
  };

  const branch = makeVersion('version-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    isCurrent: true,
    operationSeq: 2,
  });
  const operation = makeOperation('VERSION_BRANCH_CREATED', 2, {
    versionId: branch.id,
    parentVersionId: root.id,
    branchName: branch.branchName,
    label: branch.label,
    createdAt: branch.createdAt,
    createdBy: 'user-b',
    operationSummary: 'Added audio track',
    version: branch,
    sourceVersionId: root.id,
  });

  const originalFetch = globalThis.fetch;
  const capturedUrls: string[] = [];
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);
    if (url.includes('/operations')) {
      return jsonResponse({
        operations: [operation],
        latestSnapshotSeq: 2,
        rebootstrapRequired: false,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    await harness.refreshVersionTreeFromServer();

    assert.deepEqual(capturedUrls, [
      '/api/daw/projects/project-1/operations?demoId=demo-1&afterSeq=1',
    ]);
    const projectState = engine.getState().projectState;
    assert.ok(projectState);
    assert.equal(projectState?.versions.length, 2);
    assert.equal(projectState?.currentVersionId, branch.id);
    assert.equal(projectState?.activeVersionId, root.id);
    assert.equal(projectState?.isFollowingHead, false);
    assert.equal(projectState?.lastSeenOperationSeq, 2);
    assert.equal(engine.getState().lastSyncedOperationSeq, 2);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('ProjectSyncEngine catch-up replays remote version_created, branch_created, and reverted operations without moving a pinned checkout', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    refreshVersionTreeFromServer: () => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.bootstrapResponse = makeBootstrap([root], root.id);
  harness.state = {
    ...engine.getState(),
    projectState: {
      ...initial,
      activeVersionId: root.id,
      isFollowingHead: false,
    },
    lastSyncedOperationSeq: 1,
  };

  const created = makeVersion('version-created', {
    label: 'Auto save',
    name: 'Auto save',
    branchName: 'Auto save',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });
  const branch = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: created.id,
    parentVersionId: created.id,
    createdAt: '2025-01-02T12:00:00.000Z',
    isCurrent: true,
    operationSeq: 3,
  });
  const reverted = makeVersion('version-reverted', {
    label: 'Revert to root',
    name: 'Revert to root',
    branchName: 'Revert to root',
    parentId: branch.id,
    parentVersionId: branch.id,
    createdAt: '2025-01-03T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 4,
  });

  const operations = [
    makeOperation('VERSION_CREATED', 2, {
      versionId: created.id,
      parentVersionId: root.id,
      createdAt: created.createdAt,
      createdBy: 'user-b',
      operationSummary: 'Auto save',
      version: created,
      currentVersionId: created.id,
    }),
    makeOperation('VERSION_BRANCH_CREATED', 3, {
      versionId: branch.id,
      parentVersionId: created.id,
      branchMode: 'fork',
      branchName: branch.branchName,
      label: branch.label,
      createdAt: branch.createdAt,
      createdBy: 'user-b',
      operationSummary: 'Branch label',
      version: branch,
      sourceVersionId: created.id,
    }),
    makeOperation('VERSION_REVERTED_FROM', 4, {
      versionId: reverted.id,
      parentVersionId: branch.id,
      revertedFromVersionId: root.id,
      createdAt: reverted.createdAt,
      createdBy: 'user-b',
      operationSummary: 'Revert to root',
      version: reverted,
      currentVersionId: reverted.id,
    }),
  ];

  const originalFetch = globalThis.fetch;
  const capturedUrls: string[] = [];
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);
    if (url.includes('/operations')) {
      return jsonResponse({
        operations,
        latestSnapshotSeq: 3,
        rebootstrapRequired: false,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    await harness.refreshVersionTreeFromServer();

    assert.deepEqual(capturedUrls, [
      '/api/daw/projects/project-1/operations?demoId=demo-1&afterSeq=1',
    ]);
    const projectState = engine.getState().projectState;
    assert.ok(projectState);
    assert.equal(projectState?.versions.length, 4);
    assert.equal(projectState?.currentVersionId, reverted.id);
    assert.equal(projectState?.activeVersionId, root.id);
    assert.equal(projectState?.isFollowingHead, false);
    assert.equal(projectState?.lastSeenOperationSeq, 4);
    assert.equal(engine.getState().lastSyncedOperationSeq, 4);
    assert.ok(projectState?.versions.some((version) => version.id === created.id));
    assert.ok(projectState?.versions.some((version) => version.id === branch.id));
    assert.ok(projectState?.versions.some((version) => version.id === reverted.id));
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('ProjectSyncEngine rebootstrapRequired replays remote version_created, branch_created, and reverted operations while preserving a pinned checkout', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    bootstrapResponse: DawProjectBootstrapResponse | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    refreshVersionTreeFromServer: () => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.bootstrapResponse = makeBootstrap([root], root.id);
  harness.state = {
    ...engine.getState(),
    projectState: {
      ...initial,
      activeVersionId: root.id,
      isFollowingHead: false,
    },
    lastSyncedOperationSeq: 1,
  };

  const created = makeVersion('version-created', {
    label: 'Auto save',
    name: 'Auto save',
    branchName: 'Auto save',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });
  const branch = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: created.id,
    parentVersionId: created.id,
    createdAt: '2025-01-02T12:00:00.000Z',
    isCurrent: true,
    operationSeq: 3,
  });
  const reverted = makeVersion('version-reverted', {
    label: 'Revert to root',
    name: 'Revert to root',
    branchName: 'Revert to root',
    parentId: branch.id,
    parentVersionId: branch.id,
    createdAt: '2025-01-03T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 4,
  });
  const bootstrapResponse: DawProjectBootstrapResponse = {
    ...makeBootstrap([root], root.id),
    activeVersionId: null,
    isFollowingHead: false,
    latestSnapshot: {
      ...makeBootstrap([root], root.id).latestSnapshot!,
      id: 'snapshot-2',
      operationSeq: 1,
      snapshot: {
        ...makeBootstrap([root], root.id).latestSnapshot!.snapshot,
      },
      createdById: 'user-a',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    operationTail: [
      makeOperation('VERSION_CREATED', 2, {
        versionId: created.id,
        parentVersionId: root.id,
        createdAt: created.createdAt,
        createdBy: 'user-b',
        operationSummary: 'Auto save',
        version: created,
        currentVersionId: created.id,
      }),
      makeOperation('VERSION_BRANCH_CREATED', 3, {
        versionId: branch.id,
        parentVersionId: created.id,
        branchMode: 'fork',
        branchName: branch.branchName,
        label: branch.label,
        createdAt: branch.createdAt,
        createdBy: 'user-b',
        operationSummary: 'Branch label',
        version: branch,
        sourceVersionId: created.id,
      }),
      makeOperation('VERSION_REVERTED_FROM', 4, {
        versionId: reverted.id,
        parentVersionId: branch.id,
        revertedFromVersionId: root.id,
        createdAt: reverted.createdAt,
        createdBy: 'user-b',
        operationSummary: 'Revert to root',
        version: reverted,
        currentVersionId: reverted.id,
      }),
    ],
  };

  const originalFetch = globalThis.fetch;
  const capturedUrls: string[] = [];
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);
    if (url.includes('/operations')) {
      return jsonResponse({
        operations: [],
        latestSnapshotSeq: 3,
        rebootstrapRequired: true,
      });
    }
    if (url.includes('/bootstrap')) {
      return jsonResponse(bootstrapResponse);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    await harness.refreshVersionTreeFromServer();

    assert.deepEqual(capturedUrls, [
      '/api/daw/projects/project-1/operations?demoId=demo-1&afterSeq=1',
      '/api/daw/projects/project-1/bootstrap?demoId=demo-1',
    ]);
    const projectState = engine.getState().projectState;
    assert.ok(projectState);
    assert.equal(projectState?.versions.length, 4);
    assert.equal(projectState?.currentVersionId, reverted.id);
    assert.equal(projectState?.activeVersionId, root.id);
    assert.equal(projectState?.isFollowingHead, false);
    assert.equal(projectState?.lastSeenOperationSeq, 4);
    assert.equal(engine.getState().lastSyncedOperationSeq, 4);
    assert.ok(projectState?.versions.some((version) => version.id === created.id));
    assert.ok(projectState?.versions.some((version) => version.id === branch.id));
    assert.ok(projectState?.versions.some((version) => version.id === reverted.id));
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('ProjectSyncEngine reboots when a realtime version_tree_changed event arrives', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    handleRealtimeVersionTreeChanged: (event: MessageEvent<string>) => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.state = {
    ...engine.getState(),
    projectState: {
      ...initial,
      activeVersionId: root.id,
      isFollowingHead: true,
    },
    lastSyncedOperationSeq: 1,
  };

  const branch = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });
  const bootstrapResponse = makeBootstrap([root, branch], branch.id);
  bootstrapResponse.activeVersionId = branch.id;
  bootstrapResponse.isFollowingHead = true;
  bootstrapResponse.activeBranchName = branch.label;
  bootstrapResponse.project.currentVersionId = branch.id;
  bootstrapResponse.latestSnapshot = {
    id: 'snapshot-2',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 2,
    snapshot: {
      versions: [root, branch],
      currentVersionId: branch.id,
      comments: [],
      annotations: [],
      tempoMetadataByTrackVersionId: {},
    },
    createdById: 'user-b',
    createdAt: '2025-01-02T00:00:00.000Z',
  };

  const originalFetch = globalThis.fetch;
  const stubbedCache = dawLocalCache as unknown as {
    putProject: (...args: unknown[]) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
    putAsset: (...args: unknown[]) => Promise<void>;
  };
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  const originalPutAsset = stubbedCache.putAsset;
  const capturedUrls: string[] = [];

  stubbedCache.putProject = async () => {};
  stubbedCache.putPluginDefinitions = async () => {};
  stubbedCache.putAsset = async () => {};
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);
    if (url.includes('/bootstrap')) {
      return jsonResponse(bootstrapResponse);
    }
    if (url.includes('/active-version') && init?.method === 'POST') {
      return jsonResponse({
        activeVersionId: branch.id,
        isFollowingHead: true,
        activeBranchName: branch.label,
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    await harness.handleRealtimeVersionTreeChanged({
      data: JSON.stringify({
        type: 'version_tree_changed',
        projectId: 'project-1',
        demoId: 'demo-1',
        createdAt: '2025-01-02T00:00:00.000Z',
        actorUserId: 'user-b',
      }),
    } as MessageEvent<string>);

    assert.deepEqual(capturedUrls, [
      '/api/daw/projects/project-1/bootstrap?demoId=demo-1',
    ]);
    const projectState = engine.getState().projectState;
    assert.ok(projectState);
    assert.equal(projectState?.versions.length, 2);
    assert.equal(projectState?.currentVersionId, branch.id);
    assert.equal(projectState?.activeVersionId, root.id);
    assert.equal(projectState?.isFollowingHead, true);
    assert.equal(engine.getState().lastSyncedOperationSeq, 2);
    assert.equal(engine.getState().versionTreeAttention?.versionId, branch.id);
    assert.equal(engine.getState().versionTreeAttention?.createdAt, '2025-01-02T00:00:00.000Z');
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    stubbedCache.putAsset = originalPutAsset;
  }
});

test('ProjectSyncEngine catches up on open and reconnects when realtime goes silent', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const sourceSegment: TrackTimelineSegment = {
    id: 'segment-source',
    trackVersionId: 'track-version-a',
    sourceStartMs: 0,
    sourceEndMs: 1000,
    timelineStartMs: 0,
    timelineEndMs: 1000,
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    isMuted: false,
    position: 0,
    isImplicit: false,
  };
  const initial = createLocalProjectStateFromBootstrap(
    makeBootstrap(
      [
        makeVersion('version-root', {
          isCurrent: true,
          tracks: [
            makeTrack('track-version-a', {
              trackId: 'track-a',
              trackName: 'Track A',
              segments: [sourceSegment],
            }),
          ],
        }),
      ],
      root.id,
    ),
  );
  const splitOperation = makeOperation('SEGMENT_SPLIT', 2, {
    trackVersionId: 'track-version-a',
    sourceSegmentId: 'segment-source',
    leftSegment: {
      id: 'segment-left',
      trackVersionId: 'track-version-a',
      startMs: 0,
      endMs: 500,
      timelineStartMs: 0,
      timelineEndMs: 500,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 0,
    },
    rightSegment: {
      id: 'segment-right',
      trackVersionId: 'track-version-a',
      startMs: 500,
      endMs: 1000,
      timelineStartMs: 500,
      timelineEndMs: 1000,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      isMuted: false,
      position: 1,
    },
  });
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    openRealtimeConnection: () => void;
  };
  const stubbedCache = dawLocalCache as unknown as {
    getProject: (projectId: string, demoId: string) => Promise<null>;
    listAcceptedOperations: (projectId: string, demoId: string, afterSeq: number) => Promise<DawProjectOperationRecord[]>;
    listPendingOperations: (
      projectId: string,
      demoId: string,
    ) => Promise<
      Array<{
        key: string;
        projectId: string;
        demoId: string;
        request: DawOperationCommitRequest;
        status: 'pending' | 'retrying' | 'failed';
        attemptCount: number;
        error: string | null;
        createdAt: number;
        updatedAt: number;
      }>
    >;
    findOperationByIdempotencyKey: (projectId: string, demoId: string, idempotencyKey: string) => Promise<DawProjectOperationRecord | null>;
    putPendingOperation: (...args: unknown[]) => Promise<void>;
    updatePendingOperation: (...args: unknown[]) => Promise<void>;
    putAcceptedOperation: (projectId: string, demoId: string, operation: DawProjectOperationRecord) => Promise<void>;
    deletePendingOperation: (projectId: string, demoId: string, idempotencyKey: string) => Promise<void>;
    putProject: (...args: unknown[]) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
    putAsset: (...args: unknown[]) => Promise<void>;
  };

  const originalGetProject = stubbedCache.getProject;
  const originalListAcceptedOperations = stubbedCache.listAcceptedOperations;
  const originalListPendingOperations = stubbedCache.listPendingOperations;
  const originalFindOperationByIdempotencyKey = stubbedCache.findOperationByIdempotencyKey;
  const originalPutPendingOperation = stubbedCache.putPendingOperation;
  const originalUpdatePendingOperation = stubbedCache.updatePendingOperation;
  const originalPutAcceptedOperation = stubbedCache.putAcceptedOperation;
  const originalDeletePendingOperation = stubbedCache.deletePendingOperation;
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  const originalPutAsset = stubbedCache.putAsset;
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const capturedUrls: string[] = [];
  const eventSources: Array<{
    listeners: Map<string, Array<(event: MessageEvent<string>) => void>>;
    emit: (type: string, data?: string) => void;
  }> = [];
  const scheduledTimers = new Map<number, () => void>();
  let nextTimerId = 1;
  let operationsFetchCount = 0;

  stubbedCache.getProject = async () => null;
  stubbedCache.listAcceptedOperations = async () => [];
  stubbedCache.listPendingOperations = async () => [];
  stubbedCache.findOperationByIdempotencyKey = async () => null;
  stubbedCache.putPendingOperation = async () => {};
  stubbedCache.updatePendingOperation = async () => {};
  stubbedCache.putAcceptedOperation = async () => {};
  stubbedCache.deletePendingOperation = async () => {};
  stubbedCache.putProject = async () => {};
  stubbedCache.putPluginDefinitions = async () => {};
  stubbedCache.putAsset = async () => {};
  (globalThis as typeof globalThis & { setTimeout: typeof setTimeout }).setTimeout = ((callback: TimerHandler) => {
    const timerId = nextTimerId++;
    scheduledTimers.set(timerId, () => {
      if (typeof callback === 'function') {
        return callback();
      }
      return undefined;
    });
    return timerId as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  (globalThis as typeof globalThis & { clearTimeout: typeof clearTimeout }).clearTimeout = ((timerId: number) => {
    scheduledTimers.delete(timerId);
  }) as typeof clearTimeout;
  (globalThis as typeof globalThis & { EventSource: typeof EventSource }).EventSource = class {
    listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

    constructor() {
      eventSources.push(this);
    }

    close() {}

    addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type: string, data = '') {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ data } as MessageEvent<string>);
      }
    }
  } as unknown as typeof EventSource;
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);
    if (url.includes('/operations') && url.includes('afterSeq=1')) {
      operationsFetchCount += 1;
      if (operationsFetchCount === 1) {
        return jsonResponse({
          operations: [],
          latestSnapshotSeq: 1,
          rebootstrapRequired: false,
        });
      }

      return jsonResponse({
        operations: [splitOperation],
        latestSnapshotSeq: 2,
        rebootstrapRequired: false,
      });
    }

    if (url.includes('/operations') && url.includes('afterSeq=2')) {
      return jsonResponse({
        operations: [],
        latestSnapshotSeq: 2,
        rebootstrapRequired: false,
      });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    harness.projectId = 'project-1';
    harness.demoId = 'demo-1';
    harness.state = {
      ...engine.getState(),
      projectState: {
        ...initial,
        activeVersionId: root.id,
        isFollowingHead: true,
      },
      lastSyncedOperationSeq: 1,
    };

    harness.openRealtimeConnection();
    assert.equal(eventSources.length, 1);

    eventSources[0]?.emit('open');
    await Promise.resolve();

    const projectStateAfterOpen = engine.getState().projectState;
    assert.ok(projectStateAfterOpen);
    assert.equal(projectStateAfterOpen?.versions.length, 1);
    assert.equal(projectStateAfterOpen?.versions[0]?.tracks[0]?.segments.length, 1);
    assert.deepEqual(projectStateAfterOpen?.versions[0]?.tracks[0]?.plugins, [makePlugin('plugin-track-version-a')]);
    assert.equal(projectStateAfterOpen?.lastSeenOperationSeq, 1);
    assert.deepEqual(capturedUrls, [
      '/api/daw/projects/project-1/operations?demoId=demo-1&afterSeq=1',
    ]);
    const timerCallbacks = Array.from(scheduledTimers.values());
    assert.equal(timerCallbacks.length, 2);

    await timerCallbacks[1]();
    await Promise.resolve();

    const projectStateAfterPoll = engine.getState().projectState;
    assert.ok(projectStateAfterPoll);
    assert.equal(capturedUrls.at(-1), '/api/daw/projects/project-1/operations?demoId=demo-1&afterSeq=1');
    assert.equal(projectStateAfterPoll?.versions[0]?.tracks[0]?.segments.length, 2);
    assert.equal(projectStateAfterPoll?.lastSeenOperationSeq, 2);
    assert.equal(eventSources.length, 1);

    await timerCallbacks[0]();
    await Promise.resolve();

    assert.equal(eventSources.length, 2);
  } finally {
    stubbedCache.getProject = originalGetProject;
    stubbedCache.listAcceptedOperations = originalListAcceptedOperations;
    stubbedCache.listPendingOperations = originalListPendingOperations;
    stubbedCache.findOperationByIdempotencyKey = originalFindOperationByIdempotencyKey;
    stubbedCache.putPendingOperation = originalPutPendingOperation;
    stubbedCache.updatePendingOperation = originalUpdatePendingOperation;
    stubbedCache.putAcceptedOperation = originalPutAcceptedOperation;
    stubbedCache.deletePendingOperation = originalDeletePendingOperation;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    stubbedCache.putAsset = originalPutAsset;
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    (globalThis as typeof globalThis & { EventSource?: typeof EventSource }).EventSource = originalEventSource;
    (globalThis as typeof globalThis & { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
    (globalThis as typeof globalThis & { clearTimeout: typeof clearTimeout }).clearTimeout = originalClearTimeout;
  }
});

test('ProjectSyncEngine reboots when a realtime version_created event arrives without moving the active checkout', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    handleRealtimeVersionTreeChanged: (event: MessageEvent<string>) => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.state = {
    ...engine.getState(),
    projectState: {
      ...initial,
      activeVersionId: root.id,
      isFollowingHead: true,
    },
    lastSyncedOperationSeq: 1,
  };

  const branch = makeVersion('version-auto', {
    label: 'Auto save',
    name: 'Auto save',
    branchName: 'Auto save',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });
  const bootstrapResponse = makeBootstrap([root, branch], root.id);
  bootstrapResponse.activeVersionId = root.id;
  bootstrapResponse.isFollowingHead = true;
  bootstrapResponse.activeBranchName = branch.label;
  bootstrapResponse.project.currentVersionId = branch.id;
  bootstrapResponse.latestSnapshot = {
    id: 'snapshot-2',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 2,
    snapshot: {
      versions: [root, branch],
      currentVersionId: branch.id,
      comments: [],
      annotations: [],
      tempoMetadataByTrackVersionId: {},
    },
    createdById: 'user-b',
    createdAt: '2025-01-02T00:00:00.000Z',
  };

  const originalFetch = globalThis.fetch;
  const stubbedCache = dawLocalCache as unknown as {
    putProject: (...args: unknown[]) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
    putAsset: (...args: unknown[]) => Promise<void>;
  };
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  const originalPutAsset = stubbedCache.putAsset;
  const capturedUrls: string[] = [];

  stubbedCache.putProject = async () => {};
  stubbedCache.putPluginDefinitions = async () => {};
  stubbedCache.putAsset = async () => {};
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);
    if (url.includes('/bootstrap')) {
      return jsonResponse(bootstrapResponse);
    }
    if (url.includes('/active-version') && init?.method === 'POST') {
      return jsonResponse({
        activeVersionId: branch.id,
        isFollowingHead: true,
        activeBranchName: branch.label,
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    await harness.handleRealtimeVersionTreeChanged({
      data: JSON.stringify({
        type: 'version_created',
        projectId: 'project-1',
        demoId: 'demo-1',
        createdAt: '2025-01-02T00:00:00.000Z',
        actorUserId: 'user-b',
        versionId: branch.id,
        parentVersionId: root.id,
        kind: 'AUTO',
        operationSeq: 2,
      }),
    } as MessageEvent<string>);

    assert.deepEqual(capturedUrls, [
      '/api/daw/projects/project-1/bootstrap?demoId=demo-1',
    ]);
    const projectState = engine.getState().projectState;
    assert.ok(projectState);
    assert.equal(projectState?.versions.length, 2);
    assert.equal(projectState?.currentVersionId, branch.id);
    assert.equal(projectState?.activeVersionId, root.id);
    assert.equal(projectState?.isFollowingHead, true);
    assert.equal(engine.getState().lastSyncedOperationSeq, 2);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    stubbedCache.putAsset = originalPutAsset;
  }
});

test('ProjectSyncEngine reboots when a realtime branch_created event arrives without moving the active checkout', async () => {
  const root = makeVersion('version-root', { isCurrent: true });
  const initial = createLocalProjectStateFromBootstrap(makeBootstrap([root], root.id));
  const engine = new ProjectSyncEngine();
  const harness = engine as unknown as {
    projectId: string | null;
    demoId: string | null;
    state: ReturnType<ProjectSyncEngine['getState']>;
    handleRealtimeVersionTreeChanged: (event: MessageEvent<string>) => Promise<void>;
  };
  harness.projectId = 'project-1';
  harness.demoId = 'demo-1';
  harness.state = {
    ...engine.getState(),
    projectState: {
      ...initial,
      activeVersionId: root.id,
      isFollowingHead: true,
    },
    lastSyncedOperationSeq: 1,
  };

  const branch = makeVersion('version-branch', {
    label: 'Branch label',
    name: 'Branch label',
    branchName: 'Branch label',
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    isCurrent: true,
    operationSeq: 2,
  });
  const bootstrapResponse = makeBootstrap([root, branch], root.id);
  bootstrapResponse.activeVersionId = root.id;
  bootstrapResponse.isFollowingHead = true;
  bootstrapResponse.activeBranchName = branch.label;
  bootstrapResponse.project.currentVersionId = branch.id;
  bootstrapResponse.latestSnapshot = {
    id: 'snapshot-2',
    projectId: 'project-1',
    demoId: 'demo-1',
    operationSeq: 2,
    snapshot: {
      versions: [root, branch],
      currentVersionId: branch.id,
      comments: [],
      annotations: [],
      tempoMetadataByTrackVersionId: {},
    },
    createdById: 'user-b',
    createdAt: '2025-01-02T00:00:00.000Z',
  };

  const originalFetch = globalThis.fetch;
  const stubbedCache = dawLocalCache as unknown as {
    putProject: (...args: unknown[]) => Promise<void>;
    putPluginDefinitions: (...args: unknown[]) => Promise<void>;
    putAsset: (...args: unknown[]) => Promise<void>;
  };
  const originalPutProject = stubbedCache.putProject;
  const originalPutPluginDefinitions = stubbedCache.putPluginDefinitions;
  const originalPutAsset = stubbedCache.putAsset;
  const capturedUrls: string[] = [];

  stubbedCache.putProject = async () => {};
  stubbedCache.putPluginDefinitions = async () => {};
  stubbedCache.putAsset = async () => {};
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    capturedUrls.push(url);
    if (url.includes('/bootstrap')) {
      return jsonResponse(bootstrapResponse);
    }
    if (url.includes('/active-version') && init?.method === 'POST') {
      return jsonResponse({
        activeVersionId: branch.id,
        isFollowingHead: true,
        activeBranchName: branch.label,
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    await harness.handleRealtimeVersionTreeChanged({
      data: JSON.stringify({
        type: 'branch_created',
        projectId: 'project-1',
        demoId: 'demo-1',
        createdAt: '2025-01-02T00:00:00.000Z',
        actorUserId: 'user-b',
        versionId: branch.id,
        parentVersionId: root.id,
        branchMode: 'continue',
        operationSeq: 2,
      }),
    } as MessageEvent<string>);

    assert.deepEqual(capturedUrls, [
      '/api/daw/projects/project-1/bootstrap?demoId=demo-1',
    ]);
    const projectState = engine.getState().projectState;
    assert.ok(projectState);
    assert.equal(projectState?.versions.length, 2);
    assert.equal(projectState?.currentVersionId, branch.id);
    assert.equal(projectState?.activeVersionId, root.id);
    assert.equal(projectState?.isFollowingHead, true);
    assert.equal(engine.getState().lastSyncedOperationSeq, 2);
  } finally {
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
    stubbedCache.putProject = originalPutProject;
    stubbedCache.putPluginDefinitions = originalPutPluginDefinitions;
    stubbedCache.putAsset = originalPutAsset;
  }
});
