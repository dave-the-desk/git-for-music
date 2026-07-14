import test from 'node:test';
import assert from 'node:assert/strict';
import type { DawVersion } from '@/app/lib/daw/state/local-project-state';
import { buildGraphEdgePath, buildGraphLayout } from './version-tree-layout';

type VersionFixture = Partial<DawVersion> & {
  parentIds?: string[];
};

function makeVersion(id: string, overrides: VersionFixture = {}): DawVersion & VersionFixture {
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
    kind: overrides.kind ?? 'EXPLICIT',
    operationSeq: overrides.operationSeq ?? 1,
    isCurrent: overrides.isCurrent ?? false,
    tempoBpm: overrides.tempoBpm ?? 120,
    timeSignatureNum: overrides.timeSignatureNum ?? 4,
    timeSignatureDen: overrides.timeSignatureDen ?? 4,
    musicalKey: overrides.musicalKey ?? null,
    tempoSource: overrides.tempoSource ?? 'MANUAL',
    keySource: overrides.keySource ?? 'MANUAL',
    tracks: overrides.tracks ?? [],
    parentIds: overrides.parentIds,
  };
}

test('buildGraphLayout keeps a chain in a single column and topological rows', () => {
  const root = makeVersion('version-root', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const middle = makeVersion('version-middle', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });
  const head = makeVersion('version-head', {
    parentId: middle.id,
    parentVersionId: middle.id,
    createdAt: '2025-01-03T00:00:00.000Z',
    operationSeq: 3,
  });

  const layout = buildGraphLayout([head, root, middle]);
  const rootNode = layout.nodes.find((node) => node.id === root.id);
  const middleNode = layout.nodes.find((node) => node.id === middle.id);
  const headNode = layout.nodes.find((node) => node.id === head.id);

  assert.equal(rootNode?.row, 0);
  assert.equal(middleNode?.row, 1);
  assert.equal(headNode?.row, 2);
  assert.ok(layout.nodeWidth > 140);
  assert.ok(layout.nodeHeight > 140);
  assert.equal(rootNode?.column, 0);
  assert.equal(middleNode?.column, 0);
  assert.equal(headNode?.column, 0);
});

test('buildGraphLayout centers a two-way fork over the sibling span', () => {
  const root = makeVersion('version-root', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const firstBranch = makeVersion('version-first-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 3,
  });
  const secondBranch = makeVersion('version-second-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });

  const layout = buildGraphLayout([secondBranch, root, firstBranch]);
  const rootNode = layout.nodes.find((node) => node.id === root.id);
  const firstNode = layout.nodes.find((node) => node.id === firstBranch.id);
  const secondNode = layout.nodes.find((node) => node.id === secondBranch.id);

  assert.equal(rootNode?.row, 0);
  assert.equal(firstNode?.row, 1);
  assert.equal(secondNode?.row, 1);
  assert.equal(secondNode?.column, 0);
  assert.equal(firstNode?.column, 1);
  assert.equal(rootNode?.column, 0.5);
  assert.equal(rootNode?.left, ((firstNode?.left ?? 0) + (secondNode?.left ?? 0)) / 2);
});

test('buildGraphLayout centers a wider fork across all sibling children', () => {
  const root = makeVersion('version-root', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const firstBranch = makeVersion('version-first-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });
  const secondBranch = makeVersion('version-second-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 3,
  });
  const thirdBranch = makeVersion('version-third-branch', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 4,
  });

  const layout = buildGraphLayout([thirdBranch, root, secondBranch, firstBranch]);
  const rootNode = layout.nodes.find((node) => node.id === root.id);
  const branchNodes = [firstBranch, secondBranch, thirdBranch].map((branch) =>
    layout.nodes.find((node) => node.id === branch.id),
  );

  assert.equal(branchNodes[0]?.row, 1);
  assert.equal(branchNodes[1]?.row, 1);
  assert.equal(branchNodes[2]?.row, 1);
  assert.equal(branchNodes[0]?.column, 0);
  assert.equal(branchNodes[1]?.column, 1);
  assert.equal(branchNodes[2]?.column, 2);
  assert.equal(rootNode?.column, 1);
  assert.equal(rootNode?.left, (branchNodes[0]?.left ?? 0) + ((branchNodes[2]?.left ?? 0) - (branchNodes[0]?.left ?? 0)) / 2);
});

test('buildGraphLayout keeps merge layouts deterministic with parallel lanes', () => {
  const leftParent = makeVersion('version-left-parent', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const rightParent = makeVersion('version-right-parent', {
    createdAt: '2025-01-01T12:00:00.000Z',
    operationSeq: 2,
  });
  const mergeChild = makeVersion('version-merge', {
    parentId: leftParent.id,
    parentVersionId: leftParent.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 3,
    parentIds: [leftParent.id, rightParent.id],
  });

  const layout = buildGraphLayout([mergeChild, rightParent, leftParent]);
  const leftNode = layout.nodes.find((node) => node.id === leftParent.id);
  const rightNode = layout.nodes.find((node) => node.id === rightParent.id);
  const mergeNode = layout.nodes.find((node) => node.id === mergeChild.id);
  const edgesToMerge = layout.edges.filter((edge) => edge.toId === mergeChild.id);

  assert.equal(mergeNode?.column, 0);
  assert.equal(leftNode?.column, 0);
  assert.equal(rightNode?.column, 1);
  assert.equal(edgesToMerge.length, 2);
  assert.ok(edgesToMerge.some((edge) => edge.fromId === rightParent.id && edge.color === rightNode?.color.line));
  assert.ok(edgesToMerge.some((edge) => edge.fromId === leftParent.id && edge.color === leftNode?.color.line));
});

test('buildGraphLayout is deterministic across input order', () => {
  const root = makeVersion('version-root', {
    createdAt: '2025-01-01T00:00:00.000Z',
    operationSeq: 1,
  });
  const branchA = makeVersion('version-branch-a', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 2,
  });
  const branchB = makeVersion('version-branch-b', {
    parentId: root.id,
    parentVersionId: root.id,
    createdAt: '2025-01-02T00:00:00.000Z',
    operationSeq: 3,
  });
  const merge = makeVersion('version-merge', {
    parentId: branchA.id,
    parentVersionId: branchA.id,
    parentIds: [branchA.id, branchB.id],
    createdAt: '2025-01-03T00:00:00.000Z',
    operationSeq: 4,
  });

  const firstLayout = buildGraphLayout([merge, branchB, root, branchA]);
  const secondLayout = buildGraphLayout([branchA, merge, root, branchB]);

  assert.deepEqual(
    firstLayout.nodes.map(({ id, row, column, left, top, color }) => ({
      id,
      row,
      column,
      left,
      top,
      color,
    })),
    secondLayout.nodes.map(({ id, row, column, left, top, color }) => ({
      id,
      row,
      column,
      left,
      top,
      color,
    })),
  );
  assert.deepEqual(firstLayout.edges, secondLayout.edges);
});

test('buildGraphEdgePath routes with orthogonal elbows', () => {
  const path = buildGraphEdgePath(
    { left: 10, top: 20 },
    { left: 70, top: 140 },
    40,
    40,
  );

  assert.equal(path, 'M 30 40 L 30 100 L 90 100 L 90 160');
});
