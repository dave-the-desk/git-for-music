type AnyRecord = Record<string, unknown>;

export type WamParamMap = Record<string, number>;

export type WamNode = AudioNode & {
  setParameterValues?: (params: WamParamMap) => void | Promise<void>;
  setParameters?: (params: WamParamMap) => void | Promise<void>;
  setState?: (state: unknown) => void | Promise<void>;
  applyState?: (state: unknown) => void | Promise<void>;
  destroy?: () => void;
};

export type WamGroup = {
  id: string;
  audioContext: AudioContext;
  nodes: Set<WamNode>;
};

export type WamEnv = {
  audioContext: AudioContext;
  group: WamGroup;
  modules: Map<string, LoadedWamModule>;
  nodesByPluginKey: Map<string, Set<WamNode>>;
};

export type LoadedWamModule = {
  pluginKey: string;
  version: string;
  descriptorUrl: string;
  module: AnyRecord;
};

type WamModuleCacheEntry = Promise<LoadedWamModule> | LoadedWamModule;

type WamRuntime = {
  env: WamEnv;
  group: WamGroup;
};

type WamModuleFactory = (
  audioContext: AudioContext,
  env: WamEnv,
  group: WamGroup,
  pluginKey: string,
  version: string,
) => WamNode | Promise<WamNode>;

export type WamHostedPluginInstanceState = {
  instanceId: string;
  pluginKey: string;
  version: string;
  position: number;
  bypassed: boolean;
  params: WamParamMap;
  state?: unknown;
};

export type WamTrackPluginResolver = (trackVersionId: string) => WamHostedPluginInstanceState[];

export type PlaybackPluginGraph = {
  outputNode: AudioNode;
  nodesByInstanceId: Map<string, WamNode>;
  latencyByInstanceId: Map<string, number>;
  issues: PlaybackPluginGraphIssue[];
  teardown: () => void;
};

export type PlaybackPluginGraphIssue = {
  trackVersionId: string;
  pluginKey: string;
  version: string;
  message: string;
  severity: 'warning' | 'error';
  instanceId?: string;
};

const HEAVY_CHAIN_WARNING_THRESHOLD = 8;
const MAX_CHAIN_INSTANCES = 16;

const wamModuleCache = new Map<string, WamModuleCacheEntry>();
const wamRuntimeCache = new WeakMap<AudioContext, WamRuntime>();

function getModuleCacheKey(pluginKey: string, version: string) {
  return `${pluginKey}::${version}`;
}

function assertMainThreadWamHost() {
  if (typeof AudioWorkletProcessor !== 'undefined') {
    throw new Error('WAM host operations must run on the main thread, not inside an AudioWorklet render context.');
  }
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === 'function';
}

function getWamRuntime(audioContext: AudioContext): WamRuntime {
  const cached = wamRuntimeCache.get(audioContext);
  if (cached) {
    return cached;
  }

  const group: WamGroup = {
    id: `wam-group-${crypto.randomUUID()}`,
    audioContext,
    nodes: new Set<WamNode>(),
  };

  const env: WamEnv = {
    audioContext,
    group,
    modules: new Map<string, LoadedWamModule>(),
    nodesByPluginKey: new Map<string, Set<WamNode>>(),
  };

  const runtime = { env, group };
  wamRuntimeCache.set(audioContext, runtime);
  return runtime;
}

function registerNode(runtime: WamRuntime, pluginKey: string, node: WamNode) {
  runtime.group.nodes.add(node);

  const nodesForPlugin = runtime.env.nodesByPluginKey.get(pluginKey) ?? new Set<WamNode>();
  nodesForPlugin.add(node);
  runtime.env.nodesByPluginKey.set(pluginKey, nodesForPlugin);
}

function createNodeFromFactory(factory: WamModuleFactory, audioContext: AudioContext, env: WamEnv, group: WamGroup, pluginKey: string, version: string) {
  return factory(audioContext, env, group, pluginKey, version);
}

function normalizeModuleExports(moduleExports: AnyRecord): AnyRecord {
  return moduleExports && typeof moduleExports === 'object' ? moduleExports : { default: moduleExports };
}

function isConstructorInvocationError(error: unknown) {
  return error instanceof TypeError && /cannot be invoked without 'new'/i.test(error.message);
}

