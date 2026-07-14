export type { FeatureDefinition, FeatureId } from './types';
export {
  isFeatureEnabled,
  listFeatures,
  overrideFeature,
  registerFeature,
  resetFeatureRegistryForTests,
} from './registry';
