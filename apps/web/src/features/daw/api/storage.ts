import {
  buildAudioStorageRoot,
  buildDerivedAudioObjectKey,
  buildDerivedAudioStoragePrefix,
  buildOriginalAudioObjectKey,
  type AudioStorageContext,
} from '@git-for-music/shared';

type StorageKeyInput = AudioStorageContext & {
  fileName?: string;
};

export function buildTrackVersionStoragePrefix({
  groupId,
  projectId,
  demoId,
  trackId,
  trackVersionId,
}: Omit<StorageKeyInput, 'fileName'>) {
  return buildAudioStorageRoot({
    groupId,
    projectId,
    demoId,
    trackId,
    trackVersionId,
  });
}

export function buildTrackVersionObjectKey(input: StorageKeyInput) {
  return buildOriginalAudioObjectKey(input, input.fileName ?? 'audio');
}

export function buildTrackVersionStorageKey(input: StorageKeyInput) {
  return buildTrackVersionObjectKey(input);
}

export function buildTrackVersionLegacyStorageKey(input: StorageKeyInput) {
  return `/uploads/${buildTrackVersionObjectKey(input)}`;
}

export function buildTrackVersionDerivedStoragePrefix(
  input: Omit<StorageKeyInput, 'fileName'>,
  jobId: string,
) {
  return buildDerivedAudioStoragePrefix(input, jobId);
}

export function buildTrackVersionDerivedObjectKey(
  input: StorageKeyInput,
  jobId: string,
) {
  return buildDerivedAudioObjectKey(input, jobId, input.fileName ?? 'audio');
}
