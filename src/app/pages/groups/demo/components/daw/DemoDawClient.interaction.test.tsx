import { createElement, forwardRef, useImperativeHandle } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DawTrack, DawVersion, LocalProjectState } from '@/app/lib/daw/state/local-project-state';
import { EMPTY_TRACK_MIME_TYPE } from '@/app/lib/daw/utils/segments';

const mockRouter = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

const mockProjectSync = vi.hoisted(() => {
  const listeners = new Set<(state: unknown) => void>();
  const assetStatusListeners = new Set<(event: { status: string; message?: string }) => void>();
  let state: {
    projectState: LocalProjectState | null;
    queue: Record<string, never>;
    baseSnapshotId: string | null;
    lastSyncedOperationSeq: number;
    isBootstrapping: boolean;
    isOnline: boolean;
    isSyncing: boolean;
    lastError: string | null;
    versionTreeAttention: null;
    lastCommitRequest:
      | {
          operationType: string;
          payload: {
            trackId?: string;
            trackVersionId?: string;
            instanceId?: string;
            paramId?: string;
            value?: number;
            position?: number;
            bypassed?: boolean;
          };
        }
      | null;
    commitRequests: Array<{
      operationType: string;
      payload: {
        trackId?: string;
        trackVersionId?: string;
        instanceId?: string;
        paramId?: string;
        value?: number;
        position?: number;
        bypassed?: boolean;
      };
    }>;
  } = {
    projectState: null,
    queue: {},
    baseSnapshotId: null,
    lastSyncedOperationSeq: 0,
    isBootstrapping: false,
    isOnline: true,
    isSyncing: false,
    lastError: null,
    versionTreeAttention: null,
    lastCommitRequest: null,
    commitRequests: [],
  };

  return {
    listeners,
    assetStatusListeners,
    getState: () => state,
    setState: (nextState: typeof state) => {
      state = nextState;
      for (const listener of listeners) {
        listener(state);
      }
    },
    updateProjectState: (nextProjectState: LocalProjectState) => {
      state = {
        ...state,
        projectState: nextProjectState,
        isOnline: true,
        lastError: null,
      };
      for (const listener of listeners) {
        listener(state);
      }
    },
    reset: () => {
      listeners.clear();
      assetStatusListeners.clear();
      state = {
        projectState: null,
        queue: {},
        baseSnapshotId: null,
        lastSyncedOperationSeq: 0,
        isBootstrapping: false,
        isOnline: true,
        isSyncing: false,
        lastError: null,
        versionTreeAttention: null,
        lastCommitRequest: null,
        commitRequests: [],
      };
    },
    get projectState() {
      return state.projectState;
    },
  };
});

function normalizePlugins(
  plugins: Array<DawTrack['plugins'][number]>,
) {
  return plugins.map((plugin, index) => ({
    ...plugin,
    position: index,
  }));
}

function getCommitOps() {
  return mockProjectSync.getState().commitRequests;
}

const mockIngest = vi.hoisted(() => ({
  recordUploadCount: 0,
  addTrackUploadCount: 0,
  objectUrlCount: 0,
  revokeObjectUrl: vi.fn(),
  lastUploadAudioFileSourceVersionId: null as string | null,
  lastUploadRecordedBlobSourceVersionId: null as string | null,
}));

const mockPlaybackEngine = vi.hoisted(() => ({
  lastConstructorOptions: null as { pluginGraphFactory?: unknown } | null,
  setProjectCount: 0,
  lastSetProject: null as unknown,
}));

const mockVersionHistoryTree = vi.hoisted(() => ({
  lastProps: null as null | Record<string, unknown>,
}));

const mockPendingActiveVersionUpdates = vi.hoisted(() => ({
  pending: [] as Array<{
    activeVersionId: string;
    options: { isFollowingHead?: boolean };
    resolve: () => void;
  }>,
  flush: async () => {
    const pending = [...mockPendingActiveVersionUpdates.pending];
    mockPendingActiveVersionUpdates.pending.length = 0;
    for (const entry of pending) {
      entry.resolve();
    }
    await Promise.resolve();
  },
}));

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createDataTransfer() {
  const data = new Map<string, string>();

  return {
    dropEffect: 'move',
    effectAllowed: 'move',
    files: [] as unknown as FileList,
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
    clearData: (type?: string) => {
      if (type) {
        data.delete(type);
      } else {
        data.clear();
      }
    },
  } as unknown as DataTransfer;
}

const mockRecordingSave = vi.hoisted(() => ({
  deferred: null as ReturnType<typeof createDeferred> | null,
}));

function makeTrack(trackName: string, trackVersionId: string, overrides: Partial<DawTrack> = {}): DawTrack {
  return {
    trackId: overrides.trackId ?? trackVersionId.replace('version', 'track'),
    trackName,
    trackPosition: overrides.trackPosition ?? 0,
    trackVersionId,
    storageKey: overrides.storageKey ?? '',
    mimeType: overrides.mimeType ?? EMPTY_TRACK_MIME_TYPE,
    durationMs: overrides.durationMs ?? 0,
    startOffsetMs: overrides.startOffsetMs ?? 0,
    recordedTempoBpm: overrides.recordedTempoBpm ?? 120,
    sourceTempoBpm: overrides.sourceTempoBpm ?? 120,
    isDerived: overrides.isDerived ?? false,
    operationType: overrides.operationType ?? 'ORIGINAL',
    parentTrackVersionId: overrides.parentTrackVersionId ?? null,
    segments: overrides.segments ?? [],
    plugins: overrides.plugins ?? [],
  };
}

function makePlugin(
  instanceId: string,
  overrides: Partial<DawTrack['plugins'][number]> = {},
): DawTrack['plugins'][number] {
  return {
    instanceId,
    pluginKey: overrides.pluginKey ?? `com.example.${instanceId}`,
    version: overrides.version ?? '1.0.0',
    backend: overrides.backend ?? 'wam',
    position: overrides.position ?? 0,
    bypassed: overrides.bypassed ?? false,
    params: overrides.params ?? {},
    state: overrides.state,
    stateBlobKey: overrides.stateBlobKey ?? null,
  };
}

function makeVersion(
  id: string,
  trackNames: string[],
  overrides: Partial<DawVersion> = {},
): DawVersion {
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
    createdAt: overrides.createdAt ?? '2026-07-05T00:00:00.000Z',
    kind: overrides.kind ?? 'EXPLICIT',
    operationSeq: overrides.operationSeq ?? 1,
    isCurrent: overrides.isCurrent ?? false,
    tempoBpm: overrides.tempoBpm ?? 120,
    timeSignatureNum: overrides.timeSignatureNum ?? 4,
    timeSignatureDen: overrides.timeSignatureDen ?? 4,
    musicalKey: overrides.musicalKey ?? null,
    tempoSource: overrides.tempoSource ?? 'MANUAL',
    keySource: overrides.keySource ?? 'MANUAL',
    tracks:
      overrides.tracks ??
      trackNames.map((trackName, index) =>
        makeTrack(trackName, `${id}-track-${index + 1}`, {
          trackId: `${id}-track-${index + 1}`,
          trackPosition: index,
          trackVersionId: `${id}-track-${index + 1}`,
        }),
      ),
  };
}

