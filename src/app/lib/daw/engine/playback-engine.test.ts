import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioPlaybackEngine } from '@/app/lib/daw/engine/playback-engine';
import type { PlaybackPluginGraph } from '@/app/lib/daw/engine/wam-host';
import type { PlaybackProjectSnapshot } from '@/app/lib/daw/engine/playback-engine';

type NodeLogEntry = { from: string; to: string };

function createFakeNode(id: string) {
  const connections: AudioNode[] = [];
  return {
    id,
    connections,
    connect(target: AudioNode) {
      connections.push(target);
      return target;
    },
    disconnect(target?: AudioNode) {
      if (!target) {
        connections.length = 0;
        return undefined;
      }

      const index = connections.indexOf(target);
      if (index >= 0) {
        connections.splice(index, 1);
      }
      return undefined;
    },
  } as unknown as AudioNode;
}

function createFakeGainNode(id: string) {
  const node = createFakeNode(id) as unknown as GainNode & { gain: { value: number; setValueAtTime: () => void } };
  node.gain = {
    value: 1,
    setValueAtTime() {},
  };
  return node;
}

function createFakePannerNode(id: string) {
  const node = createFakeNode(id) as unknown as StereoPannerNode & { pan: { value: number; setValueAtTime: () => void } };
  node.pan = {
    value: 0,
    setValueAtTime() {},
  };
  return node;
}

function createFakeAudioContext() {
  const destination = createFakeNode('destination');
  return {
    state: 'running',
    currentTime: 0,
    destination,
    createGain() {
      return createFakeGainNode(`gain-${Math.random().toString(16).slice(2)}`);
    },
    createStereoPanner() {
      return createFakePannerNode(`pan-${Math.random().toString(16).slice(2)}`);
    },
    decodeAudioData() {
      throw new Error('not used in playback-engine tests');
    },
    resume() {
      return Promise.resolve();
    },
    close() {
      return Promise.resolve();
    },
  } as unknown as AudioContext;
}

function createTrackPluginGraphFactory() {
  const pluginNode = createFakeNode('plugin-node') as AudioNode & {
    setParameterValues(values: Record<string, number>): void;
    destroy(): void;
  };
  let teardownCount = 0;
  let rebuildCount = 0;
  const parameterCalls: Array<Record<string, number>> = [];
  let disconnectCount = 0;
  let destroyCount = 0;

  const factory = (trackVersionId: string, inputNode: AudioNode) => {
    rebuildCount += 1;
    const graph: PlaybackPluginGraph = {
      outputNode: pluginNode,
      nodesByInstanceId: new Map([['plugin-1', pluginNode]]),
      teardown: () => {
        teardownCount += 1;
        inputNode.disconnect(pluginNode);
        pluginNode.disconnect();
        pluginNode.destroy();
      },
    };

    inputNode.connect(pluginNode);
    return graph;
  };

  pluginNode.setParameterValues = (values: Record<string, number>) => {
    parameterCalls.push(values);
  };
  pluginNode.disconnect = () => {
    disconnectCount += 1;
    return undefined;
  };
  pluginNode.destroy = () => {
    destroyCount += 1;
  };

  return {
    factory,
    pluginNode,
    parameterCalls,
    get rebuildCount() {
      return rebuildCount;
    },
    get teardownCount() {
      return teardownCount;
    },
    get disconnectCount() {
      return disconnectCount;
    },
    get destroyCount() {
      return destroyCount;
    },
  };
}

function makeProject(overrides: Partial<PlaybackProjectSnapshot> = {}) {
  return {
    tracks: [
      {
        trackId: 'track-1',
        trackName: 'Track 1',
        trackVersionId: 'track-version-1',
        storageKey: '/audio/track-1.wav',
        mimeType: 'audio/wav',
        startOffsetMs: 0,
        durationMs: 1000,
        segments: [],
        recordedTempoBpm: 120,
        sourceTempoBpm: 120,
        isMuted: false,
        plugins: [],
      },
    ],
    mutedTrackVersionIds: new Set<string>(),
    soloTrackVersionIds: new Set<string>(),
    gainByTrackVersionId: {},
    panByTrackVersionId: {},
    localTempoBpm: 120,
    sharedDemoTempoBpm: 120,
    ...overrides,
  } satisfies PlaybackProjectSnapshot;
}

