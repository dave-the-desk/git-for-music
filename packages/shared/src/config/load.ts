import type { Config, PublicConfig } from './schema';

function getNodeBuiltins() {
  if (typeof process === 'undefined' || typeof process.getBuiltinModule !== 'function') {
    return null;
  }

  return {
    fs: process.getBuiltinModule('node:fs'),
    path: process.getBuiltinModule('node:path'),
  };
}

let cachedConfig: Config | null = null;
let cachedFingerprint: string | null = null;

function isNextBuildPhase() {
  return typeof process !== 'undefined' && process.env.NEXT_PHASE === 'phase-production-build';
}

function readEnvFile(fs: NonNullable<ReturnType<typeof getNodeBuiltins>>['fs'], filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadWorkspaceEnvFiles() {
  const builtins = getNodeBuiltins();
  if (!builtins) {
    return;
  }

  const cwd = process.cwd();
  const candidates = [
    '.env.local',
    '.env',
    'src/.env.local',
    'src/.env',
    '../.env.local',
    '../.env',
    '../../.env.local',
    '../../.env',
  ];

  for (const candidate of candidates) {
    readEnvFile(builtins.fs, builtins.path.resolve(cwd, candidate));
  }
}

function readTrimmedEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function parseBooleanEnv(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return null;
}

function readFeatureFlags() {
  return Object.entries(process.env).reduce<Record<string, boolean>>((accumulator, [key, value]) => {
    if (!key.startsWith('FEATURE_')) {
      return accumulator;
    }

    const flagValue = parseBooleanEnv(value as string | undefined);
    if (flagValue !== null) {
      accumulator[key.slice('FEATURE_'.length).toLowerCase()] = flagValue;
    }

    return accumulator;
  }, {});
}

function getConfigFingerprint() {
  const relevantEntries = Object.entries(process.env)
    .filter(([key]) =>
      key === 'NODE_ENV' ||
      key === 'DATABASE_URL' ||
      key === 'REDIS_URL' ||
      key === 'OBJECT_STORAGE_BUCKET_NAME' ||
      key === 'R2_BUCKET_NAME' ||
      key === 'OBJECT_STORAGE_ACCESS_KEY_ID' ||
      key === 'R2_ACCESS_KEY_ID' ||
      key === 'OBJECT_STORAGE_SECRET_ACCESS_KEY' ||
      key === 'R2_SECRET_ACCESS_KEY' ||
      key === 'R2_ACCOUNT_ID' ||
      key === 'OBJECT_STORAGE_REGION' ||
      key === 'OBJECT_STORAGE_PUBLIC_URL' ||
      key === 'R2_PUBLIC_URL' ||
      key === 'OBJECT_STORAGE_INTERNAL_URL' ||
      key === 'DAW_ASSET_UPLOAD_TOKEN_SECRET' ||
      key === 'DAW_PLUGIN_UPLOAD_TOKEN_SECRET' ||
      key === 'DAW_WORKER_CALLBACK_SECRET' ||
      key === 'NEXTAUTH_SECRET' ||
      key === 'NEXT_PUBLIC_APP_URL' ||
      key === 'DAW_ENABLE_ORDINARY_EDIT_HEAD_ADVANCE' ||
      key.startsWith('FEATURE_'),
    )
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return JSON.stringify(relevantEntries);
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

function resolveObjectStorageConfig() {
  const bucketName = readTrimmedEnv('OBJECT_STORAGE_BUCKET_NAME', 'R2_BUCKET_NAME');
  const accessKeyId = readTrimmedEnv('OBJECT_STORAGE_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID');
  const secretAccessKey = readTrimmedEnv('OBJECT_STORAGE_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY');
  const accountId = readTrimmedEnv('R2_ACCOUNT_ID');
  const region =
    readTrimmedEnv('OBJECT_STORAGE_REGION') ?? (accountId ? 'auto' : 'us-east-1');
  const publicUrl =
    parseUrl(readTrimmedEnv('OBJECT_STORAGE_PUBLIC_URL', 'R2_PUBLIC_URL')) ??
    (accountId ? parseUrl(`https://${accountId}.r2.cloudflarestorage.com`) : null);
  const internalUrl = parseUrl(readTrimmedEnv('OBJECT_STORAGE_INTERNAL_URL')) ?? publicUrl;

  const isProduction = process.env.NODE_ENV === 'production' && !isNextBuildPhase();

  if (!bucketName && !accessKeyId && !secretAccessKey && !publicUrl) {
    if (isProduction) {
      throw new Error(
        'Object storage is required in production. Set OBJECT_STORAGE_* env vars, or the equivalent R2_* values, before starting.',
      );
    }

    return null;
  }

  if (!bucketName || !accessKeyId || !secretAccessKey || !publicUrl || !internalUrl) {
    if (isProduction) {
      throw new Error(
        'Object storage is not fully configured. Set OBJECT_STORAGE_* env vars, or the equivalent R2_* values, before starting in production.',
      );
    }

    return null;
  }

  return {
    bucketName,
    accessKeyId,
    secretAccessKey,
    region,
    publicUrl: publicUrl.toString(),
    internalUrl: internalUrl.toString(),
  };
}

function buildConfig(): Config {
  loadWorkspaceEnvFiles();

  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  const isProduction = nodeEnv === 'production';
  const enforceProductionConfig = isProduction && !isNextBuildPhase();
  const databaseUrl = readTrimmedEnv('DATABASE_URL');
  const redisUrl = readTrimmedEnv('REDIS_URL');
  const objectStorage = resolveObjectStorageConfig();
  const assetUploadTokenSecret = readTrimmedEnv('DAW_ASSET_UPLOAD_TOKEN_SECRET');
  const pluginUploadTokenSecret = readTrimmedEnv('DAW_PLUGIN_UPLOAD_TOKEN_SECRET');
  const workerCallbackSecret = readTrimmedEnv('DAW_WORKER_CALLBACK_SECRET');
  const nextAuthSecret = readTrimmedEnv('NEXTAUTH_SECRET');
  const appUrl = readTrimmedEnv('NEXT_PUBLIC_APP_URL');
  const enableOrdinaryEditHeadAdvance =
    parseBooleanEnv(readTrimmedEnv('DAW_ENABLE_ORDINARY_EDIT_HEAD_ADVANCE')) ?? false;

  if (enforceProductionConfig && !databaseUrl) {
    throw new Error('DATABASE_URL is required in production.');
  }

  if (enforceProductionConfig && !nextAuthSecret) {
    throw new Error('NEXTAUTH_SECRET is required in production.');
  }

  if (enforceProductionConfig && !assetUploadTokenSecret) {
    throw new Error('DAW_ASSET_UPLOAD_TOKEN_SECRET is required in production.');
  }

  if (enforceProductionConfig && !pluginUploadTokenSecret) {
    throw new Error('DAW_PLUGIN_UPLOAD_TOKEN_SECRET is required in production.');
  }

  if (enforceProductionConfig && !workerCallbackSecret) {
    throw new Error('DAW_WORKER_CALLBACK_SECRET is required in production.');
  }

  return {
    environment: {
      nodeEnv,
      isProduction,
    },
    database: {
      url: databaseUrl,
    },
    redis: {
      url: redisUrl,
    },
    objectStorage,
    secrets: {
      dawAssetUploadTokenSecret:
        assetUploadTokenSecret ?? (isProduction ? '' : 'dev-only-daw-asset-token-secret'),
      dawPluginUploadTokenSecret:
        pluginUploadTokenSecret ??
        (isProduction ? '' : assetUploadTokenSecret ?? 'dev-only-daw-plugin-token-secret'),
      dawWorkerCallbackSecret:
        workerCallbackSecret ?? (isProduction ? '' : 'dev-only-daw-worker-callback-secret'),
      nextAuthSecret: nextAuthSecret ?? (isProduction ? '' : 'dev-only-nextauth-secret'),
    },
    features: readFeatureFlags(),
    branding: {
      appName: 'Git for Music',
      logoPath: null,
      supportUrl: null,
    },
    deployment: {
      environmentName: nodeEnv,
      baseUrl: appUrl,
    },
    toggles: {
      enableOrdinaryEditHeadAdvance,
    },
  };
}

export function loadConfig() {
  loadWorkspaceEnvFiles();
  return buildConfig();
}

export function getConfig() {
  loadWorkspaceEnvFiles();
  const fingerprint = getConfigFingerprint();
  if (!cachedConfig || cachedFingerprint !== fingerprint) {
    cachedConfig = buildConfig();
    cachedFingerprint = fingerprint;
  }

  return cachedConfig;
}

export function getPublicConfig(): PublicConfig {
  const config = getConfig();
  return {
    features: config.features,
    branding: config.branding,
    deployment: config.deployment,
  };
}

export function resetConfigForTests() {
  cachedConfig = null;
  cachedFingerprint = null;
}
