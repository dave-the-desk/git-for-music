export interface AudioStorageContext {
  groupId: string;
  projectId: string;
  demoId: string;
  trackId: string;
  trackVersionId: string;
}

export interface PresignedAudioUrlInput extends AudioStorageContext {
  objectKey: string;
  contentType?: string;
  expiresInSeconds?: number;
}

export interface AudioStorageService {
  createPresignedUploadUrl(input: PresignedAudioUrlInput): Promise<string>;
  createPresignedDownloadUrl(input: PresignedAudioUrlInput): Promise<string>;
}

function sanitizeStorageSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

function sanitizeAssetName(value: string) {
  const normalized = sanitizeStorageSegment(value);
  return normalized || 'asset';
}

export function buildAudioStorageRoot({
  projectId,
  demoId,
  trackId,
  trackVersionId,
}: AudioStorageContext) {
  return `projects/${sanitizeStorageSegment(projectId)}/demos/${sanitizeStorageSegment(demoId)}/tracks/${sanitizeStorageSegment(trackId)}/versions/${sanitizeStorageSegment(trackVersionId)}`;
}

function getAssetExtension(fileNameOrExtension?: string, fallback = '.wav') {
  if (!fileNameOrExtension) return fallback;
  const dotIndex = fileNameOrExtension.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileNameOrExtension.length - 1) {
    return fallback;
  }

  const extension = fileNameOrExtension.slice(dotIndex);
  return /^\.[a-zA-Z0-9]+$/.test(extension) ? extension : fallback;
}

function buildVersionAssetKey(
  context: AudioStorageContext,
  prefix: 'originals' | 'derived' | 'peaks' | 'transcripts' | 'stems',
  assetId: string,
  fileNameOrExtension?: string,
  fallbackExtension = '.wav',
) {
  const extension = getAssetExtension(fileNameOrExtension, fallbackExtension);
  return `${buildAudioStorageRoot(context)}/${prefix}/${sanitizeAssetName(assetId)}${extension}`;
}

export function buildOriginalAudioObjectKey(
  context: AudioStorageContext,
  assetId: string,
  fileName?: string,
) {
  return buildVersionAssetKey(context, 'originals', assetId, fileName, '.wav');
}

export function buildDerivedAudioStoragePrefix(context: AudioStorageContext, assetId: string) {
  return `${buildAudioStorageRoot(context)}/derived/${sanitizeAssetName(assetId)}`;
}

export function buildPeaksAudioStoragePrefix(context: AudioStorageContext) {
  return `${buildAudioStorageRoot(context)}/peaks`;
}

export function buildTranscriptAudioStoragePrefix(context: AudioStorageContext) {
  return `${buildAudioStorageRoot(context)}/transcripts`;
}

export function buildStemAudioStoragePrefix(context: AudioStorageContext) {
  return `${buildAudioStorageRoot(context)}/stems`;
}

export function buildAnalysisStoragePrefix(input: { projectId: string; demoId: string }) {
  return `projects/${sanitizeStorageSegment(input.projectId)}/demos/${sanitizeStorageSegment(input.demoId)}/analysis`;
}

export function buildDerivedAudioObjectKey(
  context: AudioStorageContext,
  assetId: string,
  fileName?: string,
) {
  return buildVersionAssetKey(context, 'derived', assetId, fileName, '.wav');
}

export function buildPeaksAudioObjectKey(context: AudioStorageContext, assetId: string) {
  return `${buildPeaksAudioStoragePrefix(context)}/${sanitizeAssetName(assetId)}.json`;
}

export function buildTranscriptAudioObjectKey(context: AudioStorageContext, assetId: string) {
  return `${buildTranscriptAudioStoragePrefix(context)}/${sanitizeAssetName(assetId)}.json`;
}

export function buildStemAudioObjectKey(context: AudioStorageContext, assetId: string, fileName?: string) {
  return `${buildStemAudioStoragePrefix(context)}/${sanitizeAssetName(assetId)}${getAssetExtension(fileName, '.wav')}`;
}

export function buildAnalysisObjectKey(input: { projectId: string; demoId: string }, jobId: string) {
  return `${buildAnalysisStoragePrefix(input)}/${sanitizeAssetName(jobId)}.json`;
}

export function buildTrackVersionAudioUrl(trackVersionId: string) {
  return `/api/daw/track-versions/${encodeURIComponent(trackVersionId)}/audio`;
}

export function buildPublicAudioUrl(baseUrl: string, objectKey: string) {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedKey = objectKey.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedKey}`;
}

export function normalizeLegacyUploadKey(storageKey: string) {
  return storageKey.replace(/^\/uploads\//, '').replace(/^\/+/, '');
}

export function toLegacyLocalUploadKey(objectKey: string) {
  const normalized = objectKey.replace(/^\/+/, '');
  return `/uploads/${normalized}`;
}
