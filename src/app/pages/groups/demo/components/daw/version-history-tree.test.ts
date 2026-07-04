import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from './version-tree-layout';
import type { DawVersion } from '@/app/lib/daw/state/local-project-state';

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

test('buildTree keeps branch nodes under the correct parent and sorts siblings by operation sequence', () => {
  const root = makeVersion('version-root', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
    isCurrent: true,
  });
  const firstChild = makeVersion('version-first', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });
  const secondChild = makeVersion('version-second', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 3,
  });

  const tree = buildTree([secondChild, root, firstChild]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.version.id, root.id);
  assert.equal(tree[0]?.children.length, 2);
  assert.equal(tree[0]?.children[0]?.version.id, firstChild.id);
  assert.equal(tree[0]?.children[1]?.version.id, secondChild.id);
});

test('buildTree keeps future merge children attached to each parent id', () => {
  const rootA = makeVersion('version-root-a', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const rootB = makeVersion('version-root-b', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 2,
  });
  const mergeChild = {
    ...makeVersion('version-merge', {
      parentId: rootA.id,
      parentVersionId: rootA.id,
      createdAt: '2025-01-03T00:00:00.000Z',
      operationSeq: 4,
    }),
    parentIds: [rootA.id, rootB.id],
  } as DawVersion & { parentIds: string[] };

  const tree = buildTree([mergeChild, rootB, rootA]);

  assert.equal(tree.length, 2);
  assert.equal(tree[0]?.version.id, rootA.id);
  assert.equal(tree[1]?.version.id, rootB.id);
  assert.equal(tree[0]?.children[0]?.version.id, mergeChild.id);
  assert.equal(tree[1]?.children[0]?.version.id, mergeChild.id);
});
