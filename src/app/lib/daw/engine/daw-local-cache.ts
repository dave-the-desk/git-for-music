import type { DawProjectBootstrapResponse, DawProjectOperationRecord, DawOperationCommitRequest } from '@git-for-music/server/app/lib/daw/protocol';
import type { LocalProjectState } from '@/app/lib/daw/state/local-project-state';
import type { LocalProjectSyncOperationStatus } from '@/app/lib/daw/state/local-operation-queue';
import type { WaveformPeak } from '@/app/lib/daw/state/ui-state';

const DB_NAME = 'git-for-music-daw-local-cache';
const DB_VERSION = 1;

const STORE_NAMES = {
  projects: 'projects',
  operations: 'operations',
  pendingOperations: 'pendingOperations',
  assets: 'assets',
  waveformPeaks: 'waveformPeaks',
  pluginDefinitions: 'pluginDefinitions',
} as const;

type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

export type DawLocalCacheProjectRecord = {
  key: string;
  projectId: string;
  demoId: string;
  bootstrap: DawProjectBootstrapResponse | null;
  projectState: LocalProjectState | null;
  latestAcceptedOperationSeq: number;
  updatedAt: number;
};

export type DawLocalCacheOperationRecord = {
  key: string;
  projectId: string;
  demoId: string;
  operation: DawProjectOperationRecord;
  updatedAt: number;
};

export type DawLocalCachePendingOperationRecord = {
  key: string;
  projectId: string;
  demoId: string;
  request: DawOperationCommitRequest;
  status: Exclude<LocalProjectSyncOperationStatus, 'accepted'>;
  attemptCount: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DawLocalCacheAssetUploadState = 'queued' | 'signing' | 'uploading' | 'complete' | 'failed';

export type DawLocalCacheAssetRecord = {
  key: string;
  projectId: string;
  demoId: string;
  assetId: string | null;
  localBlobId: string | null;
  trackId: string | null;
  trackVersionId: string | null;
  storageKey: string | null;
  blob: Blob | null;
  uploadState: DawLocalCacheAssetUploadState;
  metadata: {
    checksum?: string;
    durationMs?: number;
    sampleRate?: number;
    bitDepth?: number;
    channelCount?: number;
    sizeBytes?: number;
    mimeType?: string | null;
    recordedTempoBpm?: number | null;
    sourceTempoBpm?: number | null;
  } | null;
  createdAt: number;
  updatedAt: number;
};

export type DawLocalCacheWaveformPeaksRecord = {
  key: string;
  projectId: string;
  demoId: string;
  assetId: string | null;
  localBlobId: string | null;
  durationMs: number;
  peaks: WaveformPeak[];
  sourceUrl: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DawLocalCachePluginDefinitionRecord = {
  key: string;
  projectId: string;
  demoId: string;
  pluginDefinition: DawProjectBootstrapResponse['pluginDefinitions'][number];
  updatedAt: number;
};

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

function projectKey(projectId: string, demoId: string) {
  return `${projectId}:${demoId}`;
}

function operationKey(projectId: string, demoId: string, operationSeq: number) {
  return `${projectId}:${demoId}:${operationSeq}`;
}

function pendingOperationKey(projectId: string, demoId: string, idempotencyKey: string) {
  return `${projectId}:${demoId}:${idempotencyKey}`;
}

function assetKey(projectId: string, demoId: string, assetIdOrLocalBlobId: string) {
  return `${projectId}:${demoId}:${assetIdOrLocalBlobId}`;
}

function waveformKey(projectId: string, demoId: string, assetIdOrLocalBlobId: string) {
  return `${projectId}:${demoId}:${assetIdOrLocalBlobId}`;
}

function pluginKey(projectId: string, demoId: string, pluginId: string) {
  return `${projectId}:${demoId}:${pluginId}`;
}

function normalizePendingStatus(status: LocalProjectSyncOperationStatus | 'applied'): Exclude<LocalProjectSyncOperationStatus, 'accepted'> {
  if (status === 'accepted' || status === 'applied') {
    return 'pending';
  }
  return status;
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve<IDBDatabase | null>(null);
  }

  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of Object.values(STORE_NAMES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'key' });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
) {
  const db = await openDatabase();
  if (!db) return null;

  return await new Promise<T | null>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    Promise.resolve(handler(store))
      .then((result) => {
        if (result instanceof IDBRequest) {
          result.onerror = () => reject(result.error);
          result.onsuccess = () => resolve((result.result as T | undefined) ?? null);
        } else {
          resolve(result);
        }
      })
      .catch(reject);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getAll<T>(storeName: StoreName) {
  const db = await openDatabase();
  if (!db) return [];

  return await new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as T[] | undefined) ?? []);
  });
}

