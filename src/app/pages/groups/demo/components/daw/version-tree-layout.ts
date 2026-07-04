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

function isFiniteColumn(column: number | undefined): column is number {
  return typeof column === 'number' && Number.isFinite(column);
}

function findFirstFreeColumn(startColumn: number, occupiedColumns: Set<number>) {
  let column = Math.max(0, startColumn);
  while (occupiedColumns.has(column)) {
    column += 1;
  }
  return column;
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
  const childrenMap = new Map<string, VersionWithParents[]>();
  const parentsMap = new Map<string, string[]>();

  for (const version of versions as VersionWithParents[]) {
    const parentIds = Array.from(new Set(getParentIds(version)));
    parentsMap.set(version.id, parentIds.filter((parentId): parentId is string => parentId !== null));

    for (const parentId of parentIds) {
      if (parentId === null) continue;
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId)!.push(version);
    }
  }

  for (const siblings of childrenMap.values()) {
    siblings.sort(compareVersions);
  }

  const columnById = new Map<string, number>();
  const occupiedColumns = new Set<number>();
  let nextColumn = 0;

  for (const version of [...sortedVersions].reverse()) {
    const children = childrenMap.get(version.id) ?? [];
    const childColumns = children.map((child) => columnById.get(child.id)).filter(isFiniteColumn).sort((a, b) => a - b);
    const branchChildColumns = children
      .filter((child) => (parentsMap.get(child.id)?.length ?? 0) <= 1)
      .map((child) => columnById.get(child.id))
      .filter(isFiniteColumn)
      .sort((a, b) => a - b);

    let column: number;
    if (childColumns.length === 0) {
      column = findFirstFreeColumn(nextColumn, occupiedColumns);
      nextColumn = column + 1;
    } else if (branchChildColumns.length > 0) {
      column = branchChildColumns[0] ?? childColumns[0];
    } else {
      const leftmostChildColumn = childColumns[0] ?? nextColumn;
      column = findFirstFreeColumn(leftmostChildColumn + 1, occupiedColumns);
      nextColumn = Math.max(nextColumn, column + 1);
    }

    columnById.set(version.id, column);
    occupiedColumns.add(column);
  }

  const rowCount = Math.max(1, sortedVersions.length);
  const columnCount = Math.max(1, occupiedColumns.size);
  const density = Math.max(0.62, Math.min(1, 1 - Math.max(0, rowCount - 4) * 0.1 - Math.max(0, columnCount - 4) * 0.04));
  const scale = 0.66 * density;
  const baseNodeSize = Math.round(136 * scale);
  const labelFontSize = Math.round(13 * scale);
  const metaFontSize = Math.round(10.5 * scale);
  const summaryFontSize = Math.round(10 * scale);
  const lineHeight = Number((1.15 + scale * 0.05).toFixed(2));
  const nodeWidth = baseNodeSize;
  const nodeHeight = nodeWidth;
  const xGap = Math.max(Math.round(176 * scale), Math.round(nodeWidth * 1.24));
  const yGap = Math.max(Math.round(126 * scale), Math.round(nodeHeight * 1.08));
  const paddingX = Math.max(Math.round(22 * scale), Math.round(nodeWidth * 0.18));
  const paddingY = Math.max(Math.round(18 * scale), Math.round(nodeHeight * 0.16));

  const nodes = sortedVersions.map((version, row) => {
    const column = columnById.get(version.id) ?? 0;
    return {
      id: version.id,
      version,
      row,
      column,
      left: paddingX + column * xGap,
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

  const width = paddingX * 2 + (columnCount + 1) * xGap + nodeWidth;
  const height = paddingY * 2 + rowCount * yGap + nodeHeight;

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
