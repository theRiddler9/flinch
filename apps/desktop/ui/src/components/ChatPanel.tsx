import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useStore } from '../state/useStore';
import { Send, Square, Terminal, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export function ChatPanel() {
  const [input, setInput] = useState('');
  const messages = useStore((s) => s.messages);
  const isRunning = useStore((s) => s.isRunning);
  const isCanceling = useStore((s) => s.isCanceling);
  const error = useStore((s) => s.error);
  const logs = useStore((s) => s.logs);
  const startRun = useStore((s) => s.startRun);
  const cancelRun = useStore((s) => s.cancelRun);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, logs]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [isRunning]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isRunning) return;
    startRun(input);
    setInput('');
  };

  return (
    <div className="flex flex-col w-[380px] min-w-[320px] border-r border-flinch-border bg-flinch-base/80 flinch-glass">
      {/* Chat header */}
      <div className="px-4 py-3 border-b border-flinch-border-dim flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2 h-2 rounded-full flinch-transition",
            isRunning ? "bg-flinch-accent flinch-pulse" : "bg-flinch-success"
          )} />
          <span className="text-sm font-semibold text-flinch-text">
            {isRunning ? 'Agent Running' : 'Ready'}
          </span>
        </div>
        {isRunning && (
          <Loader2 size={14} className="text-flinch-accent animate-spin" />
        )}
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !isRunning && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-5xl mb-4 opacity-30">🎬</div>
            <div className="text-flinch-text-dim text-sm font-medium mb-1">
              Describe your animation
            </div>
            <div className="text-flinch-text-muted text-xs max-w-[240px]">
              e.g. &ldquo;A red cube bouncing 3 times over 2 seconds at 24fps&rdquo;
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={msg.id}
            className={cn(
              "flinch-slide-in rounded-lg text-[13px] leading-relaxed",
              msg.role === 'user'
                ? "ml-8 p-3 bg-flinch-accent/10 text-flinch-text border border-flinch-accent/15"
                : "mr-4 p-3 bg-flinch-surface/60 text-flinch-text-dim border border-flinch-border-dim"
            )}
            style={{ animationDelay: `${i * 20}ms` }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={cn(
                "text-2xs font-bold uppercase tracking-widest",
                msg.role === 'user' ? "text-flinch-accent" : "text-flinch-text-muted"
              )}>
                {msg.role === 'user' ? 'You' : 'Flinch'}
              </span>
            </div>
            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
          </div>
        ))}

        {/* Error display */}
        {error && (
          <div className="flinch-slide-in p-3 rounded-lg bg-flinch-error/10 border border-flinch-error/20 text-flinch-error text-xs font-mono">
            {error}
          </div>
        )}

        {/* Blender logs (collapsible terminal) */}
        {logs.length > 0 && (
          <details className="flinch-slide-in group">
            <summary className="flex items-center gap-2 text-flinch-text-muted text-xs cursor-pointer hover:text-flinch-text-dim flinch-transition select-none">
              <Terminal size={12} />
              Blender Output ({logs.length} lines)
            </summary>
            <div className="mt-2 p-3 bg-flinch-deep rounded-md border border-flinch-border-dim font-mono text-2xs text-flinch-text-muted max-h-40 overflow-y-auto">
              {logs.map((l, i) => (
                <div key={i} className="py-0.5 hover:text-flinch-text-dim flinch-transition">{l}</div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Input area */}
      <div className="p-3 bg-flinch-panel/50 border-t border-flinch-border-dim">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isRunning}
            placeholder={isRunning ? "Agent is working..." : "Describe a Blender animation..."}
            className={cn(
              "flex-1 bg-flinch-surface text-flinch-text rounded-lg px-3.5 py-2.5 text-sm",
              "border border-flinch-border placeholder:text-flinch-text-muted",
              "flinch-focus-ring flinch-transition",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          />
          {isRunning ? (
            <button
              type="button"
              onClick={cancelRun}
              disabled={isCanceling}
              className={cn(
                "px-3 py-2.5 rounded-lg flinch-transition flinch-focus-ring",
                "bg-flinch-error/10 text-flinch-error border border-flinch-error/20",
                "hover:bg-flinch-error/20 disabled:opacity-40",
                "flex items-center justify-center"
              )}
            >
              <Square size={14} className="fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={cn(
                "px-3 py-2.5 rounded-lg flinch-transition flinch-focus-ring",
                "bg-flinch-accent text-white",
                "hover:bg-flinch-accent-dim",
                "disabled:opacity-30 disabled:bg-flinch-surface disabled:text-flinch-text-muted disabled:border-flinch-border",
                "flex items-center justify-center"
              )}
            >
              <Send size={14} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
