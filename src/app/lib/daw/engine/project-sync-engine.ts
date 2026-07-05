import type {
  AcceptedDawProjectOperation,
  DawOperationCommitRequest,
  DawOperationType,
  DawProjectBootstrapResponse,
  DawProjectOperationRecord,
  DawSetUserActiveVersionResponse,
} from '@git-for-music/server/app/lib/daw/protocol';
import type { CreateVersionResponse, RevertVersionRequest } from '@git-for-music/shared';
import { dawLocalCache } from '@/app/lib/daw/engine/daw-local-cache';
import {
  applyAcceptedProjectOperation,
  applyAcceptedProjectOperationWithoutHistory,
  applyAcceptedProjectOperations,
  createLocalProjectStateFromBootstrap,
} from '@/app/lib/daw/state/operation-reducer';
import { rebaseTimelineEditRequest } from '@/app/lib/daw/state/timeline-edit-rebase';
import {
  createLocalOperationQueue,
  type LocalOperationQueueEntry,
  type LocalOperationQueueState,
  type LocalProjectSyncOperationStatus,
} from '@/app/lib/daw/state/local-operation-queue';
import type {
  LocalProjectState,
  TempoMetadataEntry,
} from '@/app/lib/daw/state/local-project-state';

type SyncableOperationType = Exclude<DawOperationType, 'ASSET_ADDED'>;

type ProjectSyncSnapshot = {
  projectState: LocalProjectState | null;
  queue: LocalOperationQueueState;
  baseSnapshotId: string | null;
  lastSyncedOperationSeq: number;
  isBootstrapping: boolean;
  isOnline: boolean;
  isSyncing: boolean;
  lastError: string | null;
  versionTreeAttention: {
    versionId: string;
    createdAt: string;
  } | null;
};

const VERSION_TREE_REFRESH_OPERATION_TYPES = new Set<DawOperationType>([
  'TRACK_RENAMED',
  'SEGMENT_SPLIT',
  'SEGMENT_DELETED',
  'SEGMENT_TRIMMED',
  'SEGMENT_MERGED',
  'SEGMENT_FADE_SET',
  'CROSSFADE_SET',
  'VERSION_CREATED',
  'VERSION_BRANCH_CREATED',
  'VERSION_RENAMED',
  'VERSION_SELECTED',
  'VERSION_REVERTED_FROM',
  'CURRENT_VERSION_CHANGED',
  'VERSION_PARENT_SET',
  'VERSION_OPERATION_SUMMARY_SET',
  'VERSION_NODE_ADDED',
  'VERSION_TIMING_UPDATED',
]);

const REALTIME_SILENCE_TIMEOUT_MS = 30_000;
const REALTIME_CATCH_UP_INTERVAL_MS = 15_000;

type RealtimeAcceptedOperationEvent = {
  type: 'accepted_operation';
  projectId: string;
  demoId: string;
  createdAt: string;
  operation: DawProjectOperationRecord;
};

type OperationCatchUpResponse = {
  operations: DawProjectOperationRecord[];
  latestSnapshotSeq?: number;
  rebootstrapRequired?: boolean;
};

type RealtimeAssetProcessingStatusEvent = {
  type: 'asset_processing_status';
  projectId: string;
  demoId: string;
  createdAt: string;
  assetId: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  trackId: string | null;
  trackVersionId: string | null;
  message: string | null;
};

type RealtimePresenceEvent = {
  type: 'presence';
  projectId: string;
  demoId: string;
  createdAt: string;
  presenceId: string;
  actorUserId: string;
  presenceSeed: string;
  status: 'online' | 'idle' | 'away' | 'offline';
  cursorTimeMs: number | null;
  selectedTrackId: string | null;
  currentTool: 'select' | 'split' | 'merge' | 'fade';
  recordingState: 'idle' | 'recording' | 'preview' | 'uploading' | 'error';
  playbackFollowState: boolean;
};

type RealtimeVersionTreeChangedEvent = {
  type: 'version_tree_changed';
  projectId: string;
  demoId: string;
  createdAt: string;
  actorUserId: string;
  reason?: 'version_created' | 'branch_created' | 'head_moved' | 'reverted';
};

type RealtimeVersionCreatedEvent = {
  type: 'version_created';
  projectId: string;
  demoId: string;
  createdAt: string;
  actorUserId: string;
  versionId: string;
  parentVersionId: string | null;
  kind: 'AUTO' | 'SEMANTIC' | 'EXPLICIT' | 'REVERT' | 'BRANCH' | 'MERGE';
  operationSeq: number | null;
};

type RealtimeBranchCreatedEvent = {
  type: 'branch_created';
  projectId: string;
  demoId: string;
  createdAt: string;
  actorUserId: string;
  versionId: string;
  parentVersionId: string | null;
  branchMode: 'continue' | 'fork';
  operationSeq: number | null;
};

type RealtimeHeadMovedEvent = {
  type: 'head_moved';
  projectId: string;
  demoId: string;
  createdAt: string;
  actorUserId: string;
  previousVersionId: string | null;
  currentVersionId: string;
  isFollowingHead: boolean;
};

type RealtimeRevertedEvent = {
  type: 'reverted';
  projectId: string;
  demoId: string;
  createdAt: string;
  actorUserId: string;
  versionId: string;
  parentVersionId: string | null;
  revertedFromVersionId: string;
  revertedToOperationId: string | null;
  operationSeq: number | null;
};

type RealtimeProjectRebootstrapRequiredEvent = {
  type: 'project_rebootstrap_required';
  projectId: string;
  demoId: string;
  createdAt: string;
  actorUserId: string;
  reason: string;
};

export type ProjectSyncBootstrapInput = {
  projectId: string;
  demoId: string;
  initialProjectState: LocalProjectState;
};

export type ProjectSyncOperationListener = (state: ProjectSyncSnapshot) => void;
export type ProjectSyncAssetStatusListener = (event: RealtimeAssetProcessingStatusEvent) => void;
export type ProjectSyncPresenceListener = (event: RealtimePresenceEvent) => void;

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

function stripLegacyRecordingState<T extends Record<string, unknown>>(value: T): T {
  const next = { ...value } as Record<string, unknown>;
  delete next.recordingTakesByTrackId;
  return next as T;
}

function sanitizeLocalProjectState(state: LocalProjectState | null | undefined) {
  if (!state) return null;
  return stripLegacyRecordingState(clone(state) as LocalProjectState & { recordingTakesByTrackId?: unknown });
}

function sanitizeBootstrapResponse(response: DawProjectBootstrapResponse | null) {
  if (!response) return null;

  const next = clone(response);
  if (next.projectState && typeof next.projectState === 'object' && !Array.isArray(next.projectState)) {
    next.projectState = stripLegacyRecordingState(next.projectState as Record<string, unknown>) as DawProjectBootstrapResponse['projectState'];
  }
  return next;
}

function generateId() {
  return crypto.randomUUID();
}

function shouldRefreshVersionTreeAfterOperation(operationType: DawOperationType) {
  return VERSION_TREE_REFRESH_OPERATION_TYPES.has(operationType);
}

function isBrowserOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

