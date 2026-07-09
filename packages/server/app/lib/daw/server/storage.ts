import {
  buildAnalysisObjectKey,
  buildAudioStorageRoot,
  buildDerivedAudioObjectKey,
  buildDerivedAudioStoragePrefix,
  buildOriginalAudioObjectKey,
  buildPeaksAudioObjectKey,
  buildStemAudioObjectKey,
  buildTranscriptAudioObjectKey,
  type AudioStorageContext,
} from '@git-for-music/shared';

type StorageKeyInput = AudioStorageContext & {
  assetId?: string;
  fileName?: string;
  jobId?: string;
};

function sanitizeStorageSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

function sanitizePluginSegment(value: string) {
  const normalized = sanitizeStorageSegment(value);
  return normalized || 'plugin';
}

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
  return buildOriginalAudioObjectKey(input, input.assetId ?? input.trackVersionId, input.fileName);
}

export function buildTrackVersionStorageKey(input: StorageKeyInput) {
  return `/${buildTrackVersionObjectKey(input)}`;
}

export function buildTrackVersionLegacyStorageKey(input: StorageKeyInput) {
  return `/uploads/${buildTrackVersionObjectKey(input)}`;
}

export function buildTrackVersionDerivedStoragePrefix(
  input: Omit<StorageKeyInput, 'fileName'>,
  assetId: string,
) {
  return buildDerivedAudioStoragePrefix(input, assetId);
}

export function buildTrackVersionDerivedObjectKey(
  input: StorageKeyInput,
  assetId: string,
) {
  return buildDerivedAudioObjectKey(input, assetId, input.fileName);
}

export function buildTrackVersionPeaksObjectKey(input: StorageKeyInput) {
  return buildPeaksAudioObjectKey(input, input.assetId ?? input.trackVersionId);
}

export function buildTrackVersionTranscriptObjectKey(input: StorageKeyInput) {
  return buildTranscriptAudioObjectKey(input, input.assetId ?? input.trackVersionId);
}

export function buildTrackVersionStemObjectKey(input: StorageKeyInput) {
  return buildStemAudioObjectKey(input, input.assetId ?? input.trackVersionId, input.fileName);
}

export function buildDemoAnalysisObjectKey(input: Pick<StorageKeyInput, 'projectId' | 'demoId'>, jobId: string) {
  return buildAnalysisObjectKey(input, jobId);
}

export function buildPluginStoragePrefix(input: {
  ownerId: string;
  pluginId: string;
  version: string;
}) {
  return `plugins/${sanitizePluginSegment(input.ownerId)}/${sanitizePluginSegment(input.pluginId)}/${sanitizePluginSegment(input.version)}`;
}

export function buildPluginModuleObjectKey(input: {
  ownerId: string;
  pluginId: string;
  version: string;
  fileName: string;
}) {
  const fileName = sanitizePluginSegment(input.fileName);
  return `${buildPluginStoragePrefix(input)}/${fileName}`;
}

export function buildPluginBundlePrefix(input: {
  ownerId: string;
  pluginId: string;
  version: string;
}) {
  return buildPluginStoragePrefix(input);
}
