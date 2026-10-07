import { useEffect, useCallback, useState } from 'react';
import { useStore } from '../state/useStore';
import type { EnginePreset } from '../state/useStore';
import {
  Clock, CheckCircle2, AlertCircle, Box, Sparkles, Settings2,
  ChevronDown, ChevronRight, Zap, Layers, Sun, Activity,
  CircleDot, Loader2, XCircle,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { AgentResult } from '../bindings/AgentResult';
import { cn } from '../lib/utils';

const ENGINE_OPTIONS: { id: EnginePreset; label: string; desc: string }[] = [
  { id: 'eevee',       label: 'EEVEE Next',     desc: 'Real-time raster' },
  { id: 'cycles_fast', label: 'Cycles Fast',     desc: 'Low sample preview' },
  { id: 'cycles_prod', label: 'Cycles Prod',     desc: 'Full quality' },
];

function StatusDot({ status }: { status: 'checking' | 'ok' | 'error' }) {
  if (status === 'checking') return <span className="w-2 h-2 rounded-full bg-flinch-warning animate-pulse inline-block" />;
  if (status === 'ok')       return <span className="w-2 h-2 rounded-full bg-flinch-success inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-flinch-error inline-block" />;
}

export function Sidebar() {
  const history      = useStore((s) => s.history);
  const loadHistory  = useStore((s) => s.loadHistory);
  const doctorStatus = useStore((s) => s.doctorStatus);
  const blenderVersion = useStore((s) => s.blenderVersion);
  const enginePreset = useStore((s) => s.enginePreset);
  const setEnginePreset = useStore((s) => s.setEnginePreset);
  const executionQueue  = useStore((s) => s.executionQueue);

  const [envOpen, setEnvOpen] = useState(true);
  const [queueOpen, setQueueOpen] = useState(true);
  // Simulated VRAM — in real app wire from a Tauri sysinfo command
  const vramUsed = 4.2;
  const vramTotal = 16;
  const vramPct = vramUsed / vramTotal;

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Doctor check on mount to get blender version
  useEffect(() => {
    invoke<{ blender_ok: boolean; blender_version: string | null; provider_ok: boolean }>('check_doctor')
      .then((res) => {
        useStore.setState({
          doctorStatus: (res.blender_ok && res.provider_ok) ? 'ok' : 'error',
          blenderVersion: res.blender_version ?? null,
          providerOnline: res.provider_ok,
        });
      })
      .catch(() => useStore.setState({ doctorStatus: 'error' }));
  }, []);

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
    <div className="w-64 bg-flinch-base border-r border-flinch-border-dim flex flex-col h-full overflow-hidden">
      {/* Brand header */}
      <div className="px-4 py-3 border-b border-flinch-border-dim flex items-center gap-2.5 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-flinch-accent to-blue-600 flex items-center justify-center shadow-flinch-glow">
          <Box size={14} className="text-white" />
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-flinch-text">Flinch</div>
          <div className="text-2xs text-flinch-text-muted">Cursor for Blender</div>
        </div>
        <StatusDot status={doctorStatus} />
      </div>

      {/* New session button */}
      <div className="px-3 pt-3 pb-1 shrink-0">
        <button
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium",
            "bg-flinch-accent/10 text-flinch-accent border border-flinch-accent/20",
            "hover:bg-flinch-accent/20 flinch-transition flinch-focus-ring"
          )}
          onClick={() => {
            useStore.setState({
              messages: [], attempts: [], activeAttemptIndex: 0,
              finalResult: null, error: null, logs: [], prompt: '',
            });
          }}
        >
          <Sparkles size={14} />
          New Session
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-0 pb-2">
        {/* ── Environment ── */}
        <section className="px-3 pt-2">
          <button
            onClick={() => setEnvOpen(!envOpen)}
            className="w-full flex items-center gap-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-flinch-text-muted hover:text-flinch-text-dim flinch-transition"
          >
            {envOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Activity size={10} /> Environment
          </button>
          {envOpen && (
            <div className="mt-1.5 space-y-2 pl-1">
              {/* Blender Path */}
              <div className="flex items-center gap-2 text-xs">
                <Box size={11} className={cn("shrink-0", doctorStatus === 'ok' ? "text-flinch-success" : "text-flinch-error")} />
                <span className="text-flinch-text-dim truncate">
                  {blenderVersion ?? (doctorStatus === 'error' ? 'Not found' : 'Checking...')}
                </span>
              </div>

              {/* VRAM Bar */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-2xs text-flinch-text-muted flex items-center gap-1">
                    <Zap size={9} /> VRAM
                  </span>
                  <span className={cn(
                    "text-2xs font-mono",
                    vramPct > 0.8 ? "text-flinch-warning" : "text-flinch-text-muted"
                  )}>
                    {vramUsed}GB / {vramTotal}GB
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-flinch-surface overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full flinch-transition",
                      vramPct > 0.8 ? "bg-flinch-warning" : "bg-flinch-accent"
                    )}
                    style={{ width: `${Math.min(vramPct * 100, 100)}%` }}
                  />
                </div>
                {vramPct > 0.8 && (
                  <p className="text-2xs text-flinch-warning mt-0.5">⚠ High VRAM — render may crash</p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Engine Presets ── */}
        <section className="px-3 pt-3">
          <div className="flex items-center gap-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-flinch-text-muted">
            <Layers size={10} /> Engine
          </div>
          <div className="mt-1.5 space-y-1">
            {ENGINE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setEnginePreset(opt.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs flinch-transition",
                  enginePreset === opt.id
                    ? "bg-flinch-accent/15 text-flinch-accent border border-flinch-accent/25 font-medium"
                    : "text-flinch-text-dim hover:bg-flinch-surface/40 hover:text-flinch-text border border-transparent"
                )}
              >
                <CircleDot size={10} className={enginePreset === opt.id ? "text-flinch-accent" : "opacity-40"} />
                <span>{opt.label}</span>
                <span className="ml-auto text-2xs opacity-50">{opt.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Execution Queue ── */}
        <section className="px-3 pt-3">
          <button
            onClick={() => setQueueOpen(!queueOpen)}
            className="w-full flex items-center gap-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-flinch-text-muted hover:text-flinch-text-dim flinch-transition"
          >
            {queueOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Sun size={10} /> Queue ({executionQueue.length})
          </button>
          {queueOpen && (
            <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
              {executionQueue.length === 0 && (
                <div className="text-2xs text-flinch-text-muted px-1 py-2 text-center">No jobs queued</div>
              )}
              {executionQueue.slice().reverse().map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-flinch-surface/30 text-xs"
                >
                  {entry.status === 'running' && <Loader2 size={10} className="text-flinch-accent animate-spin shrink-0" />}
                  {entry.status === 'done'    && <CheckCircle2 size={10} className="text-flinch-success shrink-0" />}
                  {entry.status === 'error'   && <XCircle size={10} className="text-flinch-error shrink-0" />}
                  {entry.status === 'queued'  && <CircleDot size={10} className="text-flinch-text-muted shrink-0" />}
                  <span className="truncate text-flinch-text-dim">{entry.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── History ── */}
        <section className="px-3 pt-3">
          <div className="flex items-center gap-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-flinch-text-muted">
            <Clock size={10} /> History
            <span className="ml-auto text-2xs bg-flinch-surface rounded-full px-1.5 py-0.5">{history.length}</span>
          </div>
          <div className="mt-1 space-y-0.5">
            {history.map((session, i) => (
              <button
                key={session.id}
                onClick={() => loadSession(session.id)}
                className={cn(
                  "w-full text-left px-2.5 py-2 rounded-md flinch-transition flinch-focus-ring group",
                  "hover:bg-flinch-surface/60",
                  i === 0 && "flinch-slide-in"
                )}
                style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {session.success
                    ? <CheckCircle2 size={10} className="text-flinch-success shrink-0" />
                    : <AlertCircle size={10} className="text-flinch-error shrink-0" />}
                  <span className="text-2xs text-flinch-text-muted truncate flex-1">
                    {formatRelativeTime(session.created_at)}
                  </span>
                </div>
                <div className="text-[12px] text-flinch-text-dim group-hover:text-flinch-text flinch-transition line-clamp-2 leading-snug">
                  {session.prompt}
                </div>
              </button>
            ))}
            {history.length === 0 && (
              <div className="text-center py-6 text-flinch-text-muted text-xs">
                <div className="text-xl mb-1 opacity-30">🧊</div>
                No sessions yet
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-flinch-border-dim space-y-0.5 shrink-0">
        <button
          className="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-flinch-text-dim hover:text-flinch-text hover:bg-flinch-surface/60 flinch-transition group"
          onClick={() => {
            useStore.setState({ doctorStatus: 'checking' });
            invoke<{ blender_ok: boolean; blender_version: string | null; provider_ok: boolean }>('check_doctor')
              .then((res) => {
                useStore.setState({
                  doctorStatus: (res.blender_ok && res.provider_ok) ? 'ok' : 'error',
                  blenderVersion: res.blender_version ?? null,
                  providerOnline: res.provider_ok,
                });
              })
              .catch(() => useStore.setState({ doctorStatus: 'error' }));
          }}
        >
          <div className="flex items-center gap-2">
            <Box size={14} className="group-hover:text-flinch-accent flinch-transition" />
            <span>Connect to Blender</span>
          </div>
          <StatusDot status={doctorStatus} />
        </button>

        <button
          onClick={() => useStore.setState({ isSettingsOpen: true })}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-flinch-text-dim hover:text-flinch-text hover:bg-flinch-surface/60 flinch-transition group"
        >
          <Settings2 size={14} className="group-hover:text-flinch-text flinch-transition" />
          <span>Settings & Theme</span>
        </button>
      </div>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now  = new Date();
    const diffMs  = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)  return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24)  return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}
