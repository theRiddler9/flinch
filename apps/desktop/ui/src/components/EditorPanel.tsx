import { useStore } from '../state/useStore';
import { Editor, DiffEditor } from '@monaco-editor/react';
import { AlertCircle, CheckCircle2, Download, FileCode, ChevronDown, ChevronRight, Image as ImageIcon, Loader2, Copy, Code2 } from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { tempDir, join } from '@tauri-apps/api/path';
import { save } from '@tauri-apps/plugin-dialog';
import { cn } from '../lib/utils';
import { useState, useEffect } from 'react';

export function EditorPanel() {
  const { attempts, activeAttemptIndex, setActiveAttempt, finalResult, theme, fontSize } = useStore();
  const [errorExpanded, setErrorExpanded] = useState(true);

  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const currentAttempt = attempts[activeAttemptIndex];
  const previousAttempt = activeAttemptIndex > 0 ? attempts[activeAttemptIndex - 1] : null;

  useEffect(() => {
    setPreviewSrc(null);
    setPreviewError(null);
    setActiveTab('code');
  }, [currentAttempt?.script]);

  if (attempts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-flinch-deep">
        <div className="text-center">
          <div className="text-6xl mb-5 opacity-20">🧊</div>
          <div className="text-flinch-text-dim text-sm font-medium mb-1">No script yet</div>
          <div className="text-flinch-text-muted text-xs">
            Generated code will appear here
          </div>
        </div>
      </div>
    );
  }

  const isDiffMode = previousAttempt && currentAttempt.script !== previousAttempt.script;
  const hasError = currentAttempt.harness_result && !currentAttempt.harness_result.ok;
  const isSuccess = currentAttempt.harness_result?.ok;

  const handleExportBlend = async () => {
    const path = await save({ filters: [{ name: 'Blender', extensions: ['blend'] }] });
    if (path) {
      await invoke('export_blend', { script: currentAttempt.script, outPath: path });
    }
  };

  const handleSavePy = async () => {
    const path = await save({ filters: [{ name: 'Python', extensions: ['py'] }] });
    if (path) {
      await invoke('export_script', { script: currentAttempt.script, outPath: path });
    }
  };

  const handlePreview = async () => {
    setActiveTab('preview');
    if (previewSrc) return;
    
    setPreviewLoading(true);
    setPreviewError(null);
    
    try {
      const tDir = await tempDir();
      const randStr = Math.random().toString(36).substring(7);
      const outPath = await join(tDir, `flinch_preview_${randStr}.png`);
      
      await invoke('export_preview', { script: currentAttempt.script, outPath });
      
      const assetUrl = convertFileSrc(outPath);
      setPreviewSrc(assetUrl);
    } catch (err: any) {
      setPreviewError(err.toString());
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(currentAttempt.script);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleOpenExternal = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-opener');
      const tDir = await tempDir();
      const randStr = Math.random().toString(36).substring(7);
      const outPath = await join(tDir, `flinch_script_${randStr}.py`);
      await invoke('export_script', { script: currentAttempt.script, outPath });
      await open(outPath);
    } catch (err) {
      console.error('Failed to open in external editor', err);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-flinch-deep">
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-flinch-border-dim bg-flinch-panel/80 flinch-glass">
        {/* Attempt tabs */}
        <div className="flex items-center gap-1">
          {attempts.map((att, idx) => {
            const attError = att.harness_result && !att.harness_result.ok;
            const attOk = att.harness_result?.ok;
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
          <div className="flex items-center gap-1 bg-flinch-surface/40 p-0.5 rounded-md border border-flinch-border-dim">
            <button
              onClick={() => setActiveTab('code')}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium flinch-transition",
                activeTab === 'code' ? "bg-flinch-surface text-flinch-text shadow-sm" : "text-flinch-text-dim hover:text-flinch-text"
              )}
            >
              <FileCode size={12} />
              Code
            </button>
            <button
              onClick={handlePreview}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium flinch-transition",
                activeTab === 'preview' ? "bg-flinch-surface text-flinch-text shadow-sm" : "text-flinch-text-dim hover:text-flinch-text"
              )}
            >
              <ImageIcon size={12} />
              Preview
            </button>
          </div>
          <div className="w-px h-5 bg-flinch-border-dim mx-1" />

          {finalResult && (
            <div className={cn(
              "flinch-badge",
              finalResult.success
                ? "text-flinch-success bg-flinch-success/10 border border-flinch-success/20"
                : "text-flinch-error bg-flinch-error/10 border border-flinch-error/20"
            )}>
              {finalResult.success ? (
                <><CheckCircle2 size={10} /> Passed</>
              ) : (
                <><AlertCircle size={10} /> Failed</>
              )}
            </div>
          )}
          <div className="w-px h-5 bg-flinch-border-dim mx-1" />
          <button
            onClick={handleCopyCode}
            title="Copy Code"
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium flinch-transition flinch-focus-ring",
              "text-flinch-text-dim hover:text-flinch-text bg-flinch-surface/40 hover:bg-flinch-surface border border-flinch-border-dim"
            )}
          >
            <Copy size={12} />
          </button>
          <button
            onClick={handleOpenExternal}
            title="Open in External Editor"
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium flinch-transition flinch-focus-ring",
              "text-flinch-text-dim hover:text-flinch-text bg-flinch-surface/40 hover:bg-flinch-surface border border-flinch-border-dim"
            )}
          >
            <Code2 size={12} />
          </button>
          <button
            onClick={handleExportBlend}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium flinch-transition flinch-focus-ring",
              "text-flinch-text-dim hover:text-flinch-text bg-flinch-surface/40 hover:bg-flinch-surface border border-flinch-border-dim"
            )}
          >
            <Download size={12} />
            .blend
          </button>
          <button
            onClick={handleSavePy}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium flinch-transition flinch-focus-ring",
              "text-flinch-text-dim hover:text-flinch-text bg-flinch-surface/40 hover:bg-flinch-surface border border-flinch-border-dim"
            )}
          >
            <FileCode size={12} />
            .py
          </button>
        </div>
      </div>

      {/* ── Monaco Editor / Preview ───────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        {activeTab === 'preview' ? (
          <div className="flex-1 flex items-center justify-center bg-black/20 p-4">
            {previewLoading ? (
              <div className="flex flex-col items-center gap-3 text-flinch-text-muted">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-xs">Rendering preview...</span>
              </div>
            ) : previewError ? (
              <div className="flex flex-col items-center gap-3 text-flinch-error max-w-md text-center">
                <AlertCircle className="w-8 h-8" />
                <span className="text-sm font-medium">Failed to render preview</span>
                <span className="text-xs opacity-80 font-mono break-all">{previewError}</span>
              </div>
            ) : previewSrc ? (
              <img src={previewSrc} alt="Preview" className="max-w-full max-h-full object-contain rounded-md shadow-lg" />
            ) : null}
          </div>
        ) : isDiffMode ? (
          <DiffEditor
            language="python"
            theme={theme === 'light' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches) ? "vs-light" : "vs-dark"}
            original={previousAttempt.script}
            modified={currentAttempt.script}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderSideBySide: false,
              fontSize: fontSize,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              lineHeight: Math.round(fontSize * 1.5),
              padding: { top: 12, bottom: 12 },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
            }}
          />
        ) : (
          <Editor
            language="python"
            theme={theme === 'light' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches) ? "vs-light" : "vs-dark"}
            value={currentAttempt.script}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: fontSize,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              lineHeight: Math.round(fontSize * 1.5),
              padding: { top: 12, bottom: 12 },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
            }}
          />
        )}
      </div>

      {/* ── Error / Diagnostics Panel ───────────────────────── */}
      {hasError && currentAttempt.harness_result && (
        <div className="border-t border-flinch-error/20 bg-flinch-deep">
          {/* Collapsible header */}
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
            <div className="max-h-48 overflow-y-auto px-4 pb-3 flinch-slide-in space-y-3">
              {/* Traceback */}
              {currentAttempt.harness_result.error && (
                <div className="font-mono text-xs leading-relaxed">
                  <div className="text-flinch-error font-semibold mb-1">
                    {currentAttempt.harness_result.error.type}: {currentAttempt.harness_result.error.message}
                  </div>
                  {currentAttempt.harness_result.error.traceback && (
                    <pre className="text-flinch-error/60 whitespace-pre-wrap text-2xs leading-relaxed">
                      {currentAttempt.harness_result.error.traceback}
                    </pre>
                  )}
                </div>
              )}

              {/* Failing checks */}
              {currentAttempt.harness_result.checks.filter(c => !c.passed).length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-flinch-warning flex items-center gap-1.5">
                    Failing Checks
                  </div>
                  {currentAttempt.harness_result.checks.filter(c => !c.passed).map(c => (
                    <div key={c.id} className="flex items-center gap-2 text-2xs font-mono text-flinch-warning/80">
                      <span className="text-flinch-error">✕</span>
                      <span className="font-semibold">{c.id}</span>
                      <span className="text-flinch-text-muted">{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Scene stats (if available and success) */}
              {isSuccess && currentAttempt.harness_result.scene_stats && (
                <div className="text-2xs text-flinch-text-muted font-mono">
                  Objects: {currentAttempt.harness_result.scene_stats.counts.mesh} mesh,{' '}
                  {currentAttempt.harness_result.scene_stats.counts.light} light,{' '}
                  {currentAttempt.harness_result.scene_stats.counts.camera} camera |{' '}
                  Frames: {currentAttempt.harness_result.scene_stats.frame_range[0]}-
                  {currentAttempt.harness_result.scene_stats.frame_range[1]} @{' '}
                  {currentAttempt.harness_result.scene_stats.fps}fps
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Success info bar ────────────────────────────────── */}
      {isSuccess && currentAttempt.harness_result?.scene_stats && (
        <div className="px-4 py-2 border-t border-flinch-success/20 bg-flinch-success/5 flex items-center gap-3 text-2xs text-flinch-text-muted font-mono">
          <CheckCircle2 size={12} className="text-flinch-success shrink-0" />
          <span>
            {currentAttempt.harness_result.scene_stats.counts.mesh}M{' '}
            {currentAttempt.harness_result.scene_stats.counts.light}L{' '}
            {currentAttempt.harness_result.scene_stats.counts.camera}C
          </span>
          <span className="text-flinch-border">|</span>
          <span>
            {currentAttempt.harness_result.scene_stats.frame_range[0]}–
            {currentAttempt.harness_result.scene_stats.frame_range[1]} @{' '}
            {currentAttempt.harness_result.scene_stats.fps}fps
          </span>
          <span className="text-flinch-border">|</span>
          <span>{currentAttempt.harness_result.duration_ms}ms</span>
        </div>
      )}
    </div>
  );
}
