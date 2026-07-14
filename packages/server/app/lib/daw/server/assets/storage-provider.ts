import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  buildOriginalAudioObjectKey,
  normalizeLegacyUploadKey,
  type AudioStorageContext,
} from '@git-for-music/shared';
import { getConfig } from '@git-for-music/shared';
import { buildTrackVersionObjectKey } from '@/app/lib/daw/server/storage';
import {
  getStorageProvider,
  setStorageProvider,
  type StorageProvider,
} from '../../../extensions';

type AssetUploadIntent = AudioStorageContext & {
  userId: string;
  objectKey?: string;
  projectId: string;
  demoId: string;
  trackId?: string | null;
  trackVersionId?: string | null;
  name?: string | null;
  sourceVersionId?: string | null;
  sourceType?: 'recording' | 'upload';
  timingChoice?: 'keepProjectTempo' | 'updateProjectTempoFromUpload' | 'uploadUnchanged' | null;
  createTrack?: boolean;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  assetId?: string;
  expiresAt?: string;
};

type VerifiedAssetUploadToken = AssetUploadIntent & {
  objectKey: string;
  assetId: string;
  expiresAt: string;
};

type ObjectStorageConfig = {
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicUrl: URL;
  internalUrl: URL;
};

const S3_SERVICE = 's3';

function getTokenSecret() {
  const config = getConfig();
  return (
    config.secrets.dawAssetUploadTokenSecret ||
    config.secrets.nextAuthSecret ||
    'dev-only-daw-asset-token-secret'
  );
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function hmac(key: Buffer | string, data: string) {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: string) {
  return createHash('sha256').update(data).digest('hex');
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQueryString(params: URLSearchParams) {
  return Array.from(params.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string) {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function getObjectStorageConfig(): ObjectStorageConfig | null {
  const config = getConfig();
  if (!config.objectStorage) {
    return null;
  }

  return {
    bucketName: config.objectStorage.bucketName,
    accessKeyId: config.objectStorage.accessKeyId,
    secretAccessKey: config.objectStorage.secretAccessKey,
    region: config.objectStorage.region,
    publicUrl: new URL(config.objectStorage.publicUrl),
    internalUrl: new URL(config.objectStorage.internalUrl),
  };
}

function assertObjectStorageConfig() {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error(
      'Object storage is not configured. Set OBJECT_STORAGE_* env vars and run MinIO or another S3-compatible store.',
    );
  }

  return config;
}

function getTimestampParts(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: `${iso.slice(0, 15)}Z`,
    dateStamp: iso.slice(0, 8),
  };
}

function buildObjectUrl(endpoint: URL, bucketName: string, objectKey: string) {
  const url = new URL(endpoint.toString());
  url.pathname = `/${bucketName}/${objectKey
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/')}`;
  url.search = '';
  url.hash = '';
  return url;
}

async function createSignedUploadUrl(
  input: {
    objectKey: string;
    contentType: string;
    method: 'PUT' | 'GET' | 'HEAD';
    expiresInSeconds?: number;
  },
) {
  const config = assertObjectStorageConfig();
  return {
    url: signPresignedUrl(config, config.publicUrl, input.method, input.objectKey, input.expiresInSeconds ?? 900),
    expiresAt: new Date(Date.now() + (input.expiresInSeconds ?? 900) * 1000).toISOString(),
    localFallback: false,
  };
}

async function createSignedDownloadUrl(input: {
  objectKey: string;
  contentType?: string;
  expiresInSeconds?: number;
}) {
  const config = assertObjectStorageConfig();
  const objectKey = normalizeLegacyUploadKey(input.objectKey);

  return {
    url: signPresignedUrl(config, config.publicUrl, 'GET', objectKey, input.expiresInSeconds ?? 900),
    expiresAt: new Date(Date.now() + (input.expiresInSeconds ?? 900) * 1000).toISOString(),
    localFallback: false,
  };
}

async function deleteObject(objectKey: string) {
  const config = assertObjectStorageConfig();
  const normalizedObjectKey = normalizeLegacyUploadKey(objectKey);
  const deleteUrl = signPresignedUrl(config, config.internalUrl, 'DELETE', normalizedObjectKey, 60);
  await fetch(deleteUrl, { method: 'DELETE' });
}

async function getObjectStream(objectKey: string) {
  const config = assertObjectStorageConfig();
  const normalizedObjectKey = normalizeLegacyUploadKey(objectKey);
  const downloadUrl = signPresignedUrl(config, config.internalUrl, 'GET', normalizedObjectKey, 60);
  const response = await fetch(downloadUrl, { method: 'GET' });
  if (!response.ok) {
    return null;
  }

  return response.body;
}

export const defaultStorageProvider: StorageProvider = {
  createSignedUploadUrl,
  createSignedDownloadUrl,
  deleteObject,
  getObjectStream,
};

setStorageProvider(defaultStorageProvider);

export function signPresignedUrl(
  config: ObjectStorageConfig,
  endpoint: URL,
  method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
  objectKey: string,
  expiresInSeconds = 900,
) {
  const { amzDate, dateStamp } = getTimestampParts();
  const url = buildObjectUrl(endpoint, config.bucketName, objectKey);
  const credentialScope = `${dateStamp}/${config.region}/${S3_SERVICE}/aws4_request`;
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQueryString(params),
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(config.secretAccessKey, dateStamp, config.region, S3_SERVICE);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  params.set('X-Amz-Signature', signature);

  return `${url.toString()}?${params.toString()}`;
}

async function putObjectToStorage(
  config: ObjectStorageConfig,
  objectKey: string,
  rawBuffer: Buffer,
  contentType: string,
) {
  const uploadUrl = signPresignedUrl(config, config.internalUrl, 'PUT', objectKey, 900);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': contentType,
    },
    body: new Uint8Array(rawBuffer),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(
      `Failed to upload asset to object storage (${response.status} ${response.statusText})${responseText ? `: ${responseText}` : ''}`,
    );
  }
}

