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

function sanitizeFileName(fileName: string) {
  const normalized = sanitizeStorageSegment(fileName);
  return normalized || 'audio';
}

export function buildAudioStorageRoot({
  groupId,
  projectId,
  demoId,
  trackId,
  trackVersionId,
}: AudioStorageContext) {
  return `groups/${sanitizeStorageSegment(groupId)}/projects/${sanitizeStorageSegment(projectId)}/demos/${sanitizeStorageSegment(demoId)}/tracks/${sanitizeStorageSegment(trackId)}/versions/${sanitizeStorageSegment(trackVersionId)}`;
}

export function buildOriginalAudioObjectKey(context: AudioStorageContext, fileName: string) {
  return `${buildAudioStorageRoot(context)}/original/${sanitizeFileName(fileName)}`;
}

export function buildDerivedAudioStoragePrefix(context: AudioStorageContext, jobId: string) {
  return `${buildAudioStorageRoot(context)}/derived/${sanitizeStorageSegment(jobId)}`;
}

export function buildDerivedAudioObjectKey(
  context: AudioStorageContext,
  jobId: string,
  fileName: string,
) {
  return `${buildDerivedAudioStoragePrefix(context, jobId)}/${sanitizeFileName(fileName)}`;
}

export function buildPublicAudioUrl(baseUrl: string, objectKey: string) {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedKey = objectKey.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedKey}`;
}

export function normalizeLegacyUploadKey(storageKey: string) {
  return storageKey.replace(/^\/uploads\//, '');
}

export function toLegacyLocalUploadKey(objectKey: string) {
  const normalized = objectKey.replace(/^\/+/, '');
  return `/uploads/${normalized}`;
}
