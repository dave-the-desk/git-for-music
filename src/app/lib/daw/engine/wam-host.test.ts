import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyParams,
  applyState,
  createInstance,
  createWamPlaybackPluginGraphFactory,
  loadWamModule,
} from '@/app/lib/daw/engine/wam-host';

function dataModule(source: string) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

test('loadWamModule caches per plugin key and version', async () => {
  const key = `com.example.cached-${crypto.randomUUID()}`;
  const version = '1.0.0';
  const loadCountKey = `__wamLoadCount_${key.replace(/[^a-z0-9]/gi, '_')}`;
  const moduleA = dataModule(`
    globalThis.${loadCountKey} = (globalThis.${loadCountKey} ?? 0) + 1;
    export function createInstance() {
      return { tag: 'a' };
    }
  `);
  const moduleB = dataModule(`
    globalThis.${loadCountKey} = (globalThis.${loadCountKey} ?? 0) + 100;
    export function createInstance() {
      return { tag: 'b' };
    }
  `);

  const first = await loadWamModule(key, version, moduleA);
  const second = await loadWamModule(key, version, moduleB);

  assert.equal(first, second);
  assert.equal(first.descriptorUrl, moduleA);
  assert.equal((globalThis as Record<string, unknown>)[loadCountKey], 1);
});

test('createInstance reuses one WamEnv and WamGroup per AudioContext', async () => {
  const key = `com.example.runtime-${crypto.randomUUID()}`;
  const version = '1.0.0';
  const seenEnvs: unknown[] = [];
  const seenGroups: unknown[] = [];
  const moduleUrl = dataModule(`
    export function createInstance(audioContext, env, group) {
      globalThis.__wamCreateCount = (globalThis.__wamCreateCount ?? 0) + 1;
      globalThis.__wamSeenEnvs = globalThis.__wamSeenEnvs ?? [];
      globalThis.__wamSeenGroups = globalThis.__wamSeenGroups ?? [];
      globalThis.__wamSeenEnvs.push(env);
      globalThis.__wamSeenGroups.push(group);
      return {
        audioContext,
        env,
        group,
        connect() {
          return undefined;
        },
        disconnect() {
          return undefined;
        },
        setParameterValues() {
          return undefined;
        },
        setState() {
          return undefined;
        },
      };
    }
  `);

  await loadWamModule(key, version, moduleUrl);

  const contextA = {} as AudioContext;
  const contextB = {} as AudioContext;

  const nodeA1 = (await createInstance(contextA, key, version)) as unknown as { env: unknown; group: unknown };
  const nodeA2 = (await createInstance(contextA, key, version)) as unknown as { env: unknown; group: unknown };
  const nodeB = (await createInstance(contextB, key, version)) as unknown as { env: unknown; group: unknown };

  seenEnvs.push((globalThis as Record<string, unknown>).__wamSeenEnvs as unknown);
  seenGroups.push((globalThis as Record<string, unknown>).__wamSeenGroups as unknown);

  assert.equal(nodeA1.env, nodeA2.env);
  assert.equal(nodeA1.group, nodeA2.group);
  assert.notEqual(nodeA1.env, nodeB.env);
  assert.notEqual(nodeA1.group, nodeB.group);
  assert.equal((globalThis as Record<string, unknown>).__wamCreateCount, 3);
  assert.equal(seenEnvs.length, 1);
  assert.equal(seenGroups.length, 1);
});

test('applyParams and applyState use node methods when available', async () => {
  const calls: Array<{ method: string; value: unknown }> = [];
  const node = {
    connect() {
      return undefined;
    },
    disconnect() {
      return undefined;
    },
    setParameterValues(values: Record<string, number>) {
      calls.push({ method: 'setParameterValues', value: values });
    },
    setState(state: unknown) {
      calls.push({ method: 'setState', value: state });
    },
  } as unknown as Parameters<typeof applyParams>[0];

  await applyParams(node, { mix: 0.5, feedback: 0.25 });
  await applyState(node, { preset: 'wide' });

  assert.deepEqual(calls, [
    { method: 'setParameterValues', value: { mix: 0.5, feedback: 0.25 } },
    { method: 'setState', value: { preset: 'wide' } },
  ]);
});

test('wam host operations fail fast inside an AudioWorklet render context', async () => {
  const original = (globalThis as Record<string, unknown>).AudioWorkletProcessor;
  (globalThis as Record<string, unknown>).AudioWorkletProcessor = function AudioWorkletProcessor() {};

  try {
    const key = `com.example.render-guard-${crypto.randomUUID()}`;
    const version = '1.0.0';
    const moduleUrl = dataModule(`
      export function createInstance() {
        return {
          connect() {
            return undefined;
          },
          disconnect() {
            return undefined;
          },
        };
      }
    `);

    await assert.rejects(() => loadWamModule(key, version, moduleUrl), /main thread/i);
  } finally {
    if (original === undefined) {
      delete (globalThis as Record<string, unknown>).AudioWorkletProcessor;
    } else {
      (globalThis as Record<string, unknown>).AudioWorkletProcessor = original;
    }
  }
});

