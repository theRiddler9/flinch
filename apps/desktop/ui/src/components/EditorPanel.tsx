import { useStore } from '../state/useStore';
import { Editor, DiffEditor } from '@monaco-editor/react';
import {
  AlertCircle, CheckCircle2, Download, FileCode,
  ChevronDown, ChevronRight, Copy, Code2,
} from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { tempDir, join } from '@tauri-apps/api/path';
import { save } from '@tauri-apps/plugin-dialog';
import { cn } from '../lib/utils';
import { useState, useEffect, useRef } from 'react';
import { FrameScrubber } from './FrameScrubber';

export function EditorPanel() {
  const { attempts, activeAttemptIndex, setActiveAttempt, finalResult, theme, fontSize } = useStore();
  const [errorExpanded, setErrorExpanded] = useState(true);

  // Resizable split
  const [splitPct, setSplitPct] = useState(60); // top pane %
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const monacoTheme =
    theme === 'light' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)
      ? 'vs-light'
      : 'vs-dark';

  const currentAttempt  = attempts[activeAttemptIndex];
  const previousAttempt = activeAttemptIndex > 0 ? attempts[activeAttemptIndex - 1] : null;
  const isDiffMode  = previousAttempt && currentAttempt.script !== previousAttempt.script;
  const hasError    = currentAttempt?.harness_result && !currentAttempt.harness_result.ok;
  const isSuccess   = currentAttempt?.harness_result?.ok;

  // Reset split when script changes
  useEffect(() => { setSplitPct(60); }, [currentAttempt?.script]);

  // Drag handler
  const onMouseDown = () => { dragging.current = true; };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setSplitPct(Math.min(Math.max(pct, 25), 80));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const handleExportBlend = async () => {
    const path = await save({ filters: [{ name: 'Blender', extensions: ['blend'] }] });
    if (path) await invoke('export_blend', { script: currentAttempt.script, outPath: path });
  };

  const handleSavePy = async () => {
    const path = await save({ filters: [{ name: 'Python', extensions: ['py'] }] });
    if (path) await invoke('export_script', { script: currentAttempt.script, outPath: path });
  };

  const handleCopyCode = async () => {
    try { await navigator.clipboard.writeText(currentAttempt.script); } catch (err) { console.error(err); }
  };

  const handleOpenExternal = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-opener');
      const tDir   = await tempDir();
      const rand   = Math.random().toString(36).substring(7);
      const outPath = await join(tDir, `flinch_script_${rand}.py`);
      await invoke('export_script', { script: currentAttempt.script, outPath });
      await open(outPath);
    } catch (err) { console.error(err); }
  };

  if (attempts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-flinch-deep">
        <div className="text-center">
          <div className="text-6xl mb-5 opacity-20">🧊</div>
          <div className="text-flinch-text-dim text-sm font-medium mb-1">No script yet</div>
          <div className="text-flinch-text-muted text-xs">Generated code will appear here</div>
        </div>
      </div>
    );
  }

  const frameRange: [number, number] = currentAttempt.harness_result?.scene_stats
    ? [
        currentAttempt.harness_result.scene_stats.frame_range[0],
        currentAttempt.harness_result.scene_stats.frame_range[1],
      ]
    : [1, 120];

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-flinch-deep overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-flinch-border-dim bg-flinch-panel/80 flinch-glass shrink-0">
        {/* Attempt tabs */}
        <div className="flex items-center gap-1">
          {attempts.map((att, idx) => {
            const attError = att.harness_result && !att.harness_result.ok;
            const attOk    = att.harness_result?.ok;
            return (
              <button
                key={idx}
                onClick={() => setActiveAttempt(idx)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium flinch-transition flinch-focus-ring",
                  "flex items-center gap-1.5",
                  activeAttemptIndex === idx
                    ? "bg-flinch-surface text-flinch-text shadow-flinch-panel"
                    : "text-flinch-text-muted hover:text-flinch-text-dim hover:bg-flinch-surface/40"
                )}
              >
                <span>Attempt {idx + 1}</span>
                {attError ? (
                  <AlertCircle size={12} className="text-flinch-error" />
                ) : attOk ? (
                  <CheckCircle2 size={12} className="text-flinch-success" />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Status + Export actions */}
        <div className="flex items-center gap-2">
          {finalResult && (
            <div className={cn(
              "flinch-badge",
              finalResult.success
                ? "text-flinch-success bg-flinch-success/10 border border-flinch-success/20"
                : "text-flinch-error bg-flinch-error/10 border border-flinch-error/20"
            )}>
              {finalResult.success ? <><CheckCircle2 size={10} /> Passed</> : <><AlertCircle size={10} /> Failed</>}
            </div>
          )}
          <div className="w-px h-5 bg-flinch-border-dim mx-1" />

          <button onClick={handleCopyCode} title="Copy Code"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium flinch-transition flinch-focus-ring text-flinch-text-dim hover:text-flinch-text bg-flinch-surface/40 hover:bg-flinch-surface border border-flinch-border-dim">
            <Copy size={12} />
          </button>
          <button onClick={handleOpenExternal} title="Open in External Editor"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium flinch-transition flinch-focus-ring text-flinch-text-dim hover:text-flinch-text bg-flinch-surface/40 hover:bg-flinch-surface border border-flinch-border-dim">
            <Code2 size={12} />
          </button>
          <button onClick={handleExportBlend}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium flinch-transition flinch-focus-ring text-flinch-text-dim hover:text-flinch-text bg-flinch-surface/40 hover:bg-flinch-surface border border-flinch-border-dim">
            <Download size={12} /> .blend
          </button>
          <button onClick={handleSavePy}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium flinch-transition flinch-focus-ring text-flinch-text-dim hover:text-flinch-text bg-flinch-surface/40 hover:bg-flinch-surface border border-flinch-border-dim">
            <FileCode size={12} /> .py
          </button>
        </div>
      </div>

      {/* ── Dual Pane ───────────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* TOP: Monaco editor */}
        <div style={{ height: `${splitPct}%` }} className="min-h-0 overflow-hidden">
          {isDiffMode ? (
            <DiffEditor
              language="python" theme={monacoTheme}
              original={previousAttempt.script}
              modified={currentAttempt.script}
              options={{
                readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
                renderSideBySide: false, fontSize, lineHeight: Math.round(fontSize * 1.5),
                fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
                padding: { top: 12, bottom: 12 }, smoothScrolling: true,
                cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
              }}
            />
          ) : (
            <Editor
              language="python" theme={monacoTheme}
              value={currentAttempt.script}
              options={{
                readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
                fontSize, lineHeight: Math.round(fontSize * 1.5),
                fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
                padding: { top: 12, bottom: 12 }, smoothScrolling: true,
                cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
              }}
            />
          )}
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="h-1.5 bg-flinch-border-dim hover:bg-flinch-accent/50 cursor-row-resize flinch-transition shrink-0"
          title="Drag to resize"
        />

        {/* BOTTOM: Frame Scrubber / Preview */}
        <div style={{ height: `${100 - splitPct}%` }} className="min-h-0 overflow-hidden">
          <FrameScrubber
            script={currentAttempt.script}
            frameRange={frameRange}
          />
        </div>
      </div>

      {/* ── Error / Diagnostics Panel ───────────────────────── */}
      {hasError && currentAttempt.harness_result && (
        <div className="border-t border-flinch-error/20 bg-flinch-deep shrink-0">
          <button
            onClick={() => setErrorExpanded(!errorExpanded)}
            className="w-full flex items-center gap-2 px-4 py-2 text-flinch-error hover:bg-flinch-error/5 flinch-transition text-sm font-medium"
          >
            {errorExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <AlertCircle size={14} />
            <span>Stage: {currentAttempt.harness_result.stage}</span>
            {currentAttempt.harness_result.error && (
              <span className="ml-2 text-xs text-flinch-error/70 font-mono truncate">
                {currentAttempt.harness_result.error.type}
              </span>
            )}
          </button>
          {errorExpanded && (
            <div className="max-h-40 overflow-y-auto px-4 pb-3 flinch-slide-in space-y-3">
              {currentAttempt.harness_result.error && (
                <div className="font-mono text-xs leading-relaxed">
                  <div className="text-flinch-error font-semibold mb-1">
                    {(currentAttempt.harness_result.error as any).error_type ?? (currentAttempt.harness_result.error as any).type}: {currentAttempt.harness_result.error.message}
                  </div>
                  {currentAttempt.harness_result.error.traceback && (
                    <pre className="text-flinch-error/60 whitespace-pre-wrap text-2xs leading-relaxed">
                      {currentAttempt.harness_result.error.traceback}
                    </pre>
                  )}
                </div>
              )}
              {currentAttempt.harness_result.checks.filter(c => !c.passed).length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-flinch-warning">Failing Checks</div>
                  {currentAttempt.harness_result.checks.filter(c => !c.passed).map(c => (
                    <div key={c.id} className="flex items-center gap-2 text-2xs font-mono text-flinch-warning/80">
                      <span className="text-flinch-error">✕</span>
                      <span className="font-semibold">{c.id}</span>
                      <span className="text-flinch-text-muted">{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Success info bar ────────────────────────────────── */}
      {isSuccess && currentAttempt.harness_result?.scene_stats && (
        <div className="px-4 py-2 border-t border-flinch-success/20 bg-flinch-success/5 flex items-center gap-3 text-2xs text-flinch-text-muted font-mono shrink-0">
          <CheckCircle2 size={12} className="text-flinch-success shrink-0" />
          <span>{currentAttempt.harness_result.scene_stats.counts.mesh}M {currentAttempt.harness_result.scene_stats.counts.light}L {currentAttempt.harness_result.scene_stats.counts.camera}C</span>
          <span className="text-flinch-border">|</span>
          <span>
            {currentAttempt.harness_result.scene_stats.frame_range[0]}–
            {currentAttempt.harness_result.scene_stats.frame_range[1]} @{currentAttempt.harness_result.scene_stats.fps}fps
          </span>
          <span className="text-flinch-border">|</span>
          <span>{currentAttempt.harness_result.duration_ms}ms</span>
        </div>
      )}
    </div>
  );
}
