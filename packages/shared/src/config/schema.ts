export interface ConfigDatabase {
  url: string | null;
}

export interface ConfigRedis {
  url: string | null;
}

export interface ConfigObjectStorage {
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicUrl: string;
  internalUrl: string;
}

export interface ConfigSecrets {
  dawAssetUploadTokenSecret: string;
  dawPluginUploadTokenSecret: string;
  dawWorkerCallbackSecret: string;
  nextAuthSecret: string;
}

export interface ConfigBranding {
  appName: string;
  logoPath: string | null;
  supportUrl: string | null;
}

export interface ConfigDeployment {
  environmentName: string;
  baseUrl: string | null;
}

export interface ConfigToggles {
  enableOrdinaryEditHeadAdvance: boolean;
}

export interface Config {
  environment: {
    nodeEnv: string;
    isProduction: boolean;
  };
  database: ConfigDatabase;
  redis: ConfigRedis;
  objectStorage: ConfigObjectStorage | null;
  secrets: ConfigSecrets;
  features: Record<string, boolean>;
  branding: ConfigBranding;
  deployment: ConfigDeployment;
  toggles: ConfigToggles;
}

export interface PublicConfig {
  features: Record<string, boolean>;
  branding: ConfigBranding;
  deployment: ConfigDeployment;
}
