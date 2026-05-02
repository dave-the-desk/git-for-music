type StorageKeyInput = {
  groupId: string;
  projectId: string;
  demoId: string;
  trackId: string;
  trackVersionId: string;
  artifact?: 'original-audio' | 'derived-audio' | 'waveform' | 'analysis';
  fileName?: string;
};

function sanitizeStorageName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

export function buildTrackVersionStoragePrefix({
  groupId,
  projectId,
  demoId,
  trackId,
  trackVersionId,
}: Omit<StorageKeyInput, 'artifact' | 'fileName'>) {
  return `groups/${groupId}/projects/${projectId}/demos/${demoId}/tracks/${trackId}/versions/${trackVersionId}`;
}

export function buildTrackVersionStorageKey(input: StorageKeyInput) {
  const prefix = buildTrackVersionStoragePrefix(input);
  const artifact = input.artifact ?? 'original-audio';
  const fileName = input.fileName ? sanitizeStorageName(input.fileName) : 'audio';
  return `${prefix}/${artifact}/${fileName}`;
}
