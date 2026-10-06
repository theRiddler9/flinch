import { useState, type FormEvent } from 'react';
import { useStore } from '../state/useStore';
import { Send, Square } from 'lucide-react';
import { cn } from '../lib/utils';

export function ChatPanel() {
  const [input, setInput] = useState('');
  const { messages, isRunning, isCanceling, startRun, cancelRun, logs } = useStore();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isRunning) return;
    startRun(input);
    setInput('');
  };

  return (
    <div className="flex flex-col w-1/3 min-w-[350px] border-r border-slate-800 bg-slate-900/50">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "p-3 rounded-lg max-w-[85%] text-sm",
              msg.role === 'user'
                ? "bg-blue-600/20 text-blue-100 ml-auto border border-blue-500/20"
                : "bg-slate-800 text-slate-200 border border-slate-700"
            )}
          >
            <div className="font-semibold text-xs opacity-50 mb-1 uppercase tracking-wider">
              {msg.role}
            </div>
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
        ))}
        {logs.length > 0 && (
          <div className="p-2 bg-black/40 rounded border border-slate-800 font-mono text-[10px] text-slate-400 max-h-48 overflow-y-auto">
            {logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>

      <div className="p-4 bg-slate-900 border-t border-slate-800">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isRunning}
            placeholder={isRunning ? "Agent is running..." : "Describe a Blender animation..."}
            className="flex-1 bg-slate-800 text-white rounded-md px-3 py-2 text-sm border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
          />
          {isRunning ? (
            <button
              type="button"
              onClick={cancelRun}
              disabled={isCanceling}
              className="px-3 py-2 bg-red-600/20 text-red-400 rounded-md hover:bg-red-600/30 border border-red-500/20 transition-colors flex items-center justify-center disabled:opacity-50"
            >
              <Square size={16} className="fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center disabled:opacity-50 disabled:bg-slate-800 disabled:text-slate-500"
            >
              <Send size={16} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
