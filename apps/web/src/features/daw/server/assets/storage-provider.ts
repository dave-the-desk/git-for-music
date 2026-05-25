import { createHmac, createHash, randomUUID } from 'node:crypto';
import {
  buildOriginalAudioObjectKey,
  buildPublicAudioUrl,
  normalizeLegacyUploadKey,
  type AudioStorageContext,
} from '@git-for-music/shared';

type AssetUploadIntent = AudioStorageContext & {
  userId: string;
  objectKey?: string;
  projectId: string;
  demoId: string;
  trackId?: string | null;
  trackVersionId?: string | null;
  name?: string | null;
  sourceVersionId?: string | null;
  timingChoice?: 'keepProjectTempo' | 'updateProjectTempoFromUpload' | 'uploadUnchanged' | null;
  attachMode?: 'track-version' | 'clip';
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

const TOKEN_SECRET =
  process.env.DAW_ASSET_UPLOAD_TOKEN_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  'dev-only-daw-asset-token-secret';

const R2_REGION = 'auto';
const R2_SERVICE = 's3';

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

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();
  const publicUrl = process.env.R2_PUBLIC_URL?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl: publicUrl || null,
  };
}

function getTimestampParts(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: `${iso.slice(0, 15)}Z`,
    dateStamp: iso.slice(0, 8),
  };
}

function buildR2ObjectUrl(config: NonNullable<ReturnType<typeof getR2Config>>, objectKey: string) {
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${objectKey}`;
}

function buildLocalPublicUrl(objectKey: string) {
  return buildPublicAudioUrl('/', objectKey);
}

function buildLocalUploadUrl(uploadToken: string) {
  return `/api/daw/assets/local-upload/${uploadToken}`;
}

function signPresignedUrl(
  method: 'PUT' | 'GET',
  objectKey: string,
  expiresInSeconds = 900,
) {
  const config = getR2Config();
  if (!config) {
    return null;
  }

  const { amzDate, dateStamp } = getTimestampParts();
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const encodedPath = `/${config.bucketName}/${objectKey
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/')}`;

  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalRequest = [
    method,
    encodedPath,
    canonicalQueryString(params),
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(config.secretAccessKey, dateStamp, R2_REGION, R2_SERVICE);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  params.set('X-Amz-Signature', signature);

  return `${buildR2ObjectUrl(config, objectKey)}?${params.toString()}`;
}

export function isRemoteAssetStorageConfigured() {
  return Boolean(getR2Config());
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

export async function createAssetUploadTarget(input: AssetUploadIntent) {
  const assetId = input.assetId ?? randomUUID();
  const objectKey = buildOriginalAudioObjectKey(input, assetId, input.fileName);
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const uploadToken = signAssetUploadToken({
    ...input,
    objectKey,
    assetId,
    expiresAt,
  });

  const remoteUploadUrl = signPresignedUrl('PUT', objectKey, 900);
  const localFallback = !remoteUploadUrl;

  return {
    assetId,
    objectKey,
    uploadToken,
    uploadUrl: remoteUploadUrl ?? buildLocalUploadUrl(uploadToken),
    method: 'PUT' as const,
    headers: {
      'content-type': input.contentType,
    },
    expiresAt,
    localFallback,
  };
}

export async function createAssetDownloadUrl(input: {
  assetId?: string | null;
  objectKey: string;
  contentType?: string;
}) {
  const objectKey = normalizeLegacyUploadKey(input.objectKey);
  const remoteDownloadUrl = signPresignedUrl('GET', objectKey, 900);
  if (remoteDownloadUrl) {
    return {
      assetId: input.assetId ?? null,
      url: remoteDownloadUrl,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      localFallback: false,
    };
  }

  return {
    assetId: input.assetId ?? null,
    url: buildLocalPublicUrl(objectKey),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    localFallback: true,
  };
}

export async function assetObjectExists(objectKey: string) {
  const remoteUrl = signPresignedUrl('GET', objectKey, 60);
  if (remoteUrl) {
    const response = await fetch(remoteUrl, { method: 'HEAD' });
    return response.ok;
  }

  const fs = await import('node:fs/promises');
  try {
    await fs.access(`public/${normalizeLegacyUploadKey(objectKey)}`);
    return true;
  } catch {
    return false;
  }
}
