import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import {
  Play, Pause, SkipBack, SkipForward,
  WarningCircle as AlertCircle, SpinnerGap as Loader2, Sparkle as Sparkles, ArrowsClockwise as RefreshCw,
  ArrowSquareOut, Cube as Box, Camera,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { useStore, type PreviewParams } from '../state/useStore';
import type { ViewPreset } from '../bindings/ViewPreset';
import type { ShadingMode } from '../bindings/ShadingMode';

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title: string;
}

const VIEW_OPTIONS: SegmentOption<ViewPreset>[] = [
  { value: 'camera', label: 'Camera', title: 'Active camera (reframed automatically if it misses the model)' },
  { value: 'front', label: 'Front', title: 'Front view (orthographic)' },
  { value: 'side', label: 'Side', title: 'Side view (orthographic, from the right)' },
  { value: 'top', label: 'Top', title: 'Top view (orthographic)' },
  { value: 'iso', label: '3/4', title: 'Turntable / isometric 3/4 view (elevated 45\u00B0 perspective)' },
];

const SHADING_OPTIONS: SegmentOption<ShadingMode>[] = [
  { value: 'solid', label: 'Solid', title: 'Solid / Workbench with cavity shading for clear geometric detail' },
  { value: 'wireframe', label: 'Wireframe', title: 'Wireframe: shows the polygon edges of every mesh' },
  { value: 'rendered', label: 'Rendered', title: 'Rendered / material preview, using the engine chosen in Settings (EEVEE by default)' },
];

function Segmented<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5 rounded-md border border-flinch-border-dim bg-flinch-surface/60 p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded px-2 py-1 text-2xs font-medium flinch-transition flinch-focus-ring',
              selected ? 'bg-flinch-accent text-white' : 'text-flinch-text-muted hover:text-flinch-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface FrameScrubberProps {
  script: string;
  frameRange: [number, number];
}

