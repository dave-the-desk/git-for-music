'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'git-for-music:selectedAudioInputDeviceId';

type AudioInputSelectorProps = {
  selectedAudioInputDeviceId: string | null;
  onSelectedAudioInputDeviceIdChange: (deviceId: string | null) => void;
  isAudioInputReady: boolean;
  onAudioInputReadyChange: (isReady: boolean) => void;
};

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function fallbackDeviceLabel(index: number) {
  return `Microphone ${index + 1}`;
}

export function AudioInputSelector({
  selectedAudioInputDeviceId,
  onSelectedAudioInputDeviceIdChange,
  isAudioInputReady,
  onAudioInputReadyChange,
}: AudioInputSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [selectedDeviceUnavailable, setSelectedDeviceUnavailable] = useState(false);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.enumerateDevices !== 'function') {
      setIsSupported(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const nextDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = nextDevices.filter((device) => device.kind === 'audioinput');
      setDevices(audioInputs);

      if (audioInputs.some((device) => device.label.trim().length > 0)) {
        setHasPermission(true);
      }
    } catch {
      setDevices([]);
    } finally {
      setIsLoading(false);
      setIsSupported(true);
    }
  }, []);

  useEffect(() => {
    const supported =
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.enumerateDevices === 'function' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function';

    setIsSupported(supported);

    if (!supported) {
      setIsLoading(false);
      return;
    }

    const storedSelection = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (storedSelection && storedSelection !== selectedAudioInputDeviceId) {
      onSelectedAudioInputDeviceIdChange(storedSelection);
    }

    void refreshDevices();

    const mediaDevices = navigator.mediaDevices;
    const handleDeviceChange = () => {
      void refreshDevices();
    };

    mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [onSelectedAudioInputDeviceIdChange, refreshDevices, selectedAudioInputDeviceId]);

  const selectedDevice = useMemo(() => {
    if (!selectedAudioInputDeviceId) return null;
    return devices.find((device) => device.deviceId === selectedAudioInputDeviceId) ?? null;
  }, [devices, selectedAudioInputDeviceId]);

  const audioInputs = devices;
  const selectedExists = Boolean(selectedDevice);
  const hasAnyDevices = audioInputs.length > 0;

  useEffect(() => {
    if (isSupported !== true) {
      onAudioInputReadyChange(false);
      return;
    }

    if (!hasAnyDevices) {
      setSelectedDeviceUnavailable(false);
      if (selectedAudioInputDeviceId) {
        onSelectedAudioInputDeviceIdChange(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
      onAudioInputReadyChange(false);
      return;
    }

    if (!selectedAudioInputDeviceId) {
      setSelectedDeviceUnavailable(false);
    }

    if (selectedAudioInputDeviceId && !selectedExists) {
      setSelectedDeviceUnavailable(true);
      onSelectedAudioInputDeviceIdChange(null);
      window.localStorage.removeItem(STORAGE_KEY);
      onAudioInputReadyChange(false);
      return;
    }

    if (selectedExists) {
      setSelectedDeviceUnavailable(false);
    }

    onAudioInputReadyChange(Boolean(hasPermission && selectedExists));
  }, [
    hasAnyDevices,
    hasPermission,
    isSupported,
    onAudioInputReadyChange,
    onSelectedAudioInputDeviceIdChange,
    selectedAudioInputDeviceId,
    selectedExists,
  ]);

  const status = useMemo(() => {
    if (isSupported === false) return 'Microphone input not supported';
    if (isLoading && !hasAnyDevices) return 'Checking microphones...';
    if (!hasAnyDevices) return 'No microphone found';
    if (selectedDeviceUnavailable) return 'Selected device unavailable';
    if (!hasPermission) return 'Microphone permission needed';
    if (selectedDevice) return `Selected: ${selectedDevice.label.trim() || fallbackDeviceLabel(audioInputs.indexOf(selectedDevice))}`;
    return 'Choose a microphone';
  }, [audioInputs, hasAnyDevices, hasPermission, isLoading, isSupported, selectedDevice, selectedDeviceUnavailable]);

  const toneClassName = useMemo(() => {
    if (isSupported === false || !hasAnyDevices) return 'bg-gray-700 text-gray-200 hover:bg-gray-600';
    if (selectedDeviceUnavailable) return 'bg-red-600 text-white hover:bg-red-500';
    if (!hasPermission) return 'bg-amber-600 text-white hover:bg-amber-500';
    if (isAudioInputReady && selectedDevice) return 'bg-emerald-600 text-white hover:bg-emerald-500';
    return 'bg-gray-700 text-gray-200 hover:bg-gray-600';
  }, [hasAnyDevices, hasPermission, isAudioInputReady, isSupported, selectedDevice, selectedDeviceUnavailable]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (panelRef.current?.contains(target) || buttonRef.current?.contains(target))) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  async function grantMicrophoneAccess() {
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setPermissionError('This browser cannot request microphone access.');
      return;
    }

    setPermissionError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopStream(stream);
      setHasPermission(true);
      await refreshDevices();
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow access to list and use input devices.'
          : error instanceof Error
            ? error.message
            : 'Could not access the microphone.';
      setPermissionError(message);
      setHasPermission(false);
    }
  }

  function handleDeviceSelect(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextDeviceId = event.currentTarget.value || null;
    setSelectedDeviceUnavailable(false);
    onSelectedAudioInputDeviceIdChange(nextDeviceId);
    if (typeof window !== 'undefined') {
      if (nextDeviceId) {
        window.localStorage.setItem(STORAGE_KEY, nextDeviceId);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    if (!nextDeviceId) {
      onAudioInputReadyChange(false);
    }
  }

  if (isSupported === null) {
    return (
      <button
        type="button"
        ref={buttonRef}
        className="flex h-8 w-8 items-center justify-center rounded bg-gray-700 text-gray-300"
        title="Checking microphone support..."
        aria-label="Checking microphone support"
        disabled
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d="M6 1a2 2 0 0 0-2 2v3a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2zm-3 5a3 3 0 0 0 6 0h1a4 4 0 0 1-3 3.87V11h-2V9.87A4 4 0 0 1 2 6h1z" />
        </svg>
      </button>
    );
  }

  const iconTitle = status;

  return (
    <div className="relative">
      <button
        type="button"
        ref={buttonRef}
        onClick={() => {
          setIsOpen((open) => !open);
          void refreshDevices();
        }}
        className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${toneClassName}`}
        title={iconTitle}
        aria-label={iconTitle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d="M6 1a2 2 0 0 0-2 2v3a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2zm-3 5a3 3 0 0 0 6 0h1a4 4 0 0 1-3 3.87V11h-2V9.87A4 4 0 0 1 2 6h1z" />
        </svg>
      </button>

      {isOpen ? (
        <div
          ref={panelRef}
          className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-gray-700 bg-gray-950 p-3 shadow-2xl shadow-black/40"
          role="dialog"
          aria-label="Audio input selector"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Microphone</p>
              <p className="mt-1 text-sm text-gray-100">{status}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            >
              Close
            </button>
          </div>

          <div className="mt-3 space-y-3">
            {!hasPermission && hasAnyDevices ? (
              <button
                type="button"
                onClick={() => void grantMicrophoneAccess()}
                className="w-full rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-100 hover:bg-amber-500/15"
              >
                Allow microphone access
              </button>
            ) : null}

            {permissionError ? <p className="text-sm text-red-400">{permissionError}</p> : null}

            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Input device</span>
              <select
                value={selectedAudioInputDeviceId ?? ''}
                onChange={handleDeviceSelect}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none ring-indigo-500 focus:ring disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!hasAnyDevices}
                aria-label="Select microphone input device"
              >
                <option value="">{hasAnyDevices ? 'Choose an input' : 'No input available'}</option>
                {audioInputs.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label.trim() || fallbackDeviceLabel(index)}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-md border border-gray-800 bg-gray-900/80 px-3 py-2 text-xs text-gray-300">
              {selectedDeviceUnavailable ? (
                <p className="text-red-300">Selected device unavailable</p>
              ) : selectedAudioInputDeviceId && selectedDevice ? (
                <p className="text-emerald-300">Selected: {selectedDevice.label.trim() || fallbackDeviceLabel(audioInputs.indexOf(selectedDevice))}</p>
              ) : hasAnyDevices && !hasPermission ? (
                <p className="text-amber-200">Microphone permission needed</p>
              ) : hasAnyDevices && !selectedAudioInputDeviceId ? (
                <p>Choose a microphone to enable recording.</p>
              ) : !hasAnyDevices ? (
                <p className="text-red-300">No microphone found</p>
              ) : (
                <p className="text-gray-400">The selector is ready.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
