import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLatestVersionOrNull, selectVersionById } from './selectors';
import type { DawVersion } from './local-project-state';

function makeVersion(id: string, overrides: Partial<DawVersion> = {}): DawVersion {
  return {
    id,
    label: overrides.label ?? id,
    name: overrides.name ?? overrides.label ?? id,
    branchName: overrides.branchName ?? overrides.label ?? id,
    operationSummary: overrides.operationSummary ?? null,
    createdBy: overrides.createdBy ?? 'user-a',
    description: overrides.description ?? null,
    parentId: overrides.parentId ?? null,
    parentVersionId: overrides.parentVersionId ?? overrides.parentId ?? null,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    operationSeq: overrides.operationSeq ?? 1,
    isCurrent: overrides.isCurrent ?? false,
    tempoBpm: overrides.tempoBpm ?? 120,
    timeSignatureNum: overrides.timeSignatureNum ?? 4,
    timeSignatureDen: overrides.timeSignatureDen ?? 4,
    musicalKey: overrides.musicalKey ?? null,
    tempoSource: overrides.tempoSource ?? 'MANUAL',
    keySource: overrides.keySource ?? 'MANUAL',
    tracks: overrides.tracks ?? [],
  };
}

test('selectLatestVersionOrNull returns the newest version in a timeline', () => {
  const oldest = makeVersion('version-oldest', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const newest = makeVersion('version-newest', {
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });

  assert.equal(selectLatestVersionOrNull([oldest, newest])?.id, newest.id);
});

test('selectVersionById falls back to the newest version instead of the first version', () => {
  const oldest = makeVersion('version-oldest', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const newest = makeVersion('version-newest', {
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });

  assert.equal(selectVersionById([oldest, newest], null)?.id, newest.id);
});
