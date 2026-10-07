import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AttemptRecord } from '../bindings/AttemptRecord';
import type { AgentResult } from '../bindings/AgentResult';
import { invoke } from '@tauri-apps/api/core';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionHistory {
  id: string;
  prompt: string;
  success: boolean;
  created_at: string;
}

export type EnginePreset = 'cycles_fast' | 'cycles_prod' | 'eevee';

export interface QueueEntry {
  id: string;
  label: string;
  status: 'queued' | 'running' | 'done' | 'error';
  thumb?: string;
}

export interface SystemMetrics {
  cpu_percent: number;
  cpu_cores: number;
  cpu_brand: string;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  gpu_name: string | null;
  gpu_percent: number | null;
  vram_used_gb: number | null;
  vram_total_gb: number | null;
  vram_percent: number | null;
  disk_read_mbps: number;
  disk_write_mbps: number;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_percent: number;
}

interface RunState {
  prompt: string;
  isRunning: boolean;
  isCanceling: boolean;
  messages: Message[];
  attempts: AttemptRecord[];
  activeAttemptIndex: number;
  finalResult: AgentResult | null;
  error: string | null;
  history: SessionHistory[];
  logs: string[];
  isSettingsOpen: boolean;
  doctorStatus: 'checking' | 'ok' | 'error';
  blenderVersion: string | null;
  providerOnline: boolean;
  systemMetrics: SystemMetrics | null;

  theme: 'system' | 'dark' | 'light';
  fontSize: number;
  enginePreset: EnginePreset;
  executionQueue: QueueEntry[];

  setTheme: (theme: 'system' | 'dark' | 'light') => void;
  setFontSize: (size: number) => void;
  setEnginePreset: (preset: EnginePreset) => void;
  addToQueue: (label: string) => string; // returns id
  updateQueue: (id: string, patch: Partial<QueueEntry>) => void;
  setPrompt: (prompt: string) => void;
  appendToken: (token: string) => void;
  addMessage: (role: 'user' | 'assistant', content: string) => void;
  startRun: (prompt: string) => Promise<void>;
  cancelRun: () => Promise<void>;
  setActiveAttempt: (index: number) => void;
  appendLog: (log: string) => void;
  loadHistory: () => Promise<void>;
  fetchMetrics: () => Promise<void>;
}

export const useStore = create<RunState>()(
  persist(
    (set, get) => ({
      prompt: '',
      isRunning: false,
      isCanceling: false,
      messages: [],
      attempts: [],
      activeAttemptIndex: 0,
      finalResult: null,
      error: null,
      logs: [],
      history: [],
      isSettingsOpen: false,
      doctorStatus: 'checking',
      blenderVersion: null,
      providerOnline: false,
      theme: 'system',
      fontSize: 13,
      enginePreset: 'eevee',
      executionQueue: [],
      systemMetrics: null,

      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setEnginePreset: (enginePreset) => set({ enginePreset }),

      addToQueue: (label) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        set((state) => ({
          executionQueue: [...state.executionQueue, { id, label, status: 'queued' }],
        }));
        return id;
      },

      updateQueue: (id, patch) => {
        set((state) => ({
          executionQueue: state.executionQueue.map((entry) =>
            entry.id === id ? { ...entry, ...patch } : entry
          ),
        }));
      },

      setPrompt: (prompt) => set({ prompt }),

      appendToken: (token) => {
        set((state) => {
          const messages = [...state.messages];
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant') {
            messages[messages.length - 1] = { ...last, content: last.content + token };
          } else {
            messages.push({ id: Date.now().toString(), role: 'assistant', content: token });
          }
          return { messages };
        });
      },

      addMessage: (role, content) => {
        set((state) => ({
          messages: [...state.messages, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, role, content }],
        }));
      },

      appendLog: (log) => {
        set((state) => ({
          logs: [...state.logs, log],
        }));
      },

      startRun: async (prompt) => {
        const { addMessage, loadHistory, addToQueue, updateQueue } = get();
        const queueId = addToQueue(prompt.slice(0, 40) + (prompt.length > 40 ? '.' : ''));
        set({
          isRunning: true,
          error: null,
          attempts: [],
          activeAttemptIndex: 0,
          finalResult: null,
          logs: [],
        });
        addMessage('user', prompt);
        updateQueue(queueId, { status: 'running' });

        try {
          const result = await invoke<AgentResult>('run_prompt', { prompt });
          set({
            finalResult: result,
            attempts: result.attempts,
            isRunning: false,
            activeAttemptIndex: Math.max(0, result.attempts.length - 1),
          });
          addMessage('assistant', result.success ? '✨ Script executed successfully!' : '❌ Script failed after all attempts.');
          updateQueue(queueId, { status: result.success ? 'done' : 'error' });
          await loadHistory();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          set({ error: msg, isRunning: false });
          updateQueue(queueId, { status: 'error' });
        }
      },

      cancelRun: async () => {
        set({ isCanceling: true });
        try {
          await invoke('cancel_run');
        } catch (e) {
          console.error(e);
        } finally {
          set({ isCanceling: false, isRunning: false });
        }
      },

      setActiveAttempt: (index) => set({ activeAttemptIndex: index }),

      loadHistory: async () => {
        try {
          const sessions = await invoke<[string, string, boolean, string][]>('list_sessions');
          const history = sessions.map((s) => ({
            id: s[0],
            prompt: s[1],
            success: s[2],
            created_at: s[3],
          }));
          set({ history });
        } catch (e) {
          console.error(e);
        }
      },

      fetchMetrics: async () => {
        try {
          const metrics = await invoke<SystemMetrics>('get_system_metrics');
          set({ systemMetrics: metrics });
        } catch (e) {
          console.error('Failed to fetch system metrics:', e);
        }
      },
    }),
    {
      name: 'flinch-storage',
      partialize: (state) => ({
        theme: state.theme,
        fontSize: state.fontSize,
        enginePreset: state.enginePreset,
      }),
    }
  )
);
