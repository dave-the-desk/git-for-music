export type FeatureId = 'plugins' | (string & {});

export interface FeatureDefinition {
  id: FeatureId;
  description: string;
  enabledByDefault: boolean;
  envVar?: string;
}
