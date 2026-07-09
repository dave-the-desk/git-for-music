import assert from 'node:assert/strict';
import test from 'node:test';

test('fake wam plugin exports a usable createInstance factory', async () => {
  const moduleUrl = new URL('../../../../../docs/fake-wam-plugin.mjs', import.meta.url).href;
  const { createInstance } = await import(moduleUrl);

  const disconnect = () => undefined;
  const delayNode = {
    delayTime: { value: 0 },
    disconnect,
  };
  const audioContext = {
    createDelay(maxDelayTime: number) {
      assert.equal(maxDelayTime, 1);
      return delayNode;
    },
  } as unknown as AudioContext;

  const node = createInstance(audioContext, { kind: 'env' }, { kind: 'group' }, 'com.example.fake', '1.0.0');

  assert.equal(node, delayNode);
  assert.equal(node.delayTime.value, 0.18);
  assert.equal(typeof (node as { setParameterValues?: unknown }).setParameterValues, 'function');
});
