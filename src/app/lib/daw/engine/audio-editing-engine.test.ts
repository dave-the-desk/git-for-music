import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEditingEngine } from '@/app/lib/daw/engine/audio-editing-engine';

test('AudioEditingEngine builds plugin operation commit requests', () => {
  const engine = new AudioEditingEngine({ demoId: 'demo-1' });

  assert.deepEqual(
    engine.addPlugin({
      trackVersionId: 'track-version-1',
      plugin: {
        instanceId: 'plugin-1',
        pluginKey: 'com.example.delay',
        version: '1.0.0',
        backend: 'wam',
        position: 0,
        bypassed: false,
        params: { mix: 0.5 },
        state: { preset: 'wide' },
        stateBlobKey: null,
      },
    }),
    {
      demoId: 'demo-1',
      operationType: 'PLUGIN_ADDED',
      payload: {
        trackVersionId: 'track-version-1',
        instanceId: 'plugin-1',
        pluginKey: 'com.example.delay',
        version: '1.0.0',
        backend: 'wam',
        position: 0,
        bypassed: false,
        params: { mix: 0.5 },
        state: { preset: 'wide' },
        stateBlobKey: null,
      },
    },
  );

  assert.deepEqual(
    engine.removePlugin({ trackVersionId: 'track-version-1', instanceId: 'plugin-1' }),
    {
      demoId: 'demo-1',
      operationType: 'PLUGIN_REMOVED',
      payload: {
        trackVersionId: 'track-version-1',
        instanceId: 'plugin-1',
      },
    },
  );

  assert.deepEqual(
    engine.reorderPlugin({
      trackVersionId: 'track-version-1',
      instanceId: 'plugin-1',
      position: 2,
    }),
    {
      demoId: 'demo-1',
      operationType: 'PLUGIN_REORDERED',
      payload: {
        trackVersionId: 'track-version-1',
        instanceId: 'plugin-1',
        position: 2,
      },
    },
  );

  assert.deepEqual(
    engine.setPluginParam({
      trackVersionId: 'track-version-1',
      instanceId: 'plugin-1',
      paramId: 'mix',
      value: 0.75,
    }),
    {
      demoId: 'demo-1',
      operationType: 'PLUGIN_PARAM_SET',
      payload: {
        trackVersionId: 'track-version-1',
        instanceId: 'plugin-1',
        paramId: 'mix',
        value: 0.75,
      },
    },
  );

  assert.deepEqual(
    engine.setPluginBypass({
      trackVersionId: 'track-version-1',
      instanceId: 'plugin-1',
      bypassed: true,
    }),
    {
      demoId: 'demo-1',
      operationType: 'PLUGIN_BYPASS_SET',
      payload: {
        trackVersionId: 'track-version-1',
        instanceId: 'plugin-1',
        bypassed: true,
      },
    },
  );

  assert.deepEqual(
    engine.setPluginState({
      trackVersionId: 'track-version-1',
      instanceId: 'plugin-1',
      state: { preset: 'bright' },
      stateBlobKey: 'blob-key-1',
    }),
    {
      demoId: 'demo-1',
      operationType: 'PLUGIN_STATE_SET',
      payload: {
        trackVersionId: 'track-version-1',
        instanceId: 'plugin-1',
        state: { preset: 'bright' },
        stateBlobKey: 'blob-key-1',
      },
    },
  );
});