function resolveWamFactory(moduleExports: AnyRecord): WamModuleFactory | null {
  const directFactory = moduleExports.createInstance ?? moduleExports.createNode;
  if (typeof directFactory === 'function') {
    return async (audioContext, env, group, pluginKey, version) =>
      (await directFactory(audioContext, env, group, pluginKey, version)) as WamNode;
  }

  const defaultExport = moduleExports.default;
  if (typeof defaultExport === 'function') {
    return async (audioContext, env, group, pluginKey, version) =>
      (await (async () => {
        try {
          return await (defaultExport as (
            audioContext: AudioContext,
            env: WamEnv,
            group: WamGroup,
            pluginKey: string,
            version: string,
          ) => WamNode)(audioContext, env, group, pluginKey, version);
        } catch (error) {
          if (!isConstructorInvocationError(error)) {
            throw error;
          }

          return await new (defaultExport as new (...args: unknown[]) => WamNode)(
            audioContext,
            env,
            group,
            pluginKey,
            version,
          );
        }
      })()) as WamNode;
  }

  if (defaultExport && typeof defaultExport === 'object') {
    const nestedFactory = (defaultExport as AnyRecord).createInstance ?? (defaultExport as AnyRecord).createNode;
    if (typeof nestedFactory === 'function') {
      return async (audioContext, env, group, pluginKey, version) =>
        (await nestedFactory(audioContext, env, group, pluginKey, version)) as WamNode;
    }
  }

  if (typeof moduleExports.WamNode === 'function') {
    return async (audioContext, env, group, pluginKey, version) =>
      (await new (moduleExports.WamNode as new (...args: unknown[]) => WamNode)(audioContext, env, group, pluginKey, version)) as WamNode;
  }

  return null;
}

async function invokeNodeMethod(node: WamNode, methodNames: string[], value: unknown) {
  const candidate = methodNames.find((methodName) => typeof (node as AnyRecord)[methodName] === 'function');
  if (!candidate) {
    return;
  }

  const result = (node as AnyRecord)[candidate](value);
  if (isPromise(result)) {
    await result;
  }
}

function resolveNodeLatencyMs(node: WamNode, audioContext: AudioContext) {
  const candidate = node as AnyRecord;
  const rawLatency =
    typeof candidate.latency === 'number'
      ? candidate.latency
      : typeof candidate.latencyMs === 'number'
        ? candidate.latencyMs
        : typeof candidate.getLatency === 'function'
          ? candidate.getLatency()
          : typeof candidate.getLatencyMs === 'function'
            ? candidate.getLatencyMs()
            : typeof candidate.latencySamples === 'number'
              ? candidate.latencySamples
              : typeof candidate.getLatencySamples === 'function'
                ? candidate.getLatencySamples()
                : null;

  if (!Number.isFinite(rawLatency)) {
    return null;
  }

  if (rawLatency > 1000 && Number.isFinite(audioContext.sampleRate) && audioContext.sampleRate > 0) {
    return (rawLatency / audioContext.sampleRate) * 1000;
  }

  return rawLatency;
}

/**
 * Load and cache a plugin ES module for a plugin key and version.
 */
export async function loadWamModule(pluginKey: string, version: string, descriptorUrl: string): Promise<LoadedWamModule> {
  assertMainThreadWamHost();
  const cacheKey = getModuleCacheKey(pluginKey, version);
  const cached = wamModuleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const loadPromise = (async () => {
    const moduleExports = normalizeModuleExports(await import(/* webpackIgnore: true, @vite-ignore */ descriptorUrl));
    return {
      pluginKey,
      version,
      descriptorUrl,
      module: moduleExports,
    } satisfies LoadedWamModule;
  })();

  wamModuleCache.set(cacheKey, loadPromise);

  try {
    const loaded = await loadPromise;
    wamModuleCache.set(cacheKey, loaded);
    return loaded;
  } catch (error) {
    wamModuleCache.delete(cacheKey);
    throw error;
  }
}

/**
 * Create a live WAM node instance for a plugin key/version pair.
 */
export function createInstance(audioContext: AudioContext, pluginKey: string, version: string): WamNode {
  assertMainThreadWamHost();
  const cacheKey = getModuleCacheKey(pluginKey, version);
  const loadedModule = wamModuleCache.get(cacheKey);
  if (!loadedModule) {
    throw new Error(`WAM module not loaded for ${pluginKey}@${version}. Call loadWamModule() first.`);
  }

  if (isPromise(loadedModule)) {
    throw new Error(`WAM module ${pluginKey}@${version} is still loading. Pre-resolve module imports before building the graph.`);
  }

  const moduleRecord = loadedModule;
  const runtime = getWamRuntime(audioContext);
  runtime.env.modules.set(cacheKey, moduleRecord);

  const factory = resolveWamFactory(moduleRecord.module);
  if (!factory) {
    throw new Error(`WAM module ${pluginKey}@${version} does not expose a supported node factory.`);
  }

  const nodeOrPromise = createNodeFromFactory(factory, audioContext, runtime.env, runtime.group, pluginKey, version);
  if (isPromise(nodeOrPromise)) {
    throw new Error(`WAM module ${pluginKey}@${version} returned an async node factory. Pre-resolve modules before building the graph.`);
  }

  const node = nodeOrPromise;
  registerNode(runtime, pluginKey, node);
  return node;
}

/**
 * Apply a WAM parameter map to a node.
 */