export class DawLocalCache {
  async getProject(projectId: string, demoId: string) {
    const key = projectKey(projectId, demoId);
    return (await withStore<DawLocalCacheProjectRecord>(STORE_NAMES.projects, 'readonly', (store) => store.get(key))) ?? null;
  }

  async putProject(record: Omit<DawLocalCacheProjectRecord, 'key' | 'updatedAt'>) {
    const value: DawLocalCacheProjectRecord = {
      ...clone(record),
      key: projectKey(record.projectId, record.demoId),
      updatedAt: Date.now(),
    };
    await withStore(STORE_NAMES.projects, 'readwrite', (store) => store.put(value));
  }

  async putAcceptedOperation(projectId: string, demoId: string, operation: DawProjectOperationRecord) {
    const value: DawLocalCacheOperationRecord = {
      key: operationKey(projectId, demoId, operation.operationSeq),
      projectId,
      demoId,
      operation: clone(operation),
      updatedAt: Date.now(),
    };
    await withStore(STORE_NAMES.operations, 'readwrite', (store) => store.put(value));
  }

  async listAcceptedOperations(projectId: string, demoId: string, afterSeq = 0) {
    const all = await getAll<DawLocalCacheOperationRecord>(STORE_NAMES.operations);
    return all
      .filter((record) => record.projectId === projectId && record.demoId === demoId && record.operation.operationSeq > afterSeq)
      .sort((left, right) => left.operation.operationSeq - right.operation.operationSeq)
      .map((record) => clone(record.operation));
  }

  async findOperationByIdempotencyKey(projectId: string, demoId: string, idempotencyKey: string) {
    const all = await getAll<DawLocalCacheOperationRecord>(STORE_NAMES.operations);
    const found = all.find(
      (record) =>
        record.projectId === projectId &&
        record.demoId === demoId &&
        record.operation.idempotencyKey === idempotencyKey,
    );
    return found ? clone(found.operation) : null;
  }

