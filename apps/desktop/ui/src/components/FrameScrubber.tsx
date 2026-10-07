import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { tempDir, join } from '@tauri-apps/api/path';
import {
  Play, Pause, SkipBack, SkipForward,
  AlertCircle, Loader2, Sparkles, RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

interface FrameScrubberProps {
  script: string;
  frameRange: [number, number];
}

export function FrameScrubber({ script, frameRange }: FrameScrubberProps) {
  const [frame, setFrame]       = useState(frameRange[0]);
  const [playing, setPlaying]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canRender = Boolean(script && script.includes('import bpy'));

  const renderFrame = useCallback(async (f: number) => {
    if (!script || !script.includes('import bpy')) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const tDir = await tempDir();
      const outPath = await join(tDir, `flinch_frame_${f}.png`);
      await invoke('render_frame', { script, frame: f, outPath });
      setPreviewSrc(convertFileSrc(outPath) + `?t=${Date.now()}`);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [script]);

  // Debounced render on frame change if canRender
  useEffect(() => {
    if (!canRender) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      renderFrame(frame);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [frame, renderFrame, canRender]);

  // Reset preview when script changes
  useEffect(() => {
    setPreviewSrc(null);
    setError(null);
    if (canRender) {
      renderFrame(frameRange[0]);
    }
  }, [script, canRender]);

  // Playback
  useEffect(() => {
    if (playing) {
      playTimerRef.current = setInterval(() => {
        setFrame((f) => {
          const next = f + 1;
          if (next > frameRange[1]) { setPlaying(false); return frameRange[0]; }
          return next;
        });
      }, 200);
    } else {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    }
    return () => { if (playTimerRef.current) clearInterval(playTimerRef.current); };
  }, [playing, frameRange]);

  const totalFrames = frameRange[1] - frameRange[0];

  return (
    <div className="flex flex-col bg-flinch-deep border-t border-flinch-border-dim h-full">
      {/* Viewport Header */}
      <div className="px-3 py-1 bg-flinch-panel/40 border-b border-flinch-border-dim/40 text-2xs font-mono text-flinch-text-muted flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <span>🎬 Live Viewport Canvas</span>
          {canRender && (
            <span className="w-1.5 h-1.5 rounded-full bg-flinch-success inline-block" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {canRender && (
            <button
              onClick={() => renderFrame(frame)}
              disabled={loading}
              className="text-flinch-text-muted hover:text-flinch-text flinch-transition flex items-center gap-1"
            >
              <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
              <span>Rerender Frame</span>
            </button>
          )}
          <span>Frame {frame} of {frameRange[1]}</span>
        </div>
      </div>

      {/* Preview canvas */}
      <div className="flex-1 flex items-center justify-center bg-black/30 relative overflow-hidden min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 bg-flinch-surface/80 px-4 py-2.5 rounded-lg border border-flinch-border shadow-lg">
              <Loader2 className="w-5 h-5 text-flinch-accent animate-spin" />
              <span className="text-2xs font-mono text-flinch-text">Evaluating Frame {frame}...</span>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-2 text-flinch-error p-4 text-center max-w-sm">
            <AlertCircle size={22} />
            <span className="text-xs font-semibold">Frame Render Error</span>
            <span className="text-2xs font-mono text-flinch-text-muted break-all max-h-24 overflow-y-auto">{error}</span>
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
          />
        ) : !loading && !error ? (
          <div className="text-center p-6 text-flinch-text-muted">
            <div className="text-4xl mb-3 opacity-30">🧊</div>
            <div className="text-sm font-medium text-flinch-text-dim mb-1">Live Viewport Ready</div>
            <div className="text-xs text-flinch-text-muted max-w-xs mb-3">
              {canRender
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
            onClick={() => setFrame(frameRange[0])}
            className="text-flinch-text-dim hover:text-flinch-text flinch-transition p-1"
            title="Go to start (Frame 1)"
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center flinch-transition",
              "bg-flinch-accent text-white hover:bg-flinch-accent-dim"
            )}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            onClick={() => setFrame(frameRange[1])}
            className="text-flinch-text-dim hover:text-flinch-text flinch-transition p-1"
            title={`Go to end (Frame ${frameRange[1]})`}
          >
            <SkipForward size={14} />
          </button>

          {/* Scrubber slider */}
          <input
            type="range"
            min={frameRange[0]}
            max={frameRange[1]}
            value={frame}
            onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
            className="flex-1 h-1.5 accent-flinch-accent cursor-pointer"
          />

          {/* Frame counter */}
          <span className="text-xs font-mono text-flinch-text-dim shrink-0 w-24 text-right">
            {frame} / {frameRange[1]}
            <span className="text-flinch-text-muted ml-1">
              ({totalFrames}f)
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
