const MAX_DELAY_SECONDS = 1;
const DEFAULT_DELAY_SECONDS = 0.18;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toSafeId(value) {
  return String(value ?? 'fake-wam').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

export function createInstance(audioContext, env, group, pluginKey, version) {
  const delayNode = audioContext.createDelay(MAX_DELAY_SECONDS);
  const state = {
    delayMs: DEFAULT_DELAY_SECONDS * 1000,
    pluginKey,
    version,
  };

  delayNode.delayTime.value = DEFAULT_DELAY_SECONDS;

  Object.assign(delayNode, {
    id: `fake-wam-${toSafeId(pluginKey)}-${toSafeId(version)}`,
    latencyMs: DEFAULT_DELAY_SECONDS * 1000,
    env,
    group,
    setParameterValues(values) {
      if (typeof values?.delayMs === 'number') {
        const clampedDelayMs = clamp(values.delayMs, 0, MAX_DELAY_SECONDS * 1000);
        delayNode.delayTime.value = clampedDelayMs / 1000;
        state.delayMs = clampedDelayMs;
      }
    },
    setState(nextState) {
      if (!nextState || typeof nextState !== 'object') {
        return;
      }

      if (typeof nextState.delayMs === 'number') {
        const clampedDelayMs = clamp(nextState.delayMs, 0, MAX_DELAY_SECONDS * 1000);
        delayNode.delayTime.value = clampedDelayMs / 1000;
        state.delayMs = clampedDelayMs;
      }

      Object.assign(state, nextState);
    },
    applyState(nextState) {
      this.setState(nextState);
    },
    getState() {
      return { ...state };
    },
    destroy() {
      delayNode.disconnect();
    },
  });

  return delayNode;
}

export default {
  createInstance,
};
