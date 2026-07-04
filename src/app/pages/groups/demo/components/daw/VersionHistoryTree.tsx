'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DawVersion, ProjectOperationHistoryEntry } from '@/app/lib/daw/state/local-project-state';
import { buildTree, type TreeNode } from './version-tree-layout';
import {
  buildVersionsById,
  getVersionDisplayLabel,
  getVersionOperationSummary,
} from '@/app/lib/daw/utils/version-labels';

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

type BranchState = {
  sourceVersionId: string;
  sourceVersionLabel: string;
  value: string;
  saving: boolean;
  error: string | null;
};

type RevertState = {
  sourceVersionId: string;
  sourceVersionLabel: string;
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

const TREE_SCALE = 0.66;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function estimateTextWidth(text: string, fontSize: number) {
  return text.length * fontSize * 0.6;
}

function getRequiredNodeDiameter(
  label: string,
  summary: string,
  baseDiameter: number,
  labelFontSize: number,
  metaFontSize: number,
  summaryFontSize: number,
) {
  const labelWidth = estimateTextWidth(label, labelFontSize);
  const summaryWidth = estimateTextWidth(summary, summaryFontSize);
  const textWidth = Math.max(labelWidth, summaryWidth);
  const horizontalPadding = Math.max(18, Math.round(baseDiameter * 0.18));
  const bodyWidth = textWidth + horizontalPadding * 2;

  const labelLines = Math.max(1, Math.ceil(label.length / 16));
  const summaryLines = summary ? Math.max(1, Math.ceil(summary.length / 26)) : 0;
  const textHeight =
    horizontalPadding * 2 +
    labelLines * labelFontSize * 1.2 +
    metaFontSize * 1.2 +
    summaryLines * summaryFontSize * 1.15 +
    14;

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
    const displaySummary = summary === 'Initial version' ? '' : summary;
    return displaySummary.length > longest.length ? displaySummary : longest;
  }, '');
  const requiredDiameter = getRequiredNodeDiameter(
    maxLabel || 'Version',
    maxSummary,
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
  operationHistory: ProjectOperationHistoryEntry[];
  currentVersionId: string;
  activeVersionId: string;
  selectedVersionId: string;
  selectedHistoryOperationSeq: number | null;
  isFollowingHead: boolean;
  isHistoryViewActive: boolean;
  onSelectVersion: (id: string) => void;
  onCheckoutSelectedVersion: () => void;
  onSelectHistoryOperation: (operationSeq: number | null) => void;
  onCreateBranch: (sourceVersionId: string, label: string) => Promise<{ versionId: string; label: string } | null>;
  onRevertToVersion: (sourceVersionId: string) => Promise<{ versionId: string; label: string } | null>;
};