  async putPendingOperation(record: Omit<DawLocalCachePendingOperationRecord, 'key' | 'createdAt' | 'updatedAt'>) {
    const value: DawLocalCachePendingOperationRecord = {
      ...clone(record),
      key: pendingOperationKey(record.projectId, record.demoId, record.request.idempotencyKey ?? record.request.clientOperationId ?? crypto.randomUUID()),
      status: normalizePendingStatus(record.status),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await withStore(STORE_NAMES.pendingOperations, 'readwrite', (store) => store.put(value));
  }

  async updatePendingOperation(
    projectId: string,
    demoId: string,
    idempotencyKey: string,
    updater: (record: DawLocalCachePendingOperationRecord) => DawLocalCachePendingOperationRecord,
  ) {
    const key = pendingOperationKey(projectId, demoId, idempotencyKey);
    const current = (await withStore<DawLocalCachePendingOperationRecord>(
      STORE_NAMES.pendingOperations,
      'readonly',
      (store) => store.get(key),
    )) ?? null;
    if (!current) return null;
    const next = updater(clone(current));
    await withStore(STORE_NAMES.pendingOperations, 'readwrite', (store) => store.put(next));
    return next;
  }

  async deletePendingOperation(projectId: string, demoId: string, idempotencyKey: string) {
    const key = pendingOperationKey(projectId, demoId, idempotencyKey);
    await withStore(STORE_NAMES.pendingOperations, 'readwrite', (store) => store.delete(key));
  }

  async listPendingOperations(projectId: string, demoId: string) {
    const all = await getAll<DawLocalCachePendingOperationRecord>(STORE_NAMES.pendingOperations);
    return all.filter((record) => record.projectId === projectId && record.demoId === demoId);
  }

  async putAsset(record: Omit<DawLocalCacheAssetRecord, 'key' | 'createdAt' | 'updatedAt'> & { key?: string }) {
    const identifier = record.assetId ?? record.localBlobId;
    if (!identifier) {
      throw new Error('assetId or localBlobId is required');
    }

    const value: DawLocalCacheAssetRecord = {
      ...clone(record),
      key: record.key ?? assetKey(record.projectId, record.demoId, identifier),
      createdAt: 'createdAt' in record && typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
      updatedAt: Date.now(),
    };
    await withStore(STORE_NAMES.assets, 'readwrite', (store) => store.put(value));
    return value;
  }

  async updateAsset(
    projectId: string,
    demoId: string,
    assetIdOrLocalBlobId: string,
    updater: (record: DawLocalCacheAssetRecord) => DawLocalCacheAssetRecord,
  ) {
    const key = assetKey(projectId, demoId, assetIdOrLocalBlobId);
    const current = (await withStore<DawLocalCacheAssetRecord>(STORE_NAMES.assets, 'readonly', (store) => store.get(key))) ?? null;
    if (!current) return null;
    const next = updater(clone(current));
    next.updatedAt = Date.now();
    await withStore(STORE_NAMES.assets, 'readwrite', (store) => store.put(next));
    return next;
  }

  async getAsset(projectId: string, demoId: string, assetIdOrLocalBlobId: string) {
    const key = assetKey(projectId, demoId, assetIdOrLocalBlobId);
    return (await withStore<DawLocalCacheAssetRecord>(STORE_NAMES.assets, 'readonly', (store) => store.get(key))) ?? null;
  }

  async listAssets(projectId: string, demoId: string) {
    const all = await getAll<DawLocalCacheAssetRecord>(STORE_NAMES.assets);
    return all.filter((record) => record.projectId === projectId && record.demoId === demoId).map(clone);
  }

  async deleteAsset(projectId: string, demoId: string, assetIdOrLocalBlobId: string) {
    const key = assetKey(projectId, demoId, assetIdOrLocalBlobId);
    await withStore(STORE_NAMES.assets, 'readwrite', (store) => store.delete(key));
  }

  async putWaveformPeaks(record: Omit<DawLocalCacheWaveformPeaksRecord, 'key' | 'createdAt' | 'updatedAt'>) {
    const identifier = record.assetId ?? record.localBlobId;
    if (!identifier) {
      throw new Error('assetId or localBlobId is required');
    }

    const value: DawLocalCacheWaveformPeaksRecord = {
      ...clone(record),
      key: waveformKey(record.projectId, record.demoId, identifier),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await withStore(STORE_NAMES.waveformPeaks, 'readwrite', (store) => store.put(value));
    return value;
  }

  async getWaveformPeaks(projectId: string, demoId: string, assetIdOrLocalBlobId: string) {
    const key = waveformKey(projectId, demoId, assetIdOrLocalBlobId);
    return (await withStore<DawLocalCacheWaveformPeaksRecord>(
      STORE_NAMES.waveformPeaks,
      'readonly',
      (store) => store.get(key),
    )) ?? null;
  }

  async deleteWaveformPeaks(projectId: string, demoId: string, assetIdOrLocalBlobId: string) {
    const key = waveformKey(projectId, demoId, assetIdOrLocalBlobId);
    await withStore(STORE_NAMES.waveformPeaks, 'readwrite', (store) => store.delete(key));
  }

  async putPluginDefinitions(
    projectId: string,
    demoId: string,
    pluginDefinitions: DawProjectBootstrapResponse['pluginDefinitions'],
  ) {
    const records: DawLocalCachePluginDefinitionRecord[] = pluginDefinitions.map((pluginDefinition) => ({
      key: pluginKey(projectId, demoId, pluginDefinition.id),
      projectId,
      demoId,
      pluginDefinition: clone(pluginDefinition),
      updatedAt: Date.now(),
    }));

    const db = await openDatabase();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAMES.pluginDefinitions, 'readwrite');
      const store = transaction.objectStore(STORE_NAMES.pluginDefinitions);
      for (const record of records) {
        store.put(record);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async listPluginDefinitions(projectId: string, demoId: string) {
    const all = await getAll<DawLocalCachePluginDefinitionRecord>(STORE_NAMES.pluginDefinitions);
    return all
      .filter((record) => record.projectId === projectId && record.demoId === demoId)
      .map((record) => clone(record.pluginDefinition));
  }
}

export const dawLocalCache = new DawLocalCache();
