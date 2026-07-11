'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DawVersion, ProjectOperationHistoryEntry } from '@/app/lib/daw/state/local-project-state';
import { buildGraphEdgePath, buildGraphLayout } from './version-tree-layout';
import {
  buildVersionsById,
  getVersionBranchDisplayLabel,
  getVersionDisplayLabel,
  getVersionOperationSummary,
} from '@/app/lib/daw/utils/version-labels';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type VersionNodeTone = 'currentBranch' | 'currentBranchHead' | 'otherBranch' | 'otherBranchHead';

const NODE_TONES: Record<
  VersionNodeTone,
  { border: string; fill: string; glow: string; line: string; text: string }
> = {
  currentBranch: {
    border: 'rgb(59 130 246)',
    fill: 'rgba(15, 23, 42, 0.95)',
    glow: 'rgba(59,130,246,0.16)',
    line: 'rgba(59,130,246,0.72)',
    text: 'text-blue-100',
  },
  currentBranchHead: {
    border: 'rgb(125 211 252)',
    fill: 'rgba(15, 23, 42, 0.98)',
    glow: 'rgba(125,211,252,0.18)',
    line: 'rgba(125,211,252,0.78)',
    text: 'text-sky-100',
  },
  otherBranch: {
    border: 'rgb(253 224 71)',
    fill: 'rgba(52, 39, 10, 0.95)',
    glow: 'rgba(253,224,71,0.14)',
    line: 'rgba(253,224,71,0.65)',
    text: 'text-yellow-100',
  },
  otherBranchHead: {
    border: 'rgb(245 158 11)',
    fill: 'rgba(69, 37, 11, 0.96)',
    glow: 'rgba(245,158,11,0.16)',
    line: 'rgba(245,158,11,0.72)',
    text: 'text-amber-100',
  },
};

function getPrimaryParentId(version: DawVersion) {
  return version.parentVersionId ?? version.parentId ?? null;
}

function buildAncestorBranchIds(versionsById: Map<string, DawVersion>, activeVersionId: string) {
  const branchIds = new Set<string>();
  let current = versionsById.get(activeVersionId) ?? null;

  while (current && !branchIds.has(current.id)) {
    branchIds.add(current.id);
    const parentId = getPrimaryParentId(current);
    current = parentId ? versionsById.get(parentId) ?? null : null;
  }

  return branchIds;
}

function resolveUserDisplayName(
  actorUserId: string | null | undefined,
  userDisplayNamesById: Record<string, string | null>,
) {
  const resolvedName = actorUserId ? userDisplayNamesById[actorUserId]?.trim() : '';
  if (resolvedName) {
    return resolvedName;
  }
  return actorUserId?.trim() ?? '';
}

function getVersionCreatorLabel(
  version: DawVersion,
  operationHistory: ProjectOperationHistoryEntry[],
  userDisplayNamesById: Record<string, string | null>,
) {
  const resolvedCreatorName = version.createdByName?.trim();
  if (resolvedCreatorName) {
    return resolvedCreatorName;
  }

  const directCreator = version.createdBy?.trim();
  if (directCreator) {
    const resolvedDirectCreator = resolveUserDisplayName(directCreator, userDisplayNamesById);
    if (resolvedDirectCreator) {
      return resolvedDirectCreator;
    }
  }

  const historyMatch = operationHistory.find((entry) => {
    if (entry.versionId !== version.id && entry.currentVersionId !== version.id) {
      return false;
    }

    return (
      entry.operationType === 'VERSION_CREATED' ||
      entry.operationType === 'VERSION_BRANCH_CREATED' ||
      entry.operationType === 'VERSION_REVERTED_FROM' ||
      entry.operationType === 'TRACK_VERSION_CREATED'
    );
  });

  const fallbackMatch = operationHistory.find((entry) => entry.versionId === version.id || entry.currentVersionId === version.id);

  const resolvedHistoryActor = resolveUserDisplayName(historyMatch?.actorUserId, userDisplayNamesById);
  if (resolvedHistoryActor) {
    return resolvedHistoryActor;
  }

  const resolvedFallbackActor = resolveUserDisplayName(fallbackMatch?.actorUserId, userDisplayNamesById);
  return resolvedFallbackActor || 'Unknown user';
}