export function VersionHistoryTree({
  projectId,
  demoId,
  baseOperationSeq,
  versions,
  operationHistory,
  currentVersionId,
  activeVersionId,
  selectedVersionId,
  selectedHistoryOperationSeq,
  isFollowingHead,
  isHistoryViewActive,
  onSelectVersion,
  onCheckoutSelectedVersion,
  onSelectHistoryOperation,
  onCreateBranch,
  onRevertToVersion,
}: VersionHistoryTreeProps) {
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [branchState, setBranchState] = useState<BranchState | null>(null);
  const [revertState, setRevertState] = useState<RevertState | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (isHistoryViewActive) {
      setRenameState(null);
      setBranchState(null);
      setRevertState(null);
    }
  }, [isHistoryViewActive]);

  const roots = useMemo(() => buildTree(versions), [versions]);
  const versionsById = useMemo(() => buildVersionsById(versions), [versions]);
  const currentVersion = useMemo(
    () => versions.find((v) => v.id === currentVersionId),
    [versions, currentVersionId],
  );
  const currentVersionLabel = currentVersion
    ? getVersionDisplayLabel(currentVersion, versionsById)
    : 'Branch head';
  const currentVersionSummary = currentVersion
    ? getVersionOperationSummary(currentVersion, versionsById)
    : 'No branch head selected';
  const selectedHistoryVersionId = selectedVersionId || currentVersionId;
  const branchSourceVersion =
    versionsById.get(selectedVersionId) ?? versionsById.get(activeVersionId) ?? currentVersion ?? null;
  const selectedHistoryEntries = useMemo(
    () =>
      operationHistory
        .filter((entry) => entry.versionId === selectedHistoryVersionId || entry.currentVersionId === selectedHistoryVersionId)
        .slice(-8)
        .reverse(),
    [operationHistory, selectedHistoryVersionId],
  );

  function openCreateBranch() {
    const sourceVersion = branchSourceVersion;
    if (!sourceVersion) return;
    setBranchState({
      sourceVersionId: sourceVersion.id,
      sourceVersionLabel: getVersionDisplayLabel(sourceVersion, versionsById),
      value: `${getVersionDisplayLabel(sourceVersion, versionsById)} branch`,
      saving: false,
      error: null,
    });
  }

  async function commitRevert() {
    const sourceVersion = branchSourceVersion;
    if (!sourceVersion) return;

    setRevertState({
      sourceVersionId: sourceVersion.id,
      sourceVersionLabel: getVersionDisplayLabel(sourceVersion, versionsById),
      saving: true,
      error: null,
    });
    setBranchState(null);

    try {
      const result = await onRevertToVersion(sourceVersion.id);
      if (!result) {
        setRevertState((prev) =>
          prev ? { ...prev, saving: false, error: 'Could not revert to this version' } : null,
        );
        return;
      }

      setRevertState(null);
      if (isHistoryViewActive) {
        onSelectHistoryOperation(null);
      }
      onSelectVersion(result.versionId);
    } catch {
      setRevertState((prev) =>
        prev ? { ...prev, saving: false, error: 'Something went wrong' } : null,
      );
    }
  }

  async function commitBranchCreation() {
    if (!branchState) return;
    const trimmed = branchState.value.trim();
    setBranchState((prev) => (prev ? { ...prev, saving: true, error: null } : null));
    try {
      const result = await onCreateBranch(branchState.sourceVersionId, trimmed);
      if (!result) {
        setBranchState((prev) =>
          prev ? { ...prev, saving: false, error: 'Could not create branch' } : null,
        );
        return;
      }
      setBranchState(null);
      if (isHistoryViewActive) {
        onSelectHistoryOperation(null);
      }
      onSelectVersion(result.versionId);
    } catch {
      setBranchState((prev) =>
        prev ? { ...prev, saving: false, error: 'Something went wrong' } : null,
      );
    }
  }

  async function commitRename() {
    if (!renameState) return;
    if (isHistoryViewActive) return;
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
          operationType: 'VERSION_RENAMED',
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
    } catch {
      setRenameState((prev) =>
        prev ? { ...prev, saving: false, error: 'Something went wrong' } : null,
      );
    }
  }

  function startRename(versionId: string, label: string) {
    if (isHistoryViewActive) return;
    setRenameState({ versionId, value: label, saving: false, error: null });
  }

  const layout = useMemo(() => buildGraphLayout(roots), [roots]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const selectedTreeNode =
    nodeById.get(selectedVersionId) ?? nodeById.get(currentVersionId) ?? nodeById.get(activeVersionId) ?? null;
  const historyNodeWidth = Math.min(208, Math.max(Math.round(layout.nodeWidth * 0.8), 136));
  const historyNodeHeight = Math.min(
    104,
    Math.max(Math.round(layout.nodeHeight * 0.44), 68),
  );
  const historyNodeGap = Math.max(Math.round(14 * layout.scale), 10);
  const historyLaneGap = Math.max(Math.round(44 * layout.scale), 28);
  const historyNodeLeft = selectedTreeNode
    ? selectedTreeNode.left + layout.nodeWidth + historyLaneGap
    : layout.width + historyLaneGap;
  const historyLaneTop = selectedTreeNode
    ? Math.max(0, selectedTreeNode.top + Math.round((layout.nodeHeight - historyNodeHeight) / 2))
    : 0;
  const historyDiagramWidth =
    selectedTreeNode && selectedHistoryEntries.length > 0
      ? Math.max(layout.width, historyNodeLeft + historyNodeWidth + Math.round(12 * layout.scale))
      : layout.width;
  const historyDiagramHeight =
    selectedTreeNode && selectedHistoryEntries.length > 0
      ? Math.max(
          layout.height,
          historyLaneTop +
            selectedHistoryEntries.length * historyNodeHeight +
            Math.max(0, selectedHistoryEntries.length - 1) * historyNodeGap +
            Math.round(16 * layout.scale),
        )
      : layout.height;

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
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Branch head</p>
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
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-200">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
              branch head
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-200">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              my active version
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              selected node
            </span>
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 ${
                isFollowingHead
                  ? 'border-slate-700 bg-slate-900 text-slate-300'
                  : 'border-violet-500/30 bg-violet-500/10 text-violet-200'
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${isFollowingHead ? 'bg-slate-500' : 'bg-violet-400'}`}
              />
              {isFollowingHead ? 'following head' : 'pinned checkout'}
            </span>
            {selectedVersionId !== activeVersionId && !isHistoryViewActive ? (
              <button
                type="button"
                onClick={onCheckoutSelectedVersion}
                className="ml-auto rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 hover:text-emerald-100"
              >
                Checkout selected
              </button>
            ) : null}
            <button
              type="button"
              onClick={branchState ? () => setBranchState(null) : openCreateBranch}
              disabled={!branchState && !branchSourceVersion}
              className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {branchState ? 'Cancel branch' : isHistoryViewActive ? 'Branch from this point' : 'Create Branch'}
            </button>
            <button
              type="button"
              onClick={() => void commitRevert()}
              disabled={!branchSourceVersion || revertState?.saving === true}
              className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold text-rose-200 transition-colors hover:bg-rose-500/20 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {revertState?.saving ? 'Reverting…' : 'Revert to this version'}
            </button>
          </div>
          {branchState ? (
            <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">
                    Create branch
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Branching from <span className="font-semibold text-white">{branchState.sourceVersionLabel}</span>.
                    Leave the name blank to use the default branch label.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBranchState(null)}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Close
                </button>
              </div>
              <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
                <input
                  type="text"
                  value={branchState.value}
                  onChange={(e) => {
                    const nextValue = e.currentTarget.value;
                    setBranchState((prev) => (prev ? { ...prev, value: nextValue } : prev));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitBranchCreation();
                    if (e.key === 'Escape') setBranchState(null);
                  }}
                  disabled={branchState.saving}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
                  placeholder="Branch name (optional)"
                />
                <button
                  type="button"
                  onClick={() => void commitBranchCreation()}
                  disabled={branchState.saving}
                  className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {branchState.saving ? 'Creating…' : 'Create branch'}
                </button>
              </div>
              {branchState.error ? <p className="mt-2 text-sm text-red-400">{branchState.error}</p> : null}
            </div>
          ) : null}
          {revertState ? (
            <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200/70">
                    Revert to version
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Reverting to <span className="font-semibold text-white">{revertState.sourceVersionLabel}</span>{' '}
                    creates a new version at the current branch head and preserves history.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRevertState(null)}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Close
                </button>
              </div>
              {revertState.error ? <p className="mt-2 text-sm text-red-400">{revertState.error}</p> : null}
            </div>
          ) : null}

          <div className="overflow-auto">
            <div className="relative" style={{ minWidth: historyDiagramWidth, minHeight: historyDiagramHeight }}>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(71,85,105,0.28)_1px,transparent_0)] [background-size:26px_26px] opacity-70" />

              <svg
                className="pointer-events-none absolute inset-0"
                width={historyDiagramWidth}
                height={historyDiagramHeight}
                viewBox={`0 0 ${historyDiagramWidth} ${historyDiagramHeight}`}
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

                {selectedTreeNode && selectedHistoryEntries.length > 0 ? (
                  <>
                    <line
                      x1={selectedTreeNode.left + layout.nodeWidth}
                      y1={selectedTreeNode.top + layout.nodeHeight / 2}
                      x2={historyNodeLeft}
                      y2={historyLaneTop + historyNodeHeight / 2}
                      stroke="rgba(34,211,238,0.35)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    {selectedHistoryEntries.slice(0, -1).map((entry, index) => {
                      const currentTop = historyLaneTop + index * (historyNodeHeight + historyNodeGap);
                      const nextTop = historyLaneTop + (index + 1) * (historyNodeHeight + historyNodeGap);
                      const canRevertToHistoryPoint =
                        typeof entry.operationSeq === 'number' && Number.isFinite(entry.operationSeq);

                      return (
                        <line
                          key={`history-link-${entry.operationId}`}
                          x1={historyNodeLeft + historyNodeWidth / 2}
                          y1={currentTop + historyNodeHeight}
                          x2={historyNodeLeft + historyNodeWidth / 2}
                          y2={nextTop}
                          stroke={canRevertToHistoryPoint ? 'rgba(100,116,139,0.55)' : 'rgba(100,116,139,0.35)'}
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      );
                    })}
                  </>
                ) : null}
              </svg>

              {layout.nodes.map((node) => {
                const isCurrent = node.id === currentVersionId;
                const isActive = node.id === activeVersionId;
                const isSelected = node.id === selectedVersionId;
                const isRenaming = renameState?.versionId === node.id;
                const label = getVersionDisplayLabel(node.version, versionsById);
                const summary = getVersionOperationSummary(node.version, versionsById);
                const displaySummary = summary === 'Initial version' ? '' : summary;

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
                        : isActive
                          ? 'border-emerald-400 bg-slate-900 shadow-[0_10px_18px_rgba(16,185,129,0.12)]'
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
                            onChange={(e) => {
                              const nextValue = e.currentTarget.value;
                              setRenameState((prev) => (prev ? { ...prev, value: nextValue } : prev));
                            }}
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
                              disabled={isHistoryViewActive}
                              title="Rename version"
                              className="absolute right-2 top-2 rounded-full p-1 text-slate-500 opacity-0 transition-opacity hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
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
                          </div>

                          <div className="mt-2 space-y-1.5">
                            <div
                              className="flex flex-wrap items-center justify-center gap-2 font-medium text-slate-400"
                              style={{ fontSize: layout.metaFontSize }}
                            >
                              <span>{formatDate(node.version.createdAt)}</span>
                              <span>{node.version.tracks.length} tracks</span>
                            </div>
                            {displaySummary ? (
                              <p
                                className="text-center leading-snug text-slate-500"
                                style={{ fontSize: layout.summaryFontSize, lineHeight: layout.lineHeight }}
                              >
                                {displaySummary}
                              </p>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {selectedTreeNode && selectedHistoryEntries.length > 0
                ? selectedHistoryEntries.map((entry, index) => {
                    const isSelectedHistoryPoint = selectedHistoryOperationSeq === entry.operationSeq;
                    const canRevertToHistoryPoint =
                      typeof entry.operationSeq === 'number' && Number.isFinite(entry.operationSeq);
                    const nodeTop = historyLaneTop + index * (historyNodeHeight + historyNodeGap);

                    return (
                      <div
                        key={entry.operationId}
                        role={canRevertToHistoryPoint ? 'button' : undefined}
                        tabIndex={canRevertToHistoryPoint ? 0 : -1}
                        onClick={() => {
                          if (!canRevertToHistoryPoint) return;
                          onSelectHistoryOperation(entry.operationSeq ?? null);
                        }}
                        onKeyDown={(e) => {
                          if (!canRevertToHistoryPoint) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectHistoryOperation(entry.operationSeq ?? null);
                          }
                        }}
                        title={canRevertToHistoryPoint ? `${entry.summary} · ${formatDate(entry.createdAt)}` : 'Older history entry'}
                        className={[
                          'group absolute overflow-hidden rounded-xl border px-3 py-3 text-left transition-all duration-150',
                          canRevertToHistoryPoint ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-not-allowed',
                          isSelectedHistoryPoint
                            ? 'border-cyan-400/70 bg-cyan-500/10 shadow-[0_10px_18px_rgba(34,211,238,0.08)]'
                            : 'border-slate-700 bg-slate-900/90 hover:border-cyan-400/40 hover:bg-slate-900',
                          !canRevertToHistoryPoint ? 'opacity-60' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{
                          left: historyNodeLeft,
                          top: nodeTop,
                          width: historyNodeWidth,
                          height: historyNodeHeight,
                        }}
                      >
                        <div className="flex h-full flex-col justify-between gap-2">
                          <p
                            className="break-words font-semibold leading-snug text-white"
                            style={{ fontSize: layout.summaryFontSize, lineHeight: layout.lineHeight }}
                          >
                            {entry.summary}
                          </p>
                          <p className="text-slate-500" style={{ fontSize: layout.metaFontSize }}>
                            {formatDate(entry.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                : null}

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
