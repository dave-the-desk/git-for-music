import assert from 'node:assert/strict';
import test from 'node:test';

test('fake wam plugin exports a usable createInstance factory', async () => {
  const moduleUrl = new URL('../../../../../docs/fake-wam-plugin.js', import.meta.url).href;
  const { createInstance } = await import(moduleUrl);

  const disconnect = () => undefined;
  const gainNode = {
    gain: { value: 0 },
    disconnect,
  };
  const audioContext = {
    createGain() {
      return gainNode;
    },
  } as unknown as AudioContext;

  const node = createInstance(audioContext, { kind: 'env' }, { kind: 'group' }, 'com.example.fake', '1.0.0');

  assert.equal(node, gainNode);
  assert.equal(node.gain.value, 1);
  assert.equal(typeof (node as { setParameterValues?: unknown }).setParameterValues, 'function');
});
