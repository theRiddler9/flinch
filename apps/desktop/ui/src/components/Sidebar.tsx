import { useEffect, useCallback } from 'react';
import { useStore } from '../state/useStore';
import { Clock, CheckCircle2, AlertCircle, Box, Sparkles, Settings2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { AgentResult } from '../bindings/AgentResult';
import { cn } from '../lib/utils';

export function Sidebar() {
  const history = useStore((s) => s.history);
  const loadHistory = useStore((s) => s.loadHistory);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loadSession = useCallback(async (id: string) => {
    try {
      const result = await invoke<AgentResult>('get_session', { sessionId: id });
      useStore.setState({
        finalResult: result,
        attempts: result.attempts,
        activeAttemptIndex: Math.max(0, result.attempts.length - 1),
        messages: [{ id: Date.now().toString(), role: 'assistant', content: 'Loaded historical session.' }],
      });
    } catch (e) {
      console.error(e);
    }
  }, []);

  return (
    <div className="w-60 bg-flinch-base border-r border-flinch-border-dim flex flex-col h-full overflow-hidden">
      {/* Brand header */}
      <div className="px-4 py-3 border-b border-flinch-border-dim flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-flinch-accent to-blue-600 flex items-center justify-center shadow-flinch-glow">
          <Box size={14} className="text-white" />
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-flinch-text">Flinch</div>
          <div className="text-2xs text-flinch-text-muted">Cursor for Blender</div>
        </div>
      </div>

      {/* New session button */}
      <div className="px-3 py-2">
        <button
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium",
            "bg-flinch-accent/10 text-flinch-accent border border-flinch-accent/20",
            "hover:bg-flinch-accent/20 flinch-transition flinch-focus-ring"
          )}
          onClick={() => {
            useStore.setState({
              messages: [],
              attempts: [],
              activeAttemptIndex: 0,
              finalResult: null,
              error: null,
              logs: [],
              prompt: '',
            });
          }}
        >
          <Sparkles size={14} />
          New Session
        </button>
      </div>

      {/* History header */}
      <div className="px-4 py-2 flex items-center gap-2">
        <Clock size={12} className="text-flinch-text-muted" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-flinch-text-muted">
          History
        </span>
        <span className="ml-auto text-2xs text-flinch-text-muted bg-flinch-surface rounded-full px-1.5 py-0.5">
          {history.length}
        </span>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {history.map((session, i) => (
          <button
            key={session.id}
            onClick={() => loadSession(session.id)}
            className={cn(
              "w-full text-left px-3 py-2.5 rounded-md flinch-transition flinch-focus-ring group",
              "hover:bg-flinch-surface/60",
              i === 0 && "flinch-slide-in"
            )}
            style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
          >
            <div className="flex items-center gap-2 mb-1">
              {session.success ? (
                <CheckCircle2 size={11} className="text-flinch-success shrink-0" />
              ) : (
                <AlertCircle size={11} className="text-flinch-error shrink-0" />
              )}
              <span className="text-2xs text-flinch-text-muted truncate flex-1">
                {formatRelativeTime(session.created_at)}
              </span>
            </div>
            <div className="text-[13px] text-flinch-text-dim group-hover:text-flinch-text flinch-transition line-clamp-2 leading-snug">
              {session.prompt}
            </div>
          </button>
        ))}
        {history.length === 0 && (
          <div className="text-center py-8 text-flinch-text-muted text-sm">
            <div className="text-2xl mb-2 opacity-40">🧊</div>
            No sessions yet
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-flinch-border-dim flex items-center justify-between">
        <div className="text-2xs text-flinch-text-muted">
          Blender 4.5 LTS
        </div>
        <button
          onClick={() => useStore.setState({ isSettingsOpen: true })}
          className="text-flinch-text-muted hover:text-flinch-text flinch-transition rounded p-1 hover:bg-flinch-surface"
          title="Preferences"
        >
          <Settings2 size={14} />
        </button>
      </div>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}
