import type {
  DawOperationCommitRequest,
  DawOperationType,
  DawProjectBootstrapResponse,
  DawProjectOperationRecord,
} from '@/features/daw/protocol';
import { dawLocalCache } from '@/features/daw/engine/daw-local-cache';
import {
  applyAcceptedProjectOperation,
  applyAcceptedProjectOperations,
  createLocalProjectStateFromBootstrap,
} from '@/features/daw/state/operation-reducer';
import {
  createLocalOperationQueue,
  type LocalOperationQueueEntry,
  type LocalOperationQueueState,
  type LocalProjectSyncOperationStatus,
} from '@/features/daw/state/local-operation-queue';
import type {
  LocalProjectState,
  TempoMetadataEntry,
  TrackRecordingTake,
} from '@/features/daw/state/local-project-state';

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
};

type RealtimeAcceptedOperationEvent = {
  type: 'accepted_operation';
  projectId: string;
  demoId: string;
  createdAt: string;
  operation: DawProjectOperationRecord;
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

export type ProjectSyncBootstrapInput = {
  projectId: string;
  demoId: string;
  initialProjectState: LocalProjectState;
};

export type ProjectSyncOperationListener = (state: ProjectSyncSnapshot) => void;
export type ProjectSyncAssetStatusListener = (event: RealtimeAssetProcessingStatusEvent) => void;

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

function generateId() {
  return crypto.randomUUID();
}

function isBrowserOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function toSyntheticOperation(
  request: DawOperationCommitRequest,
  projectId: string,
): DawProjectOperationRecord {
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

function toPersistedPendingStatus(status: LocalOperationQueueEntry['status']) {
  if (status === 'accepted' || status === 'applied') {
    return 'pending' as const;
  }
  return status as Exclude<LocalProjectSyncOperationStatus, 'accepted'>;
}

export class ProjectSyncEngine {
  private readonly listeners = new Set<ProjectSyncOperationListener>();
  private readonly assetStatusListeners = new Set<ProjectSyncAssetStatusListener>();
  private readonly inFlightByIdempotencyKey = new Map<string, Promise<DawProjectOperationRecord>>();
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

  getState() {
    return this.state;
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

  async upsertTrackRecordingTake(
    trackId: string,
    take: LocalProjectState['recordingTakesByTrackId'][string][number],
  ) {
    if (!this.state.projectState) return;

    const currentTakesByTrackId = this.state.projectState.recordingTakesByTrackId ?? {};
    const currentTakes = currentTakesByTrackId[trackId] ?? [];
    const nextTakes = [...currentTakes.filter((entry) => entry.id !== take.id), take];
    this.setState({
      projectState: {
        ...this.state.projectState,
        recordingTakesByTrackId: {
          ...currentTakesByTrackId,
          [trackId]: nextTakes,
        },
      },
    });
    await this.persistProjectState();
  }

  async setTrackRecordingTakes(trackId: string, takes: TrackRecordingTake[]) {
    if (!this.state.projectState) return;

    const currentTakesByTrackId = this.state.projectState.recordingTakesByTrackId ?? {};
    this.setState({
      projectState: {
        ...this.state.projectState,
        recordingTakesByTrackId: {
          ...currentTakesByTrackId,
          [trackId]: takes,
        },
      },
    });
    await this.persistProjectState();
  }

  async removeTrackRecordingTake(trackId: string, takeId: string) {
    if (!this.state.projectState) return;

    const currentTakesByTrackId = this.state.projectState.recordingTakesByTrackId ?? {};
    const currentTakes = currentTakesByTrackId[trackId] ?? [];
    const nextTakes = currentTakes.filter((entry) => entry.id !== takeId);
    this.setState({
      projectState: {
        ...this.state.projectState,
        recordingTakesByTrackId: {
          ...currentTakesByTrackId,
          [trackId]: nextTakes,
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
  }

  private readonly handleRealtimeAcceptedOperation = async (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as RealtimeAcceptedOperationEvent;
      if (payload.type !== 'accepted_operation') return;
      if (payload.projectId !== this.projectId || payload.demoId !== this.demoId) return;
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
      for (const listener of this.assetStatusListeners) {
        listener(payload);
      }
    } catch {
      // Realtime asset state is best-effort too.
    }
  };

  private openRealtimeConnection() {
    if (!this.projectId || !this.demoId) return;

    this.closeRealtimeConnection();

    const source = new EventSource(
      `/api/daw/projects/${this.projectId}/realtime?demoId=${this.demoId}&afterSeq=${this.state.lastSyncedOperationSeq}`,
    );

    source.addEventListener('open', () => {
      this.setState({ isOnline: true, lastError: null });
    });

    source.addEventListener('accepted_operation', (event) => {
      void this.handleRealtimeAcceptedOperation(event as MessageEvent<string>);
    });
    source.addEventListener('asset_processing_status', (event) => {
      this.handleRealtimeAssetStatus(event as MessageEvent<string>);
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

  async bootstrap(input: ProjectSyncBootstrapInput) {
    this.projectId = input.projectId;
    this.demoId = input.demoId;
    this.closeRealtimeConnection();
    this.setState({ isBootstrapping: true, isOnline: isBrowserOnline(), lastError: null });

    const cachedProject = await dawLocalCache.getProject(input.projectId, input.demoId);
    const cachedAccepted = await dawLocalCache.listAcceptedOperations(input.projectId, input.demoId, 0);
    const cachedPending = await dawLocalCache.listPendingOperations(input.projectId, input.demoId);

    if (cachedProject?.bootstrap) {
      this.bootstrapResponse = clone(cachedProject.bootstrap);
    }

    const cachedState =
      cachedProject?.projectState ??
      (cachedProject?.bootstrap ? createLocalProjectStateFromBootstrap(cachedProject.bootstrap) : null) ??
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
      this.setState({
        projectState: applyAcceptedProjectOperations(this.state.projectState, cachedAccepted),
        lastSyncedOperationSeq: Math.max(
          this.state.lastSyncedOperationSeq,
          ...cachedAccepted.map((operation) => operation.operationSeq),
        ),
      });
    }

    try {
      const bootstrapResponse = await this.fetchBootstrap();
      if (bootstrapResponse) {
        this.bootstrapResponse = bootstrapResponse;
        const bootstrappedState = createLocalProjectStateFromBootstrap(bootstrapResponse);
        if (bootstrappedState) {
          bootstrappedState.tempoMetadataByTrackVersionId = {
            ...(cachedProject?.projectState?.tempoMetadataByTrackVersionId ?? {}),
            ...bootstrappedState.tempoMetadataByTrackVersionId,
          };
          bootstrappedState.recordingTakesByTrackId = {
            ...(cachedProject?.projectState?.recordingTakesByTrackId ?? {}),
            ...bootstrappedState.recordingTakesByTrackId,
          };
        }
        this.setState({
          projectState: bootstrappedState ? clone(bootstrappedState) : this.state.projectState,
          baseSnapshotId: bootstrapResponse.latestSnapshot?.id ?? this.state.baseSnapshotId,
          lastSyncedOperationSeq: bootstrapResponse.latestSnapshot?.operationSeq ?? this.state.lastSyncedOperationSeq,
        });
        if (bootstrapResponse.operationTail.length > 0 && this.state.projectState) {
          this.setState({
            projectState: applyAcceptedProjectOperations(this.state.projectState, bootstrapResponse.operationTail),
          });
        }
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
      (operation) => operation.operationSeq > this.state.lastSyncedOperationSeq,
    );
    if (freshOperations.length === 0) return;

    for (const operation of freshOperations) {
      await dawLocalCache.putAcceptedOperation(operation.projectId, operation.demoId, operation);
    }

    this.setState({
      projectState: applyAcceptedProjectOperations(this.state.projectState, freshOperations),
      lastSyncedOperationSeq: Math.max(
        this.state.lastSyncedOperationSeq,
        ...freshOperations.map((operation) => operation.operationSeq),
      ),
      queue: {
        entries: this.state.queue.entries.map((entry) => {
          const accepted = freshOperations.find(
            (operation) =>
              operation.idempotencyKey === entry.idempotencyKey ||
              operation.clientOperationId === entry.clientOperationId,
          );
          if (!accepted) return entry;
          return {
            ...entry,
            status: 'accepted' as const,
            error: null,
            updatedAt: Date.now(),
          };
        }),
      },
    });

    for (const operation of freshOperations) {
      await this.deletePendingOperation(operation.idempotencyKey);
    }

    await this.persistProjectState();
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

    const sendPromise = this.sendOperationToServer({
      ...normalizedRequest,
      idempotencyKey,
      clientOperationId,
    })
      .then(async (operation) => {
        this.setState({
          projectState: this.state.projectState
            ? applyAcceptedProjectOperation(this.state.projectState, operation)
            : this.state.projectState,
          lastSyncedOperationSeq: Math.max(this.state.lastSyncedOperationSeq, operation.operationSeq),
          queue: {
            entries: this.state.queue.entries.map((entry) =>
              entry.id === queueEntry.id ? { ...entry, status: 'accepted' as const, error: null } : entry,
            ),
          },
          isOnline: true,
          lastError: null,
        });
        await dawLocalCache.putAcceptedOperation(operation.projectId, operation.demoId, operation);
        await this.deletePendingOperation(idempotencyKey);
        await this.persistProjectState();
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
        await this.persistProjectState();
        if (status === 'rejected' || status === 'conflicted') {
          throw error;
        }
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

  private async sendQueuedEntry(entry: LocalOperationQueueEntry) {
    if (!this.projectId || !this.demoId) return;
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
    return this.commitOperation(request);
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
    const response = await fetch(`/api/daw/projects/${this.projectId}/operations?demoId=${this.demoId}&afterSeq=${this.state.lastSyncedOperationSeq}`);
    const data = (await response.json()) as { operations?: DawProjectOperationRecord[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? 'Could not load remote operations');
    }

    await this.receiveAcceptedRemoteOperations(data.operations ?? []);
  }

  private async fetchBootstrap() {
    if (!this.projectId || !this.demoId) return null;
    const response = await fetch(`/api/daw/projects/${this.projectId}/bootstrap?demoId=${this.demoId}`);
    const data = (await response.json()) as DawProjectBootstrapResponse | { error?: string };
    if (!response.ok) {
      throw new Error('error' in data ? data.error ?? 'Could not load project bootstrap' : 'Could not load project bootstrap');
    }
    return data as DawProjectBootstrapResponse;
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
