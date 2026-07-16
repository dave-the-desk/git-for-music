import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioPlaybackEngine } from '@/app/lib/daw/engine/playback-engine';
import type { PlaybackPluginGraph } from '@/app/lib/daw/engine/wam-host';
import type { PlaybackProjectSnapshot } from '@/app/lib/daw/engine/playback-engine';

const createdBufferSources: Array<
  AudioBufferSourceNode & { connections: AudioNode[]; startCalls: unknown[][] }
> = [];

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
  const node = createFakeNode(id) as unknown as GainNode & { gain: AudioParam };
  node.gain = {
    value: 1,
    setValueAtTime(value: number, startTime: number) {
      void value;
      void startTime;
      return node.gain as unknown as AudioParam;
    },
  } as unknown as AudioParam;
  return node;
}

function createFakePannerNode(id: string) {
  const node = createFakeNode(id) as unknown as StereoPannerNode & { pan: AudioParam };
  node.pan = {
    value: 0,
    setValueAtTime(value: number, startTime: number) {
      void value;
      void startTime;
      return node.pan as unknown as AudioParam;
    },
  } as unknown as AudioParam;
  return node;
}

function createFakeBufferSource() {
  const node = createFakeNode(`source-${createdBufferSources.length}`) as unknown as AudioBufferSourceNode & {
    connections: AudioNode[];
    startCalls: unknown[][];
  };
  node.buffer = null;
  Object.assign(node, { playbackRate: { value: 1 } as AudioParam });
  node.startCalls = [];
  node.start = (...args: unknown[]) => {
    node.startCalls.push(args);
  };
  node.stop = () => {};
  node.onended = null;
  createdBufferSources.push(node);
  return node;
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
      latencyByInstanceId: new Map(),
      issues: [],
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
const originalAudioBuffer = globalThis.AudioBuffer;

test.beforeEach(() => {
  createdBufferSources.length = 0;
  (globalThis as Record<string, unknown>).AudioBuffer = class FakeAudioBuffer {
    duration: number;
    constructor(options: { length: number; sampleRate: number }) {
      this.duration = options.length / options.sampleRate;
    }
  } as unknown as typeof AudioBuffer;
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
    createBufferSource() {
      return createFakeBufferSource();
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
  (globalThis as Record<string, unknown>).AudioBuffer = originalAudioBuffer;
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

test('AudioPlaybackEngine keeps only one track soloed at a time', () => {
  const engine = new AudioPlaybackEngine();

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
          plugins: [],
        },
        {
          trackId: 'track-2',
          trackName: 'Track 2',
          trackVersionId: 'track-version-2',
          storageKey: '/audio/track-2.wav',
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
      soloTrackVersionIds: new Set(['track-version-1', 'track-version-2']),
    }),
  );

  const trackBuses = (engine as unknown as { trackBuses: Map<string, { gain: { gain: { value: number } } }> }).trackBuses;
  assert.equal(trackBuses.get('track-version-1')?.gain.gain.value, 1);
  assert.equal(trackBuses.get('track-version-2')?.gain.gain.value, 0);

  engine.setTrackSolo('track-version-2', true);

  assert.equal(trackBuses.get('track-version-1')?.gain.gain.value, 0);
  assert.equal(trackBuses.get('track-version-2')?.gain.gain.value, 1);
});

test('AudioPlaybackEngine plays a moved clip from its source buffer through the destination mix and effects', async () => {
  const graphFactory = createTrackPluginGraphFactory();
  const engine = new AudioPlaybackEngine({ pluginGraphFactory: graphFactory.factory });
  const sourceBuffer = new AudioBuffer({ length: 96_000, sampleRate: 48_000 });
  const destinationBuffer = new AudioBuffer({ length: 96_000, sampleRate: 48_000 });

  engine.setProject(
    makeProject({
      tracks: [
        {
          trackId: 'track-source',
          trackName: 'Source',
          trackVersionId: 'track-version-source',
          storageKey: '/audio/source.wav',
          mimeType: 'audio/wav',
          startOffsetMs: 0,
          durationMs: 2000,
          segments: [],
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          isMuted: false,
          plugins: [],
        },
        {
          trackId: 'track-destination',
          trackName: 'Destination',
          trackVersionId: 'track-version-destination',
          storageKey: '/audio/destination.wav',
          mimeType: 'audio/wav',
          startOffsetMs: 0,
          durationMs: 2000,
          segments: [
            {
              id: 'segment-moved',
              trackVersionId: 'track-version-destination',
              sourceTrackVersionId: 'track-version-source',
              sourceStorageKey: '/audio/source.wav',
              sourceStartMs: 100,
              sourceEndMs: 900,
              timelineStartMs: 0,
              timelineEndMs: 800,
              durationMs: 800,
              startMs: 100,
              endMs: 900,
              gainDb: 0,
              fadeInMs: 0,
              fadeOutMs: 0,
              isMuted: false,
              position: 0,
              isImplicit: false,
            },
          ],
          recordedTempoBpm: 120,
          sourceTempoBpm: 120,
          isMuted: false,
          plugins: [
            {
              instanceId: 'plugin-1',
              pluginKey: 'com.example.destination-effect',
              version: '1.0.0',
              backend: 'wam',
              position: 0,
              bypassed: false,
              params: { mix: 1 },
            },
          ],
        },
      ],
      gainByTrackVersionId: { 'track-version-destination': 0.25 },
    }),
  );

  const internals = engine as unknown as {
    bufferCache: Map<string, AudioBuffer>;
    trackBuses: Map<string, { input: AudioNode; gain: { gain: { value: number } } }>;
    scheduledSources: Set<{ source: AudioBufferSourceNode; trackVersionId: string }>;
  };
  internals.bufferCache.set('/audio/source.wav', sourceBuffer);
  internals.bufferCache.set('/audio/destination.wav', destinationBuffer);

  await engine.play(0);

  const scheduled = [...internals.scheduledSources].find(
    (entry) => entry.trackVersionId === 'track-version-destination',
  );
  const destinationBus = internals.trackBuses.get('track-version-destination');
  const sourceNode = scheduled?.source as (AudioBufferSourceNode & { connections: AudioNode[] }) | undefined;
  const segmentGain = sourceNode?.connections[0] as (AudioNode & { connections: AudioNode[] }) | undefined;

  assert.ok(scheduled);
  assert.equal(scheduled?.source.buffer, sourceBuffer);
  assert.equal(segmentGain?.connections[0], destinationBus?.input);
  assert.equal(destinationBus?.gain.gain.value, 0.25);
  assert.equal(graphFactory.rebuildCount, 2);

  engine.setTrackMuted('track-version-destination', true);
  assert.equal(destinationBus?.gain.gain.value, 0);
  engine.setTrackMuted('track-version-destination', false);
  engine.setTrackSolo('track-version-source', true);
  assert.equal(destinationBus?.gain.gain.value, 0);
  engine.setTrackSolo('track-version-destination', true);
  assert.equal(destinationBus?.gain.gain.value, 0.25);
});
