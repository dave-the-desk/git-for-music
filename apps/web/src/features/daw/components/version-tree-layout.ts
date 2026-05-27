import type { DawVersion } from '@/features/daw/state/local-project-state';

export type TreeNode = {
  version: DawVersion;
  children: TreeNode[];
};

function getVersionSortKey(version: DawVersion) {
  const createdAt = Date.parse(version.createdAt);
  return {
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    operationSeq: version.operationSeq ?? 0,
    id: version.id,
  };
}

function compareVersions(left: DawVersion, right: DawVersion) {
  const leftKey = getVersionSortKey(left);
  const rightKey = getVersionSortKey(right);

  if (leftKey.createdAt !== rightKey.createdAt) {
    return leftKey.createdAt - rightKey.createdAt;
  }
  if (leftKey.operationSeq !== rightKey.operationSeq) {
    return leftKey.operationSeq - rightKey.operationSeq;
  }
  return leftKey.id.localeCompare(rightKey.id);
}

export function buildTree(versions: DawVersion[]): TreeNode[] {
  const childrenOf = new Map<string | null, DawVersion[]>();
  for (const version of versions) {
    const key = version.parentId ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(version);
  }

  for (const siblings of childrenOf.values()) {
    siblings.sort(compareVersions);
  }

  function build(parentId: string | null): TreeNode[] {
    return (childrenOf.get(parentId) ?? []).map((version) => ({
      version,
      children: build(version.id),
    }));
  }

  return build(null);
}
