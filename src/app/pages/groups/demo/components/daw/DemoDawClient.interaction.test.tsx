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
      };
    },
    get projectState() {
      return state.projectState;
    },
  };
});

const mockIngest = vi.hoisted(() => ({
  recordUploadCount: 0,
  addTrackUploadCount: 0,
  objectUrlCount: 0,
  revokeObjectUrl: vi.fn(),
  lastUploadAudioFileSourceVersionId: null as string | null,
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
  VersionHistoryTree: () => createElement('div', { 'data-testid': 'version-history-tree' }),
}));

vi.mock('./TrackSegmentClip', () => ({
  TrackSegmentClip: () => null,
}));

vi.mock('@/app/lib/daw/engine/audio-editing-engine', () => ({
  AudioEditingEngine: class AudioEditingEngineMock {
    constructor() {}
    moveTrack() {}
    moveSegment() {}
    deleteTrack(trackId: string) {
      return {
        demoId: 'demo-1',
        operationType: 'TRACK_REMOVED',
        payload: { trackId },
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
    setProject() {}
    preloadTracks() {}
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

      await mockRecordingSave.deferred?.promise;

      const nextVersionId = `recorded-version-${mockIngest.recordUploadCount}`;
      const nextVersion = cloneVersionWithTracks(sourceVersion, nextVersionId, ['Track 1']);
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
    async commitOperation(request: { operationType: string; payload: { trackId?: string } }) {
      const currentState = mockProjectSync.getState();
      const projectState = currentState.projectState;
      if (!projectState) {
        throw new Error('Project state missing');
      }

      if (request.operationType === 'TRACK_REMOVED' && request.payload.trackId) {
        const nextProjectState: LocalProjectState = {
          ...projectState,
          versions: projectState.versions.map((version) => ({
            ...version,
            tracks: version.tracks.filter((track) => track.trackId !== request.payload.trackId),
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

    await act(async () => {
      await mockPendingActiveVersionUpdates.flush();
    });
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
        activeVersionId: initialVersion.id,
        isFollowingHead: false,
        lastVersionOperationSeq: 2,
        lastSeenOperationSeq: 2,
      });
    });

    await waitFor(() => {
      expect(container.querySelector('[data-track-version-id]')?.textContent).toContain('Remote Update Track');
    });

    await user.click((await screen.findAllByRole('button', { name: 'Enable mock mic' }))[0]);
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
});