test('createWamPlaybackPluginGraphFactory builds ordered chains and skips bypassed plugins', async () => {
  const trackVersionId = `track-version-${crypto.randomUUID()}`;
  const connectionLogKey = '__wamConnectionLog';
  (globalThis as Record<string, unknown>)[connectionLogKey] = [];

  const aKey = `com.example.a-${crypto.randomUUID()}`;
  const bKey = `com.example.b-${crypto.randomUUID()}`;
  const cKey = `com.example.c-${crypto.randomUUID()}`;

  const moduleSource = (label: string) => dataModule(`
    export function createInstance() {
      const node = {
        id: '${label}',
        connect(target) {
          globalThis.__wamConnectionLog = globalThis.__wamConnectionLog ?? [];
          globalThis.__wamConnectionLog.push({ from: '${label}', to: target.id ?? 'unknown' });
          return target;
        },
        disconnect() {
          return undefined;
        },
      };
      return node;
    }
  `);

  await loadWamModule(aKey, '1.0.0', moduleSource('A'));
  await loadWamModule(bKey, '1.0.0', moduleSource('B'));
  await loadWamModule(cKey, '1.0.0', moduleSource('C'));

  const inputNode = {
    id: 'input',
    connect(target: { id?: string }) {
      const log = (globalThis as Record<string, unknown>)[connectionLogKey] as Array<{ from: string; to: string }>;
      log.push({ from: 'input', to: target.id ?? 'unknown' });
      return target;
    },
    disconnect() {
      return undefined;
    },
  } as unknown as AudioNode;

  const plugins = [
    {
      instanceId: 'plugin-c',
      pluginKey: cKey,
      version: '1.0.0',
      position: 20,
      bypassed: false,
      params: {},
      state: undefined,
    },
    {
      instanceId: 'plugin-a',
      pluginKey: aKey,
      version: '1.0.0',
      position: 0,
      bypassed: false,
      params: {},
      state: undefined,
    },
    {
      instanceId: 'plugin-b',
      pluginKey: bKey,
      version: '1.0.0',
      position: 10,
      bypassed: true,
      params: {},
      state: undefined,
    },
  ];

  const factory = createWamPlaybackPluginGraphFactory({
    getTrackPlugins: (id) => (id === trackVersionId ? plugins : []),
  });

  const graph = factory(trackVersionId, inputNode, {} as AudioContext);

  assert.equal((graph.outputNode as { id?: string }).id, 'C');
  assert.deepEqual((globalThis as Record<string, unknown>)[connectionLogKey], [
    { from: 'input', to: 'A' },
    { from: 'A', to: 'C' },
  ]);
  assert.equal(graph.nodesByInstanceId.size, 2);
});

test('createWamPlaybackPluginGraphFactory returns input unchanged for an empty chain', async () => {
  const inputNode = {
    id: 'input',
    connect() {
      throw new Error('should not connect');
    },
    disconnect() {
      return undefined;
    },
  } as unknown as AudioNode;

  const factory = createWamPlaybackPluginGraphFactory({
    getTrackPlugins: () => [],
  });

  const graph = factory('track-version-empty', inputNode, {} as AudioContext);

  assert.equal(graph.outputNode, inputNode);
  assert.equal(graph.nodesByInstanceId.size, 0);
});

test('createWamPlaybackPluginGraphFactory captures plugin latency and warns on heavy chains', async () => {
  const trackVersionId = `track-version-${crypto.randomUUID()}`;
  const key = `com.example.latency-${crypto.randomUUID()}`;
  await loadWamModule(
    key,
    '1.0.0',
    dataModule(`
      export function createInstance() {
        return {
          id: 'latency-node',
          latencyMs: 48,
          connect(target) {
            return target;
          },
          disconnect() {
            return undefined;
          },
        };
      }
    `),
  );

  const graph = createWamPlaybackPluginGraphFactory({
    getTrackPlugins: () => [
      {
        instanceId: 'plugin-1',
        pluginKey: key,
        version: '1.0.0',
        position: 0,
        bypassed: false,
        params: {},
        state: undefined,
      },
      {
        instanceId: 'plugin-2',
        pluginKey: key,
        version: '1.0.0',
        position: 1,
        bypassed: false,
        params: {},
        state: undefined,
      },
      {
        instanceId: 'plugin-3',
        pluginKey: key,
        version: '1.0.0',
        position: 2,
        bypassed: false,
        params: {},
        state: undefined,
      },
      {
        instanceId: 'plugin-4',
        pluginKey: key,
        version: '1.0.0',
        position: 3,
        bypassed: false,
        params: {},
        state: undefined,
      },
      {
        instanceId: 'plugin-5',
        pluginKey: key,
        version: '1.0.0',
        position: 4,
        bypassed: false,
        params: {},
        state: undefined,
      },
      {
        instanceId: 'plugin-6',
        pluginKey: key,
        version: '1.0.0',
        position: 5,
        bypassed: false,
        params: {},
        state: undefined,
      },
      {
        instanceId: 'plugin-7',
        pluginKey: key,
        version: '1.0.0',
        position: 6,
        bypassed: false,
        params: {},
        state: undefined,
      },
      {
        instanceId: 'plugin-8',
        pluginKey: key,
        version: '1.0.0',
        position: 7,
        bypassed: false,
        params: {},
        state: undefined,
      },
    ],
  })(trackVersionId, {
    id: 'input',
    connect(target: { id?: string }) {
      return target;
    },
    disconnect() {
      return undefined;
    },
  } as unknown as AudioNode, {} as AudioContext);

  assert.equal(graph.latencyByInstanceId.get('plugin-1'), 48);
  assert.equal(graph.issues.length >= 1, true);
  assert.equal(graph.issues[0]?.severity, 'warning');
});

