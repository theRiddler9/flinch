import { useEffect } from 'react';
import { useStore } from '../state/useStore';
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { AgentResult } from '../bindings/AgentResult';

export function Sidebar() {
  const { history, loadHistory } = useStore();

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loadSession = async (id: string) => {
    try {
      const result = await invoke<AgentResult>('get_session', { sessionId: id });
      useStore.setState({ 
        finalResult: result, 
        attempts: result.attempts, 
        activeAttemptIndex: Math.max(0, result.attempts.length - 1),
        messages: [{ id: Date.now().toString(), role: 'assistant', content: 'Loaded historical session.' }]
      });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-slate-800 font-bold text-slate-200 flex items-center gap-2">
        <Clock size={16} /> History
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {history.map((session) => (
          <button
            key={session.id}
            onClick={() => loadSession(session.id)}
            className="w-full text-left p-2 rounded hover:bg-slate-800 transition-colors text-sm group"
          >
            <div className="flex items-center gap-2 mb-1">
              {session.success ? (
                <CheckCircle2 size={12} className="text-green-400" />
              ) : (
                <AlertCircle size={12} className="text-red-400" />
              )}
              <span className="text-slate-400 text-xs truncate flex-1">
                {new Date(session.created_at).toLocaleString()}
              </span>
            </div>
            <div className="text-slate-200 line-clamp-2 leading-tight">
              {session.prompt}
            </div>
          </button>
        ))}
        {history.length === 0 && (
          <div className="text-center p-4 text-slate-500 text-sm">
            No previous sessions
          </div>
        )}
      </div>
    </div>
  );
}
