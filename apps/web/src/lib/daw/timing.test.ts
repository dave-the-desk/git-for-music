import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBarBeatLabel, snapMsToGrid } from './timing';

test('formatBarBeatLabel converts seconds into bar.beat labels', () => {
  const timing = {
    tempoBpm: 120,
    timeSignature: { num: 4, den: 4 },
    musicalKey: null,
    tempoSource: 'MANUAL',
    keySource: 'MANUAL',
  } as const;

  assert.equal(formatBarBeatLabel(0, timing), '1.1');
  assert.equal(formatBarBeatLabel(0.51, timing), '1.2');
  assert.equal(formatBarBeatLabel(2.01, timing), '2.1');
});

test('snapMsToGrid snaps to beat subdivisions', () => {
  const timing = {
    tempoBpm: 120,
    timeSignature: { num: 4, den: 4 },
    musicalKey: null,
    tempoSource: 'MANUAL',
    keySource: 'MANUAL',
  } as const;

  assert.equal(snapMsToGrid(260, timing, 'beat'), 500);
  assert.equal(snapMsToGrid(260, timing, 'halfBeat'), 250);
  assert.equal(snapMsToGrid(260, timing, 'off'), 260);
});