export function isRemoteAssetStorageConfigured() {
  return Boolean(getObjectStorageConfig());
}

export function signAssetUploadToken(input: AssetUploadIntent) {
  const payload = {
    ...input,
    assetId: input.assetId ?? randomUUID(),
    expiresAt: input.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', getTokenSecret()).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyAssetUploadToken(token: string) {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = createHmac('sha256', getTokenSecret()).update(encodedPayload).digest('base64url');
  if (expected !== signature) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<VerifiedAssetUploadToken>;
    if (
      typeof payload.objectKey !== 'string' ||
      !payload.objectKey ||
      typeof payload.assetId !== 'string' ||
      !payload.assetId ||
      typeof payload.expiresAt !== 'string' ||
      !payload.expiresAt
    ) {
      return null;
    }

    if (Date.now() > Date.parse(payload.expiresAt)) {
      return null;
    }

    return payload as VerifiedAssetUploadToken;
  } catch {
    return null;
  }
}

export async function storeTrackUploadAsset(input: {
  groupId: string;
  projectId: string;
  demoId: string;
  trackId: string;
  trackVersionId: string;
  assetId: string;
  fileName: string;
  contentType: string;
  rawBuffer: Buffer;
}) {
  const config = assertObjectStorageConfig();
  const storageObjectKey = buildTrackVersionObjectKey({
    groupId: input.groupId,
    projectId: input.projectId,
    demoId: input.demoId,
    trackId: input.trackId,
    trackVersionId: input.trackVersionId,
    assetId: input.assetId,
    fileName: input.fileName,
  });
  const storageKey = `/${storageObjectKey}`;

  await putObjectToStorage(config, storageObjectKey, input.rawBuffer, input.contentType);

  return {
    originalName: input.fileName,
    storageKey,
    storageObjectKey,
  };
}

export async function createAssetUploadTarget(input: AssetUploadIntent) {
  const storageProvider = getStorageProvider();
  const assetId = input.assetId ?? randomUUID();
  const objectKey = buildOriginalAudioObjectKey(input, assetId, input.fileName);
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const uploadToken = signAssetUploadToken({
    ...input,
    objectKey,
    assetId,
    expiresAt,
  });

  return {
    assetId,
    objectKey,
    uploadToken,
    uploadUrl: (await storageProvider.createSignedUploadUrl({
      objectKey,
      contentType: input.contentType,
      method: 'PUT',
      expiresInSeconds: 900,
    })).url,
    method: 'PUT' as const,
    headers: {
      'content-type': input.contentType,
    },
    expiresAt,
    localFallback: false,
  };
}

export async function createObjectUploadTarget(input: {
  objectKey: string;
  contentType: string;
  expiresAt?: string;
}) {
  const storageProvider = getStorageProvider();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const signedUrl = await storageProvider.createSignedUploadUrl({
    objectKey: input.objectKey,
    contentType: input.contentType,
    method: 'PUT',
    expiresInSeconds: 900,
  });

  return {
    objectKey: input.objectKey,
    uploadUrl: signedUrl.url,
    method: 'PUT' as const,
    headers: {
      'content-type': input.contentType,
    },
    expiresAt,
    localFallback: false,
  };
}

export async function createAssetDownloadUrl(input: {
  assetId?: string | null;
  objectKey: string;
  contentType?: string;
}) {
  const storageProvider = getStorageProvider();
  const signedUrl = await storageProvider.createSignedDownloadUrl({
    objectKey: input.objectKey,
    contentType: input.contentType,
    expiresInSeconds: 900,
  });
  return {
    assetId: input.assetId ?? null,
    url: signedUrl.url,
    expiresAt: signedUrl.expiresAt,
    localFallback: false,
  };
}

export async function assetObjectExists(objectKey: string) {
  const config = assertObjectStorageConfig();
  const normalizedObjectKey = normalizeLegacyUploadKey(objectKey);
  const remoteUrl = signPresignedUrl(config, config.internalUrl, 'HEAD', normalizedObjectKey, 60);
  const response = await fetch(remoteUrl, { method: 'HEAD' });
  return response.ok;
}