function toSyntheticOperation(
  request: DawOperationCommitRequest,
  projectId: string,
): AcceptedDawProjectOperation {
  return {
    id: generateId(),
    projectId,
    demoId: request.demoId,
    type: request.operationType,
    createdAt: new Date().toISOString(),
    actorUserId: 'local',
    baseSnapshotId: request.baseSnapshotId ?? null,
    baseOperationSeq: request.baseOperationSeq ?? 0,
    operationSeq: 0,
    payload: request.payload as unknown as DawProjectOperationRecord['payload'],
    idempotencyKey: request.idempotencyKey ?? generateId(),
    clientOperationId: request.clientOperationId ?? generateId(),
  };
}

function isSyntheticOperationRecord(operation: AcceptedDawProjectOperation) {
  return operation.operationSeq === 0 && operation.actorUserId === 'local';
}

function queueEntryFromPending(record: Awaited<ReturnType<typeof dawLocalCache.listPendingOperations>>[number]): LocalOperationQueueEntry {
  return {
    id: record.key,
    operationType: record.request.operationType,
    payload: record.request.payload,
    baseSnapshotId: record.request.baseSnapshotId ?? null,
    baseOperationSeq: record.request.baseOperationSeq ?? 0,
    targetTrackId: record.request.targetTrackId ?? null,
    targetSegmentId: record.request.targetSegmentId ?? null,
    affectedTimeRange: record.request.affectedTimeRange ?? null,
    status: record.status,
    attemptCount: record.attemptCount,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    idempotencyKey: record.request.idempotencyKey ?? record.key,
    clientOperationId: record.request.clientOperationId ?? record.key,
  };
}

function isReplayableQueuedOperationStatus(status: LocalOperationQueueEntry['status']) {
  return status === 'optimistic' || status === 'pending' || status === 'retrying' || status === 'failed';
}

function toReplayableAcceptedOperationRecord(
  entry: LocalOperationQueueEntry,
  projectId: string,
  demoId: string,
  operationSeq: number,
): AcceptedDawProjectOperation {
  return {
    id: entry.id,
    projectId,
    demoId,
    type: entry.operationType,
    createdAt: new Date(entry.createdAt).toISOString(),
    actorUserId: 'local',
    baseSnapshotId: entry.baseSnapshotId,
    baseOperationSeq: entry.baseOperationSeq,
    operationSeq,
    payload: entry.payload as unknown as DawProjectOperationRecord['payload'],
    idempotencyKey: entry.idempotencyKey,
    clientOperationId: entry.clientOperationId,
  };
}

function shouldReplayQueuedOperationEntry(entry: LocalOperationQueueEntry) {
  // SEGMENT_SPLIT requests are queued in request shape and must wait for the server's accepted payload.
  return isReplayableQueuedOperationStatus(entry.status) && entry.operationType !== 'SEGMENT_SPLIT';
}

function queueEntryToRebaseableRequest(
  entry: LocalOperationQueueEntry,
  demoId: string,
): DawOperationCommitRequest & { clientOperationId: string } {
  return {
    demoId,
    operationType: entry.operationType,
    payload: entry.payload as DawOperationCommitRequest['payload'],
    baseSnapshotId: entry.baseSnapshotId,
    baseOperationSeq: entry.baseOperationSeq,
    targetTrackId: entry.targetTrackId,
    targetSegmentId: entry.targetSegmentId,
    affectedTimeRange: entry.affectedTimeRange,
    idempotencyKey: entry.idempotencyKey,
    clientOperationId: entry.clientOperationId,
  };
}

function toPersistedPendingStatus(status: LocalOperationQueueEntry['status']) {
  if (status === 'accepted' || status === 'applied') {
    return 'pending' as const;
  }
  return status as Exclude<LocalProjectSyncOperationStatus, 'accepted'>;
}

export class ProjectSyncEngine {
  private readonly listeners = new Set<ProjectSyncOperationListener>();
  private readonly assetStatusListeners = new Set<ProjectSyncAssetStatusListener>();
  private readonly presenceListeners = new Set<ProjectSyncPresenceListener>();
  private readonly inFlightByIdempotencyKey = new Map<string, Promise<DawProjectOperationRecord>>();
  private versionTreeAttentionClearTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeCatchUpTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeSource: EventSource | null = null;
  private projectId: string | null = null;
  private demoId: string | null = null;
  private bootstrapResponse: DawProjectBootstrapResponse | null = null;
  private state: ProjectSyncSnapshot = {
    projectState: null,
    queue: createLocalOperationQueue(),
    baseSnapshotId: null,
    lastSyncedOperationSeq: 0,
    isBootstrapping: false,
    isOnline: true,
    isSyncing: false,
    lastError: null,
    versionTreeAttention: null,
  };

  subscribe(listener: ProjectSyncOperationListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeAssetStatus(listener: ProjectSyncAssetStatusListener) {
    this.assetStatusListeners.add(listener);
    return () => {
      this.assetStatusListeners.delete(listener);
    };
  }

  subscribePresence(listener: ProjectSyncPresenceListener) {
    this.presenceListeners.add(listener);
    return () => {
      this.presenceListeners.delete(listener);
    };
  }

  getState() {
    return this.state;
  }

  async setActiveVersion(
    activeVersionId: string,
    options: {
      isFollowingHead?: boolean;
    } = {},
  ) {
    if (!this.projectId || !this.demoId || !this.state.projectState) return null;

    const resolvedIsFollowingHead =
      options.isFollowingHead ?? activeVersionId === this.state.projectState.currentVersionId;

    try {
      const response = await fetch(`/api/daw/projects/${this.projectId}/active-version`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          demoId: this.demoId,
          activeVersionId,
          isFollowingHead: resolvedIsFollowingHead,
        }),
      });

      const data = (await response.json()) as DawSetUserActiveVersionResponse | { error?: string };
      if (!response.ok) {
        const message =
          'error' in data ? data.error ?? 'Could not update active version' : 'Could not update active version';
        this.setState({
          isOnline: isBrowserOnline(),
          lastError: message,
        });
        return null;
      }

      const responseData = data as DawSetUserActiveVersionResponse;
      const nextActiveVersionId = responseData.activeVersionId ?? activeVersionId;
      const nextIsFollowingHead = responseData.isFollowingHead ?? resolvedIsFollowingHead;
      this.setState({
        projectState: {
          ...this.state.projectState,
          activeVersionId: nextActiveVersionId,
          isFollowingHead: nextIsFollowingHead,
        },
        isOnline: true,
        lastError: null,
      });

      this.bootstrapResponse = this.bootstrapResponse
        ? {
            ...this.bootstrapResponse,
            activeVersionId: nextActiveVersionId,
            isFollowingHead: nextIsFollowingHead,
            activeBranchName: responseData.activeBranchName ?? null,
          }
        : this.bootstrapResponse;