const originalAudioContext = globalThis.AudioContext;

test.beforeEach(() => {
  (globalThis as Record<string, unknown>).AudioContext = class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = createFakeNode('destination');
    createGain() {
      return createFakeGainNode(`gain-${Math.random().toString(16).slice(2)}`);
    }
    createStereoPanner() {
      return createFakePannerNode(`pan-${Math.random().toString(16).slice(2)}`);
    }
    decodeAudioData() {
      throw new Error('not used');
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  } as unknown as typeof AudioContext;
});

test.afterEach(() => {
  (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
});

test('AudioPlaybackEngine updates plugin params live and rebuilds on chain changes', () => {
  const graphFactory = createTrackPluginGraphFactory();
  const engine = new AudioPlaybackEngine({
    pluginGraphFactory: graphFactory.factory,
  });

  engine.setProject(
    makeProject({
      tracks: [
        {
          trackId: 'track-1',
          trackName: 'Track 1',
          trackVersionId: 'track-version-1',
          storageKey: '/audio/track-1.wav',
          mimeType: 'audio/wav',
          startOffsetMs: 0,
          durationMs: 1000,
          segments: [],
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          isMuted: false,
          plugins: [
            {
              instanceId: 'plugin-1',
              pluginKey: 'com.example.plugin',
              version: '1.0.0',
              backend: 'wam',
              position: 0,
              bypassed: false,
              params: { mix: 0.5 },
              state: { preset: 'wide' },
            },
          ],
        },
      ],
    }),
  );

  assert.equal(graphFactory.rebuildCount, 1);

  engine.setPluginParam('track-version-1', 'plugin-1', 'mix', 0.75);
  assert.deepEqual(graphFactory.parameterCalls.at(-1), { mix: 0.75 });
  assert.equal(graphFactory.rebuildCount, 1);

  engine.rebuildTrackPluginChain('track-version-1');
  assert.equal(graphFactory.rebuildCount, 2);
  assert.equal(graphFactory.teardownCount, 1);

  engine.setPluginBypass('track-version-1', 'plugin-1', true);
  assert.equal(graphFactory.rebuildCount, 3);
  assert.equal(graphFactory.teardownCount, 2);
});

test('AudioPlaybackEngine setProject re-applies plugin params without rebuilding the graph', () => {
  const graphFactory = createTrackPluginGraphFactory();
  const engine = new AudioPlaybackEngine({
    pluginGraphFactory: graphFactory.factory,
  });

  engine.setProject(
    makeProject({
      tracks: [
        {
          trackId: 'track-1',
          trackName: 'Track 1',
          trackVersionId: 'track-version-1',
          storageKey: '/audio/track-1.wav',
          mimeType: 'audio/wav',
          startOffsetMs: 0,
          durationMs: 1000,
          segments: [],
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          isMuted: false,
          plugins: [
            {
              instanceId: 'plugin-1',
              pluginKey: 'com.example.plugin',
              version: '1.0.0',
              backend: 'wam',
              position: 0,
              bypassed: false,
              params: { mix: 0.5 },
              state: undefined,
            },
          ],
        },
      ],
    }),
  );

  engine.setProject(
    makeProject({
      tracks: [
        {
          trackId: 'track-1',
          trackName: 'Track 1',
          trackVersionId: 'track-version-1',
          storageKey: '/audio/track-1.wav',
          mimeType: 'audio/wav',
          startOffsetMs: 0,
          durationMs: 1000,
          segments: [],
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          isMuted: false,
          plugins: [
            {
              instanceId: 'plugin-1',
              pluginKey: 'com.example.plugin',
              version: '1.0.0',
              backend: 'wam',
              position: 0,
              bypassed: false,
              params: { mix: 0.9 },
              state: undefined,
            },
          ],
        },
      ],
    }),
  );

  assert.equal(graphFactory.rebuildCount, 1);
  assert.deepEqual(graphFactory.parameterCalls.at(-1), { mix: 0.9 });
});

test('AudioPlaybackEngine setProject rebuilds the graph when plugin chain shape changes', () => {
  const graphFactory = createTrackPluginGraphFactory();
  const engine = new AudioPlaybackEngine({
    pluginGraphFactory: graphFactory.factory,
  });

  engine.setProject(
    makeProject({
      tracks: [
        {
          trackId: 'track-1',
          trackName: 'Track 1',
          trackVersionId: 'track-version-1',
          storageKey: '/audio/track-1.wav',
          mimeType: 'audio/wav',
          startOffsetMs: 0,
          durationMs: 1000,
          segments: [],
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          isMuted: false,
          plugins: [
            {
              instanceId: 'plugin-1',
              pluginKey: 'com.example.plugin',
              version: '1.0.0',
              backend: 'wam',
              position: 0,
              bypassed: false,
              params: { mix: 0.5 },
              state: undefined,
            },
          ],
        },
      ],
    }),
  );

  assert.equal(graphFactory.rebuildCount, 1);

  engine.setProject(
    makeProject({
      tracks: [
        {
          trackId: 'track-1',
          trackName: 'Track 1',
          trackVersionId: 'track-version-1',
          storageKey: '/audio/track-1.wav',
          mimeType: 'audio/wav',
          startOffsetMs: 0,
          durationMs: 1000,
          segments: [],
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          isMuted: false,
          plugins: [
            {
              instanceId: 'plugin-1',
              pluginKey: 'com.example.plugin',
              version: '1.0.0',
              backend: 'wam',
              position: 0,
              bypassed: false,
              params: { mix: 0.5 },
              state: undefined,
            },
            {
              instanceId: 'plugin-2',
              pluginKey: 'com.example.plugin',
              version: '1.0.0',
              backend: 'wam',
              position: 1,
              bypassed: false,
              params: { mix: 0.25 },
              state: undefined,
            },
          ],
        },
      ],
    }),
  );

  assert.equal(graphFactory.rebuildCount, 2);
  assert.equal(graphFactory.teardownCount, 1);
});

test('AudioPlaybackEngine disposes WAM nodes when tracks are removed or the engine is disposed', () => {
  const graphFactory = createTrackPluginGraphFactory();
  const engine = new AudioPlaybackEngine({
    pluginGraphFactory: graphFactory.factory,
  });

  engine.setProject(
    makeProject({
      tracks: [
        {
          trackId: 'track-1',
          trackName: 'Track 1',
          trackVersionId: 'track-version-1',
          storageKey: '/audio/track-1.wav',
          mimeType: 'audio/wav',
          startOffsetMs: 0,
          durationMs: 1000,
          segments: [],
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          isMuted: false,
          plugins: [
            {
              instanceId: 'plugin-1',
              pluginKey: 'com.example.plugin',
              version: '1.0.0',
              backend: 'wam',
              position: 0,
              bypassed: false,
              params: { mix: 0.5 },
              state: undefined,
            },
          ],
        },
      ],
    }),
  );

  engine.setProject(makeProject({ tracks: [] }));

  assert.equal(graphFactory.teardownCount, 1);
  assert.equal(graphFactory.disconnectCount, 1);
  assert.equal(graphFactory.destroyCount, 1);

  engine.setProject(
    makeProject({
      tracks: [
        {
          trackId: 'track-1',
          trackName: 'Track 1',
          trackVersionId: 'track-version-1',
          storageKey: '/audio/track-1.wav',
          mimeType: 'audio/wav',
          startOffsetMs: 0,
          durationMs: 1000,
          segments: [],
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          isMuted: false,
          plugins: [
            {
              instanceId: 'plugin-1',
              pluginKey: 'com.example.plugin',
              version: '1.0.0',
              backend: 'wam',
              position: 0,
              bypassed: false,
              params: { mix: 0.5 },
              state: undefined,
            },
          ],
        },
      ],
    }),
  );

  engine.dispose();

  assert.equal(graphFactory.teardownCount, 2);
  assert.equal(graphFactory.disconnectCount, 2);
  assert.equal(graphFactory.destroyCount, 2);
});