function makeProjectState(versions: DawVersion[]): LocalProjectState {
  const currentVersion = versions.find((version) => version.isCurrent) ?? versions[0];
  if (!currentVersion) {
    throw new Error('Expected at least one version');
  }

  return {
    versions,
    currentVersionId: currentVersion.id,
    activeVersionId: currentVersion.id,
    isFollowingHead: true,
    versionTreeUpdatedAt: null,
    lastVersionOperationSeq: 0,
    lastSeenOperationSeq: 0,
    comments: [],
    annotations: [],
    tempoMetadataByTrackVersionId: {},
    operationHistory: [],
  };
}

function cloneVersionWithTracks(version: DawVersion, nextId: string, nextTrackNames: string[]): DawVersion {
  return makeVersion(nextId, nextTrackNames, {
    parentId: version.id,
    parentVersionId: version.id,
    operationSeq: (version.operationSeq ?? 0) + 1,
    isCurrent: true,
    createdAt: new Date(Date.parse(version.createdAt) + 1000).toISOString(),
  });
}

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('./RecordingControls', () => {
  const RecordingControls = forwardRef(function RecordingControlsMock(
    {
      microphoneSelector,
      recordingTarget,
      recordedTempoBpm,
      onStreamReady,
      onStopped,
    }: {
      microphoneSelector?: React.ReactNode;
      recordingTarget: {
        trackId: string;
        trackVersionId: string;
        trackName: string;
      } | null;
      recordedTempoBpm: number;
      onStreamReady: (
        stream: MediaStream,
        startOffsetMs: number,
        target: {
          trackId: string;
          trackVersionId: string;
          trackName: string;
        },
        recordedTempoBpm: number,
      ) => void;
      onStopped: (blob: Blob, durationMs: number) => void;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      startRecording: async () => {},
      stopRecording: () => {},
    }));

    const fakeStream = {
      getTracks: () => [],
    } as unknown as MediaStream;

    return createElement(
      'div',
      { 'data-testid': 'recording-controls' },
      microphoneSelector,
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            if (!recordingTarget) return;
            onStreamReady(fakeStream, 0, recordingTarget, recordedTempoBpm);
          },
        },
        'Start mock recording',
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onStopped(new Blob(['mock recording'], { type: 'audio/webm' }), 1000);
          },
        },
        'Stop mock recording',
      ),
    );
  });

  return { RecordingControls };
});

vi.mock('./RecordingTrackLane', () => ({
  RecordingTrackLane: ({ recording }: { recording: { name: string } }) =>
    createElement('div', { 'data-testid': 'recording-track-lane' }, recording.name),
}));

vi.mock('./TransportControls', () => ({
  TransportControls: ({ leadingSlot, trailingSlot }: { leadingSlot?: React.ReactNode; trailingSlot?: React.ReactNode }) =>
    createElement('div', { 'data-testid': 'transport-controls' }, leadingSlot, trailingSlot),
}));

vi.mock('./ProjectTimingControls', () => ({
  ProjectTimingControls: () => createElement('div', { 'data-testid': 'project-timing-controls' }),
}));

vi.mock('./DawToolbarTabs', () => ({
  DawToolbarTabs: () => createElement('div', { 'data-testid': 'toolbar-tabs' }),
}));

vi.mock('./AudioInputSelector', () => ({
  AudioInputSelector: ({
    selectedAudioInputDeviceId,
    onSelectedAudioInputDeviceIdChange,
    onAudioInputReadyChange,
  }: {
    selectedAudioInputDeviceId: string | null;
    onSelectedAudioInputDeviceIdChange: (deviceId: string | null) => void;
    onAudioInputReadyChange: (isReady: boolean) => void;
  }) =>
    createElement(
      'div',
      { 'data-testid': 'audio-input-selector' },
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onSelectedAudioInputDeviceIdChange(selectedAudioInputDeviceId ?? 'mock-device');
            onAudioInputReadyChange(true);
          },
        },
        'Enable mock mic',
      ),
    ),
}));

vi.mock('./VersionHistoryTree', () => ({
  VersionHistoryTree: (props: Record<string, unknown>) => {
    mockVersionHistoryTree.lastProps = props;
    return createElement('div', { 'data-testid': 'version-history-tree' });
  },
}));

vi.mock('./TrackSegmentClip', () => ({
  TrackSegmentClip: () => null,
}));

vi.mock('@/app/lib/daw/engine/audio-editing-engine', () => ({
  AudioEditingEngine: class AudioEditingEngineMock {
    constructor() {}
    moveTrack() {}
    moveSegment() {}
    addPlugin({ trackVersionId, plugin }: { trackVersionId: string; plugin: unknown }) {
      return {
        demoId: 'demo-1',
        operationType: 'PLUGIN_ADDED',
        payload: {
          trackVersionId,
          ...(plugin as Record<string, unknown>),
        },
      };
    }
    deleteTrack(trackId: string) {
      return {
        demoId: 'demo-1',
        operationType: 'TRACK_REMOVED',
        payload: { trackId },
      };
    }
    removePlugin({ trackVersionId, instanceId }: { trackVersionId: string; instanceId: string }) {
      return {
        demoId: 'demo-1',
        operationType: 'PLUGIN_REMOVED',
        payload: { trackVersionId, instanceId },
      };
    }
    reorderPlugin({
      trackVersionId,
      instanceId,
      position,
    }: {
      trackVersionId: string;
      instanceId: string;
      position: number;
    }) {
      return {
        demoId: 'demo-1',
        operationType: 'PLUGIN_REORDERED',
        payload: { trackVersionId, instanceId, position },
      };
    }
    setPluginParam({
      trackVersionId,
      instanceId,
      paramId,
      value,
    }: {
      trackVersionId: string;
      instanceId: string;
      paramId: string;
      value: number;
    }) {
      return {
        demoId: 'demo-1',
        operationType: 'PLUGIN_PARAM_SET',
        payload: { trackVersionId, instanceId, paramId, value },
      };
    }
    setPluginBypass({
      trackVersionId,
      instanceId,
      bypassed,
    }: {
      trackVersionId: string;
      instanceId: string;
      bypassed: boolean;
    }) {
      return {
        demoId: 'demo-1',
        operationType: 'PLUGIN_BYPASS_SET',
        payload: { trackVersionId, instanceId, bypassed },
      };
    }
    deleteSegment() {}
    splitSegment() {}
    setSegmentFade() {}
    renameTrack() {}
    mergeSegments() {}
  },
}));

vi.mock('@/app/lib/daw/engine/playback-engine', () => ({
  AudioPlaybackEngine: class AudioPlaybackEngineMock {
    private currentTimeMs = 0;
    constructor(options?: { pluginGraphFactory?: unknown }) {
      mockPlaybackEngine.lastConstructorOptions = options ?? null;
    }
    setProject(project: unknown) {
      mockPlaybackEngine.setProjectCount += 1;
      mockPlaybackEngine.lastSetProject = project;
    }
    preloadTracks() {}
    rebuildTrackPluginChain() {}
    setPluginParam() {}
    setPluginBypass() {}
    play() {
      return Promise.resolve();
    }
    pause() {}
    stop() {}
    seek(timeMs: number) {
      this.currentTimeMs = timeMs;
    }
    getCurrentTimeMs() {
      return this.currentTimeMs;
    }
    setTrackMuted() {}
    setTrackSolo() {}
    setTrackGain() {}
    dispose() {}
  },
}));

