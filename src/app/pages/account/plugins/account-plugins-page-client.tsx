'use client';

import { DragEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type PluginItem = {
  id: string;
  pluginKey: string;
  name: string;
  displayName: string | null;
  description: string | null;
  version: string;
  manufacturer: string | null;
  parameterSchema: unknown;
  ownerId: string | null;
  visibility: 'PRIVATE' | 'PUBLIC';
  moduleObjectKey: string | null;
  bundlePrefix: string | null;
  bundleKind: 'SINGLE_MODULE' | 'ZIP_BUNDLE' | null;
  sizeBytes: string | null;
  checksum: string | null;
  createdAt: string;
  updatedAt: string;
};

type AccountPluginsPageClientProps = {
  initialPlugins: PluginItem[];
};

function getPluginLabel(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim() || 'plugin';
}

function isSupportedPluginFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith('.js') || lowerName.endsWith('.mjs');
}

export default function AccountPluginsPageClient({ initialPlugins }: AccountPluginsPageClientProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [plugins, setPlugins] = useState(initialPlugins);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingPluginId, setDeletingPluginId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadPlugin(file: File) {
    if (!isSupportedPluginFile(file)) {
      setError('Use a .js or .mjs plugin module.');
      return;
    }

    setError(null);
    setStatusMessage(`Uploading ${file.name}...`);
    setIsUploading(true);

    try {
      const signResponse = await fetch('/api/plugins/sign-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/javascript',
          sizeBytes: file.size,
          displayName: getPluginLabel(file.name),
          visibility: 'PRIVATE',
        }),
      });

      const signData = (await signResponse.json()) as {
        uploadUrl?: string;
        uploadToken?: string;
        headers?: Record<string, string>;
        error?: string;
      };

      if (!signResponse.ok || !signData.uploadUrl || !signData.uploadToken) {
        setError(signData.error ?? 'Could not create an upload target.');
        setStatusMessage(null);
        return;
      }

      const putResponse = await fetch(signData.uploadUrl, {
        method: 'PUT',
        headers: signData.headers ?? { 'content-type': file.type || 'application/javascript' },
        body: file,
      });

      if (!putResponse.ok) {
        setError('Could not upload the plugin bundle.');
        setStatusMessage(null);
        return;
      }

      const completeResponse = await fetch('/api/plugins/complete-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uploadToken: signData.uploadToken }),
      });

      const completeData = (await completeResponse.json()) as {
        plugin?: PluginItem;
        error?: string;
      };

      if (!completeResponse.ok || !completeData.plugin) {
        setError(completeData.error ?? 'Could not finish the plugin upload.');
        setStatusMessage(null);
        return;
      }

      setPlugins((current) => [completeData.plugin as PluginItem, ...current]);
      setStatusMessage(`Uploaded ${file.name}.`);
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setStatusMessage(null);
    } finally {
      setIsUploading(false);
      setIsDragging(false);
    }
  }

  async function deletePlugin(plugin: PluginItem) {
    const pluginLabel = plugin.displayName ?? plugin.name;
    const confirmed = window.confirm(`Delete ${pluginLabel}? This will remove it from your library and any demo grants.`);
    if (!confirmed) {
      return;
    }

    setError(null);
    setStatusMessage(`Deleting ${pluginLabel}...`);
    setDeletingPluginId(plugin.id);

    try {
      const response = await fetch(`/api/plugins/${plugin.id}`, {
        method: 'DELETE',
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? 'Could not delete the plugin.');
        setStatusMessage(null);
        return;
      }

      setPlugins((current) => current.filter((currentPlugin) => currentPlugin.id !== plugin.id));
      setStatusMessage(`Deleted ${pluginLabel}.`);
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setStatusMessage(null);
    } finally {
      setDeletingPluginId((current) => (current === plugin.id ? null : current));
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void uploadPlugin(file);
    }
  }

  function handleFileChange(file: File | null) {
    if (file) {
      void uploadPlugin(file);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-[0.18em] text-cyan-300">Account</p>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Plugin Library</h1>
      </header>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5 shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">Upload Plugin</h2>
          <button
            type="button"
            onClick={openFilePicker}
            disabled={isUploading}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Choose file
          </button>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`mt-4 rounded-2xl border-2 border-dashed px-5 py-10 text-center transition-colors ${
            isDragging ? 'border-cyan-400 bg-cyan-500/10' : 'border-gray-700 bg-gray-950/50'
          }`}
        >
          <p className="text-base font-semibold text-white">Drop plugin here</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".js,.mjs,application/javascript,text/javascript"
            className="sr-only"
            onChange={(event) => handleFileChange(event.currentTarget.files?.[0] ?? null)}
          />
        </div>

        {statusMessage ? (
          <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {statusMessage}
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5 shadow-lg shadow-black/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">Owned Plugins</h2>
          <p className="text-sm text-gray-400">
            {plugins.length} plugin{plugins.length === 1 ? '' : 's'}
          </p>
        </div>

        {plugins.length > 0 ? (
          <ul className="mt-4 grid gap-3">
            {plugins.map((plugin) => {
              const pluginLabel = plugin.displayName ?? plugin.name;

              return (
                <li key={plugin.id} className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{pluginLabel}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {plugin.name} · {plugin.version} · {plugin.visibility}
                      </p>
                    </div>
                    <span className="rounded-full border border-gray-700 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-gray-300">
                      {plugin.bundleKind ?? 'Bundle'}
                    </span>
                  </div>
                  {plugin.description ? <p className="mt-3 text-sm text-gray-300">{plugin.description}</p> : null}
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <p className="min-w-0 text-xs text-gray-500">Plugin ID {plugin.id}</p>
                    <button
                      type="button"
                      onClick={() => void deletePlugin(plugin)}
                      disabled={deletingPluginId === plugin.id}
                      aria-label={`Delete ${pluginLabel}`}
                      title={`Delete ${pluginLabel}`}
                      className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-sm font-medium text-rose-100 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingPluginId === plugin.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-gray-800 px-4 py-6 text-sm text-gray-400">
            No plugins yet.
          </p>
        )}
      </section>
    </div>
  );
}
