import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from './state/useStore';
import { Layout } from './components/Layout';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { EditorPanel } from './components/EditorPanel';
import { SettingsModal } from './components/SettingsModal';
import './App.css';

function App() {
  const { appendToken } = useStore();

  useEffect(() => {
    let tokenBuffer = '';
    let logBuffer: string[] = [];
    let rafId: number | null = null;

    const flush = () => {
      if (tokenBuffer) {
        appendToken(tokenBuffer);
        tokenBuffer = '';
      }
      if (logBuffer.length > 0) {
        useStore.setState((state) => ({ logs: [...state.logs, ...logBuffer] }));
        logBuffer = [];
      }
      rafId = null;
    };

    const scheduleFlush = () => {
      if (!rafId) {
        rafId = requestAnimationFrame(flush);
      }
    };

    const unlistenToken = listen<{ message: string }>('agent://token', (event) => {
      tokenBuffer += event.payload.message;
      scheduleFlush();
    });

    const unlistenLog = listen<{ message: string }>('blender://log', (event) => {
      logBuffer.push(event.payload.message);
      scheduleFlush();
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      unlistenToken.then(f => f());
      unlistenLog.then(f => f());
    };
  }, [appendToken]);

  const isSettingsOpen = useStore((s) => s.isSettingsOpen);
  const closeSettings = () => useStore.setState({ isSettingsOpen: false });

  useEffect(() => {
    // Run Doctor on startup
    invoke<{ blender_ok: boolean; provider_ok: boolean }>('check_doctor')
      .then((res) => {
        if (!res.blender_ok || !res.provider_ok) {
          useStore.setState({ isSettingsOpen: true });
        }
      })
      .catch(() => {
        useStore.setState({ isSettingsOpen: true });
      });
  }, []);

  return (
    <Layout>
      <Sidebar />
      <ChatPanel />
      <EditorPanel />
      <SettingsModal isOpen={isSettingsOpen} onClose={closeSettings} />
    </Layout>
  );
}

export default App;