export function FrameScrubber({ script, frameRange }: FrameScrubberProps) {
  const isRunning = useStore((state) => state.isRunning);
  const finalResult = useStore((state) => state.finalResult);
  const startFrame = frameRange[0];
  const endFrame = frameRange[1];
  const totalFrames = Math.max(1, endFrame - startFrame + 1);

  const [frame, setFrame] = useState(startFrame);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [baking, setBaking] = useState(false);
  const [bakingText, setBakingText] = useState('');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blenderLaunchError, setBlenderLaunchError] = useState<string | null>(null);
  const [cachedFramesCount, setCachedFramesCount] = useState(0);
  const [openingInBlender, setOpeningInBlender] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const viewPreset = useStore((state) => state.viewPreset);
  const shadingMode = useStore((state) => state.shadingMode);
  const matcap = useStore((state) => state.matcap);
  const enginePreset = useStore((state) => state.enginePreset);
  const setViewPreset = useStore((state) => state.setViewPreset);
  const setShadingMode = useStore((state) => state.setShadingMode);
  const setMatcap = useStore((state) => state.setMatcap);

  // Options for the next render, kept in refs so in-flight renders can tell when they went stale.
  const paramsRef = useRef<PreviewParams>({ view: viewPreset, shading: shadingMode, engine: enginePreset, matcap });
  paramsRef.current = { view: viewPreset, shading: shadingMode, engine: enginePreset, matcap };
  // Only settings that change the picture count: MatCap only affects Solid, the engine only Rendered.
  const viewKey = [viewPreset, shadingMode, shadingMode === 'solid' ? String(matcap) : '', shadingMode === 'rendered' ? enginePreset : ''].join('|');
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;
  const prevViewKeyRef = useRef(viewKey);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const rerenderPendingRef = useRef(false);
  const renderFrameRef = useRef<((f: number, silent?: boolean) => Promise<boolean>) | null>(null);

  // In-memory frame cache: frame number -> base64 data URI
  const frameCacheRef = useRef<Map<number, string>>(new Map());
  const isRenderingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpenInBlender = useCallback(async () => {
    if (!script) return;
    setOpeningInBlender(true);
    setBlenderLaunchError(null);
    try {
      await invoke('open_in_blender', { script });
    } catch (e: unknown) {
      console.error("Failed to open in Blender:", e);
      setBlenderLaunchError(String(e));
    } finally {
      setTimeout(() => setOpeningInBlender(false), 2000);
    }
  }, [script]);

  const isFailedRun = finalResult && finalResult.success === false;
  const canRender = Boolean(script && script.includes('import bpy') && !isRunning && !isFailedRun);

  // Single-frame renderer with cache check
  const renderFrame = useCallback(
    async (f: number, silent = false): Promise<boolean> => {
      if (!script || !script.includes('import bpy')) return false;

      const cached = frameCacheRef.current.get(f);
      if (cached) {
        setPreviewSrc(cached);
        return true;
      }

      if (isRenderingRef.current) {
        rerenderPendingRef.current = true; // render the latest frame and options once this one finishes
        return false;
      }
      isRenderingRef.current = true;
      const key = viewKeyRef.current;

      if (!silent) setLoading(true);
      setError(null);

      try {
        const b64DataUri = await invoke<string>('render_frame', {
          script,
          frame: f,
          outPath: null,
          preview: paramsRef.current,
        });
        if (key !== viewKeyRef.current) return false; // view or shading changed meanwhile: drop the stale image
        frameCacheRef.current.set(f, b64DataUri);
        setCachedFramesCount(frameCacheRef.current.size);
        setPreviewSrc(b64DataUri);
        return true;
      } catch (e: unknown) {
        if (key === viewKeyRef.current) setError(String(e));
        return false;
      } finally {
        isRenderingRef.current = false;
        if (!silent) setLoading(false);
        if (rerenderPendingRef.current) {
          rerenderPendingRef.current = false;
          void renderFrameRef.current?.(frameRef.current, silent);
        }
      }
    },
    [script]
  );
  renderFrameRef.current = renderFrame;

  // Batch-bake all frames in one single Blender invocation (~30ms/frame)
  const bakeAnimation = useCallback(async (): Promise<boolean> => {
    if (!script || !script.includes('import bpy')) return false;
    setBaking(true);
    setBakingText(`Baking frames ${startFrame} to ${endFrame} for smooth playback...`);
    setError(null);

    const key = viewKeyRef.current;
    try {
      const frames = await invoke<Record<string, string>>('render_sequence', {
        script,
        startFrame,
        endFrame,
        preview: paramsRef.current,
      });
      if (key !== viewKeyRef.current) return false; // view or shading changed while baking

      for (const [fStr, dataUri] of Object.entries(frames)) {
        frameCacheRef.current.set(Number(fStr), dataUri);
      }
      setCachedFramesCount(frameCacheRef.current.size);

      // Update current preview if we have it
      const current = frameCacheRef.current.get(frame) || frameCacheRef.current.get(startFrame);
      if (current) setPreviewSrc(current);
      return true;
    } catch (e: unknown) {
      setError(String(e));
      return false;
    } finally {
      setBaking(false);
      setBakingText('');
    }
  }, [script, startFrame, endFrame, frame]);

  // Handle Play/Pause toggle
  const togglePlay = useCallback(async () => {
    if (playing) {
      setPlaying(false);
      return;
    }

    // Check if we have cached frames
    const cachedCount = frameCacheRef.current.size;
    const isFullyCached = cachedCount >= totalFrames;

    if (!isFullyCached) {
      // Bake all frames quickly in one single process so animation plays in one smooth flow
      const success = await bakeAnimation();
      if (!success) return;
    }

    setPlaying(true);
  }, [playing, totalFrames, bakeAnimation]);

  // Smooth 24fps in-memory playback loop (0ms latency, zero Blender calls during play)
  useEffect(() => {
    if (!playing) return;

    const interval = setInterval(() => {
      setFrame((prevFrame) => {
        const next = prevFrame >= endFrame ? startFrame : prevFrame + 1;
        const cachedUri = frameCacheRef.current.get(next);
        if (cachedUri) {
          setPreviewSrc(cachedUri);
        }
        return next;
      });
    }, 1000 / 24);

    return () => clearInterval(interval);
  }, [playing, startFrame, endFrame]);

  // Debounced render on manual scrub if not in cache
  useEffect(() => {
    if (!canRender || playing) return;

    // If frame is already cached, show it instantly
    const cached = frameCacheRef.current.get(frame);
    if (cached) {
      setPreviewSrc(cached);
      return;
    }

    // Otherwise debounce single frame render
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      renderFrame(frame);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [frame, renderFrame, canRender, playing]);

  // New viewpoint or shading: cached frames show the old look, so drop them and redraw the current frame.
  useEffect(() => {
    if (prevViewKeyRef.current === viewKey) return;
    prevViewKeyRef.current = viewKey;
    frameCacheRef.current.clear();
    setCachedFramesCount(0);
    setPlaying(false);
    setError(null);
    if (canRender) void renderFrame(frameRef.current);
  }, [viewKey, canRender, renderFrame]);

  // High-resolution single frame, written wherever the user picks in the OS save dialog.
  const handleSnapshot = useCallback(async () => {
    if (!canRender) return;
    setSnapshotError(null);
    setSnapshotNotice(null);
    try {
      const path = await save({
        title: 'Save snapshot',
        defaultPath: `flinch-${paramsRef.current.view}-frame-${frameRef.current}.png`,
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      });
      if (!path) return;
      setSnapshotting(true);
      await invoke('export_snapshot', { script, frame: frameRef.current, preview: paramsRef.current, outPath: path });
      setSnapshotNotice('Snapshot saved');
      setTimeout(() => setSnapshotNotice(null), 4000);
    } catch (e: unknown) {
      setSnapshotError(String(e));
    } finally {
      setSnapshotting(false);
    }
  }, [canRender, script]);

  // Reset cache and preview when script changes
  useEffect(() => {
    frameCacheRef.current.clear();
    setCachedFramesCount(0);
    setPreviewSrc(null);
    setError(null);
    setPlaying(false);
    setFrame(startFrame);
    if (canRender) {
      renderFrame(startFrame);
    }
  }, [script, canRender, startFrame, renderFrame]);

  return (
    <div className="flex flex-col bg-flinch-deep border-t border-flinch-border-dim h-full">
      {/* Viewport Header */}
      <div className="px-3 py-1 bg-flinch-panel/40 border-b border-flinch-border-dim/40 text-2xs font-mono text-flinch-text-muted flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <span>Live Viewport Canvas</span>
          {canRender && (
            <span className="w-1.5 h-1.5 rounded-full bg-flinch-success inline-block" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {script && (
            <button
              onClick={handleOpenInBlender}
              disabled={isRunning || openingInBlender}
              className="text-flinch-text-muted hover:text-flinch-text flinch-transition flex items-center gap-1 bg-flinch-surface/60 px-2 py-0.5 rounded border border-flinch-border/50 text-2xs hover:border-flinch-accent/50"
              title="Launch and open the generated model directly in Blender"
            >
              <ArrowSquareOut size={11} className={openingInBlender ? "animate-pulse text-flinch-accent" : "text-flinch-accent"} />
              <span>{openingInBlender ? 'Opening...' : 'Open in Blender'}</span>
            </button>
          )}
          {canRender && (
            <>
              <button
                onClick={bakeAnimation}
                disabled={loading || baking}
                className="text-flinch-text-muted hover:text-flinch-text flinch-transition flex items-center gap-1 bg-flinch-surface/60 px-2 py-0.5 rounded border border-flinch-border/50 text-2xs"
                title="Bake all frames in sequence for instant smooth 24fps playback"
              >
                <Sparkles size={11} className={baking ? 'animate-spin text-flinch-accent' : 'text-flinch-accent'} />
                <span>{baking ? 'Baking...' : cachedFramesCount >= totalFrames ? 'Re-bake All' : 'Bake Animation'}</span>
              </button>
              <button
                onClick={() => renderFrame(frame)}
                disabled={loading || baking}
                className="text-flinch-text-muted hover:text-flinch-text flinch-transition flex items-center gap-1"
              >
                <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
                <span>Rerender</span>
              </button>
            </>
          )}
          <span>
            Frame {frame} of {endFrame}
            {cachedFramesCount > 0 && (
              <span className="text-flinch-accent ml-1.5 font-normal">
                ({cachedFramesCount}/{totalFrames} cached)
              </span>
            )}
          </span>
        </div>
      </div>

      {blenderLaunchError && (
        <div className="px-3 py-1 bg-flinch-error/15 border-b border-flinch-error/30 text-2xs text-flinch-error font-mono flex items-center justify-between shrink-0">
          <span className="truncate">Blender launch error: {blenderLaunchError}</span>
          <button onClick={() => setBlenderLaunchError(null)} className="ml-2 text-flinch-text-muted hover:text-flinch-text">✕</button>
        </div>
      )}

      {/* View, shading and snapshot controls */}
      <div className="px-3 py-1.5 bg-flinch-panel/30 border-b border-flinch-border-dim/40 flex flex-wrap items-center gap-x-3 gap-y-1.5 shrink-0">
        <Segmented label="Camera angle" value={viewPreset} options={VIEW_OPTIONS} onChange={setViewPreset} />
        <Segmented label="Shading" value={shadingMode} options={SHADING_OPTIONS} onChange={setShadingMode} />
        {shadingMode === 'solid' && (
          <label
            className="flex items-center gap-1.5 text-2xs text-flinch-text-muted cursor-pointer select-none"
            title="Light the model with a MatCap. This replaces material colors with the MatCap's own."
          >
            <input type="checkbox" checked={matcap} onChange={(e) => setMatcap(e.target.checked)} className="accent-flinch-accent" />
            <span>MatCap</span>
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          {snapshotNotice && <span className="text-2xs text-flinch-success" role="status">{snapshotNotice}</span>}
          <button
            type="button"
            onClick={handleSnapshot}
            disabled={!canRender || snapshotting}
            title="Render this frame at 1920x1080 and save it as a PNG"
            className="flex items-center gap-1.5 rounded border border-flinch-border/50 bg-flinch-surface/60 px-2 py-1 text-2xs text-flinch-text-muted hover:border-flinch-accent/50 hover:text-flinch-text flinch-transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {snapshotting ? <Loader2 size={11} className="animate-spin text-flinch-accent" /> : <Camera size={11} className="text-flinch-accent" />}
            <span>{snapshotting ? 'Rendering...' : 'Snapshot'}</span>
          </button>
        </div>
      </div>

      {snapshotError && (
        <div className="px-3 py-1 bg-flinch-error/15 border-b border-flinch-error/30 text-2xs text-flinch-error font-mono flex items-start justify-between shrink-0">
          <span className="whitespace-pre-wrap break-words max-h-16 overflow-y-auto">{snapshotError}</span>
          <button onClick={() => setSnapshotError(null)} className="ml-2 shrink-0 text-flinch-text-muted hover:text-flinch-text" aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* Preview canvas */}
      <div className="flex-1 flex items-center justify-center bg-black/30 relative overflow-hidden min-h-0">
        {(loading || baking) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 bg-flinch-surface/80 px-4 py-2.5 rounded-lg border border-flinch-border shadow-lg">
              <Loader2 className="w-5 h-5 text-flinch-accent animate-spin" />
              <span className="text-2xs font-mono text-flinch-text">
                {baking ? bakingText : `Evaluating Frame ${frame}...`}
              </span>
            </div>
          </div>
        )}

        {error && !loading && !baking && (
          <div className="flex flex-col items-center gap-2 text-flinch-error p-4 text-center max-w-sm">
            <AlertCircle size={22} />
            <span className="text-xs font-semibold">Frame Render Error</span>
            <div className="text-2xs font-mono text-flinch-text-muted whitespace-pre-wrap break-words max-h-24 overflow-y-auto w-full text-left p-2 bg-black/20 rounded">{error}</div>
            <button
              onClick={() => renderFrame(frame)}
              className="mt-2 px-3 py-1 bg-flinch-surface text-flinch-text text-2xs rounded border border-flinch-border hover:bg-flinch-surface/80"
            >
              Retry
            </button>
          </div>
        )}

        {previewSrc && !error ? (
          <img
            src={previewSrc}
            alt={`Frame ${frame}`}
            className="max-w-full max-h-full object-contain shadow-2xl rounded-sm"
            onError={() => {
              setPreviewSrc(null);
              setError("Image failed to load. The frame might not have been generated correctly by Blender.");
            }}
          />
        ) : !loading && !baking && !error ? (
          <div className="text-center p-6 text-flinch-text-muted">
            <Box size={36} weight="light" className="mx-auto mb-3 opacity-30 text-flinch-text-muted" />
            <div className="text-sm font-medium text-flinch-text-dim mb-1">
              {isRunning ? "Generating Script..." : isFailedRun ? "Script Execution Failed" : "Live Viewport Ready"}
            </div>
            <div className="text-xs text-flinch-text-muted max-w-xs mb-3">
              {isRunning
                ? "Waiting for the script to finish generating before rendering frames."
                : isFailedRun
                ? "The generated script contains errors. Check the terminal below."
                : canRender
                ? "Click below to render the initial frame preview."
                : "Enter a prompt in the chat. Flinch will compile the Blender script and stream frame renders here."}
            </div>
            {canRender && (
              <button
                onClick={() => renderFrame(frame)}
                className="px-3.5 py-1.5 bg-flinch-accent text-white text-xs font-medium rounded-md hover:bg-flinch-accent-dim flinch-transition inline-flex items-center gap-1.5"
              >
                <Sparkles size={12} />
                <span>Render Frame {frame}</span>
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Timeline controls */}
      <div className="shrink-0 px-3 py-2 border-t border-flinch-border-dim bg-flinch-panel/60">
        <div className="flex items-center gap-2">
          {/* Playback buttons */}
          <button
            onClick={() => setFrame(startFrame)}
            className="text-flinch-text-dim hover:text-flinch-text flinch-transition p-1"
            title={`Go to start (Frame ${startFrame})`}
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={togglePlay}
            disabled={baking}
            className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center flinch-transition",
              "bg-flinch-accent text-white hover:bg-flinch-accent-dim",
              baking && "opacity-50 cursor-not-allowed"
            )}
            title={playing ? 'Pause' : 'Play (Smooth 24fps)'}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            onClick={() => setFrame(endFrame)}
            className="text-flinch-text-dim hover:text-flinch-text flinch-transition p-1"
            title={`Go to end (Frame ${endFrame})`}
          >
            <SkipForward size={14} />
          </button>

          {/* Scrubber slider */}
          <input
            type="range"
            min={startFrame}
            max={endFrame}
            value={frame}
            onChange={(e) => {
              setPlaying(false);
              const val = Number(e.target.value);
              setFrame(val);
              const cached = frameCacheRef.current.get(val);
              if (cached) {
                setPreviewSrc(cached);
              }
            }}
            className="flex-1 h-1.5 accent-flinch-accent cursor-pointer"
          />

          {/* Frame counter */}
          <span className="text-xs font-mono text-flinch-text-dim shrink-0 w-24 text-right">
            {frame} / {endFrame}
            <span className="text-flinch-text-muted ml-1">
              ({totalFrames}f)
            </span>
          </span>
        </div>
      </div>

    </div>
  );
}
