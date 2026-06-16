import type {
  DawCommandPayload,
  DawOperationAffectedTimeRange,
  DawOperationType,
} from '@git-for-music/server/app/lib/daw/protocol';

export type LocalOperationStatus = 'pending' | 'retrying' | 'failed' | 'applied';
export type LocalProjectSyncOperationStatus =
  | 'optimistic'
  | 'pending'
  | 'retrying'
  | 'accepted'
  | 'rejected'
  | 'conflicted'
  | 'failed';

export type LocalOperationQueueEntry = {
  id: string;
  operationType: DawOperationType;
  payload: DawCommandPayload;
  baseSnapshotId: string | null;
  baseOperationSeq: number;
  targetTrackId: string | null;
  targetSegmentId: string | null;
  affectedTimeRange: DawOperationAffectedTimeRange | null;
  status: LocalOperationStatus | LocalProjectSyncOperationStatus;
  attemptCount: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  idempotencyKey: string;
  clientOperationId: string;
};

export type LocalOperationQueueState = {
  entries: LocalOperationQueueEntry[];
};

export function createLocalOperationQueue(): LocalOperationQueueState {
  return { entries: [] };
}

export function enqueueLocalOperation(
  state: LocalOperationQueueState,
  entry: Omit<LocalOperationQueueEntry, 'status' | 'attemptCount' | 'error' | 'createdAt' | 'updatedAt'>,
) {
  const now = Date.now();
  return {
    entries: [
      ...state.entries,
      {
        ...entry,
        status: 'pending' as const,
        attemptCount: 0,
        error: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function markLocalOperationApplied(state: LocalOperationQueueState, id: string) {
  return {
    entries: state.entries.map((entry) =>
      entry.id === id ? { ...entry, status: 'applied' as const, updatedAt: Date.now() } : entry,
    ),
  };
}

export function markLocalOperationAccepted(state: LocalOperationQueueState, id: string) {
  return {
    entries: state.entries.map((entry) =>
      entry.id === id ? { ...entry, status: 'accepted' as const, updatedAt: Date.now() } : entry,
    ),
  };
}

export function markLocalOperationRejected(
  state: LocalOperationQueueState,
  id: string,
  error: string,
  status: LocalProjectSyncOperationStatus = 'rejected',
) {
  return {
    entries: state.entries.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status,
            attemptCount: entry.attemptCount + 1,
            error,
            updatedAt: Date.now(),
          }
        : entry,
    ),
  };
}

export function markLocalOperationFailed(state: LocalOperationQueueState, id: string, error: string) {
  return {
    entries: state.entries.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status: 'failed' as const,
            attemptCount: entry.attemptCount + 1,
            error,
            updatedAt: Date.now(),
          }
        : entry,
    ),
  };
}

export function markLocalOperationRetrying(state: LocalOperationQueueState, id: string) {
  return {
    entries: state.entries.map((entry) =>
      entry.id === id
        ? { ...entry, status: 'retrying' as const, updatedAt: Date.now() }
        : entry,
    ),
  };
}
