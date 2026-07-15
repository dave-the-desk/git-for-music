import { EMPTY_TRACK_MIME_TYPE, buildRenderableTrackSegments } from '@/app/lib/daw/utils/segments';
import { DEFAULT_DEMO_TEMPO_BPM, normalizeTempoBpm } from '@/app/lib/daw/utils/timing';
import type {
  DawTrack,
  HostedPluginInstanceState,
  TrackTimelineSegment,
} from '@/app/lib/daw/state/local-project-state';
import type { PlaybackPluginGraph, WamNode } from '@/app/lib/daw/engine/wam-host';

type TrackMixState = {
  muted: boolean;
  solo: boolean;
  gain: number;
  pan: number;
};

type PlaybackProjectTrack = Pick<
  DawTrack,
  | 'trackId'
  | 'trackName'
  | 'trackVersionId'
  | 'storageKey'
  | 'mimeType'
  | 'startOffsetMs'
  | 'durationMs'
  | 'segments'
  | 'recordedTempoBpm'
  | 'sourceTempoBpm'
  | 'plugins'
> & {
  isMuted?: boolean;
};

export type PlaybackProjectSnapshot = {
  tracks: PlaybackProjectTrack[];
  mutedTrackVersionIds: Set<string>;
  soloTrackVersionIds?: Set<string>;
  gainByTrackVersionId?: Record<string, number>;
  panByTrackVersionId?: Record<string, number>;
  localTempoBpm: number;
  sharedDemoTempoBpm?: number | null;
};

export type PlaybackEnginePluginGraphFactory = (
  trackVersionId: string,
  inputNode: AudioNode,
  audioContext: AudioContext,
) => PlaybackPluginGraph;

type TrackBus = {
  input: GainNode;
  gain: GainNode;
  pan: StereoPannerNode;
  pluginGraph: PlaybackPluginGraph | null;
  appliedPluginSnapshot: TrackPluginSnapshotEntry[];
  latencyByInstanceId: Map<string, number>;
};

type TrackPluginSnapshotEntry = Pick<
  HostedPluginInstanceState,
  'instanceId' | 'pluginKey' | 'version' | 'position' | 'bypassed' | 'params' | 'state'
>;

type ScheduledSource = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  trackVersionId: string;
};

const DEFAULT_GAIN = 1;
const DEFAULT_PAN = 0;

