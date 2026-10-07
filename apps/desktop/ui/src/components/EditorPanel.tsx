import { useStore } from '../state/useStore';
import { Editor, DiffEditor } from '@monaco-editor/react';
import {
  AlertCircle, CheckCircle2, Download, FileCode,
  ChevronDown, ChevronRight, Copy, Code2, Sparkles,
  Columns, PlaySquare,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { tempDir, join } from '@tauri-apps/api/path';
import { save } from '@tauri-apps/plugin-dialog';
import { cn } from '../lib/utils';
import { useState, useEffect, useRef } from 'react';
import { FrameScrubber } from './FrameScrubber';

const DEFAULT_SCRIPT = `import bpy

# Default Workspace Animation (Blender 5.2)
bpy.ops.wm.read_factory_settings(use_empty=True)

# Add a bouncing cube with keyframed z-location
bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, 0, 0))
cube = bpy.context.active_object
cube.name = "BouncingCube"

for f, z in [(1, 0.0), (15, 2.5), (30, 0.0), (45, 2.5), (60, 0.0)]:
    cube.location.z = z
    cube.keyframe_insert(data_path="location", frame=f)

bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 60
bpy.context.scene.frame_set(1)
`;

export function EditorPanel() {
  const { attempts, activeAttemptIndex, setActiveAttempt, finalResult, theme, fontSize } = useStore();
  const [errorExpanded, setErrorExpanded] = useState(true);
  const [viewMode, setViewMode] = useState<'split' | 'viewport' | 'code'>('split');

  // Resizable split: top code %, bottom preview %
  const [splitPct, setSplitPct] = useState(55);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const monacoTheme =
    theme === 'light' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)
      ? 'vs-light'
      : 'vs-dark';

  const currentAttempt  = attempts[activeAttemptIndex];
  const previousAttempt = activeAttemptIndex > 0 ? attempts[activeAttemptIndex - 1] : null;
  const script          = currentAttempt ? currentAttempt.script : DEFAULT_SCRIPT;
  const isDiffMode      = Boolean(previousAttempt && currentAttempt && currentAttempt.script !== previousAttempt.script);
  const hasError        = Boolean(currentAttempt?.harness_result && !currentAttempt.harness_result.ok);
  const isSuccess       = Boolean(currentAttempt?.harness_result?.ok);

  // Drag handler for resizing split
  const onMouseDown = () => { dragging.current = true; };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setSplitPct(Math.min(Math.max(pct, 20), 80));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleExportBlend = async () => {
    const path = await save({ filters: [{ name: 'Blender', extensions: ['blend'] }] });
    if (path) await invoke('export_blend', { script, outPath: path });
  };

  const handleSavePy = async () => {
    const path = await save({ filters: [{ name: 'Python', extensions: ['py'] }] });
    if (path) await invoke('export_script', { script, outPath: path });
  };

  const handleCopyCode = async () => {
    try { await navigator.clipboard.writeText(script); } catch (err) { console.error(err); }
  };

  const handleOpenExternal = async () => {
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      const tDir   = await tempDir();
      const rand   = Math.random().toString(36).substring(7);
      const outPath = await join(tDir, `flinch_script_${rand}.py`);
      await invoke('export_script', { script, outPath });
      await openPath(outPath);
    } catch (err) { console.error(err); }
  };

  const frameRange: [number, number] = currentAttempt?.harness_result?.scene_stats
    ? [
        currentAttempt.harness_result.scene_stats.frame_range[0],
        currentAttempt.harness_result.scene_stats.frame_range[1],
      ]
    : [1, 60];

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-flinch-deep overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-flinch-border-dim bg-flinch-panel/80 flinch-glass shrink-0">
        {/* Attempt tabs or Workspace indicator */}
        <div className="flex items-center gap-2">
          {attempts.length === 0 ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-flinch-text-dim bg-flinch-surface/40">
              <Sparkles size={12} className="text-flinch-accent" />
              <span>Workspace</span>
            </div>
          ) : (
            attempts.map((att, idx) => {
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
            })
          )}

          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 bg-flinch-surface/60 p-0.5 rounded border border-flinch-border-dim ml-2">
            <button
              onClick={() => setViewMode('split')}
              className={cn(
                "px-2 py-0.5 text-2xs font-medium rounded flinch-transition flex items-center gap-1",
                viewMode === 'split' ? "bg-flinch-accent text-white shadow-xs" : "text-flinch-text-muted hover:text-flinch-text"
              )}
              title="Split View (Code + Viewport)"
            >
              <Columns size={11} /> <span>Split</span>
            </button>
            <button
              onClick={() => setViewMode('viewport')}
              className={cn(
                "px-2 py-0.5 text-2xs font-medium rounded flinch-transition flex items-center gap-1",
                viewMode === 'viewport' ? "bg-flinch-accent text-white shadow-xs" : "text-flinch-text-muted hover:text-flinch-text"
              )}
              title="Full Viewport & Timeline Scrubber"
            >
              <PlaySquare size={11} /> <span>Viewport & Timeline</span>
            </button>
            <button
              onClick={() => setViewMode('code')}
              className={cn(
                "px-2 py-0.5 text-2xs font-medium rounded flinch-transition flex items-center gap-1",
                viewMode === 'code' ? "bg-flinch-accent text-white shadow-xs" : "text-flinch-text-muted hover:text-flinch-text"
              )}
              title="Code Editor Only"
            >
              <Code2 size={11} /> <span>Code</span>
            </button>
          </div>
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

      {/* ── Main Workspace Area ─── */}
      <div ref={containerRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {viewMode === 'viewport' ? (
          /* FULL VIEWPORT & SCRUBBER */
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <FrameScrubber script={script} frameRange={frameRange} />
          </div>
        ) : viewMode === 'code' ? (
          /* FULL CODE */
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="px-3 py-1 bg-flinch-panel/40 border-b border-flinch-border-dim/40 text-2xs font-mono text-flinch-text-muted flex items-center justify-between shrink-0">
              <span>📝 Python (bpy)</span>
              <span>{currentAttempt ? `Attempt ${activeAttemptIndex + 1}` : 'Live Editor'}</span>
            </div>
            <div className="flex-1 min-h-0">
              {isDiffMode && previousAttempt ? (
                <DiffEditor
                  language="python" theme={monacoTheme}
                  original={previousAttempt.script}
                  modified={script}
                  options={{
                    readOnly: false, minimap: { enabled: false }, scrollBeyondLastLine: false,
                    renderSideBySide: false, fontSize, lineHeight: Math.round(fontSize * 1.5),
                    fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
                    padding: { top: 10, bottom: 10 }, smoothScrolling: true,
                    cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
                  }}
                />
              ) : (
                <Editor
                  language="python" theme={monacoTheme}
                  value={script}
                  options={{
                    readOnly: false, minimap: { enabled: false }, scrollBeyondLastLine: false,
                    fontSize, lineHeight: Math.round(fontSize * 1.5),
                    fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
                    padding: { top: 10, bottom: 10 }, smoothScrolling: true,
                    cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          /* SPLIT VIEW (Code top, Viewport bottom) */
          <>
            <div style={{ height: `${splitPct}%` }} className="min-h-0 overflow-hidden flex flex-col">
              <div className="px-3 py-1 bg-flinch-panel/40 border-b border-flinch-border-dim/40 text-2xs font-mono text-flinch-text-muted flex items-center justify-between shrink-0">
                <span>📝 Python (bpy)</span>
                <span>{currentAttempt ? `Attempt ${activeAttemptIndex + 1}` : 'Live Editor'}</span>
              </div>
              <div className="flex-1 min-h-0">
                {isDiffMode && previousAttempt ? (
                  <DiffEditor
                    language="python" theme={monacoTheme}
                    original={previousAttempt.script}
                    modified={script}
                    options={{
                      readOnly: false, minimap: { enabled: false }, scrollBeyondLastLine: false,
                      renderSideBySide: false, fontSize, lineHeight: Math.round(fontSize * 1.5),
                      fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
                      padding: { top: 10, bottom: 10 }, smoothScrolling: true,
                      cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
                    }}
                  />
                ) : (
                  <Editor
                    language="python" theme={monacoTheme}
                    value={script}
                    options={{
                      readOnly: false, minimap: { enabled: false }, scrollBeyondLastLine: false,
                      fontSize, lineHeight: Math.round(fontSize * 1.5),
                      fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
                      padding: { top: 10, bottom: 10 }, smoothScrolling: true,
                      cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
                    }}
                  />
                )}
              </div>
            </div>

            {/* Drag handle */}
            <div
              onMouseDown={onMouseDown}
              className="h-2 bg-flinch-border-dim/80 hover:bg-flinch-accent/80 cursor-row-resize flinch-transition shrink-0 flex items-center justify-center group"
              title="Drag to resize code / viewport split"
            >
              <div className="w-8 h-0.5 rounded-full bg-flinch-text-muted/40 group-hover:bg-white" />
            </div>

            {/* BOTTOM: Frame Scrubber / Viewport Canvas */}
            <div style={{ height: `${100 - splitPct}%` }} className="min-h-0 overflow-hidden flex flex-col">
              <FrameScrubber
                script={script}
                frameRange={frameRange}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Error / Diagnostics Panel ───────────────────────── */}
      {hasError && currentAttempt?.harness_result && (
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
                {(currentAttempt.harness_result.error as any).error_type ?? (currentAttempt.harness_result.error as any).type}
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
      {isSuccess && currentAttempt?.harness_result?.scene_stats && (
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
