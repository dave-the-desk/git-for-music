import type { Config } from '../config';
import type { FeatureDefinition, FeatureId } from './types';

const featureRegistry = new Map<FeatureId, FeatureDefinition>();

export function registerFeature(definition: FeatureDefinition) {
  if (featureRegistry.has(definition.id)) {
    throw new Error(`Feature ${definition.id} is already registered.`);
  }

  featureRegistry.set(definition.id, definition);
}

export function overrideFeature(definition: FeatureDefinition) {
  featureRegistry.set(definition.id, definition);
}

export function isFeatureEnabled(id: FeatureId, config: Config) {
  const override = config.features[id];
  if (override !== undefined) {
    return override;
  }

  return featureRegistry.get(id)?.enabledByDefault ?? false;
}

export function listFeatures() {
  return Array.from(featureRegistry.values());
}

export function resetFeatureRegistryForTests() {
  featureRegistry.clear();
}