      await this.persistProjectState();
      return responseData;
    } catch (error) {
      this.setState({
        isOnline: isBrowserOnline(),
        lastError: error instanceof Error ? error.message : 'Could not update active version',
      });
      return null;
    }
  }

  async createVersionBranch(input: {
    sourceVersionId: string;
    label?: string | null;
    description?: string | null;
  }) {
    if (!this.projectId || !this.demoId || !this.state.projectState) return null;

    try {
      const response = await fetch('/api/versions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          demoId: this.demoId,
          label: input.label ?? '',
          description: input.description ?? undefined,
          sourceVersionId: input.sourceVersionId,
        }),
      });

      const data = (await response.json()) as CreateVersionResponse | { error?: string };
      if (!response.ok) {
        const message = 'error' in data ? data.error ?? 'Could not create branch' : 'Could not create branch';
        this.setState({
          isOnline: isBrowserOnline(),
          lastError: message,
        });
        return null;
      }

      const responseData = data as CreateVersionResponse;
      const nextActiveVersionId = responseData.activeVersionId ?? responseData.id;
      const nextIsFollowingHead = responseData.isFollowingHead ?? true;

      this.setState({
        projectState: {
          ...this.state.projectState,
          activeVersionId: nextActiveVersionId,
          isFollowingHead: nextIsFollowingHead,
        },
        isOnline: true,
        lastError: null,
      });

      this.bootstrapResponse = this.bootstrapResponse
        ? {
            ...this.bootstrapResponse,
            activeVersionId: nextActiveVersionId,
            isFollowingHead: nextIsFollowingHead,
            activeBranchName: responseData.activeBranchName ?? responseData.label ?? null,
          }
        : this.bootstrapResponse;

      await this.persistProjectState();
      await this.refreshVersionTreeFromServer();
      return responseData;
    } catch (error) {
      this.setState({
        isOnline: isBrowserOnline(),
        lastError: error instanceof Error ? error.message : 'Could not create branch',
      });
      return null;
    }
  }

  async revertToVersion(input: {
    sourceVersionId: string;
    label?: string | null;
    description?: string | null;
  }) {
    if (!this.projectId || !this.demoId || !this.state.projectState) return null;

    try {
      const response = await fetch('/api/versions/revert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          demoId: this.demoId,
          sourceVersionId: input.sourceVersionId,
          label: input.label ?? undefined,
          description: input.description ?? undefined,
        } satisfies RevertVersionRequest),
      });

      const data = (await response.json()) as CreateVersionResponse | { error?: string };
      if (!response.ok) {
        const message = 'error' in data ? data.error ?? 'Could not revert to version' : 'Could not revert to version';
        this.setState({
          isOnline: isBrowserOnline(),
          lastError: message,
        });
        return null;
      }

      const responseData = data as CreateVersionResponse;
      const nextActiveVersionId = responseData.activeVersionId ?? responseData.id;
      const nextIsFollowingHead = responseData.isFollowingHead ?? true;

      this.setState({
        projectState: {
          ...this.state.projectState,
          activeVersionId: nextActiveVersionId,
          isFollowingHead: nextIsFollowingHead,
        },
        isOnline: true,
        lastError: null,
      });

      this.bootstrapResponse = this.bootstrapResponse
        ? {
            ...this.bootstrapResponse,
            activeVersionId: nextActiveVersionId,
            isFollowingHead: nextIsFollowingHead,
            activeBranchName: responseData.activeBranchName ?? responseData.label ?? null,
          }
        : this.bootstrapResponse;

      await this.persistProjectState();
      await this.refreshVersionTreeFromServer();
      return responseData;
    } catch (error) {
      this.setState({
        isOnline: isBrowserOnline(),
        lastError: error instanceof Error ? error.message : 'Could not revert to version',
      });
      return null;
    }
  }

  async setActiveVersionId(activeVersionId: string, isFollowingHead: boolean) {
    return this.setActiveVersion(activeVersionId, { isFollowingHead });
  }

  async setTrackTempoMetadata(trackVersionId: string, tempoMetadata: TempoMetadataEntry) {
    if (!this.state.projectState) return;

    this.setState({
      projectState: {
        ...this.state.projectState,
        tempoMetadataByTrackVersionId: {
          ...this.state.projectState.tempoMetadataByTrackVersionId,
          [trackVersionId]: tempoMetadata,
        },
      },
    });

    await this.persistProjectState();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private closeRealtimeConnection() {
    if (this.realtimeSource) {
      this.realtimeSource.close();
      this.realtimeSource = null;
    }
    if (this.realtimeSilenceTimer) {
      clearTimeout(this.realtimeSilenceTimer);
      this.realtimeSilenceTimer = null;
    }
    if (this.realtimeCatchUpTimer) {
      clearTimeout(this.realtimeCatchUpTimer);
      this.realtimeCatchUpTimer = null;
    }
    this.clearVersionTreeAttentionTimer();
  }

  private armRealtimeSilenceWatchdog() {
    if (this.realtimeSilenceTimer) {
      clearTimeout(this.realtimeSilenceTimer);
    }

    if (!this.realtimeSource) {
      this.realtimeSilenceTimer = null;
      return;
    }

    this.realtimeSilenceTimer = setTimeout(() => {
      this.realtimeSilenceTimer = null;
      if (!this.realtimeSource) return;
      void this.handleReconnect();
    }, REALTIME_SILENCE_TIMEOUT_MS);
  }

  private armRealtimeCatchUpLoop() {
    if (this.realtimeCatchUpTimer) {
      clearTimeout(this.realtimeCatchUpTimer);
    }

    if (!this.realtimeSource) {
      this.realtimeCatchUpTimer = null;
      return;
    }

    this.realtimeCatchUpTimer = setTimeout(async () => {
      this.realtimeCatchUpTimer = null;
      if (!this.realtimeSource) return;

      try {
        await this.refreshVersionTreeFromServer();
      } catch {
        // Best-effort catch-up; the silence watchdog still handles hard stalls.
      } finally {
        this.armRealtimeCatchUpLoop();
      }
    }, REALTIME_CATCH_UP_INTERVAL_MS);
  }

  private readonly handleRealtimeAcceptedOperation = async (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as RealtimeAcceptedOperationEvent;
      if (payload.type !== 'accepted_operation') return;
      if (payload.projectId !== this.projectId || payload.demoId !== this.demoId) return;
      this.armRealtimeSilenceWatchdog();
      await this.receiveAcceptedRemoteOperations([payload.operation]);
    } catch {
      // Realtime is best-effort; the EventSource reconnect will backfill if needed.
    }
  };

  private readonly handleRealtimeAssetStatus = (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as RealtimeAssetProcessingStatusEvent;
      if (payload.type !== 'asset_processing_status') return;
      if (payload.projectId !== this.projectId || payload.demoId !== this.demoId) return;
      this.armRealtimeSilenceWatchdog();
      for (const listener of this.assetStatusListeners) {
        listener(payload);
      }
    } catch {
      // Realtime asset state is best-effort too.
    }
  };

  private readonly handleRealtimePresence = (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as RealtimePresenceEvent;
      if (payload.type !== 'presence') return;
      if (payload.projectId !== this.projectId || payload.demoId !== this.demoId) return;
      this.armRealtimeSilenceWatchdog();
      for (const listener of this.presenceListeners) {
        listener(payload);
      }
    } catch {
      // Presence is best-effort and non-durable.
    }
  };

  private readonly handleRealtimeVersionTreeChanged = async (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as
        | RealtimeVersionTreeChangedEvent
        | RealtimeVersionCreatedEvent
        | RealtimeBranchCreatedEvent
        | RealtimeHeadMovedEvent
        | RealtimeRevertedEvent;
      if (
        payload.type !== 'version_tree_changed' &&
        payload.type !== 'version_created' &&
        payload.type !== 'branch_created' &&
        payload.type !== 'head_moved' &&
        payload.type !== 'reverted'
      )
        return;
      if (payload.projectId !== this.projectId || payload.demoId !== this.demoId) return;
      this.armRealtimeSilenceWatchdog();
      const attentionVersionId =
        payload.type === 'version_created' ||
        payload.type === 'branch_created' ||
        payload.type === 'reverted'
          ? payload.versionId
          : payload.type === 'head_moved'
            ? payload.currentVersionId
            : null;
      await this.rebootstrapFromServer();
      if (attentionVersionId) {
        this.flashVersionTreeAttention(attentionVersionId, payload.createdAt);
      }
    } catch {
      // Tree refresh is best-effort; accepted operations will still reconcile core edits.
    }
  };

  private readonly handleRealtimeProjectRebootstrapRequired = async (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as RealtimeProjectRebootstrapRequiredEvent;
      if (payload.type !== 'project_rebootstrap_required') return;
      if (payload.projectId !== this.projectId || payload.demoId !== this.demoId) return;

      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[daw] project_rebootstrap_required received for ${payload.projectId}/${payload.demoId}: ${payload.reason}`,
        );
      }
      this.armRealtimeSilenceWatchdog();
      await this.refreshVersionTreeFromServer();
    } catch {
      // Fallback resync is best-effort.
    }
  };

  private openRealtimeConnection() {
    if (!this.projectId || !this.demoId) return;

    this.closeRealtimeConnection();

    const source = new EventSource(
      `/api/daw/projects/${this.projectId}/realtime?demoId=${this.demoId}&afterSeq=${this.getLastSeenOperationSeq()}`,
    );

    source.addEventListener('open', () => {
      this.setState({ isOnline: true, lastError: null });
      this.armRealtimeSilenceWatchdog();
      this.armRealtimeCatchUpLoop();
      void this.catchUpFromServer().catch(() => {
        // The realtime stream is best-effort; the next reconnect will backfill.
      });
    });

    source.addEventListener('accepted_operation', (event) => {
      void this.handleRealtimeAcceptedOperation(event as MessageEvent<string>);
    });
    source.addEventListener('asset_processing_status', (event) => {
      this.handleRealtimeAssetStatus(event as MessageEvent<string>);
    });
    source.addEventListener('presence', (event) => {
      this.handleRealtimePresence(event as MessageEvent<string>);
    });
    source.addEventListener('version_tree_changed', (event) => {
      void this.handleRealtimeVersionTreeChanged(event as MessageEvent<string>);
    });
    source.addEventListener('version_created', (event) => {
      void this.handleRealtimeVersionTreeChanged(event as MessageEvent<string>);
    });
    source.addEventListener('branch_created', (event) => {
      void this.handleRealtimeVersionTreeChanged(event as MessageEvent<string>);
    });
    source.addEventListener('head_moved', (event) => {
      void this.handleRealtimeVersionTreeChanged(event as MessageEvent<string>);
    });
    source.addEventListener('reverted', (event) => {
      void this.handleRealtimeVersionTreeChanged(event as MessageEvent<string>);
    });
    source.addEventListener('project_rebootstrap_required', (event) => {
      void this.handleRealtimeProjectRebootstrapRequired(event as MessageEvent<string>);
    });
    source.addEventListener('error', () => {
      this.setState({
        isOnline: false,
        lastError: 'Realtime connection interrupted',
      });
    });

    this.realtimeSource = source;
  }

  private setState(next: Partial<ProjectSyncSnapshot>) {
    this.state = { ...this.state, ...next };
    this.emit();
  }

  private clearVersionTreeAttentionTimer() {
    if (this.versionTreeAttentionClearTimer) {
      clearTimeout(this.versionTreeAttentionClearTimer);
      this.versionTreeAttentionClearTimer = null;
    }
  }

  private flashVersionTreeAttention(versionId: string, createdAt: string) {
    this.clearVersionTreeAttentionTimer();
    this.setState({
      versionTreeAttention: {
        versionId,
        createdAt,
      },
    });
    this.versionTreeAttentionClearTimer = setTimeout(() => {
      if (
        this.state.versionTreeAttention?.versionId === versionId &&
        this.state.versionTreeAttention.createdAt === createdAt
      ) {
        this.setState({
          versionTreeAttention: null,
        });
      }
      this.versionTreeAttentionClearTimer = null;
    }, 1400);
  }

  private getLastSeenOperationSeq() {
    return this.state.projectState?.lastSeenOperationSeq ?? this.state.lastSyncedOperationSeq;
  }

  private reconcileQueueForOperation(operation: DawProjectOperationRecord) {
    const matchingEntry = this.state.queue.entries.find(
      (entry) =>
        entry.idempotencyKey === operation.idempotencyKey ||
        entry.clientOperationId === operation.clientOperationId,
    );
    if (!matchingEntry) return;

    this.setState({
      queue: {
        entries: this.state.queue.entries.map((entry) =>
          entry.id === matchingEntry.id
            ? { ...entry, status: 'accepted' as const, error: null, updatedAt: Date.now() }
            : entry,
        ),
      },
    });
  }

  private replayQueuedOperationsIntoProjectState() {
    if (!this.state.projectState || !this.projectId || !this.demoId) return false;

    const replayableEntries = [...this.state.queue.entries]
      .filter((entry) => isReplayableQueuedOperationStatus(entry.status))
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.updatedAt === right.updatedAt
            ? left.id.localeCompare(right.id)
            : left.updatedAt - right.updatedAt
          : left.createdAt - right.createdAt,
      );

    const skippedSplitEntries = replayableEntries.filter((entry) => !shouldReplayQueuedOperationEntry(entry));
    if (skippedSplitEntries.length > 0) {
      console.warn('[daw][project-sync-engine] skipping optimistic replay for queued SEGMENT_SPLIT operations', {
        projectId: this.projectId,
        demoId: this.demoId,
        skippedOperationIds: skippedSplitEntries.map((entry) => entry.id),
        skippedIdempotencyKeys: skippedSplitEntries.map((entry) => entry.idempotencyKey),
      });
    }

    const optimisticReplayEntries = replayableEntries.filter((entry) => shouldReplayQueuedOperationEntry(entry));

    if (optimisticReplayEntries.length === 0) {
      return false;
    }

    const baseOperationSeq = Math.max(this.getLastSeenOperationSeq(), this.state.lastSyncedOperationSeq);
    let nextProjectState = this.state.projectState;

    for (const [index, entry] of optimisticReplayEntries.entries()) {
      const rebasedRequest = rebaseTimelineEditRequest(
        nextProjectState,
        queueEntryToRebaseableRequest(entry, this.demoId),
      );
      if (!rebasedRequest) {
        continue;
      }

      const replayOperation = toReplayableAcceptedOperationRecord(
        {
          ...entry,
          operationType: rebasedRequest.operationType,
          payload: rebasedRequest.payload,
          baseSnapshotId: rebasedRequest.baseSnapshotId ?? entry.baseSnapshotId,
          baseOperationSeq: rebasedRequest.baseOperationSeq ?? entry.baseOperationSeq,
          targetTrackId: rebasedRequest.targetTrackId ?? entry.targetTrackId,
          targetSegmentId: rebasedRequest.targetSegmentId ?? entry.targetSegmentId,
          affectedTimeRange: rebasedRequest.affectedTimeRange ?? entry.affectedTimeRange,
          idempotencyKey: rebasedRequest.idempotencyKey ?? entry.idempotencyKey,
          clientOperationId: rebasedRequest.clientOperationId,
        },
        this.projectId,
        this.demoId,
        baseOperationSeq + index + 1,
      );
      nextProjectState = applyAcceptedProjectOperationWithoutHistory(nextProjectState, replayOperation);
    }

    if (nextProjectState === this.state.projectState) {
      return false;
    }

    this.setState({
      projectState: nextProjectState,
    });
    return true;
  }

  private async applyAcceptedOperation(operation: DawProjectOperationRecord) {
    const lastSeenOperationSeq = this.getLastSeenOperationSeq();
    const isDuplicateOrOlder = operation.operationSeq <= lastSeenOperationSeq;
    const previousActiveVersionId = this.state.projectState?.activeVersionId ?? null;
    const previousIsFollowingHead = this.state.projectState?.isFollowingHead ?? false;

    if (!isDuplicateOrOlder && this.state.projectState) {
      this.setState({
        projectState: {
          ...applyAcceptedProjectOperation(this.state.projectState, operation),
          lastSeenOperationSeq: Math.max(lastSeenOperationSeq, operation.operationSeq),
        },
        lastSyncedOperationSeq: Math.max(this.state.lastSyncedOperationSeq, operation.operationSeq),
      });
    }

    this.reconcileQueueForOperation(operation);

    await dawLocalCache.putAcceptedOperation(operation.projectId, operation.demoId, operation);
    await this.deletePendingOperation(operation.idempotencyKey);
    this.replayQueuedOperationsIntoProjectState();
    await this.persistProjectState();

    const nextActiveVersionId = this.state.projectState?.activeVersionId ?? null;
    const nextIsFollowingHead = this.state.projectState?.isFollowingHead ?? false;
    if (
      previousIsFollowingHead &&
      nextIsFollowingHead &&
      nextActiveVersionId &&
      nextActiveVersionId !== previousActiveVersionId
    ) {
      await this.setActiveVersion(nextActiveVersionId, { isFollowingHead: true });
    }
  }

  private async persistProjectState() {
    if (!this.projectId || !this.demoId) return;
    await dawLocalCache.putProject({
      projectId: this.projectId,
      demoId: this.demoId,
      bootstrap: this.bootstrapResponse,
      projectState: this.state.projectState ? clone(this.state.projectState) : null,
      latestAcceptedOperationSeq: this.state.lastSyncedOperationSeq,
    });

    if (this.bootstrapResponse) {
      await dawLocalCache.putPluginDefinitions(this.projectId, this.demoId, this.bootstrapResponse.pluginDefinitions);
      await Promise.all(
        this.bootstrapResponse.assets.map((asset) =>
          dawLocalCache.putAsset({
            projectId: asset.projectId,
            demoId: asset.demoId,
            assetId: asset.id,
            localBlobId: null,
            trackId: asset.trackId,
            trackVersionId: asset.trackVersionId,
            storageKey: asset.storageKey,
            blob: null,
            uploadState: 'complete',
            metadata: {
              checksum: asset.checksum,
              durationMs: asset.durationMs,
              sampleRate: asset.sampleRate,
              bitDepth: asset.bitDepth,
              channelCount: asset.channelCount,
              sizeBytes: Number(asset.sizeBytes),
              mimeType: asset.mimeType,
            },
          }),
        ),
      );
    }
  }

  private async persistPendingOperation(entry: LocalOperationQueueEntry) {
    if (!this.projectId || !this.demoId) return;
    await dawLocalCache.putPendingOperation({
      projectId: this.projectId,
      demoId: this.demoId,
      request: {
        demoId: this.demoId,
        operationType: entry.operationType as SyncableOperationType,
        payload: entry.payload as DawOperationCommitRequest['payload'],
        baseSnapshotId: entry.baseSnapshotId,
        baseOperationSeq: entry.baseOperationSeq,
        targetTrackId: entry.targetTrackId,
        targetSegmentId: entry.targetSegmentId,
        affectedTimeRange: entry.affectedTimeRange,
        idempotencyKey: entry.idempotencyKey,
        clientOperationId: entry.clientOperationId,
      } as DawOperationCommitRequest,
      status: toPersistedPendingStatus(entry.status),
      attemptCount: entry.attemptCount,
      error: entry.error,
    });
  }

  private async deletePendingOperation(idempotencyKey: string) {
    if (!this.projectId || !this.demoId) return;
    await dawLocalCache.deletePendingOperation(this.projectId, this.demoId, idempotencyKey);
  }

  private async catchUpFromServer() {
    if (!this.projectId || !this.demoId || !this.state.projectState) return false;

    const afterSeq = this.getLastSeenOperationSeq();
    const response = await fetch(
      `/api/daw/projects/${this.projectId}/operations?demoId=${this.demoId}&afterSeq=${afterSeq}`,
    );
    const data = (await response.json()) as OperationCatchUpResponse | { error?: string };

    if (!response.ok) {
      throw new Error(
        'error' in data ? data.error ?? 'Could not catch up project operations' : 'Could not catch up project operations',
      );
    }

    if ('rebootstrapRequired' in data && data.rebootstrapRequired) {
      return false;
    }

    const catchUpResponse = data as OperationCatchUpResponse;
    const operations = catchUpResponse.operations ?? [];
    if (operations.length === 0) {
      if (typeof catchUpResponse.latestSnapshotSeq === 'number' && this.state.projectState) {
        this.setState({
          projectState: {
            ...this.state.projectState,
            lastSeenOperationSeq: Math.max(
              this.getLastSeenOperationSeq(),
              catchUpResponse.latestSnapshotSeq,
            ),
          },
          lastSyncedOperationSeq: Math.max(
            this.state.lastSyncedOperationSeq,
            catchUpResponse.latestSnapshotSeq,
          ),
        });
      }
      return true;
    }

    await this.receiveAcceptedRemoteOperations(operations);
    return true;
  }

  private async rebootstrapFromServer() {
    if (!this.projectId || !this.demoId) return;

    const previousActiveVersionId = this.state.projectState?.activeVersionId ?? null;
    const bootstrapResponse = await this.fetchBootstrap();
    if (!bootstrapResponse) return;

    this.bootstrapResponse = sanitizeBootstrapResponse(bootstrapResponse);
    let bootstrappedState = createLocalProjectStateFromBootstrap(this.bootstrapResponse ?? bootstrapResponse, {
      fallbackActiveVersionId: this.state.projectState?.activeVersionId ?? null,
      fallbackIsFollowingHead: this.state.projectState?.isFollowingHead ?? null,
    });
    if (bootstrappedState) {
      bootstrappedState.tempoMetadataByTrackVersionId = {
        ...(this.state.projectState?.tempoMetadataByTrackVersionId ?? {}),
        ...bootstrappedState.tempoMetadataByTrackVersionId,
      };
    }

    const shouldReplayOperationTail = bootstrapResponse.projectState == null && bootstrapResponse.operationTail.length > 0;
    if (shouldReplayOperationTail && bootstrappedState) {
      bootstrappedState = {
        ...applyAcceptedProjectOperations(bootstrappedState, bootstrapResponse.operationTail),
      };
    }

    const bootstrapOperationSeq = Math.max(
      bootstrapResponse.latestSnapshot?.operationSeq ?? 0,
      ...bootstrapResponse.operationTail.map((operation) => operation.operationSeq),
    );
    const bootstrapOperationCreatedAt =
      bootstrapResponse.operationTail.at(-1)?.createdAt ?? bootstrapResponse.latestSnapshot?.createdAt ?? null;

    this.setState({
      projectState: bootstrappedState
        ? {
            ...clone(bootstrappedState),
            versionTreeUpdatedAt: bootstrapOperationCreatedAt ?? bootstrappedState.versionTreeUpdatedAt ?? null,
            lastVersionOperationSeq: bootstrapOperationSeq,
            lastSeenOperationSeq: bootstrapOperationSeq,
          }
        : this.state.projectState,
      baseSnapshotId: bootstrapResponse.latestSnapshot?.id ?? this.state.baseSnapshotId,
      lastSyncedOperationSeq: bootstrapOperationSeq,
    });

    await this.persistProjectState();

    const nextActiveVersionId = this.state.projectState?.activeVersionId ?? null;
    if (
      this.state.projectState?.isFollowingHead !== false &&
      nextActiveVersionId &&
      nextActiveVersionId !== previousActiveVersionId
    ) {
      await this.setActiveVersion(nextActiveVersionId, { isFollowingHead: true });
    }
  }

  private async refreshTimelineEditStateFromServer() {
    try {
      await this.rebootstrapFromServer();
    } catch {
      // Best-effort canonical refresh. We'll still reconcile the accepted op below.
    }
  }

  async bootstrap(input: ProjectSyncBootstrapInput) {
    this.projectId = input.projectId;
    this.demoId = input.demoId;
    this.closeRealtimeConnection();
    this.setState({ isBootstrapping: true, isOnline: isBrowserOnline(), lastError: null });

    const cachedProject = await dawLocalCache.getProject(input.projectId, input.demoId);
    const cachedAccepted = await dawLocalCache.listAcceptedOperations(input.projectId, input.demoId, 0);
    const cachedPending = (await dawLocalCache.listPendingOperations(input.projectId, input.demoId)).sort(
      (left, right) =>
        left.createdAt === right.createdAt
          ? left.updatedAt === right.updatedAt
            ? left.key.localeCompare(right.key)
            : left.updatedAt - right.updatedAt
          : left.createdAt - right.createdAt,
    );

    const sanitizedBootstrap = sanitizeBootstrapResponse(cachedProject?.bootstrap ?? null);
    if (sanitizedBootstrap) {
      this.bootstrapResponse = sanitizedBootstrap;
    }

    const cachedProjectState = sanitizeLocalProjectState(cachedProject?.projectState);
    const resolvedInitialCurrentVersionId =
      input.initialProjectState.currentVersionId ??
      sanitizedBootstrap?.project.currentVersionId ??
      cachedProjectState?.currentVersionId ??
      null;
    const cachedState = cachedProjectState
      ? {
          ...cachedProjectState,
          currentVersionId: resolvedInitialCurrentVersionId ?? cachedProjectState.currentVersionId,
          activeVersionId:
            input.initialProjectState.activeVersionId ??
            resolvedInitialCurrentVersionId ??
            sanitizedBootstrap?.activeVersionId ??
            cachedProjectState.activeVersionId ??
            cachedProjectState.currentVersionId ??
            null,
          isFollowingHead:
            input.initialProjectState.isFollowingHead ??
            sanitizedBootstrap?.isFollowingHead ??
            cachedProjectState.isFollowingHead ??
            true,
          versionTreeUpdatedAt:
            cachedProjectState.versionTreeUpdatedAt ??
            sanitizedBootstrap?.latestSnapshot?.createdAt ??
            null,
          lastVersionOperationSeq:
            cachedProjectState.lastVersionOperationSeq ??
            cachedProject?.latestAcceptedOperationSeq ??
            0,
          lastSeenOperationSeq:
            cachedProjectState.lastSeenOperationSeq ??
            cachedProject?.latestAcceptedOperationSeq ??
            0,
        }
      : (sanitizedBootstrap
          ? createLocalProjectStateFromBootstrap(sanitizedBootstrap, {
              fallbackActiveVersionId: input.initialProjectState.activeVersionId ?? null,
              fallbackIsFollowingHead: input.initialProjectState.isFollowingHead ?? null,
            })
          : null) ??
        input.initialProjectState;
    this.setState({
      projectState: clone(cachedState),
      baseSnapshotId: cachedProject?.bootstrap?.latestSnapshot?.id ?? null,
      lastSyncedOperationSeq: cachedProject?.latestAcceptedOperationSeq ?? 0,
      queue: {
        entries: cachedPending.map(queueEntryFromPending),
      },
    });

    if (cachedAccepted.length > 0 && this.state.projectState) {
      const cachedMaxSeq = Math.max(
        this.state.lastSyncedOperationSeq,
        ...cachedAccepted.map((operation) => operation.operationSeq),
      );
      this.setState({
        projectState: {
          ...applyAcceptedProjectOperations(this.state.projectState, cachedAccepted),
          lastSeenOperationSeq: cachedMaxSeq,
        },
        lastSyncedOperationSeq: cachedMaxSeq,
      });
    }

    this.replayQueuedOperationsIntoProjectState();
    await this.persistProjectState();

    try {
      const bootstrapResponse = await this.fetchBootstrap();
      if (bootstrapResponse) {
        this.bootstrapResponse = bootstrapResponse;
        let bootstrappedState = createLocalProjectStateFromBootstrap(bootstrapResponse, {
          fallbackActiveVersionId:
            this.state.projectState?.activeVersionId ?? input.initialProjectState.activeVersionId ?? null,
          fallbackIsFollowingHead:
            this.state.projectState?.isFollowingHead ?? input.initialProjectState.isFollowingHead ?? null,
        });
        if (bootstrappedState) {
          bootstrappedState.tempoMetadataByTrackVersionId = {
            ...(cachedProject?.projectState?.tempoMetadataByTrackVersionId ?? {}),
            ...bootstrappedState.tempoMetadataByTrackVersionId,
          };
        }
        const shouldReplayOperationTail = bootstrapResponse.projectState == null && bootstrapResponse.operationTail.length > 0;
        if (shouldReplayOperationTail && bootstrappedState) {
          bootstrappedState = {
            ...applyAcceptedProjectOperations(bootstrappedState, bootstrapResponse.operationTail),
          };
        }
        const bootstrapOperationSeq = Math.max(
          bootstrapResponse.latestSnapshot?.operationSeq ?? 0,
          ...bootstrapResponse.operationTail.map((operation) => operation.operationSeq),
        );
        const bootstrapOperationCreatedAt =
          bootstrapResponse.operationTail.at(-1)?.createdAt ?? bootstrapResponse.latestSnapshot?.createdAt ?? null;
        this.setState({
          projectState: bootstrappedState
            ? {
                ...clone(bootstrappedState),
                versionTreeUpdatedAt: bootstrapOperationCreatedAt ?? bootstrappedState.versionTreeUpdatedAt ?? null,
                lastVersionOperationSeq: bootstrapOperationSeq,
                lastSeenOperationSeq: bootstrapOperationSeq,
              }
            : this.state.projectState,
          baseSnapshotId: bootstrapResponse.latestSnapshot?.id ?? this.state.baseSnapshotId,
          lastSyncedOperationSeq: bootstrapOperationSeq,
        });
        this.replayQueuedOperationsIntoProjectState();
        await this.persistProjectState();
        this.openRealtimeConnection();
      }
    } catch (error) {
      this.setState({
        isOnline: false,
        lastError: error instanceof Error ? error.message : 'Could not bootstrap project',
      });
    } finally {
      this.setState({ isBootstrapping: false });
    }

    await this.syncPendingOperations();
  }

  async handleReconnect() {
    this.setState({ isOnline: isBrowserOnline(), lastError: null });
    try {
      const caughtUp = await this.catchUpFromServer();
      if (!caughtUp) {
        await this.rebootstrapFromServer();
      }
      this.openRealtimeConnection();
      await this.syncPendingOperations();
    } catch (error) {
      this.setState({
        isOnline: false,
        lastError: error instanceof Error ? error.message : 'Reconnect sync failed',
      });
    }
  }

  async retryFailedOperations() {
    if (!this.projectId || !this.demoId) return;
    const retryable = this.state.queue.entries.filter((entry) => entry.status === 'failed');
    for (const entry of retryable) {
      await dawLocalCache.updatePendingOperation(this.projectId, this.demoId, entry.idempotencyKey, (record) => ({
        ...record,
        status: 'retrying',
        error: null,
        updatedAt: Date.now(),
      }));
    }
    this.setState({
      queue: {
        entries: this.state.queue.entries.map((entry) =>
          entry.status === 'failed' ? { ...entry, status: 'retrying' as const, error: null } : entry,
        ),
      },
    });
    await this.syncPendingOperations();
  }

  async submitPendingOperations() {
    await this.syncPendingOperations();
  }

  async receiveAcceptedRemoteOperations(operations: DawProjectOperationRecord[]) {
    if (!this.state.projectState || !this.projectId || !this.demoId) return;
    const freshOperations = operations.filter(
      (operation) => operation.operationSeq > this.getLastSeenOperationSeq(),
    );
    if (freshOperations.length === 0) return;

    for (const operation of freshOperations) {
      await this.applyAcceptedOperation(operation);
    }
  }

  async commitOperation(request: DawOperationCommitRequest): Promise<DawProjectOperationRecord> {
    if (!this.projectId || !this.demoId) {
      return toSyntheticOperation(request, '');
    }

    const normalizedRequest: DawOperationCommitRequest = {
      ...request,
      demoId: request.demoId,
      baseSnapshotId: request.baseSnapshotId ?? this.state.baseSnapshotId ?? null,
      baseOperationSeq: request.baseOperationSeq ?? this.state.lastSyncedOperationSeq,
      idempotencyKey: request.idempotencyKey ?? generateId(),
      clientOperationId: request.clientOperationId ?? generateId(),
    } as DawOperationCommitRequest;

    const idempotencyKey = normalizedRequest.idempotencyKey ?? generateId();
    const clientOperationId = normalizedRequest.clientOperationId ?? generateId();
    const existingAccepted = await dawLocalCache.findOperationByIdempotencyKey(this.projectId, this.demoId, idempotencyKey);
    if (existingAccepted) return existingAccepted;

    const existingQueued = this.state.queue.entries.find((entry) => entry.idempotencyKey === idempotencyKey);
    if (existingQueued) {
      const queuedAccepted = await dawLocalCache.findOperationByIdempotencyKey(this.projectId, this.demoId, idempotencyKey);
      if (queuedAccepted) return queuedAccepted;
      const inFlightQueued = this.inFlightByIdempotencyKey.get(idempotencyKey);
      if (inFlightQueued) return inFlightQueued;
      return this.sendQueuedEntry(existingQueued);
    }

    const queueEntry: LocalOperationQueueEntry = {
      id: generateId(),
      operationType: request.operationType,
      payload: normalizedRequest.payload,
      baseSnapshotId: normalizedRequest.baseSnapshotId ?? null,
      baseOperationSeq: normalizedRequest.baseOperationSeq ?? 0,
      targetTrackId: normalizedRequest.targetTrackId ?? null,
      targetSegmentId: normalizedRequest.targetSegmentId ?? null,
      affectedTimeRange: normalizedRequest.affectedTimeRange ?? null,
      status: 'optimistic',
      attemptCount: 0,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      idempotencyKey,
      clientOperationId,
    };

    this.setState({
      queue: { entries: [...this.state.queue.entries, queueEntry] },
      lastError: null,
    });
    await this.persistPendingOperation(queueEntry);
    this.replayQueuedOperationsIntoProjectState();
    await this.persistProjectState();

    const sendPromise = this.sendOperationToServer({
      ...normalizedRequest,
      idempotencyKey,
      clientOperationId,
    })
      .then(async (operation) => {
        const shouldApplyAcceptedOperation =
          !(normalizedRequest.operationType === 'SEGMENT_SPLIT' && isSyntheticOperationRecord(operation));

        if (shouldApplyAcceptedOperation) {
          await this.receiveAcceptedRemoteOperations([operation]);
          if (shouldRefreshVersionTreeAfterOperation(normalizedRequest.operationType)) {
            await this.refreshTimelineEditStateFromServer();
          }
        } else {
          await this.persistProjectState();
        }

        this.setState({
          isOnline: !isSyntheticOperationRecord(operation),
          lastError: null,
        });
        return operation;
      })
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : 'Could not sync operation';
        const status = this.classifyFailure(message);
        if (status === 'rejected' || status === 'conflicted') {
          this.setState({
            queue: {
              entries: this.state.queue.entries.map((entry) =>
                entry.id === queueEntry.id ? { ...entry, status, error: message } : entry,
              ),
            },
            isOnline: isBrowserOnline(),
            lastError: message,
          });
        } else {
          this.setState({
            queue: {
              entries: this.state.queue.entries.map((entry) =>
                entry.id === queueEntry.id ? { ...entry, status: 'failed' as const, error: message, attemptCount: entry.attemptCount + 1 } : entry,
              ),
            },
            isOnline: isBrowserOnline(),
            lastError: message,
          });
        }

        await dawLocalCache.updatePendingOperation(this.projectId!, this.demoId!, idempotencyKey, (record) => ({
          ...record,
          status: status as Exclude<LocalProjectSyncOperationStatus, 'accepted'>,
          error: message,
          attemptCount: record.attemptCount + 1,
          updatedAt: Date.now(),
        }));
        if (status === 'rejected' || status === 'conflicted') {
          await this.rebootstrapFromServer();
          throw error;
        }
        await this.persistProjectState();
        return toSyntheticOperation(request, this.projectId ?? '');
      })
      .finally(() => {
        this.inFlightByIdempotencyKey.delete(idempotencyKey);
      });

    this.inFlightByIdempotencyKey.set(idempotencyKey, sendPromise);
    return sendPromise;
  }

  private async syncPendingOperations() {
    if (!this.projectId || !this.demoId) return;
    if (this.state.isSyncing) return;
    this.setState({ isSyncing: true, lastError: null });

    try {
      const pendingEntries = this.state.queue.entries.filter((entry) =>
        ['optimistic', 'pending', 'retrying', 'failed'].includes(entry.status),
      );

      for (const entry of pendingEntries) {
        if (this.inFlightByIdempotencyKey.has(entry.idempotencyKey)) continue;
        this.setState({
          queue: {
            entries: this.state.queue.entries.map((current) =>
              current.id === entry.id ? { ...current, status: 'retrying' as const } : current,
            ),
          },
        });
        await this.sendQueuedEntry(entry);
      }
    } finally {
      this.setState({ isSyncing: false });
    }
  }

  private async sendQueuedEntry(entry: LocalOperationQueueEntry): Promise<DawProjectOperationRecord> {
    if (!this.projectId || !this.demoId) {
      throw new Error('Project sync engine is not initialized');
    }
    const request: DawOperationCommitRequest = {
      demoId: this.demoId,
      operationType: entry.operationType as SyncableOperationType,
      payload: entry.payload as DawOperationCommitRequest['payload'],
      baseSnapshotId: entry.baseSnapshotId,
      baseOperationSeq: entry.baseOperationSeq,
      targetTrackId: entry.targetTrackId,
      targetSegmentId: entry.targetSegmentId,
      affectedTimeRange: entry.affectedTimeRange,
      idempotencyKey: entry.idempotencyKey,
      clientOperationId: entry.clientOperationId,
    } as DawOperationCommitRequest;

    const sendPromise = this.sendOperationToServer(request)
      .then(async (operation) => {
        const shouldApplyAcceptedOperation =
          !(request.operationType === 'SEGMENT_SPLIT' && isSyntheticOperationRecord(operation));

        if (shouldApplyAcceptedOperation) {
          await this.receiveAcceptedRemoteOperations([operation]);
          if (shouldRefreshVersionTreeAfterOperation(request.operationType)) {
            await this.refreshTimelineEditStateFromServer();
          }
        } else {
          await this.persistProjectState();
        }

        this.setState({
          isOnline: !isSyntheticOperationRecord(operation),
          lastError: null,
        });
        return operation;
      })
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : 'Could not sync operation';
        const status = this.classifyFailure(message);
        if (status === 'rejected' || status === 'conflicted') {
          this.setState({
            queue: {
              entries: this.state.queue.entries.map((queuedEntry) =>
                queuedEntry.id === entry.id ? { ...queuedEntry, status, error: message } : queuedEntry,
              ),
            },
            isOnline: isBrowserOnline(),
            lastError: message,
          });
        } else {
          this.setState({
            queue: {
              entries: this.state.queue.entries.map((queuedEntry) =>
                queuedEntry.id === entry.id
                  ? { ...queuedEntry, status: 'failed' as const, error: message, attemptCount: queuedEntry.attemptCount + 1 }
                  : queuedEntry,
              ),
            },
            isOnline: isBrowserOnline(),
            lastError: message,
          });
        }

        await dawLocalCache.updatePendingOperation(this.projectId!, this.demoId!, entry.idempotencyKey, (record) => ({
          ...record,
          status: status as Exclude<LocalProjectSyncOperationStatus, 'accepted'>,
          error: message,
          attemptCount: record.attemptCount + 1,
          updatedAt: Date.now(),
        }));
        if (status === 'rejected' || status === 'conflicted') {
          await this.rebootstrapFromServer();
          throw error;
        }
        await this.persistProjectState();
        return toSyntheticOperation(request, this.projectId!);
      })
      .finally(() => {
        this.inFlightByIdempotencyKey.delete(entry.idempotencyKey);
      });

    this.inFlightByIdempotencyKey.set(entry.idempotencyKey, sendPromise);
    return sendPromise;
  }

  private classifyFailure(message: string): LocalProjectSyncOperationStatus {
    const normalized = message.toLowerCase();
    if (normalized.includes('bounds no longer match') || normalized.includes('conflict')) {
      return 'conflicted';
    }
    if (
      normalized.includes('unauthorized') ||
      normalized.includes('not found') ||
      normalized.includes('invalid') ||
      normalized.includes('required')
    ) {
      return 'rejected';
    }
    return 'failed';
  }

  private async refreshFromServer() {
    if (!this.projectId || !this.demoId) return;
    await this.catchUpFromServer();
  }

  private async fetchBootstrap(operationSeq?: number) {
    if (!this.projectId || !this.demoId) return null;
    const query = new URLSearchParams({ demoId: this.demoId });
    if (typeof operationSeq === 'number' && Number.isFinite(operationSeq)) {
      query.set('operationSeq', String(operationSeq));
    }
    const response = await fetch(`/api/daw/projects/${this.projectId}/bootstrap?${query.toString()}`);
    const data = (await response.json()) as DawProjectBootstrapResponse | { error?: string };
    if (!response.ok) {
      throw new Error('error' in data ? data.error ?? 'Could not load project bootstrap' : 'Could not load project bootstrap');
    }
    return data as DawProjectBootstrapResponse;
  }

  async loadHistoricalProjectState(operationSeq: number) {
    if (!this.projectId || !this.demoId) return null;

    const bootstrapResponse = await this.fetchBootstrap(operationSeq);
    if (!bootstrapResponse) return null;

    const sanitizedBootstrap = sanitizeBootstrapResponse(bootstrapResponse);
    if (!sanitizedBootstrap) return null;

    const historicalState = createLocalProjectStateFromBootstrap(sanitizedBootstrap, {
      fallbackActiveVersionId: this.state.projectState?.activeVersionId ?? null,
      fallbackIsFollowingHead: this.state.projectState?.isFollowingHead ?? null,
    });

    if (this.state.projectState) {
      historicalState.tempoMetadataByTrackVersionId = {
        ...(this.state.projectState.tempoMetadataByTrackVersionId ?? {}),
        ...historicalState.tempoMetadataByTrackVersionId,
      };
    }

    return historicalState;
  }

  private async refreshVersionTreeFromServer() {
    if (!this.projectId || !this.demoId) return;
    if (!this.state.projectState) {
      await this.rebootstrapFromServer();
      return;
    }
    const caughtUp = await this.catchUpFromServer();
    if (!caughtUp) {
      await this.rebootstrapFromServer();
    }
  }

  private async sendOperationToServer(request: DawOperationCommitRequest) {
    if (!this.projectId || !this.demoId || !isBrowserOnline()) {
      return toSyntheticOperation(request, this.projectId ?? '');
    }

    const response = await fetch(`/api/daw/projects/${this.projectId}/operations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': request.idempotencyKey ?? generateId(),
      },
      body: JSON.stringify(request),
    });

    const data = (await response.json()) as
      | DawProjectOperationRecord
      | { error?: string; conflict?: { reason?: string } };
    if (!response.ok) {
      throw new Error(
        'conflict' in data && data.conflict?.reason
          ? data.conflict.reason
          : 'error' in data
            ? data.error ?? 'Could not commit operation'
            : 'Could not commit operation',
      );
    }
    return data as DawProjectOperationRecord;
  }

  dispose() {
    this.closeRealtimeConnection();
  }
}
