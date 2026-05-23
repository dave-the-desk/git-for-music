'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DawVersion } from '@/features/daw/state/local-project-state';
import {
  buildVersionsById,
  getVersionDisplayLabel,
  getVersionOperationSummary,
} from '@/features/daw/utils/version-labels';

type TreeNode = {
  version: DawVersion;
  children: TreeNode[];
};

function buildTree(versions: DawVersion[]): TreeNode[] {
  const childrenOf = new Map<string | null, DawVersion[]>();
  for (const v of versions) {
    const key = v.parentId ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(v);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
  function build(parentId: string | null): TreeNode[] {
    return (childrenOf.get(parentId) ?? []).map((v) => ({
      version: v,
      children: build(v.id),
    }));
  }
  return build(null);
}

function shortId(id: string) {
  return id.slice(0, 7);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type RenameState = {
  versionId: string;
  value: string;
  saving: boolean;
  error: string | null;
};

type GraphNode = {
  id: string;
  version: DawVersion;
  row: number;
  depth: number;
  left: number;
  top: number;
  parentId: string | null;
};

type GraphEdge = {
  fromId: string;
  toId: string;
};

type GraphLayout = {
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

const TREE_SCALE = 0.82;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function estimateTextWidth(text: string, fontSize: number) {
  return text.length * fontSize * 0.6;
}

function getRequiredNodeDiameter(
  label: string,
  summary: string,
  metaLabel: string,
  baseDiameter: number,
  labelFontSize: number,
  metaFontSize: number,
  summaryFontSize: number,
) {
  const labelWidth = estimateTextWidth(label, labelFontSize);
  const metaWidth = estimateTextWidth(metaLabel, metaFontSize);
  const summaryWidth = estimateTextWidth(summary, summaryFontSize);
  const textWidth = Math.max(labelWidth, metaWidth, summaryWidth);
  const horizontalPadding = Math.max(22, Math.round(baseDiameter * 0.2));
  const bodyWidth = textWidth + horizontalPadding * 2;

  const labelLines = Math.max(1, Math.ceil(label.length / 16));
  const summaryLines = Math.max(1, Math.ceil(summary.length / 26));
  const textHeight =
    horizontalPadding * 2 +
    labelLines * labelFontSize * 1.2 +
    metaFontSize * 1.2 +
    summaryLines * summaryFontSize * 1.15 +
    18;

  const widthBasedDiameter = Math.max(baseDiameter, bodyWidth);
  const heightBasedDiameter = Math.max(baseDiameter, textHeight);
  return Math.ceil(Math.max(widthBasedDiameter, heightBasedDiameter));
}

function buildGraphLayout(roots: TreeNode[]): GraphLayout {
  const nodesById = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const flattenedVersions: DawVersion[] = [];
  let nextRow = 0;
  let maxDepth = 0;

  function placeNode(node: TreeNode, depth: number, row: number, parentId: string | null) {
    flattenedVersions.push(node.version);
    const graphNode: GraphNode = {
      id: node.version.id,
      version: node.version,
      row,
      depth,
      left: 0,
      top: 0,
      parentId,
    };
    nodesById.set(graphNode.id, graphNode);
    maxDepth = Math.max(maxDepth, depth);

    if (parentId) {
      edges.push({ fromId: parentId, toId: graphNode.id });
    }

    node.children.forEach((child, index) => {
      const childRow = index === 0 ? row : nextRow++;
      placeNode(child, depth + 1, childRow, graphNode.id);
    });
  }

  roots.forEach((root) => {
    const row = nextRow++;
    placeNode(root, 0, row, null);
  });

  const rowCount = Math.max(1, nextRow);
  const density = clamp(
    1 - Math.max(0, rowCount - 4) * 0.1 - Math.max(0, maxDepth - 4) * 0.04,
    0.62,
    1,
  );
  const scale = TREE_SCALE * density;
  const baseNodeSize = Math.round(136 * scale);
  const labelFontSize = Math.round(13 * scale);
  const metaFontSize = Math.round(10.5 * scale);
  const summaryFontSize = Math.round(10 * scale);
  const lineHeight = Number((1.15 + scale * 0.05).toFixed(2));
  const versionsById = new Map(flattenedVersions.map((version) => [version.id, version]));
  const maxLabel = flattenedVersions.reduce((longest, version) => {
    const label = getVersionDisplayLabel(version, versionsById);
    return label.length > longest.length ? label : longest;
  }, '');
  const maxSummary = flattenedVersions.reduce((longest, version) => {
    const summary = getVersionOperationSummary(version, versionsById);
    return summary.length > longest.length ? summary : longest;
  }, '');
  const requiredDiameter = getRequiredNodeDiameter(
    maxLabel || 'Version',
    maxSummary || 'Initial version',
    'fffffff',
    baseNodeSize,
    labelFontSize,
    metaFontSize,
    summaryFontSize,
  );
  const nodeWidth = Math.max(baseNodeSize, requiredDiameter);
  const nodeHeight = nodeWidth;
  const xGap = Math.max(Math.round(176 * scale), Math.round(nodeWidth * 1.32));
  const yGap = Math.max(Math.round(126 * scale), Math.round(nodeHeight * 1.08));
  const paddingX = Math.max(Math.round(22 * scale), Math.round(nodeWidth * 0.18));
  const paddingY = Math.max(Math.round(18 * scale), Math.round(nodeHeight * 0.16));
  const nodes = Array.from(nodesById.values());
  for (const node of nodes) {
    node.left = paddingX + node.depth * xGap;
    node.top = paddingY + node.row * yGap;
  }

  const width = paddingX * 2 + (maxDepth + 1) * xGap + nodeWidth;
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

export type VersionHistoryTreeProps = {
  projectId: string;
  demoId: string;
  baseOperationSeq: number;
  versions: DawVersion[];
  currentVersionId: string;
  selectedVersionId: string;
  onSelectVersion: (id: string) => void;
};

export function VersionHistoryTree({
  projectId,
  demoId,
  baseOperationSeq,
  versions,
  currentVersionId,
  selectedVersionId,
  onSelectVersion,
}: VersionHistoryTreeProps) {
  const router = useRouter();
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const roots = useMemo(() => buildTree(versions), [versions]);
  const versionsById = useMemo(() => buildVersionsById(versions), [versions]);
  const currentVersion = useMemo(
    () => versions.find((v) => v.id === currentVersionId),
    [versions, currentVersionId],
  );
  const currentVersionLabel = currentVersion
    ? getVersionDisplayLabel(currentVersion, versionsById)
    : 'Current version';
  const currentVersionSummary = currentVersion
    ? getVersionOperationSummary(currentVersion, versionsById)
    : 'No version selected';

  async function commitRename() {
    if (!renameState) return;
    const trimmed = renameState.value.trim();
    if (!trimmed) {
      setRenameState(null);
      return;
    }

    setRenameState((prev) => (prev ? { ...prev, saving: true, error: null } : null));
    try {
      const res = await fetch(`/api/daw/projects/${projectId}/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          demoId,
          operationType: 'VERSION_TIMING_UPDATED',
          payload: {
            versionId: renameState.versionId,
            label: trimmed,
          },
          baseSnapshotId: selectedVersionId,
          baseOperationSeq,
          targetTrackId: null,
          targetSegmentId: null,
          affectedTimeRange: null,
          idempotencyKey: crypto.randomUUID(),
          clientOperationId: crypto.randomUUID(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setRenameState((prev) =>
          prev ? { ...prev, saving: false, error: data.error ?? 'Could not rename version' } : null,
        );
        return;
      }
      setRenameState(null);
      router.refresh();
    } catch {
      setRenameState((prev) =>
        prev ? { ...prev, saving: false, error: 'Something went wrong' } : null,
      );
    }
  }

  function startRename(versionId: string, label: string) {
    setRenameState({ versionId, value: label, saving: false, error: null });
  }

  const layout = useMemo(() => buildGraphLayout(roots), [roots]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);

  return (
    <div className="space-y-4 text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Version Tree</h2>
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
              aria-label={isExpanded ? 'Minimize version tree' : 'Maximize version tree'}
              title={isExpanded ? 'Minimize' : 'Maximize'}
            >
              {isExpanded ? <span className="text-sm leading-none">−</span> : <span className="text-sm leading-none">+</span>}
            </button>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">
            Versions run left to right, branches drop to lower rows, and the canvas scrolls when it gets wide.
          </p>
        </div>
      </div>

      {!isExpanded ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current version</p>
            <p className="mt-2 text-sm font-semibold text-white">{currentVersionLabel}</p>
            <p className="mt-1 text-xs text-slate-400">{currentVersionSummary}</p>
            {currentVersion ? (
              <p className="mt-1 text-xs text-slate-500">
                {formatDate(currentVersion.createdAt)} · {currentVersion.tracks.length} tracks · {shortId(currentVersion.id)}
              </p>
            ) : null}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
              current head
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              selected version
            </span>
          </div>

          <div className="overflow-auto">
            <div className="relative" style={{ minWidth: layout.width, minHeight: layout.height }}>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(71,85,105,0.28)_1px,transparent_0)] [background-size:26px_26px] opacity-70" />

              <svg
                className="pointer-events-none absolute inset-0"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                aria-hidden
              >
                {layout.edges.map((edge) => {
                  const from = nodeById.get(edge.fromId);
                  const to = nodeById.get(edge.toId);
                  if (!from || !to) return null;
                  const x1 = from.left + layout.nodeWidth - 2;
                  const y1 = from.top + layout.nodeHeight / 2;
                  const x2 = to.left + 2;
                  const y2 = to.top + layout.nodeHeight / 2;
                  return (
                    <line
                      key={`${edge.fromId}-${edge.toId}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="rgba(148,163,184,0.55)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  );
                })}
              </svg>

              {layout.nodes.map((node) => {
                const isCurrent = node.id === currentVersionId;
                const isSelected = node.id === selectedVersionId;
                const isRenaming = renameState?.versionId === node.id;
                const label = getVersionDisplayLabel(node.version, versionsById);
                const summary = getVersionOperationSummary(node.version, versionsById);

                return (
                  <div
                    key={node.id}
                    onClick={() => onSelectVersion(node.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectVersion(node.id);
                      }
                    }}
                    className={`group absolute overflow-hidden rounded-full border-2 text-left transition-transform duration-150 ${
                      isSelected
                        ? 'border-amber-400 bg-slate-900 shadow-[0_10px_18px_rgba(251,191,36,0.12)]'
                        : isCurrent
                          ? 'border-cyan-400 bg-slate-900 shadow-[0_10px_18px_rgba(6,182,212,0.12)]'
                          : 'border-slate-700 bg-slate-900/95 shadow-[0_10px_16px_rgba(0,0,0,0.25)] hover:-translate-y-0.5'
                    }`}
                    style={{
                      left: node.left,
                      top: node.top,
                      width: layout.nodeWidth,
                      height: layout.nodeHeight,
                    }}
                  >
                    <div className="relative flex h-full flex-col items-center justify-center px-3 py-3 text-center">
                      {isRenaming ? (
                        <div
                          className="flex h-full w-full flex-col justify-center"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            type="text"
                            value={renameState.value}
                            onChange={(e) =>
                              setRenameState((prev) => (prev ? { ...prev, value: e.currentTarget.value } : prev))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitRename();
                              if (e.key === 'Escape') setRenameState(null);
                            }}
                            disabled={renameState.saving}
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-100 outline-none"
                          />
                          {renameState.error && (
                            <p className="mt-1 text-[11px] text-red-400">{renameState.error}</p>
                          )}
                          <div className="mt-2 flex gap-3">
                            <button
                              type="button"
                              onClick={() => void commitRename()}
                              disabled={renameState.saving}
                              className="text-xs font-semibold text-cyan-300 hover:text-cyan-200 disabled:opacity-60"
                            >
                              {renameState.saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenameState(null)}
                              className="text-xs font-semibold text-slate-400 hover:text-slate-200"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(node.id, label);
                            }}
                            title="Rename version"
                            className="absolute right-2 top-2 rounded-full p-1 text-slate-500 opacity-0 transition-opacity hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100"
                          >
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                              <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z" />
                            </svg>
                          </button>

                          <div className="min-w-0">
                            <p
                              className="font-semibold leading-tight tracking-tight text-white"
                              style={{ fontSize: layout.labelFontSize, lineHeight: layout.lineHeight }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                startRename(node.id, label);
                              }}
                              title="Double-click to rename"
                            >
                              {label}
                            </p>
                            <p className="mt-0.5 text-slate-500" style={{ fontSize: layout.metaFontSize }}>
                              {shortId(node.version.id)}
                            </p>
                          </div>

                          <div className="mt-2 space-y-1.5">
                            <div
                              className="flex flex-wrap items-center justify-center gap-2 font-medium text-slate-400"
                              style={{ fontSize: layout.metaFontSize }}
                            >
                              <span>{formatDate(node.version.createdAt)}</span>
                              <span>{node.version.tracks.length} tracks</span>
                            </div>
                            <p
                              className="text-center leading-snug text-slate-500"
                              style={{ fontSize: layout.summaryFontSize, lineHeight: layout.lineHeight }}
                            >
                              {summary}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="pointer-events-none absolute bottom-4 right-4 rounded-full border border-slate-700 bg-slate-950/90 px-3 py-1 text-[11px] text-slate-500">
                Scroll horizontally if the tree stretches wide
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