function dbToLinear(db: number) {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function interpolateEnvelopeAt(segment: TrackTimelineSegment, elapsedMs: number) {
  const fadeInMs = Math.max(0, segment.fadeInMs + (segment.crossfadeInMs ?? 0));
  const fadeOutMs = Math.max(0, segment.fadeOutMs + (segment.crossfadeOutMs ?? 0));
  const durationMs = Math.max(0, segment.durationMs);
  if (durationMs <= 0) return 0;

  const clampedElapsed = clamp(elapsedMs, 0, durationMs);
  let envelope = 1;

  if (fadeInMs > 0 && clampedElapsed < fadeInMs) {
    envelope *= clampedElapsed / fadeInMs;
  }

  if (fadeOutMs > 0) {
    const remainingMs = durationMs - clampedElapsed;
    if (remainingMs < fadeOutMs) {
      envelope *= Math.max(0, remainingMs / fadeOutMs);
    }
  }

  return clamp(envelope, 0, 1);
}

export class AudioPlaybackEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private readonly bufferCache = new Map<string, Promise<AudioBuffer> | AudioBuffer>();
  private readonly trackBuses = new Map<string, TrackBus>();
  private readonly scheduledSources = new Set<ScheduledSource>();
  private readonly trackMixByTrackVersionId = new Map<string, TrackMixState>();
  private project: PlaybackProjectSnapshot | null = null;
  private isPlaying = false;
  private playheadMs = 0;
  private pluginGraphFactory: PlaybackEnginePluginGraphFactory | null = null;
  private playbackTimelineRate = 1;

  constructor(options?: { pluginGraphFactory?: PlaybackEnginePluginGraphFactory }) {
    this.pluginGraphFactory = options?.pluginGraphFactory ?? null;
  }

  private ensureAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.audioContext.destination);
    }

    return this.audioContext;
  }

  private getMasterGain() {
    return this.masterGain ?? this.ensureAudioContext().createGain();
  }

  private ensureTrackBus(trackVersionId: string) {
    const existing = this.trackBuses.get(trackVersionId);
    if (existing) return existing;

    const audioContext = this.ensureAudioContext();
    const input = audioContext.createGain();
    const pluginGraph = this.pluginGraphFactory
      ? this.pluginGraphFactory(trackVersionId, input, audioContext)
      : {
          outputNode: input,
          nodesByInstanceId: new Map<string, WamNode>(),
          latencyByInstanceId: new Map<string, number>(),
          issues: [],
          teardown: () => {},
        };
    const gain = audioContext.createGain();
    const pan = audioContext.createStereoPanner();

    pluginGraph.outputNode.connect(gain);
    gain.connect(pan);
    pan.connect(this.getMasterGain());

    const bus: TrackBus = {
      input,
      gain,
      pan,
      pluginGraph,
      appliedPluginSnapshot: [],
      latencyByInstanceId: new Map(),
    };
    this.trackBuses.set(trackVersionId, bus);
    this.applyTrackMix(trackVersionId);
    return bus;
  }

  private getTrackPluginGraph(trackVersionId: string) {
    const bus = this.trackBuses.get(trackVersionId);
    return bus?.pluginGraph ?? null;
  }

  private getTrackPlugins(trackVersionId: string) {
    const track = this.project?.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    return track?.plugins ?? [];
  }

  private getActiveSoloTrackVersionId() {
    for (const [trackVersionId, mix] of this.trackMixByTrackVersionId.entries()) {
      if (mix.solo) {
        return trackVersionId;
      }
    }
    return null;
  }

  private snapshotTrackPlugins(trackVersionId: string) {
    return this.getTrackPlugins(trackVersionId)
      .slice()
      .sort((left, right) => {
        const byPosition = left.position - right.position;
        if (byPosition !== 0) return byPosition;
        return left.instanceId.localeCompare(right.instanceId);
      })
      .map((plugin) => ({
        instanceId: plugin.instanceId,
        pluginKey: plugin.pluginKey,
        version: plugin.version,
        position: plugin.position,
        bypassed: plugin.bypassed,
        params: { ...plugin.params },
        state:
          plugin.state && typeof plugin.state === 'object' && !Array.isArray(plugin.state)
            ? structuredClone(plugin.state)
            : plugin.state,
      }));
  }

  private rebuildTrackPluginChainInternal(trackVersionId: string) {
    const bus = this.trackBuses.get(trackVersionId);
    if (!bus) return;

    const track = this.project?.tracks.find((candidate) => candidate.trackVersionId === trackVersionId);
    if (!track) {
      this.teardownTrackBus(trackVersionId);
      return;
    }

    try {
      bus.pluginGraph?.teardown();
    } catch {
      // Best effort teardown when replacing a live graph.
    }

    const audioContext = this.ensureAudioContext();
    const nextPluginGraph = this.pluginGraphFactory
      ? this.pluginGraphFactory(trackVersionId, bus.input, audioContext)
      : {
          outputNode: bus.input,
          nodesByInstanceId: new Map<string, WamNode>(),
          latencyByInstanceId: new Map<string, number>(),
          issues: [],
          teardown: () => {},
        };

    nextPluginGraph.outputNode.connect(bus.gain);
    bus.pluginGraph = nextPluginGraph;
    bus.latencyByInstanceId = new Map(nextPluginGraph.latencyByInstanceId ?? []);
    bus.appliedPluginSnapshot = this.snapshotTrackPlugins(trackVersionId);
    this.applyTrackMix(trackVersionId);
  }

  private teardownTrackBus(trackVersionId: string) {
    const bus = this.trackBuses.get(trackVersionId);
    if (!bus) return;

    try {
      bus.pluginGraph?.teardown();
    } catch {
      // Best effort teardown when removing a track bus.
    }

    try {
      bus.gain.disconnect();
    } catch {
      // Ignore disconnect failures on torn-down buses.
    }

    try {
      bus.pan.disconnect();
    } catch {
      // Ignore disconnect failures on torn-down buses.
    }

    this.trackBuses.delete(trackVersionId);
  }

  private applyTrackMix(trackVersionId: string) {
    const bus = this.trackBuses.get(trackVersionId);
    if (!bus) return;

    const mix = this.trackMixByTrackVersionId.get(trackVersionId) ?? {
      muted: false,
      solo: false,
      gain: DEFAULT_GAIN,
      pan: DEFAULT_PAN,
    };

    const activeSoloTrackVersionId = this.getActiveSoloTrackVersionId();
    const audible = !mix.muted && (!activeSoloTrackVersionId || activeSoloTrackVersionId === trackVersionId);
    bus.gain.gain.value = audible ? clamp(mix.gain, 0, 8) : 0;
    bus.pan.pan.value = clamp(mix.pan, -1, 1);
  }

  private applyTrackMixes() {
    for (const trackVersionId of this.trackBuses.keys()) {
      this.applyTrackMix(trackVersionId);
    }
  }

  private async loadBuffer(storageKey: string) {
    const cached = this.bufferCache.get(storageKey);
    if (cached instanceof AudioBuffer) {
      return cached;
    }
    if (cached) {
      return cached;
    }

    const loadPromise = (async () => {
      const response = await fetch(storageKey);
      if (!response.ok) {
        throw new Error(`Could not load audio buffer: ${response.status}`);
      }

      const bytes = await response.arrayBuffer();
      const audioContext = this.ensureAudioContext();
      return audioContext.decodeAudioData(bytes.slice(0));
    })();

    this.bufferCache.set(storageKey, loadPromise);

    try {
      const buffer = await loadPromise;
      this.bufferCache.set(storageKey, buffer);
      return buffer;
    } catch (error) {
      this.bufferCache.delete(storageKey);
      throw error;
    }
  }

  async preloadTracks(tracks: Pick<DawTrack, 'storageKey'>[]) {
    await Promise.all(
      [...new Set(tracks.map((track) => track.storageKey))].map(async (storageKey) => {
        try {
          await this.loadBuffer(storageKey);
        } catch {
          // Best effort preloading; playback can still attempt to load on demand.
        }
      }),
    );
  }

  setProject(project: PlaybackProjectSnapshot) {
    this.project = project;
    const activeSoloTrackVersionId =
      project.tracks.find((track) => project.soloTrackVersionIds?.has(track.trackVersionId))?.trackVersionId ?? null;

    for (const track of project.tracks) {
      const currentMix = this.trackMixByTrackVersionId.get(track.trackVersionId);
      this.trackMixByTrackVersionId.set(track.trackVersionId, {
        muted: project.mutedTrackVersionIds.has(track.trackVersionId),
        solo: activeSoloTrackVersionId === track.trackVersionId,
        gain: project.gainByTrackVersionId?.[track.trackVersionId] ?? currentMix?.gain ?? DEFAULT_GAIN,
        pan: project.panByTrackVersionId?.[track.trackVersionId] ?? currentMix?.pan ?? DEFAULT_PAN,
      });
      const existingBus = this.trackBuses.get(track.trackVersionId);
      if (!existingBus) {
        const bus = this.ensureTrackBus(track.trackVersionId);
        bus.appliedPluginSnapshot = this.snapshotTrackPlugins(track.trackVersionId);
        bus.latencyByInstanceId = new Map(bus.pluginGraph?.latencyByInstanceId ?? []);
        continue;
      }

      const nextSnapshot = this.snapshotTrackPlugins(track.trackVersionId);
      const previousSnapshot = existingBus.appliedPluginSnapshot;
      const nextStructure = JSON.stringify(
        nextSnapshot.map(({ instanceId, pluginKey, version, position, bypassed }) => ({
          instanceId,
          pluginKey,
          version,
          position,
          bypassed,
        })),
      );
      const previousStructure = JSON.stringify(
        previousSnapshot.map(({ instanceId, pluginKey, version, position, bypassed }) => ({
          instanceId,
          pluginKey,
          version,
          position,
          bypassed,
        })),
      );

      if (existingBus.pluginGraph === null || nextStructure !== previousStructure) {
        this.rebuildTrackPluginChainInternal(track.trackVersionId);
      } else {
        for (const plugin of nextSnapshot) {
          const node = existingBus.pluginGraph.nodesByInstanceId.get(plugin.instanceId);
          if (!node) continue;

          for (const [paramId, value] of Object.entries(plugin.params)) {
            node.setParameterValues?.({ [paramId]: value });
          }

          if (plugin.state !== undefined) {
            node.setState?.(plugin.state);
            node.applyState?.(plugin.state);
          }
        }
      }

      existingBus.appliedPluginSnapshot = nextSnapshot;
      existingBus.latencyByInstanceId = new Map(existingBus.pluginGraph?.latencyByInstanceId ?? []);
    }

    for (const trackVersionId of [...this.trackMixByTrackVersionId.keys()]) {
      if (!project.tracks.some((track) => track.trackVersionId === trackVersionId)) {
        this.trackMixByTrackVersionId.delete(trackVersionId);
        this.teardownTrackBus(trackVersionId);
      }
    }

    this.applyTrackMixes();
  }

  setTrackMuted(trackVersionId: string, muted: boolean) {
    const existing = this.trackMixByTrackVersionId.get(trackVersionId) ?? {
      muted: false,
      solo: false,
      gain: DEFAULT_GAIN,
      pan: DEFAULT_PAN,
    };
    this.trackMixByTrackVersionId.set(trackVersionId, { ...existing, muted });
    this.applyTrackMix(trackVersionId);
  }

  setTrackSolo(trackVersionId: string, solo: boolean) {
    const existing = this.trackMixByTrackVersionId.get(trackVersionId) ?? {
      muted: false,
      solo: false,
      gain: DEFAULT_GAIN,
      pan: DEFAULT_PAN,
    };
    this.trackMixByTrackVersionId.set(trackVersionId, { ...existing, solo });
    if (solo) {
      for (const [otherTrackVersionId, mix] of this.trackMixByTrackVersionId.entries()) {
        if (otherTrackVersionId === trackVersionId || !mix.solo) continue;
        this.trackMixByTrackVersionId.set(otherTrackVersionId, { ...mix, solo: false });
      }
    }
    this.applyTrackMixes();
  }

  setTrackGain(trackVersionId: string, gain: number) {
    const existing = this.trackMixByTrackVersionId.get(trackVersionId) ?? {
      muted: false,
      solo: false,
      gain: DEFAULT_GAIN,
      pan: DEFAULT_PAN,
    };
    this.trackMixByTrackVersionId.set(trackVersionId, { ...existing, gain });
    this.applyTrackMix(trackVersionId);
  }

  setTrackPan(trackVersionId: string, pan: number) {
    const existing = this.trackMixByTrackVersionId.get(trackVersionId) ?? {
      muted: false,
      solo: false,
      gain: DEFAULT_GAIN,
      pan: DEFAULT_PAN,
    };
    this.trackMixByTrackVersionId.set(trackVersionId, { ...existing, pan });
    this.applyTrackMix(trackVersionId);
  }

  rebuildTrackPluginChain(trackVersionId: string) {
    if (!this.project) return;
    this.rebuildTrackPluginChainInternal(trackVersionId);
  }

  /**
   * Latency is captured for diagnostics only; the playback engine does not yet compensate it.
   */
  getPluginLatencyMs(trackVersionId: string, instanceId: string) {
    return this.trackBuses.get(trackVersionId)?.latencyByInstanceId.get(instanceId) ?? null;
  }

  setPluginParam(trackVersionId: string, instanceId: string, paramId: string, value: number) {
    const pluginGraph = this.getTrackPluginGraph(trackVersionId);
    const node = pluginGraph?.nodesByInstanceId.get(instanceId);
    if (!node) return;

    node.setParameterValues?.({ [paramId]: value });
  }

  setPluginBypass(trackVersionId: string, instanceId: string, bypassed: boolean) {
    const track = this.getTrackPlugins(trackVersionId).find((plugin) => plugin.instanceId === instanceId);
    if (!track || track.bypassed === bypassed) return;

    this.rebuildTrackPluginChainInternal(trackVersionId);
  }

  async play(timeMs?: number) {
    if (!this.project) return;

    const nextTimeMs = Math.max(0, timeMs ?? this.playheadMs);
    this.playheadMs = nextTimeMs;
    this.isPlaying = true;

    const audioContext = this.ensureAudioContext();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    this.stopScheduledSources();
    await this.schedulePlayback(nextTimeMs);
  }

  pause() {
    this.playheadMs = this.getCurrentTimeMs();
    this.isPlaying = false;
    this.stopScheduledSources();
  }

  stop() {
    this.playheadMs = 0;
    this.isPlaying = false;
    this.stopScheduledSources();
  }

  seek(timeMs: number) {
    this.playheadMs = Math.max(0, timeMs);
    if (this.isPlaying) {
      void this.restartPlayback(this.playheadMs);
    }
  }

  getCurrentTimeMs() {
    if (!this.isPlaying || !this.audioContext) {
      return this.playheadMs;
    }
    const elapsedMs = (this.audioContext.currentTime - this.playStartAudioTime) * 1000 * this.playbackTimelineRate;
    return Math.max(0, this.playStartWallTimeMs + elapsedMs);
  }

  dispose() {
    this.stopScheduledSources();
    for (const trackVersionId of [...this.trackBuses.keys()]) {
      this.teardownTrackBus(trackVersionId);
    }
    this.project = null;
    this.trackMixByTrackVersionId.clear();
    this.bufferCache.clear();
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.masterGain = null;
  }

  private playStartWallTimeMs = 0;
  private playStartAudioTime = 0;

  private async restartPlayback(timeMs: number) {
    if (!this.project) return;
    this.stopScheduledSources();
    this.playheadMs = Math.max(0, timeMs);
    await this.schedulePlayback(this.playheadMs);
  }

  private stopScheduledSources() {
    for (const scheduled of this.scheduledSources) {
      try {
        scheduled.source.stop();
      } catch {
        // Ignore nodes that already ended.
      }
      scheduled.source.onended = null;
    }
    this.scheduledSources.clear();
  }

  private async schedulePlayback(timeMs: number) {
    if (!this.project) return;

    const audioContext = this.ensureAudioContext();
    const sharedTempoBpm = normalizeTempoBpm(this.project.sharedDemoTempoBpm, DEFAULT_DEMO_TEMPO_BPM);
    const localTempoBpm = normalizeTempoBpm(this.project.localTempoBpm, sharedTempoBpm);
    this.playbackTimelineRate = clamp(localTempoBpm / sharedTempoBpm, 0.25, 4.0);
    this.playStartWallTimeMs = timeMs;
    this.playStartAudioTime = audioContext.currentTime;

    await Promise.all(
      this.project.tracks.map(async (track) => {
        const buffer = await this.loadBuffer(track.storageKey).catch(() => null);
        if (!buffer) return;

        const segments = buildRenderableTrackSegments({
          trackVersionId: track.trackVersionId,
          trackStartOffsetMs: track.startOffsetMs,
          segments: track.segments,
          fallbackDurationMs: Math.max(0, Math.max(track.durationMs ?? 0, Math.round(buffer.duration * 1000))),
          allowImplicitSegment: track.mimeType !== EMPTY_TRACK_MIME_TYPE,
        });

        const bus = this.ensureTrackBus(track.trackVersionId);
        const mix = this.trackMixByTrackVersionId.get(track.trackVersionId) ?? {
          muted: false,
          solo: false,
          gain: DEFAULT_GAIN,
          pan: DEFAULT_PAN,
        };
        const activeSoloTrackVersionId = this.getActiveSoloTrackVersionId();
        const trackAudible = !mix.muted && (!activeSoloTrackVersionId || activeSoloTrackVersionId === track.trackVersionId);
        const trackBaseGain = trackAudible ? clamp(mix.gain, 0, 8) : 0;
        const trackPan = clamp(mix.pan, -1, 1);
        const recordedTempoBpm = normalizeTempoBpm(
          track.recordedTempoBpm ?? track.sourceTempoBpm,
          sharedTempoBpm,
        );
        const playbackRate = clamp(localTempoBpm / recordedTempoBpm, 0.25, 4.0);
        bus.gain.gain.setValueAtTime(trackBaseGain, audioContext.currentTime);
        bus.pan.pan.setValueAtTime(trackPan, audioContext.currentTime);

        for (const segment of segments) {
          if (segment.timelineEndMs <= timeMs) continue;

          const segmentStartTimelineMs = Math.max(timeMs, segment.timelineStartMs);
          const elapsedInSegmentMs = Math.max(0, segmentStartTimelineMs - segment.timelineStartMs);
          const sourceOffsetMs = segment.sourceStartMs + elapsedInSegmentMs;
          const remainingSegmentMs = Math.max(0, segment.timelineEndMs - segmentStartTimelineMs);
          const sourceDurationMs = Math.max(0, segment.durationMs - elapsedInSegmentMs);
          const sourceDurationSec = Math.min(
            sourceDurationMs / 1000,
            Math.max(0, (segment.sourceEndMs - sourceOffsetMs) / 1000),
          );
          if (sourceDurationSec <= 0) continue;

          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = playbackRate;

          const segmentGain = audioContext.createGain();
          const baseSegmentGain = dbToLinear(segment.gainDb);
          const segmentAudible = segment.isMuted ? 0 : 1;
          const segmentEnvelopeAtStart = interpolateEnvelopeAt(segment, elapsedInSegmentMs);
          const startingGain = baseSegmentGain * segmentAudible * segmentEnvelopeAtStart;

          segmentGain.gain.setValueAtTime(startingGain, audioContext.currentTime);

          // Crossfade curves are preserved in metadata, but playback currently applies a linear ramp.
          const fadeInMs = Math.max(0, segment.fadeInMs + (segment.crossfadeInMs ?? 0));
          const fadeOutMs = Math.max(0, segment.fadeOutMs + (segment.crossfadeOutMs ?? 0));
          if (fadeInMs > elapsedInSegmentMs) {
            const remainingFadeInMs = fadeInMs - elapsedInSegmentMs;
            segmentGain.gain.linearRampToValueAtTime(
              baseSegmentGain * segmentAudible,
              audioContext.currentTime + remainingFadeInMs / 1000,
            );
          } else {
            segmentGain.gain.setValueAtTime(
              baseSegmentGain * segmentAudible,
              audioContext.currentTime,
            );
          }

          if (fadeOutMs > 0) {
            const remainingToFadeOutMs = segment.durationMs - elapsedInSegmentMs - fadeOutMs;
            if (remainingToFadeOutMs > 0) {
              segmentGain.gain.setValueAtTime(
                baseSegmentGain * segmentAudible,
                audioContext.currentTime + remainingToFadeOutMs / 1000,
              );
            }
            segmentGain.gain.linearRampToValueAtTime(
              0,
              audioContext.currentTime + Math.max(0, remainingSegmentMs) / 1000,
            );
          }

          source.connect(segmentGain);
          segmentGain.connect(bus.input);
          source.start(
            audioContext.currentTime + Math.max(0, (segmentStartTimelineMs - timeMs) / 1000),
            sourceOffsetMs / 1000,
            sourceDurationSec,
          );

          const scheduled: ScheduledSource = {
            source,
            gain: segmentGain,
            trackVersionId: track.trackVersionId,
          };
          this.scheduledSources.add(scheduled);
          source.onended = () => {
            this.scheduledSources.delete(scheduled);
            source.onended = null;
            try {
              segmentGain.disconnect();
            } catch {
              // Ignore disconnect failures on finished nodes.
            }
            try {
              source.disconnect();
            } catch {
              // Ignore disconnect failures on finished nodes.
            }
          };
        }
      }),
    );
  }
}