type RenameState = {
  versionId: string;
  value: string;
  saving: boolean;
  error: string | null;
};

export type VersionHistoryTreeProps = {
  projectId: string;
  demoId: string;
  demoName: string;
  baseOperationSeq: number;
  zoomLevel: number;
  scrollResetSignal?: string;
  liveVersions: DawVersion[];
  operationHistory: ProjectOperationHistoryEntry[];
  currentVersionId: string;
  activeVersionId: string;
  selectedVersionId: string;
  isFollowingHead: boolean;
  isHistoryViewActive: boolean;
  highlightedVersionId: string | null;
  highlightedVersionCreatedAt: string | null;
  userDisplayNamesById?: Record<string, string | null>;
  onSelectVersion: (id: string) => void;
};

export function VersionHistoryTree({
  projectId,
  demoId,
  demoName,
  baseOperationSeq,
  zoomLevel,
  scrollResetSignal = '',
  liveVersions,
  operationHistory,
  currentVersionId,
  activeVersionId,
  selectedVersionId,
  isFollowingHead,
  isHistoryViewActive,
  highlightedVersionId,
  highlightedVersionCreatedAt,
  userDisplayNamesById = {},
  onSelectVersion,
}: VersionHistoryTreeProps) {
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [animatedVersionId, setAnimatedVersionId] = useState<string | null>(null);
  const [detailsVersionId, setDetailsVersionId] = useState<string | null>(null);
  const treeScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!highlightedVersionId || !highlightedVersionCreatedAt) {
      setAnimatedVersionId(null);
      return;
    }

    setAnimatedVersionId(highlightedVersionId);
    const timer = window.setTimeout(() => {
      setAnimatedVersionId((current) => (current === highlightedVersionId ? null : current));
    }, 1400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [highlightedVersionCreatedAt, highlightedVersionId]);

  const versions = liveVersions;
  const versionsById = useMemo(() => buildVersionsById(versions), [versions]);
  const layout = useMemo(() => buildGraphLayout(versions), [versions]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const currentBranchIds = useMemo(
    () => buildAncestorBranchIds(versionsById, activeVersionId),
    [activeVersionId, versionsById],
  );
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of layout.edges) {
      counts.set(edge.fromId, (counts.get(edge.fromId) ?? 0) + 1);
    }
    return counts;
  }, [layout.edges]);
  const detailsNode = detailsVersionId ? nodeById.get(detailsVersionId) ?? null : null;

  useEffect(() => {
    if (!detailsVersionId) {
      setRenameState(null);
      return;
    }

    if (renameState && renameState.versionId !== detailsVersionId) {
      setRenameState(null);
    }
  }, [detailsVersionId, renameState]);

  useLayoutEffect(() => {
    const scrollContainer = treeScrollRef.current;
    if (!scrollContainer) return;

    scrollContainer.scrollTop = 0;
    scrollContainer.scrollLeft = 0;
  }, [scrollResetSignal]);

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
    setDetailsVersionId(versionId);
    setRenameState({ versionId, value: label, saving: false, error: null });
  }

  const detailsPopupWidth = Math.min(392, Math.max(Math.round(layout.nodeWidth * 2.15), 272));
  const detailsPopupHeight = Math.min(360, Math.max(Math.round(layout.nodeHeight * 2.1), 220));
  const graphWidth = layout.width;
  const graphHeight = layout.height;
  const detailsPopupLeft = detailsNode
    ? Math.min(
        Math.max(16, detailsNode.left + layout.nodeWidth + 16),
        Math.max(16, graphWidth - detailsPopupWidth - 16),
      )
    : 0;
  const detailsPopupTop = detailsNode
    ? Math.min(
        Math.max(16, detailsNode.top + Math.round(layout.nodeHeight / 2) - Math.round(detailsPopupHeight / 2)),
        Math.max(16, graphHeight - detailsPopupHeight - 16),
      )
    : 0;

  function closeDetails() {
    setDetailsVersionId(null);
    setRenameState(null);
  }

  const detailsVersion = detailsNode?.version ?? null;
  const detailsLabel = detailsVersion
    ? getVersionDisplayLabel(detailsVersion, versionsById, demoName)
    : '';
  const detailsBranchLabel = detailsVersion
    ? getVersionBranchDisplayLabel(detailsVersion, versionsById, demoName)
    : '';
  const detailsSummary = detailsVersion ? getVersionOperationSummary(detailsVersion, versionsById, demoName) : '';
  const detailsCreatorLabel = detailsVersion
    ? getVersionCreatorLabel(detailsVersion, operationHistory, userDisplayNamesById)
    : '';
  const detailsIsRenaming = Boolean(renameState && renameState.versionId === detailsVersion?.id);
  const detailsIsCurrentSelection = detailsVersion?.id === selectedVersionId;

  function getNodeTone(nodeId: string): VersionNodeTone {
    if (nodeId === activeVersionId) {
      return 'currentBranchHead';
    }

    if (currentBranchIds.has(nodeId)) {
      return 'currentBranch';
    }

    return (childCounts.get(nodeId) ?? 0) === 0 ? 'otherBranchHead' : 'otherBranch';
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 text-slate-100">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-sky-100">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-300" />
            current branch head
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-blue-100">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />
            current branch
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-yellow-100">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-300" />
            other branch nodes
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-100">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            other branch heads
          </span>
        </div>
      </div>

      <div ref={treeScrollRef} data-testid="version-history-scroll-container" className="flex-1 min-h-0 overflow-auto">
        <div className="flex min-h-full min-w-full justify-center">
          <div
            className="relative"
            style={{ width: graphWidth * zoomLevel, height: graphHeight * zoomLevel }}
          >
            <div
              className="relative origin-top-left"
              style={{
                width: graphWidth,
                height: graphHeight,
                transform: `scale(${zoomLevel})`,
              }}
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(71,85,105,0.28)_1px,transparent_0)] [background-size:26px_26px] opacity-70" />

              <svg
                className="pointer-events-none absolute inset-0"
                width={graphWidth}
                height={graphHeight}
                viewBox={`0 0 ${graphWidth} ${graphHeight}`}
                aria-hidden
              >
              {layout.edges.map((edge) => {
                const from = nodeById.get(edge.fromId);
                const to = nodeById.get(edge.toId);
                if (!from || !to) return null;
                const fromTone = NODE_TONES[getNodeTone(from.id)];
                return (
                  <path
                    key={`${edge.fromId}-${edge.toId}`}
                    d={buildGraphEdgePath(from, to, layout.nodeWidth, layout.nodeHeight)}
                    stroke={fromTone.line}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                  );
                })}
              </svg>

              {detailsNode ? (
                <button
                  type="button"
                  aria-label="Close version details"
                  className="absolute inset-0 z-30 cursor-default bg-slate-950/10"
                  onClick={closeDetails}
                />
              ) : null}

              {layout.nodes.map((node) => {
                const isSelected = node.id === selectedVersionId;
                const isHighlighted = node.id === animatedVersionId;
                const tone = getNodeTone(node.id);
                const toneStyle = NODE_TONES[tone];
                const label = getVersionDisplayLabel(node.version, versionsById, demoName);
                const creator = getVersionCreatorLabel(node.version, operationHistory, userDisplayNamesById);
                return (
                  <div
                    key={node.id}
                    onClick={() => {
                      setDetailsVersionId((current) => (current === node.id ? null : node.id));
                    }}
                    role="button"
                    tabIndex={0}
                    aria-haspopup="dialog"
                    aria-expanded={detailsVersionId === node.id}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailsVersionId((current) => (current === node.id ? null : node.id));
                      }
                    }}
                    className={`group absolute overflow-hidden rounded-[28px] border-2 text-left transition-transform duration-150 ${
                      isHighlighted ? 'z-20 scale-[1.03] animate-pulse' : ''
                    }`}
                    style={{
                      left: node.left,
                      top: node.top,
                      width: layout.nodeWidth,
                      height: layout.nodeHeight,
                      borderColor: toneStyle.border,
                      backgroundColor: toneStyle.fill,
                      boxShadow: [
                        `0 10px 18px rgba(0,0,0,0.24)`,
                        `0 0 0 1px ${toneStyle.glow}`,
                        isSelected ? '0 0 0 2px rgba(251,191,36,0.75)' : null,
                        isHighlighted ? '0 0 0 8px rgba(34,211,238,0.14)' : null,
                      ]
                        .filter(Boolean)
                        .join(', '),
                    }}
                  >
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-5 py-5 text-center">
                      <p
                        className="w-full break-words text-center text-[9px] font-semibold tracking-tight text-white"
                        style={{ lineHeight: 1.08 }}
                      >
                        {label}
                      </p>
                      <p className={`w-full break-words text-center text-[10px] font-medium leading-tight ${toneStyle.text}`}>
                        {creator}
                      </p>
                    </div>
                  </div>
                );
              })}

              {detailsNode ? (
                <div
                  className="absolute z-40"
                  style={{
                    left: detailsPopupLeft,
                    top: detailsPopupTop,
                    width: detailsPopupWidth,
                  }}
                  role="dialog"
                  aria-label={`${detailsLabel} details`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/95 p-4 shadow-[0_18px_36px_rgba(0,0,0,0.42)] backdrop-blur">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                          Version details
                        </p>
                        {detailsIsRenaming ? (
                          <input
                            autoFocus
                            type="text"
                            value={renameState?.value ?? ''}
                            onChange={(e) => {
                              const nextValue = e.currentTarget.value;
                              setRenameState((prev) => (prev ? { ...prev, value: nextValue } : null));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitRename();
                              if (e.key === 'Escape') setRenameState(null);
                            }}
                            disabled={renameState?.saving}
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-lg font-semibold text-white outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startRename(detailsVersion.id, detailsLabel)}
                            disabled={isHistoryViewActive}
                            title="Click to rename version"
                            className="mt-1 block w-full break-words text-left text-lg font-semibold text-white outline-none transition-colors hover:text-cyan-200 disabled:cursor-not-allowed disabled:hover:text-white"
                          >
                            {detailsLabel}
                          </button>
                        )}
                        <p className="mt-1 text-sm text-slate-400">Implemented by {detailsCreatorLabel}</p>
                      </div>
                      <button
                        type="button"
                        onClick={closeDetails}
                        className="rounded-full border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-white"
                      >
                        Close
                      </button>
                    </div>

                    {detailsIsRenaming ? (
                      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Rename</p>
                        {renameState?.error ? <p className="mt-2 text-xs text-red-400">{renameState.error}</p> : null}
                        <div className="mt-3 flex gap-3">
                          <button
                            type="button"
                            onClick={() => void commitRename()}
                            disabled={renameState?.saving}
                            className="text-xs font-semibold text-cyan-300 hover:text-cyan-200 disabled:opacity-60"
                          >
                            {renameState?.saving ? 'Saving…' : 'Save'}
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
                    ) : null}

                    <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-slate-300">
                      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Summary</p>
                        <p className="mt-1 text-slate-200">{detailsSummary}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Created</p>
                          <p className="mt-1 text-slate-200">{formatDate(detailsVersion.createdAt)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Tracks</p>
                          <p className="mt-1 text-slate-200">{detailsVersion.tracks.length}</p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Branch</p>
                          <p className="mt-1 text-slate-200">{detailsBranchLabel || 'Unnamed branch'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      {!detailsIsCurrentSelection ? (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectVersion(detailsNode.id);
                            closeDetails();
                          }}
                          className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-3 text-sm font-semibold text-cyan-200 hover:border-cyan-300 hover:bg-cyan-500/15"
                        >
                          Go back to this version
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