export function applyParams(node: WamNode, params: WamParamMap) {
  assertMainThreadWamHost();
  void invokeNodeMethod(node, ['setParameterValues', 'setParameters'], params);
}

/**
 * Apply serialized WAM state to a node.
 */
export function applyState(node: WamNode, state: unknown) {
  assertMainThreadWamHost();
  void invokeNodeMethod(node, ['setState', 'applyState'], state);
}

function sortTrackPlugins(plugins: WamHostedPluginInstanceState[]) {
  return [...plugins].sort((left, right) => {
    const byPosition = left.position - right.position;
    if (byPosition !== 0) {
      return byPosition;
    }

    return left.instanceId.localeCompare(right.instanceId);
  });
}

/**
 * Build a track plugin chain from preloaded modules and serialized plugin state.
 */
export function createWamPlaybackPluginGraphFactory(options: {
  getTrackPlugins: WamTrackPluginResolver;
  onIssue?: (issue: PlaybackPluginGraphIssue) => void;
  maxInstances?: number;
  heavyChainWarningThreshold?: number;
}): (
  trackVersionId: string,
  inputNode: AudioNode,
  audioContext: AudioContext,
) => PlaybackPluginGraph {
  return (trackVersionId, inputNode, audioContext) => {
    assertMainThreadWamHost();
    const trackPlugins = sortTrackPlugins(options.getTrackPlugins(trackVersionId));
    let currentNode: AudioNode = inputNode;
    const chainNodes: WamNode[] = [];
    const nodesByInstanceId = new Map<string, WamNode>();
    const latencyByInstanceId = new Map<string, number>();
    const issues: PlaybackPluginGraphIssue[] = [];
    const emitIssue = (issue: PlaybackPluginGraphIssue) => {
      issues.push(issue);
      options.onIssue?.(issue);
    };
    const maxInstances = options.maxInstances ?? MAX_CHAIN_INSTANCES;
    const heavyChainWarningThreshold = options.heavyChainWarningThreshold ?? HEAVY_CHAIN_WARNING_THRESHOLD;

    if (trackPlugins.length >= heavyChainWarningThreshold) {
      emitIssue({
        trackVersionId,
        pluginKey: trackPlugins[0]?.pluginKey ?? 'unknown',
        version: trackPlugins[0]?.version ?? 'unknown',
        message: `Track ${trackVersionId} has ${trackPlugins.length} active WAM plugins. Playback may be heavy, and latency is captured but not yet compensated.`,
        severity: 'warning',
      });
    }

    for (const plugin of trackPlugins) {
      if (plugin.bypassed) {
        continue;
      }

      if (chainNodes.length >= maxInstances) {
        emitIssue({
          trackVersionId,
          instanceId: plugin.instanceId,
          pluginKey: plugin.pluginKey,
          version: plugin.version,
          message: `Skipped ${plugin.pluginKey}@${plugin.version} because the WAM chain reached the maximum supported length (${maxInstances}).`,
          severity: 'warning',
        });
        continue;
      }

      let node: WamNode | null = null;
      try {
        node = createInstance(audioContext, plugin.pluginKey, plugin.version);
        applyParams(node, plugin.params);
        if (plugin.state !== undefined) {
          applyState(node, plugin.state);
        }
        currentNode.connect(node);
        currentNode = node;
        chainNodes.push(node);
        nodesByInstanceId.set(plugin.instanceId, node);
        const latencyMs = resolveNodeLatencyMs(node, audioContext);
        if (latencyMs !== null) {
          latencyByInstanceId.set(plugin.instanceId, latencyMs);
        }
      } catch (error) {
        emitIssue({
          trackVersionId,
          instanceId: plugin.instanceId,
          pluginKey: plugin.pluginKey,
          version: plugin.version,
          message: error instanceof Error ? error.message : `Could not load ${plugin.pluginKey}@${plugin.version}`,
          severity: 'error',
        });
        try {
          node?.disconnect();
        } catch {
          // Best effort cleanup if the node was partially created.
        }
        if (node && typeof node.destroy === 'function') {
          try {
            node.destroy();
          } catch {
            // Ignore plugin cleanup failures during graph replacement.
          }
        }
      }
    }

    return {
      outputNode: currentNode,
      nodesByInstanceId,
      latencyByInstanceId,
      issues,
      teardown: () => {
        if (chainNodes.length === 0) {
          return;
        }

        try {
          inputNode.disconnect(chainNodes[0]);
        } catch {
          // Ignore disconnect failures during graph replacement.
        }

        for (const node of chainNodes) {
          try {
            node.disconnect();
          } catch {
            // Ignore disconnect failures during graph replacement.
          }
          if (typeof node.destroy === 'function') {
            try {
              node.destroy();
            } catch {
              // Ignore plugin cleanup failures during graph replacement.
            }
          }
        }
      },
    };
  };
}
