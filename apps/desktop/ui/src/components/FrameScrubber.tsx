import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { tempDir, join } from '@tauri-apps/api/path';
import {
  Play, Pause, SkipBack, SkipForward,
  AlertCircle, Loader2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { useStore } from '../state/useStore';

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

  const renderFrame = useCallback(async (f: number) => {
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

  // Debounced render on frame change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      renderFrame(frame);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [frame, renderFrame]);

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
      {/* Preview canvas */}
      <div className="flex-1 flex items-center justify-center bg-black/30 relative overflow-hidden min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
            <Loader2 className="w-6 h-6 text-flinch-accent animate-spin" />
          </div>
        )}
        {error && !loading && (
          <div className="flex flex-col items-center gap-2 text-flinch-error p-4 text-center max-w-xs">
            <AlertCircle size={20} />
            <span className="text-xs">{error}</span>
          </div>
        )}
        {previewSrc && !error ? (
          <img
            src={previewSrc}
            alt={`Frame ${frame}`}
            className="max-w-full max-h-full object-contain"
          />
        ) : !loading && !error ? (
          <div className="text-flinch-text-muted text-xs flex flex-col items-center gap-2 opacity-40">
            <span className="text-2xl">🎬</span>
            <span>Frame preview loads here</span>
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
            title="Go to start"
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
            title="Go to end"
          >
            <SkipForward size={14} />
          </button>

          {/* Scrubber */}
          <input
            type="range"
            min={frameRange[0]}
            max={frameRange[1]}
            value={frame}
            onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
            className="flex-1 h-1.5 accent-flinch-accent cursor-pointer"
          />

          {/* Frame counter */}
          <span className="text-xs font-mono text-flinch-text-dim shrink-0 w-20 text-right">
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
