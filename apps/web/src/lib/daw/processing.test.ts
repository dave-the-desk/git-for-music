import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStretchRatio } from './processing';

test('calculateStretchRatio returns target divided by source tempo', () => {
  assert.equal(calculateStretchRatio(120, 90), 0.75);
  assert.equal(calculateStretchRatio(90, 120), 1.3333333333333333);
});
