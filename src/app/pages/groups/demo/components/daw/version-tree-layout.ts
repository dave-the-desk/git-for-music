import type { DawVersion } from '@/app/lib/daw/state/local-project-state';

export type TreeNode = {
  version: DawVersion;
  children: TreeNode[];
};

export type GraphColor = {
  base: string;
  border: string;
  fill: string;
  line: string;
  glow: string;
};

export type GraphNode = {
  id: string;
  version: DawVersion;
  row: number;
  column: number;
  left: number;
  top: number;
  parentIds: string[];
  color: GraphColor;
};

export type GraphEdge = {
  fromId: string;
  toId: string;
  color: string;
};

export function buildGraphEdgePath(
  from: Pick<GraphNode, 'left' | 'top'>,
  to: Pick<GraphNode, 'left' | 'top'>,
  nodeWidth: number,
  nodeHeight: number,
) {
  const fromX = from.left + nodeWidth / 2;
  const fromY = from.top + nodeHeight / 2;
  const toX = to.left + nodeWidth / 2;
  const toY = to.top + nodeHeight / 2;
  const midY = fromY + (toY - fromY) / 2;

  return `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`;
}

export type GraphLayout = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeWidth: number;
  nodeHeight: number;
  width: number;
  height: number;
  scale: number;
  labelFontSize: number;
  metaFontSize: number;
  summaryFontSize: number;
  lineHeight: number;
};

type VersionWithParents = DawVersion & {
  parentIds?: Array<string | null> | null;
};

function getParentIds(version: VersionWithParents) {
  const parentIds = version.parentIds?.length ? version.parentIds : [version.parentId];
  return parentIds.filter((parentId): parentId is string | null => parentId !== undefined);
}

export function compareVersions(left: DawVersion, right: DawVersion) {
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

function getVersionSortKey(version: DawVersion) {
  const createdAt = Date.parse(version.createdAt);
  return {
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    operationSeq: version.operationSeq ?? 0,
    id: version.id,
  };
}

function getColumnColor(column: number): GraphColor {
  const hue = (column * 47 + 28) % 360;
  return {
    base: `hsl(${hue} 88% 63%)`,
    border: `hsl(${hue} 88% 63%)`,
    fill: `hsl(${hue} 52% 13% / 0.88)`,
    line: `hsl(${hue} 88% 63% / 0.7)`,
    glow: `hsl(${hue} 88% 63% / 0.14)`,
  };
}

export function buildTree(versions: DawVersion[]): TreeNode[] {
  const childrenMap = new Map<string | null, VersionWithParents[]>();
  for (const version of versions as VersionWithParents[]) {
    const uniqueParentIds = new Set(getParentIds(version));

    for (const parentId of uniqueParentIds) {
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId)!.push(version);
    }
  }

  for (const siblings of childrenMap.values()) {
    siblings.sort(compareVersions);
  }

  function build(parentId: string | null): TreeNode[] {
    return (childrenMap.get(parentId) ?? []).map((version) => ({
      version,
      children: build(version.id),
    }));
  }

  return build(null);
}

