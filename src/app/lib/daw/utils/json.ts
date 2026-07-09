import type { JsonValue } from '@git-for-music/shared';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      if (Array.isArray(value)) {
        return value.every((entry) => isJsonValue(entry));
      }

      if (!isPlainObject(value)) {
        return false;
      }

      return Object.entries(value).every(([key, entry]) => typeof key === 'string' && isJsonValue(entry));
    default:
      return false;
  }
}

export function assertJsonValue(value: unknown, label = 'value'): asserts value is JsonValue {
  if (!isJsonValue(value)) {
    throw new Error(
      `${label} must be JSON-serializable. Use stateBlobKey for binary or oversized plugin state instead of inlining bytes.`,
    );
  }
}