vi.mock('@/app/lib/daw/engine/ingest-engine', () => ({
  AudioIngestEngine: class AudioIngestEngineMock {
    createObjectUrl() {
      mockIngest.objectUrlCount += 1;
      return `blob:mock-${mockIngest.objectUrlCount}`;
    }
    revokeObjectUrl = mockIngest.revokeObjectUrl;
    async getRecordedBlobDurationMs() {
      return 1000;
    }
    async generateLocalPeaks() {
      return [];
    }
    async uploadRecordedBlob(input: { sourceVersionId?: string | null } = {}) {
      mockIngest.recordUploadCount += 1;
      const currentState = mockProjectSync.projectState;
      if (!currentState) {
        throw new Error('Project state missing');
      }

      const sourceVersionId = input.sourceVersionId ?? currentState.activeVersionId;
      const sourceVersion = currentState.versions.find((version) => version.id === sourceVersionId) ?? currentState.versions[0];
      if (!sourceVersion) {
        throw new Error('Source version missing');
      }

      mockIngest.lastUploadRecordedBlobSourceVersionId = sourceVersion.id;

      await mockRecordingSave.deferred?.promise;

      const nextVersionId = `recorded-version-${mockIngest.recordUploadCount}`;
      const nextVersion = cloneVersionWithTracks(
        sourceVersion,
        nextVersionId,
        sourceVersion.tracks.map((track) => track.trackName),
      );
      const nextProjectState: LocalProjectState = {
        ...currentState,
        versions: [...currentState.versions, nextVersion],
        currentVersionId: nextVersion.id,
        activeVersionId: currentState.activeVersionId,
        isFollowingHead: true,
      };
      mockProjectSync.updateProjectState(nextProjectState);

      return {
        assetId: `asset-record-${mockIngest.recordUploadCount}`,
        trackVersionId: `${nextVersionId}-track-1`,
        demoVersionId: nextVersion.id,
      };
    }
    async uploadAudioFile(input: { sourceVersionId?: string | null } = {}) {
      mockIngest.addTrackUploadCount += 1;
      const currentState = mockProjectSync.projectState;
      if (!currentState) {
        throw new Error('Project state missing');
      }

      const sourceVersionId =
        input.sourceVersionId ?? currentState.activeVersionId ?? currentState.versions[0]?.id ?? null;
      const sourceVersion = currentState.versions.find((version) => version.id === sourceVersionId) ?? currentState.versions[0];
      if (!sourceVersion) {
        throw new Error('Source version missing');
      }

      mockIngest.lastUploadAudioFileSourceVersionId = sourceVersion.id;
      const nextTrackNames = [...sourceVersion.tracks.map((track) => track.trackName), `Track ${sourceVersion.tracks.length + 1}`];
      const nextVersionId = `uploaded-version-${mockIngest.addTrackUploadCount}`;
      const nextVersion = cloneVersionWithTracks(sourceVersion, nextVersionId, nextTrackNames);
      const nextProjectState: LocalProjectState = {
        ...currentState,
        versions: [...currentState.versions, nextVersion],
        currentVersionId: nextVersion.id,
        activeVersionId: nextVersion.id,
        isFollowingHead: true,
      };
      mockProjectSync.updateProjectState(nextProjectState);

      return {
        assetId: `asset-upload-${mockIngest.addTrackUploadCount}`,
        objectKey: `object-upload-${mockIngest.addTrackUploadCount}`,
        trackVersionId: `${nextVersionId}-track-1`,
        demoVersionId: nextVersion.id,
      };
    }
  },
}));