export function buildGraphLayout(versions: DawVersion[]): GraphLayout {
  const sortedVersions = [...versions].sort(compareVersions);
  const versionById = new Map(sortedVersions.map((version) => [version.id, version] as const));
  const childrenMap = new Map<string, VersionWithParents[]>();
  const parentsMap = new Map<string, string[]>();
  const primaryParentById = new Map<string, string | null>();

  for (const version of versions as VersionWithParents[]) {
    const parentIds = Array.from(new Set(getParentIds(version)));
    parentsMap.set(version.id, parentIds.filter((parentId): parentId is string => parentId !== null));
    const primaryParentId = parentIds.find((parentId): parentId is string => parentId !== null) ?? null;
    primaryParentById.set(version.id, primaryParentId);

    if (primaryParentId !== null) {
      if (!childrenMap.has(primaryParentId)) childrenMap.set(primaryParentId, []);
      childrenMap.get(primaryParentId)!.push(version);
    }
  }

  for (const siblings of childrenMap.values()) {
    siblings.sort(compareVersions);
  }

  const widthById = new Map<string, number>();
  const columnById = new Map<string, number>();
  const rowById = new Map<string, number>();
  const recursionStack = new Set<string>();

  function measureSubtreeWidth(version: VersionWithParents): number {
    const cachedWidth = widthById.get(version.id);
    if (cachedWidth !== undefined) {
      return cachedWidth;
    }

    if (recursionStack.has(version.id)) {
      return 1;
    }

    recursionStack.add(version.id);
    const children = childrenMap.get(version.id) ?? [];
    const width =
      children.length === 0
        ? 1
        : children.reduce((sum, child) => sum + measureSubtreeWidth(child), 0);
    recursionStack.delete(version.id);
    widthById.set(version.id, width);
    return width;
  }

  function assignSubtree(version: VersionWithParents, startColumn: number, row: number) {
    if (columnById.has(version.id)) {
      return;
    }

    const width = measureSubtreeWidth(version);
    const children = childrenMap.get(version.id) ?? [];
    rowById.set(version.id, row);
    columnById.set(version.id, startColumn + (width - 1) / 2);

    let childStartColumn = startColumn;
    for (const child of children) {
      assignSubtree(child, childStartColumn, row + 1);
      childStartColumn += measureSubtreeWidth(child);
    }
  }

  const rootVersions = sortedVersions.filter((version) => {
    const primaryParentId = primaryParentById.get(version.id);
    return primaryParentId === null || !versionById.has(primaryParentId);
  });

  let nextRootColumn = 0;
  for (const rootVersion of rootVersions) {
    if (columnById.has(rootVersion.id)) continue;
    assignSubtree(rootVersion, nextRootColumn, 0);
    nextRootColumn += measureSubtreeWidth(rootVersion);
  }

  for (const version of sortedVersions) {
    if (columnById.has(version.id)) continue;
    assignSubtree(version, nextRootColumn, 0);
    nextRootColumn += measureSubtreeWidth(version);
  }

  const rowValues = Array.from(rowById.values());
  const maxRow = rowValues.length > 0 ? Math.max(...rowValues) : 0;
  const rowCount = Math.max(1, maxRow + 1);
  const columnValues = Array.from(columnById.values());
  const minColumn = columnValues.length > 0 ? Math.min(...columnValues) : 0;
  const maxColumn = columnValues.length > 0 ? Math.max(...columnValues) : 0;
  const columnCount = Math.max(1, Math.ceil(maxColumn - minColumn + 1));
  const density = Math.max(0.62, Math.min(1, 1 - Math.max(0, rowCount - 4) * 0.1 - Math.max(0, columnCount - 4) * 0.04));
  const scale = 0.66 * density;
  const baseNodeSize = Math.round(300 * scale);
  const labelFontSize = Math.round(11 * scale + 2);
  const metaFontSize = Math.round(10 * scale + 2);
  const summaryFontSize = Math.round(10 * scale);
  const lineHeight = Number((1.15 + scale * 0.05).toFixed(2));
  const nodeWidth = baseNodeSize;
  const nodeHeight = nodeWidth;
  const xGap = Math.max(Math.round(260 * scale), Math.round(nodeWidth * 1.34));
  const yGap = Math.max(Math.round(228 * scale), Math.round(nodeHeight * 1.26));
  const paddingX = Math.max(Math.round(30 * scale), Math.round(nodeWidth * 0.2));
  const paddingY = Math.max(Math.round(30 * scale), Math.round(nodeHeight * 0.18));

  const width = paddingX * 2 + (columnCount - 1) * xGap + nodeWidth;
  const height = paddingY * 2 + rowCount * yGap + nodeHeight;

  const nodes = sortedVersions.map((version, index) => {
    const column = columnById.get(version.id) ?? 0;
    const row = rowById.get(version.id) ?? index;
    return {
      id: version.id,
      version,
      row,
      column,
      left: paddingX + (column - minColumn) * xGap,
      top: paddingY + row * yGap,
      parentIds: parentsMap.get(version.id) ?? [],
      color: getColumnColor(column),
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    for (const parentId of node.parentIds) {
      const parent = nodeById.get(parentId);
      if (!parent) continue;
      edges.push({ fromId: parent.id, toId: node.id, color: parent.color.line });
    }
  }

  return {
    nodes,
    edges,
    nodeWidth,
    nodeHeight,
    width,
    height,
    scale,
    labelFontSize,
    metaFontSize,
    summaryFontSize,
    lineHeight,
  };
}
