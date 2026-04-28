'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { DawVersion } from './DemoDawClient';
import { buildVersionsById, getVersionDisplayLabel } from '@/lib/demos/version-labels';

// --- Tree building ---

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

// --- Helpers ---

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

// --- Types ---

type RenameState = {
  versionId: string;
  value: string;
  saving: boolean;
  error: string | null;
};

// --- VersionNode ---

type VersionNodeProps = {
  node: TreeNode;
  currentVersionId: string;
  selectedVersionId: string;
  versionsById: Map<string, DawVersion>;
  onSelect: (id: string) => void;
  renameState: RenameState | null;
  onRenameStart: (versionId: string, label: string) => void;
  onRenameChange: (val: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
};

function VersionNode({
  node,
  currentVersionId,
  selectedVersionId,
  versionsById,
  onSelect,
  renameState,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: VersionNodeProps) {
  const { version, children } = node;
  const isCurrent = version.id === currentVersionId;
  const isSelected = version.id === selectedVersionId;
  const isRenaming = renameState?.versionId === version.id;
  const label = getVersionDisplayLabel(version, versionsById);

  return (
    <div>
      {/* Node row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(version.id)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(version.id)}
        className={`group relative flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 transition-colors ${
          isSelected
            ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/30'
            : 'hover:bg-gray-800/50'
        }`}
      >
        {/* Node dot */}
        <div
          className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 transition-colors ${
            isCurrent
              ? 'border-indigo-400 bg-indigo-500'
              : isSelected
                ? 'border-indigo-500 bg-transparent'
                : 'border-gray-600 bg-gray-800'
          }`}
        />

        {/* Content */}
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            // Stop clicks and key events from bubbling to the outer row while editing
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <input
                autoFocus
                type="text"
                value={renameState.value}
                onChange={(e) => onRenameChange(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRenameCommit();
                  if (e.key === 'Escape') onRenameCancel();
                }}
                disabled={renameState.saving}
                className="w-full rounded border border-indigo-500 bg-gray-950 px-1.5 py-0.5 text-xs text-white outline-none"
              />
              {renameState.error && (
                <p className="mt-0.5 text-[10px] text-red-400">{renameState.error}</p>
              )}
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={onRenameCommit}
                  disabled={renameState.saving}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-60"
                >
                  {renameState.saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={onRenameCancel}
                  className="text-[10px] text-gray-500 hover:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className="text-sm font-medium leading-snug text-white"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onRenameStart(version.id, label);
                      }}
                      title="Double-click to rename"
                    >
                      {label}
                    </span>
                    {isCurrent && (
                      <span className="shrink-0 rounded bg-indigo-900 px-1 py-0.5 text-[10px] text-indigo-200">
                        current
                      </span>
                    )}
                    {isSelected && !isCurrent && (
                      <span className="shrink-0 rounded bg-amber-900 px-1 py-0.5 text-[10px] text-amber-200">
                        selected
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-gray-500">{shortId(version.id)}</p>
                  <p className="text-[11px] text-gray-400">{formatDate(version.createdAt)}</p>
                  <p className="text-[11px] text-gray-500">
                    {version.tracks.length} track{version.tracks.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* Rename icon (hover-reveal) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRenameStart(version.id, label);
                    }}
                  title="Rename version"
                  className="mt-0.5 shrink-0 text-gray-600 opacity-0 transition-opacity hover:text-gray-300 group-hover:opacity-100"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                    <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z" />
                  </svg>
                  </button>
                </div>
            </>
          )}
        </div>
      </div>

      {/* Children indented with a vertical connector line */}
      {children.length > 0 && (
        <div className="ml-[9px] border-l border-gray-700 pl-3">
          {children.map((child) => (
            <VersionNode
              key={child.version.id}
              node={child}
              currentVersionId={currentVersionId}
              selectedVersionId={selectedVersionId}
              versionsById={versionsById}
              onSelect={onSelect}
              renameState={renameState}
              onRenameStart={onRenameStart}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- VersionHistoryTree (main export) ---

export type VersionHistoryTreeProps = {
  demoId: string;
  versions: DawVersion[];
  currentVersionId: string;
  selectedVersionId: string;
  onSelectVersion: (id: string) => void;
  expanded: boolean;
  onExpandToggle: () => void;
};

export function VersionHistoryTree({
  versions,
  currentVersionId,
  selectedVersionId,
  onSelectVersion,
  expanded,
  onExpandToggle,
}: VersionHistoryTreeProps) {
  const router = useRouter();
  const [renameState, setRenameState] = useState<RenameState | null>(null);

  const roots = useMemo(() => buildTree(versions), [versions]);
  const versionsById = useMemo(() => buildVersionsById(versions), [versions]);
  const currentVersion = useMemo(
    () => versions.find((v) => v.id === currentVersionId),
    [versions, currentVersionId],
  );
  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId),
    [versions, selectedVersionId],
  );

  const handleRenameStart = useCallback((versionId: string, label: string) => {
    setRenameState({ versionId, value: label, saving: false, error: null });
  }, []);

  const handleRenameChange = useCallback((val: string) => {
    setRenameState((prev) => (prev ? { ...prev, value: val } : null));
  }, []);

  const handleRenameCommit = useCallback(async () => {
    if (!renameState) return;
    const trimmed = renameState.value.trim();
    if (!trimmed) {
      setRenameState(null);
      return;
    }
    setRenameState((prev) => (prev ? { ...prev, saving: true, error: null } : null));
    try {
      const res = await fetch(`/api/versions/${renameState.versionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setRenameState((prev) =>
          prev ? { ...prev, saving: false, error: data.error ?? 'Could not rename' } : null,
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
  }, [renameState, router]);

  const handleRenameCancel = useCallback(() => setRenameState(null), []);

  return (
    <>
      <aside className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900 p-4">
        {/* Panel header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Version History
            </h2>
            {!expanded && currentVersion && (
              <div className="mt-1.5">
                <p className="text-sm font-medium text-white">
                  {getVersionDisplayLabel(currentVersion, versionsById)}
                </p>
                <p className="font-mono text-[11px] text-gray-500">{shortId(currentVersion.id)}</p>
                <p className="text-[11px] text-gray-400">{formatDate(currentVersion.createdAt)}</p>
                {selectedVersion && selectedVersion.id !== currentVersion.id && (
                  <p className="mt-1 text-[11px] text-amber-300">
                    Next upload will branch from{' '}
                    <span className="font-medium text-amber-200">
                      {getVersionDisplayLabel(selectedVersion, versionsById)}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onExpandToggle}
            title={expanded ? 'Collapse version history' : 'Expand version history'}
            className="shrink-0 rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            {expanded ? '←' : '→'}
          </button>
        </div>

        {/* Full tree — only rendered when expanded */}
        {expanded && (
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
            {versions.length === 0 ? (
              <p className="text-sm text-gray-500">No versions yet.</p>
            ) : (
              <div>
                {roots.map((root) => (
                  <VersionNode
                    key={root.version.id}
                    node={root}
                    currentVersionId={currentVersionId}
                    selectedVersionId={selectedVersionId}
                    versionsById={versionsById}
                    onSelect={onSelectVersion}
                    renameState={renameState}
                    onRenameStart={handleRenameStart}
                    onRenameChange={handleRenameChange}
                    onRenameCommit={() => void handleRenameCommit()}
                    onRenameCancel={handleRenameCancel}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