vi.mock('@/app/lib/daw/engine/project-sync-engine', () => ({
  ProjectSyncEngine: class ProjectSyncEngineMock {
    subscribe(listener: (state: unknown) => void) {
      mockProjectSync.listeners.add(listener);
      listener(mockProjectSync.getState());
      return () => {
        mockProjectSync.listeners.delete(listener);
      };
    }
    subscribeAssetStatus(listener: (event: { status: string; message?: string }) => void) {
      mockProjectSync.assetStatusListeners.add(listener);
      return () => {
        mockProjectSync.assetStatusListeners.delete(listener);
      };
    }
    subscribePresence() {
      return () => {};
    }
    getState() {
      return mockProjectSync.getState();
    }
    async bootstrap(input: { initialProjectState: LocalProjectState }) {
      mockProjectSync.setState({
        ...mockProjectSync.getState(),
        projectState: input.initialProjectState,
      });
    }
    async setActiveVersion(activeVersionId: string, options: { isFollowingHead?: boolean } = {}) {
      return new Promise((resolve) => {
        mockPendingActiveVersionUpdates.pending.push({
          activeVersionId,
          options,
          resolve: () => {
            const currentState = mockProjectSync.getState();
            const projectState = currentState.projectState;
            if (projectState) {
              const nextProjectState: LocalProjectState = {
                ...projectState,
                activeVersionId,
                isFollowingHead: options.isFollowingHead ?? true,
              };
              mockProjectSync.updateProjectState(nextProjectState);
            }
            resolve({
              activeVersionId,
              isFollowingHead: options.isFollowingHead ?? true,
            });
          },
        });
      });
    }
    async setTrackTempoMetadata() {}
    async commitOperation(request: {
      operationType: string;
      payload: {
        trackId?: string;
        trackVersionId?: string;
        instanceId?: string;
        pluginKey?: string;
        version?: string;
        backend?: 'wam' | 'remote';
        position?: number;
        bypassed?: boolean;
        paramId?: string;
        value?: number;
        params?: Record<string, number>;
        stateBlobKey?: string | null;
      };
    }) {
      const currentState = mockProjectSync.getState();
      const projectState = currentState.projectState;
      if (!projectState) {
        throw new Error('Project state missing');
      }

      mockProjectSync.setState({
        ...currentState,
        lastCommitRequest: request,
        commitRequests: [...currentState.commitRequests, request],
      });

      if (request.operationType === 'TRACK_REMOVED' && request.payload.trackId) {
        const nextProjectState: LocalProjectState = {
          ...projectState,
          versions: projectState.versions.map((version) => ({
            ...version,
            tracks: version.tracks.filter((track) => track.trackId !== request.payload.trackId),
          })),
        };
        mockProjectSync.updateProjectState(nextProjectState);
      } else if (request.operationType === 'PLUGIN_ADDED' && request.payload.trackVersionId) {
        const payload = request.payload as {
          trackVersionId: string;
          instanceId: string;
          pluginKey: string;
          version: string;
          backend: 'wam' | 'remote';
          position: number;
          bypassed: boolean;
          params: Record<string, number>;
          stateBlobKey?: string | null;
        };
        const nextProjectState: LocalProjectState = {
          ...projectState,
          versions: projectState.versions.map((version) => ({
            ...version,
            tracks: version.tracks.map((track) =>
              track.trackVersionId === payload.trackVersionId
                ? {
                    ...track,
                    plugins: normalizePlugins([
                      ...track.plugins.filter((plugin) => plugin.instanceId !== payload.instanceId),
                      payload,
                    ]),
                  }
                : track,
            ),
          })),
        };
        mockProjectSync.updateProjectState(nextProjectState);
      } else if (request.operationType === 'PLUGIN_REORDERED' && request.payload.trackVersionId) {
        const payload = request.payload as {
          trackVersionId: string;
          instanceId: string;
          position: number;
        };
        const nextProjectState: LocalProjectState = {
          ...projectState,
          versions: projectState.versions.map((version) => ({
            ...version,
            tracks: version.tracks.map((track) => {
              if (track.trackVersionId !== payload.trackVersionId) return track;
              const sourceIndex = track.plugins.findIndex((plugin) => plugin.instanceId === payload.instanceId);
              if (sourceIndex === -1) return track;
              const nextPlugins = track.plugins.filter((plugin) => plugin.instanceId !== payload.instanceId);
              const sourcePlugin = track.plugins[sourceIndex];
              nextPlugins.splice(Math.max(0, Math.min(payload.position, nextPlugins.length)), 0, sourcePlugin);
              return {
                ...track,
                plugins: normalizePlugins(nextPlugins),
              };
            }),
          })),
        };
        mockProjectSync.updateProjectState(nextProjectState);
      } else if (request.operationType === 'PLUGIN_REMOVED' && request.payload.trackVersionId) {
        const payload = request.payload as {
          trackVersionId: string;
          instanceId: string;
        };
        const nextProjectState: LocalProjectState = {
          ...projectState,
          versions: projectState.versions.map((version) => ({
            ...version,
            tracks: version.tracks.map((track) =>
              track.trackVersionId === payload.trackVersionId
                ? {
                    ...track,
                    plugins: normalizePlugins(
                      track.plugins.filter((plugin) => plugin.instanceId !== payload.instanceId),
                    ),
                  }
                : track,
            ),
          })),
        };
        mockProjectSync.updateProjectState(nextProjectState);
      } else if (request.operationType === 'PLUGIN_BYPASS_SET' && request.payload.trackVersionId) {
        const payload = request.payload as {
          trackVersionId: string;
          instanceId: string;
          bypassed: boolean;
        };
        const nextProjectState: LocalProjectState = {
          ...projectState,
          versions: projectState.versions.map((version) => ({
            ...version,
            tracks: version.tracks.map((track) =>
              track.trackVersionId === payload.trackVersionId
                ? {
                    ...track,
                    plugins: track.plugins.map((plugin) =>
                      plugin.instanceId === payload.instanceId
                        ? { ...plugin, bypassed: payload.bypassed }
                        : plugin,
                    ),
                  }
                : track,
            ),
          })),
        };
        mockProjectSync.updateProjectState(nextProjectState);
      } else if (request.operationType === 'PLUGIN_PARAM_SET' && request.payload.trackVersionId) {
        const payload = request.payload as {
          trackVersionId: string;
          instanceId: string;
          paramId: string;
          value: number;
        };
        const nextProjectState: LocalProjectState = {
          ...projectState,
          versions: projectState.versions.map((version) => ({
            ...version,
            tracks: version.tracks.map((track) =>
              track.trackVersionId === payload.trackVersionId
                ? {
                    ...track,
                    plugins: track.plugins.map((plugin) =>
                      plugin.instanceId === payload.instanceId
                        ? {
                            ...plugin,
                            params: {
                              ...plugin.params,
                              [payload.paramId]: payload.value,
                            },
                          }
                        : plugin,
                    ),
                  }
                : track,
            ),
          })),
        };
        mockProjectSync.updateProjectState(nextProjectState);
      }

      return {
        id: `operation-${request.operationType}`,
        projectId: 'project-1',
        demoId: 'demo-1',
        type: request.operationType,
        createdAt: new Date().toISOString(),
        actorUserId: 'user-1',
        baseSnapshotId: null,
        baseOperationSeq: 0,
        operationSeq: 1,
        payload: request.payload,
        idempotencyKey: 'mock-idempotency',
        clientOperationId: 'mock-client-operation',
      };
    }
    async loadHistoricalProjectState() {
      return null;
    }
    async handleReconnect() {}
    dispose() {}
    async createVersionBranch() {
      return null;
    }
    async revertToVersion() {
      return null;
    }
  },
}));

import { DemoDawClient } from './DemoDawClient';

