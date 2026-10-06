// No React import needed
import { useStore } from '../state/useStore';
import { Editor, DiffEditor } from '@monaco-editor/react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';

export function EditorPanel() {
  const { attempts, activeAttemptIndex, setActiveAttempt, finalResult } = useStore();

  const currentAttempt = attempts[activeAttemptIndex];
  const previousAttempt = activeAttemptIndex > 0 ? attempts[activeAttemptIndex - 1] : null;

  if (attempts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-[#1e1e1e]">
        <div className="text-4xl mb-4">🧊</div>
        <p>Waiting for instructions...</p>
      </div>
    );
  }

  const isDiffMode = previousAttempt && currentAttempt.script !== previousAttempt.script;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
      {/* Header Tabs */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900">
        <div className="flex gap-2">
          {attempts.map((att, idx) => {
            const hasError = att.harness_result && !att.harness_result.ok;
            return (
              <button
                key={idx}
                onClick={() => setActiveAttempt(idx)}
                className={cn(
                  "px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5",
                  activeAttemptIndex === idx
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:bg-slate-800"
                )}
              >
                Attempt {idx + 1}
                {hasError ? (
                  <AlertCircle size={14} className="text-red-400" />
                ) : att.harness_result?.ok ? (
                  <CheckCircle2 size={14} className="text-green-400" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 items-center">
          {finalResult && (
            <div className={cn(
              "text-sm font-medium px-2 py-1 rounded mr-2",
              finalResult.success ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10"
            )}>
              {finalResult.success ? 'Success' : 'Failed'}
            </div>
          )}
          <button 
            className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white"
            onClick={async () => {
              const { invoke } = await import('@tauri-apps/api/core');
              const { save } = await import('@tauri-apps/plugin-dialog');
              const path = await save({ filters: [{ name: 'Blender', extensions: ['blend'] }] });
              if (path) {
                await invoke('export_blend', { script: currentAttempt.script, outPath: path });
              }
            }}
          >
            Export .blend
          </button>
          <button 
            className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white"
            onClick={async () => {
              const { invoke } = await import('@tauri-apps/api/core');
              const { save } = await import('@tauri-apps/plugin-dialog');
              const path = await save({ filters: [{ name: 'Python', extensions: ['py'] }] });
              if (path) {
                await invoke('export_script', { script: currentAttempt.script, outPath: path });
              }
            }}
          >
            Save .py
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 relative">
        {isDiffMode ? (
          <DiffEditor
            language="python"
            theme="vs-dark"
            original={previousAttempt.script}
            modified={currentAttempt.script}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderSideBySide: false
            }}
          />
        ) : (
          <Editor
            language="python"
            theme="vs-dark"
            value={currentAttempt.script}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false
            }}
          />
        )}
      </div>

      {/* Error Panel */}
      {currentAttempt.harness_result && !currentAttempt.harness_result.ok && (
        <div className="h-48 border-t border-red-900/30 bg-red-950/20 overflow-y-auto p-4">
          <div className="flex items-center gap-2 text-red-400 mb-2 font-semibold text-sm">
            <AlertCircle size={16} />
            <span>
              Failed at Stage: {currentAttempt.harness_result.stage}
            </span>
          </div>
          {currentAttempt.harness_result.error && (
            <div className="font-mono text-xs text-red-300/80 whitespace-pre-wrap">
              <span className="font-bold text-red-300">
                {currentAttempt.harness_result.error.type}: {currentAttempt.harness_result.error.message}
              </span>
              <br />
              {currentAttempt.harness_result.error.traceback}
            </div>
          )}
          {currentAttempt.harness_result.checks.filter(c => !c.passed).length > 0 && (
            <div className="mt-4 space-y-1">
              <div className="text-sm font-semibold text-orange-400">Failing Checks:</div>
              {currentAttempt.harness_result.checks.filter(c => !c.passed).map(c => (
                <div key={c.id} className="text-xs text-orange-300 font-mono flex gap-2">
                  <span>❌ {c.id}</span>
                  <span className="opacity-70">{c.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
