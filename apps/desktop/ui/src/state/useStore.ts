import { create } from 'zustand';
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

  setPrompt: (prompt: string) => void;
  appendToken: (token: string) => void;
  addMessage: (role: 'user' | 'assistant', content: string) => void;
  startRun: (prompt: string) => Promise<void>;
  cancelRun: () => Promise<void>;
  setActiveAttempt: (index: number) => void;
  appendLog: (log: string) => void;
  loadHistory: () => Promise<void>;
}

export const useStore = create<RunState>((set, get) => ({
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

  setPrompt: (prompt) => set({ prompt }),

  appendToken: (token) => {
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        // Immutable update for the last message
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
    const { addMessage, loadHistory } = get();
    set({
      isRunning: true,
      error: null,
      attempts: [],
      activeAttemptIndex: 0,
      finalResult: null,
      logs: [],
    });
    addMessage('user', prompt);

    try {
      const result = await invoke<AgentResult>('run_prompt', { prompt });
      set({
        finalResult: result,
        attempts: result.attempts,
        isRunning: false,
        activeAttemptIndex: Math.max(0, result.attempts.length - 1),
      });
      addMessage('assistant', result.success ? '✅ Script executed successfully!' : '❌ Script failed after all attempts.');
      // Refresh history sidebar after successful save
      await loadHistory();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg, isRunning: false });
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
}));