test('createWamPlaybackPluginGraphFactory skips a plugin that fails to load and keeps playback flowing', async () => {
  const trackVersionId = `track-version-${crypto.randomUUID()}`;
  const okKey = `com.example.ok-${crypto.randomUUID()}`;
  const badKey = `com.example.bad-${crypto.randomUUID()}`;
  const connectionLog: Array<{ from: string; to: string }> = [];

  await loadWamModule(
    okKey,
    '1.0.0',
    dataModule(`
      export function createInstance() {
        return {
          id: 'ok-node',
          connect(target) {
            globalThis.__wamFallbackLog = globalThis.__wamFallbackLog ?? [];
            globalThis.__wamFallbackLog.push({ from: 'ok-node', to: target.id ?? 'unknown' });
            return target;
          },
          disconnect() {
            return undefined;
          },
        };
      }
    `),
  );
  await loadWamModule(
    badKey,
    '1.0.0',
    dataModule(`
      export function createInstance() {
        throw new Error('module exploded');
      }
    `),
  );

  (globalThis as Record<string, unknown>).__wamFallbackLog = connectionLog;

  const graph = createWamPlaybackPluginGraphFactory({
    getTrackPlugins: () => [
      {
        instanceId: 'plugin-ok',
        pluginKey: okKey,
        version: '1.0.0',
        position: 0,
        bypassed: false,
        params: {},
        state: undefined,
      },
      {
        instanceId: 'plugin-bad',
        pluginKey: badKey,
        version: '1.0.0',
        position: 1,
        bypassed: false,
        params: {},
        state: undefined,
      },
      {
        instanceId: 'plugin-ok-2',
        pluginKey: okKey,
        version: '1.0.0',
        position: 2,
        bypassed: false,
        params: {},
        state: undefined,
      },
    ],
  })(
    trackVersionId,
    {
      id: 'input',
      connect(target: { id?: string }) {
        connectionLog.push({ from: 'input', to: target.id ?? 'unknown' });
        return target;
      },
      disconnect() {
        return undefined;
      },
    } as unknown as AudioNode,
    {} as AudioContext,
  );

  assert.equal((graph.outputNode as { id?: string }).id, 'ok-node');
  assert.deepEqual(connectionLog, [
    { from: 'input', to: 'ok-node' },
    { from: 'ok-node', to: 'ok-node' },
  ]);
  assert.equal(graph.nodesByInstanceId.size, 2);
  assert.equal(graph.issues.some((issue) => issue.severity === 'error'), true);
});

test('createWamPlaybackPluginGraphFactory caps oversized chains', async () => {
  const trackVersionId = `track-version-${crypto.randomUUID()}`;
  const key = `com.example.cap-${crypto.randomUUID()}`;

  await loadWamModule(
    key,
    '1.0.0',
    dataModule(`
      export function createInstance() {
        return {
          id: 'cap-node',
          connect(target) {
            return target;
          },
          disconnect() {
            return undefined;
          },
        };
      }
    `),
  );

  const plugins = Array.from({ length: 20 }, (_, index) => ({
    instanceId: `plugin-${index}`,
    pluginKey: key,
    version: '1.0.0',
    position: index,
    bypassed: false,
    params: {},
    state: undefined,
  }));

  const graph = createWamPlaybackPluginGraphFactory({
    getTrackPlugins: () => plugins,
  })(
    trackVersionId,
    {
      id: 'input',
      connect(target: { id?: string }) {
        return target;
      },
      disconnect() {
        return undefined;
      },
    } as unknown as AudioNode,
    {} as AudioContext,
  );

  assert.equal(graph.nodesByInstanceId.size, 16);
  assert.equal(graph.issues.some((issue) => issue.message.includes('maximum supported length')), true);
});