describe('DemoDawClient recording regression', () => {
  beforeEach(() => {
    mockRouter.refresh.mockReset();
    mockIngest.recordUploadCount = 0;
    mockIngest.addTrackUploadCount = 0;
    mockIngest.objectUrlCount = 0;
    mockIngest.revokeObjectUrl.mockReset();
    mockIngest.lastUploadAudioFileSourceVersionId = null;
    mockIngest.lastUploadRecordedBlobSourceVersionId = null;
    mockPlaybackEngine.lastConstructorOptions = null;
    mockPlaybackEngine.setProjectCount = 0;
    mockPlaybackEngine.lastSetProject = null;
    mockVersionHistoryTree.lastProps = null;
    mockPendingActiveVersionUpdates.pending = [];
    mockRecordingSave.deferred = createDeferred();
    mockProjectSync.reset();
    try {
      window.localStorage.clear();
    } catch {
      // jsdom/vitest may not expose a writable localStorage shim here.
    }
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/bootstrap?demoId=')) {
        return new Response(JSON.stringify({ pluginDefinitions: [] }), { status: 200 });
      }
      if (url.includes('/presence')) {
        return new Response('', { status: 200 });
      }
      if (url.includes('/active-version')) {
        return new Response(JSON.stringify({ activeVersionId: 'mock', isFollowingHead: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;
  });

  it('sets the version history rail height on the first layout pass', () => {
    const resizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 500,
      width: 800,
      height: 500,
      toJSON: () => ({}),
    } as DOMRect));

    vi.stubGlobal('ResizeObserver', resizeObserver);

    try {
      const initialVersion = makeVersion('version-1', ['Track 1'], {
        isCurrent: true,
        operationSeq: 1,
        createdAt: '2026-07-05T00:00:00.000Z',
        tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
      });

      render(
        <DemoDawClient
          groupSlug="demo-group"
          projectSlug="demo-project"
          projectId="project-1"
          demoId="demo-1"
          currentUserId="user-1"
          demoName="Demo"
          demoDescription={null}
          initialCurrentVersionId={initialVersion.id}
          initialActiveVersionId={initialVersion.id}
          initialIsFollowingHead={true}
          initialVersions={[initialVersion]}
        />,
      );

      expect(screen.getByTestId('version-tree-rail').style.height).toBe('545px');
      expect(String(mockVersionHistoryTree.lastProps?.scrollResetSignal)).toMatch(/:500$/);
    } finally {
      rectSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('does not auto-scroll the version history rail on the initial mount', () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    const scrollIntoViewSpy = HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;

    try {
      const initialVersion = makeVersion('version-1', ['Track 1'], {
        isCurrent: true,
        operationSeq: 1,
        createdAt: '2026-07-05T00:00:00.000Z',
        tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
      });

      render(
        <DemoDawClient
          groupSlug="demo-group"
          projectSlug="demo-project"
          projectId="project-1"
          demoId="demo-1"
          currentUserId="user-1"
          demoName="Demo"
          demoDescription={null}
          initialCurrentVersionId={initialVersion.id}
          initialActiveVersionId={initialVersion.id}
          initialIsFollowingHead={true}
          initialVersions={[initialVersion]}
        />,
      );

      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
      }
    }
  });

  it('keeps only one Track 1 after recording and names the next added track Track 2', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    const user = userEvent.setup();
    const { container } = render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    expect(screen.getByTestId('project-timing-controls')).toBeTruthy();
    expect(screen.getByTestId('transport-controls')).toBeTruthy();
    expect(screen.getByTestId('audio-input-selector')).toBeTruthy();
    expect(screen.getByTestId('version-tree-rail')).toBeTruthy();
    expect(screen.getByTestId('version-history-tree')).toBeTruthy();
    expect(mockPlaybackEngine.lastConstructorOptions?.pluginGraphFactory).toEqual(expect.any(Function));

    await user.click((await screen.findAllByRole('button', { name: 'Enable mock mic' }))[0]);
    await user.click(await screen.findByRole('button', { name: 'Start mock recording' }));

    await waitFor(() => {
      expect(container.querySelectorAll('[data-track-version-id]').length).toBe(1);
    });

    await user.click(screen.getByRole('button', { name: 'Stop mock recording' }));

    await act(async () => {
      mockRecordingSave.deferred?.resolve();
    });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-track-version-id]').length).toBe(1);
    });

    await user.click(screen.getAllByRole('button', { name: '+ Add track' })[0]);

    await waitFor(() => {
      expect(container.querySelectorAll('[data-track-version-id]').length).toBe(2);
    });

    expect(container.querySelectorAll('[data-track-version-id]').length).toBe(2);
    expect(mockIngest.lastUploadAudioFileSourceVersionId).toBe('recorded-version-1');

    mockRecordingSave.deferred = createDeferred();
    const trackRows = container.querySelectorAll('[data-track-version-id]');
    expect(trackRows.length).toBe(2);
    await user.click(within(trackRows[1] as HTMLElement).getByTitle('Arm track for recording'));
    await user.click(await screen.findByRole('button', { name: 'Start mock recording' }));
    await user.click(screen.getByRole('button', { name: 'Stop mock recording' }));

    await act(async () => {
      mockRecordingSave.deferred?.resolve();
    });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-track-version-id]').length).toBe(2);
    });

    expect(mockIngest.lastUploadRecordedBlobSourceVersionId).toBe('uploaded-version-1');

    await act(async () => {
      await mockPendingActiveVersionUpdates.flush();
    });
  });

  it('checks out a selected version node as a pinned active version', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    await waitFor(() => {
      expect(mockVersionHistoryTree.lastProps).toBeTruthy();
    });

    await act(async () => {
      (mockVersionHistoryTree.lastProps?.onSelectVersion as ((id: string) => void) | undefined)?.(
        initialVersion.id,
      );
    });

    expect(mockPendingActiveVersionUpdates.pending.at(-1)).toMatchObject({
      activeVersionId: initialVersion.id,
      options: { isFollowingHead: true },
    });

    await act(async () => {
      await mockPendingActiveVersionUpdates.flush();
    });
  });

  it('keeps the selected checkout stable when another branch advances', async () => {
    const rootVersion = makeVersion('version-root', ['Track 1'], {
      isCurrent: false,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-root-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });
    const branchAVersion = makeVersion('version-branch-a', ['Track 1'], {
      isCurrent: true,
      operationSeq: 2,
      createdAt: '2026-07-05T00:05:00.000Z',
      parentId: rootVersion.id,
      tracks: [makeTrack('Track 1', 'version-branch-a-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });
    const branchBVersion = makeVersion('version-branch-b', ['Track 1'], {
      isCurrent: true,
      operationSeq: 3,
      createdAt: '2026-07-05T00:10:00.000Z',
      parentId: rootVersion.id,
      tracks: [makeTrack('Track 1', 'version-branch-b-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={branchAVersion.id}
        initialActiveVersionId={branchAVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[rootVersion, branchAVersion]}
      />,
    );

    await waitFor(() => {
      expect(mockVersionHistoryTree.lastProps).toBeTruthy();
      expect(mockVersionHistoryTree.lastProps?.selectedVersionId).toBe(branchAVersion.id);
    });

    await act(async () => {
      mockProjectSync.updateProjectState({
        ...mockProjectSync.getState().projectState!,
        versions: [rootVersion, branchAVersion, branchBVersion],
        currentVersionId: branchBVersion.id,
        activeVersionId: branchAVersion.id,
        isFollowingHead: true,
      });
    });

    expect(mockVersionHistoryTree.lastProps?.currentVersionId).toBe(branchBVersion.id);
    expect(mockVersionHistoryTree.lastProps?.activeVersionId).toBe(branchAVersion.id);
    expect(mockVersionHistoryTree.lastProps?.selectedVersionId).toBe(branchAVersion.id);
  });

  it('adds a track from the selected checkout instead of snapping back to the current head', async () => {
    const rootVersion = makeVersion('version-root', ['Track 1'], {
      isCurrent: false,
      operationSeq: 1,
      createdAt: '2026-07-04T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-root-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });
    const headVersion = makeVersion('version-head', ['Track 1', 'Track 2'], {
      isCurrent: true,
      operationSeq: 2,
      createdAt: '2026-07-05T00:00:00.000Z',
      parentId: rootVersion.id,
      tracks: [
        makeTrack('Track 1', 'version-head-track-1', { trackId: 'track-1', trackPosition: 0 }),
        makeTrack('Track 2', 'version-head-track-2', { trackId: 'track-2', trackPosition: 1 }),
      ],
    });

    const user = userEvent.setup();
    const { container } = render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={headVersion.id}
        initialActiveVersionId={headVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[rootVersion, headVersion]}
      />,
    );

    await waitFor(() => {
      expect(mockVersionHistoryTree.lastProps).toBeTruthy();
    });

    await act(async () => {
      (mockVersionHistoryTree.lastProps?.onSelectVersion as ((id: string) => void) | undefined)?.(rootVersion.id);
    });

    await user.click(screen.getAllByRole('button', { name: '+ Add track' })[0]);

    await waitFor(() => {
      expect(mockIngest.lastUploadAudioFileSourceVersionId).toBe(rootVersion.id);
    });

    expect(container.querySelectorAll('[data-track-version-id]').length).toBe(2);
  });

  it('updates the docked rail when the viewport crosses the desktop breakpoint', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    const previousWidth = window.innerWidth;
    window.innerWidth = 1024;

    const { unmount } = render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Expand version history rail' })).toBeTruthy();

    window.innerWidth = 1440;
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Collapse version history rail' })).toBeTruthy();
    });

    unmount();
    window.innerWidth = previousWidth;
  });

  it('zooms the version history rail from the header controls', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    const user = userEvent.setup();
    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    await waitFor(() => {
      expect(mockVersionHistoryTree.lastProps).toBeTruthy();
      expect(mockVersionHistoryTree.lastProps?.zoomLevel).toBe(1);
    });

    await user.click(screen.getByRole('button', { name: 'Zoom out version history' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out version history' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out version history' }));

    await waitFor(() => {
      expect(mockVersionHistoryTree.lastProps?.zoomLevel).toBeCloseTo(0.625, 3);
    });

    await user.click(screen.getByRole('button', { name: 'Reset version history zoom' }));

    await waitFor(() => {
      expect(mockVersionHistoryTree.lastProps?.zoomLevel).toBe(1);
    });
  });

  it('renders upload, plugin, and member controls in the left browser rail', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    const user = userEvent.setup();
    const { container } = render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    const browserRail = screen.getByTestId('browser-rail');
    const browser = within(browserRail);

    expect(browser.getByText('Browser')).toBeTruthy();
    expect(browser.getByText('Name the track, choose a file, then send it into the demo.')).toBeTruthy();
    expect(browser.getByText('Choose file')).toBeTruthy();
    expect(browser.getByRole('button', { name: 'Upload audio' })).toBeTruthy();
    expect(browser.getByRole('button', { name: 'Upload' })).toBeTruthy();
    expect(browser.getByRole('button', { name: 'Plugins' })).toBeTruthy();
    expect(browser.getByRole('button', { name: 'Members' })).toBeTruthy();

    await user.click(browser.getByRole('button', { name: 'Plugins' }));
    await waitFor(() => {
      expect(browser.getByRole('button', { name: 'Plugins' }).getAttribute('aria-pressed')).toBe('true');
    });

    await user.click(browser.getByRole('button', { name: 'Members' }));
    await waitFor(() => {
      expect(browser.getByRole('button', { name: 'Members' }).getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('adds a browser plugin to the selected track through the PLUGIN_ADDED commit path', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/bootstrap?demoId=')) {
        return new Response(
          JSON.stringify({
            pluginDefinitions: [
              {
                id: 'plugin-def-1',
                pluginKey: 'com.example.delay',
                name: 'Delay',
                displayName: 'Delay',
                description: null,
                version: '1.0.0',
                manufacturer: 'Example Audio',
                parameterSchema: {},
                ownerId: 'user-1',
                visibility: 'PRIVATE',
                descriptorUrl:
                  'data:text/javascript,export function createInstance(){return {connect(){return undefined;},disconnect(){return undefined;},setParameterValues(){return undefined;},setState(){return undefined;}};}',
                createdAt: '2026-07-05T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/presence')) {
        return new Response('', { status: 200 });
      }
      if (url.includes('/active-version')) {
        return new Response(JSON.stringify({ activeVersionId: 'mock', isFollowingHead: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const user = userEvent.setup();
    const { container } = render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    const browserRail = screen.getByTestId('browser-rail');
    const browser = within(browserRail);

    await user.click(browser.getByRole('button', { name: 'Plugins' }));

    const addButton = await screen.findByRole('button', { name: 'Add Delay to selected track' });
    expect(addButton).toBeTruthy();
    expect((addButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(addButton);

    await waitFor(() => {
      expect(mockProjectSync.getState().lastCommitRequest?.operationType).toBe('PLUGIN_ADDED');
    });

    await waitFor(() => {
      const plugins = mockProjectSync.projectState?.versions[0]?.tracks[0]?.plugins ?? [];
      expect(plugins).toHaveLength(1);
      expect(plugins[0]?.pluginKey).toBe('com.example.delay');
      expect(plugins[0]?.version).toBe('1.0.0');
      expect(plugins[0]?.position).toBe(0);
    });

    expect(container.querySelectorAll('[data-track-version-id]').length).toBe(1);
  });

  it('logs detailed plugin module load failures when a plugin import fails', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/bootstrap?demoId=')) {
        return new Response(
          JSON.stringify({
            pluginDefinitions: [
              {
                id: 'plugin-def-1',
                pluginKey: 'com.example.broken',
                name: 'Broken',
                displayName: 'Broken',
                description: null,
                version: '1.0.0',
                manufacturer: 'Example Audio',
                parameterSchema: {},
                ownerId: 'user-1',
                visibility: 'PRIVATE',
                descriptorUrl: 'data:text/javascript,throw%20new%20Error(%22boom%22)',
                createdAt: '2026-07-05T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/presence')) {
        return new Response('', { status: 200 });
      }
      if (url.includes('/active-version')) {
        return new Response(JSON.stringify({ activeVersionId: 'mock', isFollowingHead: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const user = userEvent.setup();
    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    const browserRail = screen.getByTestId('browser-rail');
    const browser = within(browserRail);
    await user.click(browser.getByRole('button', { name: 'Plugins' }));

    const addButton = await screen.findByRole('button', { name: 'Add Broken to selected track' });
    await user.click(addButton);

    await waitFor(() => {
      expect(screen.getByText('Plugin chain error')).toBeTruthy();
    });

    await waitFor(() => {
      const failureCall = consoleErrorSpy.mock.calls.find((call) => call[0] === '[daw][wam] plugin module load failed');
      expect(failureCall).toBeTruthy();
      const payload = JSON.parse(String(failureCall?.[1] ?? '{}')) as {
        source?: string;
        projectId?: string;
        demoId?: string;
        trackVersionId?: string | null;
        trackId?: string | null;
        trackName?: string | null;
        pluginKey?: string;
        version?: string;
        descriptorUrl?: string | null;
      };
      expect(payload).toEqual(
        expect.objectContaining({
          source: 'manual-add',
          projectId: 'project-1',
          demoId: 'demo-1',
          trackVersionId: 'version-1-track-1',
          trackId: 'track-1',
          trackName: 'Track 1',
          pluginKey: 'com.example.broken',
          version: '1.0.0',
          descriptorUrl: 'data:text/javascript,throw%20new%20Error(%22boom%22)',
        }),
      );
    });

    consoleErrorSpy.mockRestore();
  });

  it('adds a plugin, changes a param, reorders it, removes another plugin, and emits the expected ops from the Plugins tab', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [
        makeTrack('Track 1', 'version-1-track-1', {
          trackId: 'track-1',
          trackPosition: 0,
          plugins: [
            makePlugin('plugin-b', { pluginKey: 'com.example.chorus', position: 0 }),
            makePlugin('plugin-c', { pluginKey: 'com.example.reverb', position: 1 }),
          ],
        }),
      ],
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/bootstrap?demoId=')) {
        return new Response(
          JSON.stringify({
            pluginDefinitions: [
              {
                id: 'plugin-def-a',
                pluginKey: 'com.example.delay',
                name: 'Delay',
                displayName: 'Delay',
                description: null,
                version: '1.0.0',
                manufacturer: 'Example Audio',
                parameterSchema: {
                  parameters: [
                    {
                      id: 'mix',
                      label: 'Delay Mix',
                      min: 0,
                      max: 1,
                      step: 0.01,
                      unit: '%',
                      default: 0.25,
                    },
                    {
                      id: 'enabled',
                      label: 'Delay On',
                      type: 'boolean',
                      default: true,
                    },
                  ],
                },
                ownerId: null,
                visibility: 'PUBLIC',
                descriptorUrl:
                  'data:text/javascript,export function createInstance(){return {connect(){return undefined;},disconnect(){return undefined;},setParameterValues(){return undefined;},setState(){return undefined;}};}',
                createdAt: '2026-07-05T00:00:00.000Z',
              },
              {
                id: 'plugin-def-b',
                pluginKey: 'com.example.chorus',
                name: 'Chorus',
                displayName: 'Chorus',
                description: null,
                version: '1.0.0',
                manufacturer: 'Example Audio',
                parameterSchema: {},
                ownerId: null,
                visibility: 'PUBLIC',
                descriptorUrl:
                  'data:text/javascript,export function createInstance(){return {connect(){return undefined;},disconnect(){return undefined;},setParameterValues(){return undefined;},setState(){return undefined;}};}',
                createdAt: '2026-07-05T00:00:00.000Z',
              },
              {
                id: 'plugin-def-c',
                pluginKey: 'com.example.reverb',
                name: 'Reverb',
                displayName: 'Reverb',
                description: null,
                version: '1.0.0',
                manufacturer: 'Example Audio',
                parameterSchema: {},
                ownerId: null,
                visibility: 'PUBLIC',
                descriptorUrl:
                  'data:text/javascript,export function createInstance(){return {connect(){return undefined;},disconnect(){return undefined;},setParameterValues(){return undefined;},setState(){return undefined;}};}',
                createdAt: '2026-07-05T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/presence')) {
        return new Response('', { status: 200 });
      }
      if (url.includes('/active-version')) {
        return new Response(JSON.stringify({ activeVersionId: 'mock', isFollowingHead: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    const user = userEvent.setup();
    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    const browserRail = screen.getByTestId('browser-rail');
    const browser = within(browserRail);
    await user.click(browser.getByRole('button', { name: 'Plugins' }));

    const addButton = await screen.findByRole('button', { name: 'Add Delay to selected track' });
    await user.click(addButton);

    await waitFor(() => {
      expect(getCommitOps().map((entry) => entry.operationType)).toEqual(['PLUGIN_ADDED']);
    });

    const addedPlugin = mockProjectSync.projectState?.versions[0]?.tracks[0]?.plugins.find(
      (plugin) => plugin.pluginKey === 'com.example.delay',
    );
    expect(addedPlugin).toBeTruthy();
    const delayInstanceId = addedPlugin?.instanceId ?? '';

    const browserPluginChain = await screen.findByTestId('browser-plugin-chain-version-1-track-1');
    const browserPluginChainView = within(browserPluginChain);

    const mixSlider = await browserPluginChainView.findByRole('slider', { name: 'Delay Mix' });
    fireEvent.change(mixSlider, { target: { value: '0.75' } });

    await waitFor(() => {
      expect(getCommitOps().map((entry) => entry.operationType)).toEqual([
        'PLUGIN_ADDED',
        'PLUGIN_PARAM_SET',
      ]);
    });
    expect(
      mockProjectSync.projectState?.versions[0]?.tracks[0]?.plugins.find((plugin) => plugin.instanceId === delayInstanceId)
        ?.params.mix,
    ).toBe(0.75);

    const dragHandle = browserPluginChainView.getByRole('button', { name: 'Drag Delay' });
    const chorusBypass = browserPluginChainView.getByRole('button', { name: 'Bypass Chorus' });
    const dragTransfer = createDataTransfer();

    fireEvent.dragStart(dragHandle, { dataTransfer: dragTransfer });
    fireEvent.dragOver(chorusBypass, { dataTransfer: dragTransfer });
    fireEvent.drop(chorusBypass, { dataTransfer: dragTransfer });

    await waitFor(() => {
      expect(getCommitOps().map((entry) => entry.operationType)).toEqual([
        'PLUGIN_ADDED',
        'PLUGIN_PARAM_SET',
        'PLUGIN_REORDERED',
      ]);
    });
    expect(
      mockProjectSync.projectState?.versions[0]?.tracks[0]?.plugins.map((plugin) => plugin.instanceId),
    ).toEqual([delayInstanceId, 'plugin-b', 'plugin-c']);

    await user.click(browserPluginChainView.getByRole('button', { name: 'Remove Chorus from Track 1' }));

    await waitFor(() => {
      expect(getCommitOps().map((entry) => entry.operationType)).toEqual([
        'PLUGIN_ADDED',
        'PLUGIN_PARAM_SET',
        'PLUGIN_REORDERED',
        'PLUGIN_REMOVED',
      ]);
    });
    expect(
      mockProjectSync.projectState?.versions[0]?.tracks[0]?.plugins.map((plugin) => plugin.instanceId),
    ).toEqual([delayInstanceId, 'plugin-c']);
  });

  it('keeps track insert chains collapsed by default and reveals them on demand', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [
        makeTrack('Track 1', 'version-1-track-1', {
          trackId: 'track-1',
          trackPosition: 0,
          plugins: [makePlugin('plugin-a')],
        }),
      ],
    });

    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    expect(screen.queryByTestId('track-plugin-chain-version-1-track-1')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show plugins on Track 1' }));

    await waitFor(() => {
      expect(screen.getByTestId('track-plugin-chain-version-1-track-1')).toBeTruthy();
    });
  });

  it('reflects collaborator plugin edits through the reducer and playback engine', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [
        makeTrack('Track 1', 'version-1-track-1', {
          trackId: 'track-1',
          trackPosition: 0,
          plugins: [
            makePlugin('plugin-a', {
              pluginKey: 'com.example.delay',
              position: 0,
              params: { mix: 0.25, enabled: 1 },
            }),
          ],
        }),
      ],
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/bootstrap?demoId=')) {
        return new Response(
          JSON.stringify({
            pluginDefinitions: [
              {
                id: 'plugin-def-a',
                pluginKey: 'com.example.delay',
                name: 'Delay',
                displayName: 'Delay',
                description: null,
                version: '1.0.0',
                manufacturer: 'Example Audio',
                parameterSchema: {
                  parameters: [
                    {
                      id: 'mix',
                      label: 'Delay Mix',
                      min: 0,
                      max: 1,
                      step: 0.01,
                      unit: '%',
                      default: 0.25,
                    },
                    {
                      id: 'enabled',
                      label: 'Delay On',
                      type: 'boolean',
                      default: true,
                    },
                  ],
                },
                ownerId: null,
                visibility: 'PUBLIC',
                descriptorUrl:
                  'data:text/javascript,export function createInstance(){return {connect(){return undefined;},disconnect(){return undefined;},setParameterValues(){return undefined;},setState(){return undefined;}};}',
                createdAt: '2026-07-05T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/presence')) {
        return new Response('', { status: 200 });
      }
      if (url.includes('/active-version')) {
        return new Response(JSON.stringify({ activeVersionId: 'mock', isFollowingHead: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Show plugins on Track 1' }));

    const trackPluginChain = await screen.findByTestId('track-plugin-chain-version-1-track-1');
    const trackPluginChainView = within(trackPluginChain);

    await trackPluginChainView.findByRole('slider', { name: 'Delay Mix' });
    await waitFor(() => {
      expect(mockPlaybackEngine.setProjectCount).toBeGreaterThan(0);
    });
    const initialSetProjectCount = mockPlaybackEngine.setProjectCount;

    const remoteUpdatedVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 2,
      createdAt: '2026-07-05T00:00:01.000Z',
      tracks: [
        makeTrack('Track 1', 'version-1-track-1', {
          trackId: 'track-1',
          trackPosition: 0,
          plugins: normalizePlugins([
            makePlugin('plugin-a', {
              pluginKey: 'com.example.delay',
              position: 0,
              bypassed: true,
              params: { mix: 0.8, enabled: 0 },
            }),
          ]),
        }),
      ],
    });

    await act(async () => {
      mockProjectSync.updateProjectState({
        ...makeProjectState([remoteUpdatedVersion]),
        currentVersionId: remoteUpdatedVersion.id,
        activeVersionId: remoteUpdatedVersion.id,
        isFollowingHead: true,
        lastVersionOperationSeq: 2,
        lastSeenOperationSeq: 2,
      });
    });

    await waitFor(() => {
      expect(mockPlaybackEngine.setProjectCount).toBeGreaterThan(initialSetProjectCount);
    });
    expect((trackPluginChainView.getByRole('slider', { name: 'Delay Mix' }) as HTMLInputElement).value).toBe('0.8');
    expect((trackPluginChainView.getByRole('checkbox', { name: 'Delay On toggle' }) as HTMLInputElement).checked).toBe(false);
    expect(trackPluginChainView.getByText('Bypassed')).toBeTruthy();
  });

  it('collapses and restores the timing and recording row', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    expect(screen.getByTestId('project-timing-controls')).toBeTruthy();
    expect(screen.getByTestId('transport-controls')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Minimize timing and recording controls' }));

    await waitFor(() => {
      expect(screen.queryByTestId('project-timing-controls')).toBeNull();
      expect(screen.queryByTestId('transport-controls')).toBeNull();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Restore timing and recording controls' }));

    await waitFor(() => {
      expect(screen.getByTestId('project-timing-controls')).toBeTruthy();
      expect(screen.getByTestId('transport-controls')).toBeTruthy();
    });
  });

  it('renders the right inspector with mirrored track controls and inline comments', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    const user = userEvent.setup();
    const { container } = render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    const inspectorRail = screen.getByTestId('inspector-rail');
    const inspector = within(inspectorRail);

    expect(inspector.getByText('Inspector')).toBeTruthy();
    expect(inspector.getByText('Comments')).toBeTruthy();
    expect(inspector.getByRole('button', { name: 'New' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Add Comment' }));

    await waitFor(() => {
      expect(inspector.getByRole('button', { name: 'Draft' })).toBeTruthy();
    });
  });

  it('deletes a track through the realtime commit path', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    const user = userEvent.setup();
    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete track Track 1' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Delete track Track 1' }));

    await waitFor(() => {
      expect(mockProjectSync.projectState?.versions[0].tracks).toHaveLength(0);
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete track Track 1' })).toBeNull();
    });
  });

  it('follows a collaborator-created blank-daw track without requiring refresh', async () => {
    const initialVersion = makeVersion('version-1', [], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [],
    });
    const remoteVersion = makeVersion('version-2', ['Remote Update Track'], {
      parentId: initialVersion.id,
      parentVersionId: initialVersion.id,
      isCurrent: true,
      operationSeq: 2,
      createdAt: '2026-07-05T00:00:01.000Z',
      tracks: [makeTrack('Remote Update Track', 'version-2-track-1', { trackId: 'track-2', trackPosition: 0 })],
    });

    const user = userEvent.setup();
    const { container } = render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-2"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={false}
        initialVersions={[initialVersion]}
      />,
    );

    expect(screen.queryByText('Remote Update Track')).toBeNull();

    await act(async () => {
      mockProjectSync.updateProjectState({
        ...makeProjectState([initialVersion, remoteVersion]),
        currentVersionId: remoteVersion.id,
        activeVersionId: remoteVersion.id,
        isFollowingHead: true,
        lastVersionOperationSeq: 2,
        lastSeenOperationSeq: 2,
      });
    });

    await screen.findAllByText('Remote Update Track');

    expect(container.querySelector('[data-track-version-id]')?.textContent).toContain('Remote Update Track');
  });

  it('keeps two simultaneous DAW clients aligned when one adds a track to a blank demo', async () => {
    const initialVersion = makeVersion('version-1', [], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [],
    });

    const user = userEvent.setup();
    render(
      <div>
        <section data-testid="client-a">
          <DemoDawClient
            groupSlug="demo-group"
            projectSlug="demo-project"
            projectId="project-1"
            demoId="demo-1"
            currentUserId="user-a"
            demoName="Demo"
            demoDescription={null}
            initialCurrentVersionId={initialVersion.id}
            initialActiveVersionId={initialVersion.id}
            initialIsFollowingHead={true}
            initialVersions={[initialVersion]}
          />
        </section>
        <section data-testid="client-b">
          <DemoDawClient
            groupSlug="demo-group"
            projectSlug="demo-project"
            projectId="project-1"
            demoId="demo-1"
            currentUserId="user-b"
            demoName="Demo"
            demoDescription={null}
            initialCurrentVersionId={initialVersion.id}
            initialActiveVersionId={initialVersion.id}
            initialIsFollowingHead={true}
            initialVersions={[initialVersion]}
          />
        </section>
      </div>,
    );

    const clientA = screen.getByTestId('client-a');
    const clientB = screen.getByTestId('client-b');

    expect(clientA.querySelectorAll('[data-track-version-id]').length).toBe(0);
    expect(clientB.querySelectorAll('[data-track-version-id]').length).toBe(0);

    await user.click(within(clientA).getByRole('button', { name: '+ Add track' }));

    await waitFor(() => {
      expect(clientA.querySelectorAll('[data-track-version-id]').length).toBe(1);
      expect(clientB.querySelectorAll('[data-track-version-id]').length).toBe(1);
    });
  });

  it('shows project and per-track MP3 export actions at the bottom of the DAW', async () => {
    const initialVersion = makeVersion('version-1', ['Track 1'], {
      isCurrent: true,
      operationSeq: 1,
      createdAt: '2026-07-05T00:00:00.000Z',
      tracks: [makeTrack('Track 1', 'version-1-track-1', { trackId: 'track-1', trackPosition: 0 })],
    });

    render(
      <DemoDawClient
        groupSlug="demo-group"
        projectSlug="demo-project"
        projectId="project-1"
        demoId="demo-1"
        currentUserId="user-1"
        demoName="Demo"
        demoDescription={null}
        initialCurrentVersionId={initialVersion.id}
        initialActiveVersionId={initialVersion.id}
        initialIsFollowingHead={true}
        initialVersions={[initialVersion]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Download project MP3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download each track MP3' })).toBeTruthy();
  });
});
