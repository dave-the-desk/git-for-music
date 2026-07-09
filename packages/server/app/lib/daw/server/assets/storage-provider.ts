import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  buildOriginalAudioObjectKey,
  normalizeLegacyUploadKey,
  type AudioStorageContext,
} from '@git-for-music/shared';
import { buildTrackVersionObjectKey } from '@/app/lib/daw/server/storage';

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

const TOKEN_SECRET =
  process.env.DAW_ASSET_UPLOAD_TOKEN_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  'dev-only-daw-asset-token-secret';

const DEFAULT_OBJECT_STORAGE_REGION = 'us-east-1';
const R2_REGION = 'auto';
const S3_SERVICE = 's3';

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

function readEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function parseUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function getObjectStorageConfig(): ObjectStorageConfig | null {
  const bucketName = readEnvValue('OBJECT_STORAGE_BUCKET_NAME', 'R2_BUCKET_NAME');
  const accessKeyId = readEnvValue('OBJECT_STORAGE_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID');
  const secretAccessKey = readEnvValue('OBJECT_STORAGE_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY');
  const accountId = readEnvValue('R2_ACCOUNT_ID');
  const region =
    readEnvValue('OBJECT_STORAGE_REGION') ?? (accountId ? R2_REGION : DEFAULT_OBJECT_STORAGE_REGION);

  if (!bucketName || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const publicUrl = parseUrl(readEnvValue('OBJECT_STORAGE_PUBLIC_URL', 'R2_PUBLIC_URL'));
  const internalUrl = parseUrl(readEnvValue('OBJECT_STORAGE_INTERNAL_URL'));

  if (publicUrl) {
    return {
      bucketName,
      accessKeyId,
      secretAccessKey,
      region,
      publicUrl,
      internalUrl: internalUrl ?? publicUrl,
    };
  }

  if (accountId) {
    const r2Url = new URL(`https://${accountId}.r2.cloudflarestorage.com`);
    return {
      bucketName,
      accessKeyId,
      secretAccessKey,
      region,
      publicUrl: r2Url,
      internalUrl: r2Url,
    };
  }

  return null;
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

export function signPresignedUrl(
  config: ObjectStorageConfig,
  endpoint: URL,
  method: 'PUT' | 'GET' | 'HEAD',
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
  const signature = createHmac('sha256', TOKEN_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyAssetUploadToken(token: string) {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = createHmac('sha256', TOKEN_SECRET).update(encodedPayload).digest('base64url');
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
  const config = assertObjectStorageConfig();
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
    uploadUrl: signPresignedUrl(config, config.publicUrl, 'PUT', objectKey, 900),
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
  const config = assertObjectStorageConfig();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString();

  return {
    objectKey: input.objectKey,
    uploadUrl: signPresignedUrl(config, config.publicUrl, 'PUT', input.objectKey, 900),
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
  const config = assertObjectStorageConfig();
  const objectKey = normalizeLegacyUploadKey(input.objectKey);

  return {
    assetId: input.assetId ?? null,
    url: signPresignedUrl(config, config.publicUrl, 'GET', objectKey, 900),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
