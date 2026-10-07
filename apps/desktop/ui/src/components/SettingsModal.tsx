import { useEffect, useState } from 'react';
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { Gear as Settings2, FloppyDisk as Save, X, WarningCircle as AlertCircle, Monitor, Cube as Box, PaintBrush as Paintbrush, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
import { cn } from '../lib/utils';
import { useStore } from '../state/useStore';

export const SettingsSchema = z.object({
  blender_bin: z.string().min(1, 'Blender path is required'),
  base_url: z.string().url('Must be a valid URL (e.g., http://localhost:11434/v1)'),
  model: z.string().min(1, 'Model name is required'),
  api_key: z.string().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

type Tab = 'general' | 'model' | 'appearance';

export function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<Settings>({
    blender_bin: 'blender',
    base_url: 'http://localhost:11434/v1',
    model: 'qwen3.5:9b',
    api_key: '',
  });

  const { theme, setTheme, fontSize, setFontSize } = useStore();
  
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [errors, setErrors] = useState<Partial<Record<keyof Settings, string>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      setSaveSuccess(false);
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const current = await invoke<Settings>('get_settings');
      setSettings(current);
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setSaveError(null);
      setSaveSuccess(false);
      setErrors({});

      // Strictly validate with Zod
      const valid = SettingsSchema.parse(settings);

      // Save to backend
      await invoke('save_settings', { settings: valid });
      
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);

      // Re-run doctor to update status in Sidebar
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
      
    } catch (e) {
      if (e instanceof z.ZodError) {
        const fieldErrors: any = {};
        (e as any).errors.forEach((err: any) => {
          if (err.path[0]) {
            fieldErrors[err.path[0]] = err.message;
          }
        });
        setErrors(fieldErrors);
        setSaveError("Validation failed. Please check the fields.");
      } else {
        setSaveError(String(e));
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm flinch-fade-in">
      <div className="bg-flinch-surface border border-flinch-border shadow-2xl rounded-xl w-full max-w-2xl h-[500px] overflow-hidden flex flex-col flinch-slide-in relative">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-flinch-border bg-flinch-deep shrink-0">
          <div className="flex items-center gap-2 text-flinch-text font-semibold">
            <Settings2 size={18} className="text-flinch-text-muted" />
            Preferences
          </div>
          <button onClick={onClose} className="text-flinch-text-muted hover:text-flinch-text flinch-transition rounded-md p-1 hover:bg-flinch-surface">
            <X size={16} />
          </button>
        </div>

        {/* Success Toast */}
        {saveSuccess && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-green-600 px-4 py-2 rounded-full shadow-lg flex items-center gap-2 z-50 flinch-slide-in">
            <CheckCircle2 size={16} className="text-white" />
            <span className="text-sm font-medium text-white">Configuration saved successfully</span>
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-48 bg-flinch-deep/50 border-r border-flinch-border p-3 space-y-1 shrink-0 overflow-y-auto">
            <button 
              onClick={() => setActiveTab('general')}
              className={cn("w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md flinch-transition", activeTab === 'general' ? "bg-flinch-surface text-flinch-text font-medium shadow-sm" : "text-flinch-text-dim hover:bg-flinch-surface/50 hover:text-flinch-text")}
            >
              <Monitor size={14} /> General
            </button>
            <button 
              onClick={() => setActiveTab('model')}
              className={cn("w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md flinch-transition", activeTab === 'model' ? "bg-flinch-surface text-flinch-text font-medium shadow-sm" : "text-flinch-text-dim hover:bg-flinch-surface/50 hover:text-flinch-text")}
            >
              <Box size={14} /> Model & API
            </button>
            <button 
              onClick={() => setActiveTab('appearance')}
              className={cn("w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md flinch-transition", activeTab === 'appearance' ? "bg-flinch-surface text-flinch-text font-medium shadow-sm" : "text-flinch-text-dim hover:bg-flinch-surface/50 hover:text-flinch-text")}
            >
              <Paintbrush size={14} /> Appearance
            </button>
          </div>

          {/* Body content */}
          <div className="flex-1 p-6 overflow-y-auto bg-flinch-base">
            {saveError && (
              <div className="mb-4 p-4 text-sm font-bold bg-red-100 border border-red-500 rounded text-red-700 flex items-start gap-2 shadow-sm">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <span>Error saving settings: {saveError}</span>
              </div>
            )}

            {activeTab === 'general' && (
              <div className="space-y-5 flinch-fade-in">
                <div>
                  <h3 className="text-lg font-semibold text-flinch-text mb-1">Blender Environment</h3>
                  <p className="text-xs text-flinch-text-muted mb-4">Configure the Blender executable that Flinch uses to render and execute scripts.</p>
                  
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-flinch-text-dim">Executable Path</label>
                    <input
                      type="text"
                      className={cn("w-full bg-flinch-deep border rounded px-3 py-2.5 text-sm text-flinch-text outline-none flinch-transition", errors.blender_bin ? "border-flinch-error focus:border-flinch-error" : "border-flinch-border focus:border-flinch-text-muted")}
                      value={settings.blender_bin}
                      onChange={(e) => setSettings({ ...settings, blender_bin: e.target.value })}
                      placeholder="/Applications/Blender.app/Contents/MacOS/Blender or C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe"
                    />
                    <p className="text-xs text-flinch-text-muted mt-1">If "blender" is in your system PATH, you can just type "blender". Otherwise, provide the full path.</p>
                    {errors.blender_bin && <div className="text-xs text-flinch-error mt-1">{errors.blender_bin}</div>}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'model' && (
              <div className="space-y-5 flinch-fade-in">
                <div>
                  <h3 className="text-lg font-semibold text-flinch-text mb-1">AI Provider</h3>
                  <p className="text-xs text-flinch-text-muted mb-4">Set up your local or remote LLM endpoint. Must be OpenAI API compatible.</p>
                  
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-flinch-text-dim">API Provider URL</label>
                      <input
                        type="text"
                        className={cn("w-full bg-flinch-deep border rounded px-3 py-2.5 text-sm text-flinch-text outline-none flinch-transition", errors.base_url ? "border-flinch-error focus:border-flinch-error" : "border-flinch-border focus:border-flinch-text-muted")}
                        value={settings.base_url}
                        onChange={(e) => setSettings({ ...settings, base_url: e.target.value })}
                        placeholder="http://localhost:11434/v1"
                      />
                      <p className="text-xs text-flinch-text-muted">Use standard OpenAI-compatible endpoints (Ollama, Groq, OpenRouter, Google AI Studio)</p>
                      {errors.base_url && <div className="text-xs text-flinch-error mt-1">{errors.base_url}</div>}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-flinch-text-dim">Model Name</label>
                      <input
                        type="text"
                        className={cn("w-full bg-flinch-deep border rounded px-3 py-2.5 text-sm text-flinch-text outline-none flinch-transition", errors.model ? "border-flinch-error focus:border-flinch-error" : "border-flinch-border focus:border-flinch-text-muted")}
                        value={settings.model}
                        onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                        placeholder="qwen3.5:9b"
                      />
                      {errors.model && <div className="text-xs text-flinch-error mt-1">{errors.model}</div>}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-flinch-text-dim">API Key (Optional)</label>
                      <input
                        type="password"
                        className={cn("w-full bg-flinch-deep border rounded px-3 py-2.5 text-sm text-flinch-text outline-none flinch-transition", errors.api_key ? "border-flinch-error focus:border-flinch-error" : "border-flinch-border focus:border-flinch-text-muted")}
                        value={settings.api_key}
                        onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
                        placeholder="Leave empty for local models like Ollama"
                      />
                      <p className="text-xs text-flinch-text-muted">Stored securely in your OS keychain. Never written to disk.</p>
                      {errors.api_key && <div className="text-xs text-flinch-error mt-1">{errors.api_key}</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-5 flinch-fade-in">
                <div>
                  <h3 className="text-lg font-semibold text-flinch-text mb-1">Appearance</h3>
                  <p className="text-xs text-flinch-text-muted mb-4">Customize the UI theme and layout.</p>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-flinch-text-dim">Theme</label>
                      <div className="flex items-center gap-3">
                        {['system', 'dark', 'light'].map((t) => (
                          <label key={t} className="flex items-center gap-2 cursor-pointer">
                            <input 
                              type="radio" 
                              name="theme" 
                              value={t} 
                              checked={theme === t} 
                              onChange={() => setTheme(t as 'system'|'dark'|'light')}
                              className="accent-flinch-accent"
                            />
                            <span className="text-sm capitalize text-flinch-text">{t}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-flinch-text-dim">Code Editor Font Size</label>
                      <select 
                        value={fontSize} 
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        className="bg-flinch-deep border border-flinch-border rounded px-3 py-2 text-sm text-flinch-text outline-none flinch-transition focus:border-flinch-text-muted"
                      >
                        <option value={11}>Small (11px)</option>
                        <option value={13}>Medium (13px)</option>
                        <option value={15}>Large (15px)</option>
                        <option value={17}>Extra Large (17px)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-flinch-border bg-flinch-deep flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-flinch-text-dim hover:text-flinch-text flinch-transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-flinch-accent text-white rounded hover:bg-flinch-accent-dim flinch-transition disabled:opacity-50"
          >
            {isSaving ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save size={16} />
            )}
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
