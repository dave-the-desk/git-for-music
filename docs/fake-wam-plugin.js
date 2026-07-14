const DEFAULT_GAIN = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toSafeId(value) {
  return String(value ?? 'fake-wam').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

export function createInstance(audioContext, env, group, pluginKey, version) {
  const gainNode = audioContext.createGain();
  const state = {
    gain: DEFAULT_GAIN,
    pluginKey,
    version,
  };

  gainNode.gain.value = DEFAULT_GAIN;

  Object.assign(gainNode, {
    id: `fake-wam-${toSafeId(pluginKey)}-${toSafeId(version)}`,
    latencyMs: 0,
    env,
    group,
    setParameterValues(values) {
      if (typeof values?.gain === 'number') {
        const nextGain = clamp(values.gain, 0, 2);
        gainNode.gain.value = nextGain;
        state.gain = nextGain;
      }
    },
    setState(nextState) {
      if (!nextState || typeof nextState !== 'object') {
        return;
      }

      if (typeof nextState.gain === 'number') {
        const nextGain = clamp(nextState.gain, 0, 2);
        gainNode.gain.value = nextGain;
        state.gain = nextGain;
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
      gainNode.disconnect();
    },
  });

  return gainNode;
}

export default {
  createInstance,
};
