import { useEffect, useCallback, useState } from 'react';
import { useStore } from '../state/useStore';
import {
  Clock, CheckCircle as CheckCircle2, WarningCircle as AlertCircle, Cube as Box, Sparkle as Sparkles, Gear as Settings2,
  CaretDown as ChevronDown, CaretRight as ChevronRight, Lightning as Zap, Sun, Pulse,
  RadioButton as CircleDot, SpinnerGap as Loader2, XCircle, Cpu, HardDrives as HardDrive, Gauge, ArrowSquareOut, Trash
} from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import type { AgentResult } from '../bindings/AgentResult';
import { cn } from '../lib/utils';

export function Sidebar() {
  const history        = useStore((s) => s.history);
  const loadHistory    = useStore((s) => s.loadHistory);
  const doctorStatus   = useStore((s) => s.doctorStatus);
  
  const executionQueue  = useStore((s) => s.executionQueue);
  const systemMetrics   = useStore((s) => s.systemMetrics);
  const fetchMetrics    = useStore((s) => s.fetchMetrics);

  const [envOpen, setEnvOpen]     = useState(true);
  const [queueOpen, setQueueOpen] = useState(true);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Doctor check on mount
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

  // Poll system performance metrics every 2.5s for real workloads
  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(() => {
      fetchMetrics();
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const loadSession = useCallback(async (id: string) => {
    try {
      const result = await invoke<AgentResult>('get_session', { sessionId: id });
      const userPrompt = result.attempts.length > 0 ? result.attempts[0].prompt : id;
      useStore.setState({
        finalResult: result,
        attempts: result.attempts,
        activeAttemptIndex: Math.max(0, result.attempts.length - 1),
        messages: [
          { id: Date.now().toString(), role: 'user', content: userPrompt },
          { id: (Date.now() + 1).toString(), role: 'assistant', content: result.success ? '✨ Script executed successfully!' : '❌ Script failed after all attempts.' }
        ],
      });
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Performance helpers
  const cpuPct = systemMetrics?.cpu_percent ?? 0;
  const ramUsed = systemMetrics?.ram_used_gb ?? 0;
  const ramTotal = systemMetrics?.ram_total_gb ?? 16;
  const ramPct = systemMetrics?.ram_percent ?? 0;

  const gpuName = systemMetrics?.gpu_name ?? 'NVIDIA GPU';
  const gpuUtil = systemMetrics?.gpu_percent ?? 0;
  const vramUsed = systemMetrics?.vram_used_gb ?? 0;
  const vramTotal = systemMetrics?.vram_total_gb ?? 8;
  const vramPct = systemMetrics?.vram_percent ?? 0;

  const diskUsed = systemMetrics?.disk_used_gb ?? 0;
  const diskTotal = systemMetrics?.disk_total_gb ?? 512;
  const diskPct = systemMetrics?.disk_percent ?? 0;
  const diskR = systemMetrics?.disk_read_mbps ?? 0;
  const diskW = systemMetrics?.disk_write_mbps ?? 0;

  return (
    <div className="w-64 bg-flinch-base border-r border-flinch-border-dim flex flex-col h-full overflow-hidden">
      {/* Brand header */}
      <div className="px-4 py-3 border-b border-flinch-border-dim flex items-center gap-3 shrink-0 bg-black/20">
        <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center shadow-[0_0_12px_rgba(139,92,246,0.4)] border border-white/10">
          <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent rounded-lg opacity-50" />
          <Box size={18} weight="duotone" className="text-white drop-shadow-md z-10" />
        </div>
        <div className="flex flex-col justify-center">
          <div className="text-[15px] font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70 leading-tight">FLINCH</div>
          <div className="text-[10px] uppercase font-medium tracking-widest text-flinch-accent/90 leading-tight">Blender AI</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {doctorStatus === 'ok' ? (
            <div className="w-2 h-2 rounded-full bg-flinch-success" title="System OK" />
          ) : doctorStatus === 'checking' ? (
            <div className="w-2 h-2 rounded-full bg-flinch-warning animate-pulse" title="Checking..." />
          ) : (
            <div 
              className="w-2 h-2 rounded-full bg-flinch-error" 
              title="System Error" 
            />
          )}
        </div>
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
        {/* ── Environment (Real OS System Performance) ── */}
        <section className="px-3 pt-2">
          <button
            onClick={() => setEnvOpen(!envOpen)}
            className="w-full flex items-center justify-between py-1 text-[11px] font-semibold uppercase tracking-wider text-flinch-text-muted hover:text-flinch-text-dim flinch-transition"
          >
            <div className="flex items-center gap-1.5">
              {envOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Pulse size={10} className="text-flinch-accent" />
              <span>Environment</span>
            </div>
            <span className="text-[10px] lowercase font-normal opacity-70">os live</span>
          </button>
          {envOpen && (
            <div className="mt-1.5 space-y-2 pl-1 bg-flinch-surface/20 p-2 rounded-lg border border-flinch-border-dim/50">
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-1.5 truncate">
                  <Pulse size={13} className="text-flinch-success shrink-0" weight="bold" />
                  <span className="text-flinch-text font-medium truncate">
                    Performance Metrics
                  </span>
                </div>
              </div>

              {/* CPU Metric */}
              <div>
                <div className="flex items-center justify-between text-2xs mb-1">
                  <span className="text-flinch-text-muted flex items-center gap-1">
                    <Cpu size={10} /> CPU ({systemMetrics?.cpu_cores ?? 8}c)
                  </span>
                  <span className="font-mono text-flinch-text-dim">
                    {cpuPct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-flinch-surface overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full flinch-transition",
                      cpuPct > 85 ? "bg-flinch-error" : cpuPct > 65 ? "bg-flinch-warning" : "bg-blue-400"
                    )}
                    style={{ width: `${Math.min(cpuPct, 100)}%` }}
                  />
                </div>
              </div>

              {/* RAM / Memory Metric */}
              <div>
                <div className="flex items-center justify-between text-2xs mb-1">
                  <span className="text-flinch-text-muted flex items-center gap-1">
                    <Gauge size={10} /> Memory
                  </span>
                  <span className="font-mono text-flinch-text-dim">
                    {ramUsed.toFixed(1)}G / {ramTotal.toFixed(0)}G ({ramPct.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-flinch-surface overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full flinch-transition",
                      ramPct > 85 ? "bg-flinch-error" : ramPct > 70 ? "bg-flinch-warning" : "bg-emerald-400"
                    )}
                    style={{ width: `${Math.min(ramPct, 100)}%` }}
                  />
                </div>
              </div>

              {/* GPU & VRAM Metric */}
              <div>
                <div className="flex items-center justify-between text-2xs mb-1">
                  <span className="text-flinch-text-muted flex items-center gap-1 truncate max-w-[130px]" title={gpuName}>
                    <Zap size={10} /> {gpuName.replace('NVIDIA GeForce ', '')}
                  </span>
                  <span className={cn(
                    "font-mono text-2xs",
                    vramPct > 80 ? "text-flinch-warning font-semibold" : "text-flinch-text-dim"
                  )}>
                    {vramUsed.toFixed(1)}G / {vramTotal.toFixed(0)}G
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-flinch-surface overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full flinch-transition",
                      vramPct > 80 ? "bg-flinch-warning" : "bg-flinch-accent"
                    )}
                    style={{ width: `${Math.min(vramPct, 100)}%` }}
                  />
                </div>
                {gpuUtil > 0 && (
                  <div className="text-[10px] text-flinch-text-muted mt-0.5 font-mono">
                    Compute load: {gpuUtil.toFixed(0)}%
                  </div>
                )}
                {vramPct > 80 && (
                  <p className="text-[10px] text-flinch-warning mt-0.5">⚠ High VRAM ({vramPct.toFixed(0)}%) — near OOM limit</p>
                )}
              </div>

              {/* Disk Storage & I/O Metric */}
              <div>
                <div className="flex items-center justify-between text-2xs mb-1">
                  <span className="text-flinch-text-muted flex items-center gap-1">
                    <HardDrive size={10} /> Disk Storage
                  </span>
                  <span className="font-mono text-flinch-text-dim">
                    {diskUsed.toFixed(0)}G / {diskTotal.toFixed(0)}G
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-flinch-surface overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-400 flinch-transition"
                    style={{ width: `${Math.min(diskPct, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-flinch-text-muted mt-1">
                  <span>I/O Read: {diskR.toFixed(1)} MB/s</span>
                  <span>Write: {diskW.toFixed(1)} MB/s</span>
                </div>
              </div>
            </div>
          )}
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
              <div
                key={session.id}
                className={cn(
                  "relative w-full text-left px-2.5 py-2 rounded-md flinch-transition group",
                  "hover:bg-flinch-surface/60",
                  i === 0 && "flinch-slide-in"
                )}
                style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
              >
                <button
                  onClick={() => loadSession(session.id)}
                  className="w-full text-left flinch-focus-ring pr-6"
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
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await invoke('delete_session', { sessionId: session.id });
                      loadHistory();
                      useStore.setState({
                        messages: [], attempts: [], activeAttemptIndex: 0,
                        finalResult: null, error: null, logs: [], prompt: '',
                      });
                    } catch (err) {
                      console.error("Failed to delete session", err);
                    }
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 opacity-0 group-hover:opacity-100 hover:bg-flinch-error/20 hover:text-flinch-error text-flinch-text-muted rounded-md flinch-transition"
                  title="Delete Session"
                >
                  <Trash size={20} />
                </button>
              </div>
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
          onClick={async () => {
            const state = useStore.getState();
            const result = state.finalResult;
            if (result && result.attempts.length > 0) {
              const latestAttempt = result.attempts[state.activeAttemptIndex ?? result.attempts.length - 1];
              if (latestAttempt && latestAttempt.script) {
                try {
                  await invoke('open_in_blender', { script: latestAttempt.script });
                } catch (e) {
                  console.error("Failed to open in Blender:", e);
                }
              }
            }
          }}
        >
          <div className="flex items-center gap-2">
            <ArrowSquareOut size={14} className="group-hover:text-flinch-accent flinch-transition" />
            <span>Open in Blender</span>
          </div>
        </button>

        <button
          onClick={() => useStore.setState({ isSettingsOpen: true })}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-flinch-text-dim hover:text-flinch-text hover:bg-flinch-surface/60 flinch-transition group"
        >
          <Settings2 size={14} className="group-hover:text-flinch-text flinch-transition" />
          <span>Settings</span>
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
