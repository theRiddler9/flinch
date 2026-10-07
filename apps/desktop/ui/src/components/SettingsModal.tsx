import { useEffect, useState } from 'react';
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { Settings2, Save, X, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export const SettingsSchema = z.object({
  blender_bin: z.string().min(1, 'Blender path is required'),
  provider_kind: z.string().default('openai_compatible'),
  provider_base_url: z.string().url('Must be a valid URL (e.g., http://localhost:11434/v1)'),
  provider_model: z.string().min(1, 'Model name is required'),
  api_key: z.string().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<Settings>({
    blender_bin: 'blender',
    provider_kind: 'openai_compatible',
    provider_base_url: 'http://localhost:11434/v1',
    provider_model: 'qwen3.5:9b',
    api_key: '',
  });
  
  const [errors, setErrors] = useState<Partial<Record<keyof Settings, string>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
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
      setErrors({});

      // Strictly validate with Zod
      const valid = SettingsSchema.parse(settings);

      // Save to backend
      await invoke('save_settings', { settings: valid });
      onClose();
    } catch (e) {
      if (e instanceof z.ZodError) {
        const fieldErrors: any = {};
        (e as any).errors.forEach((err: any) => {
          if (err.path[0]) {
            fieldErrors[err.path[0]] = err.message;
          }
        });
        setErrors(fieldErrors);
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
      <div className="bg-flinch-surface border border-flinch-border shadow-2xl rounded-xl w-full max-w-md overflow-hidden flex flex-col flinch-slide-in">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-flinch-border bg-flinch-deep">
          <div className="flex items-center gap-2 text-flinch-text font-semibold">
            <Settings2 size={18} className="text-flinch-text-muted" />
            Preferences
          </div>
          <button onClick={onClose} className="text-flinch-text-muted hover:text-flinch-text flinch-transition rounded-md p-1 hover:bg-flinch-surface">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {saveError && (
            <div className="p-3 text-xs bg-flinch-error/10 border border-flinch-error/20 rounded text-flinch-error flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-flinch-text-dim">Blender Executable Path</label>
            <input
              type="text"
              className={cn("w-full bg-flinch-deep border rounded px-3 py-2 text-sm text-flinch-text outline-none flinch-transition", errors.blender_bin ? "border-flinch-error focus:border-flinch-error" : "border-flinch-border focus:border-flinch-text-muted")}
              value={settings.blender_bin}
              onChange={(e) => setSettings({ ...settings, blender_bin: e.target.value })}
              placeholder="/Applications/Blender.app/Contents/MacOS/Blender or C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe"
            />
            {errors.blender_bin && <div className="text-xs text-flinch-error mt-1">{errors.blender_bin}</div>}
          </div>

          <div className="space-y-1 pt-2">
            <label className="text-xs font-medium text-flinch-text-dim">API Provider URL</label>
            <input
              type="text"
              className={cn("w-full bg-flinch-deep border rounded px-3 py-2 text-sm text-flinch-text outline-none flinch-transition", errors.provider_base_url ? "border-flinch-error focus:border-flinch-error" : "border-flinch-border focus:border-flinch-text-muted")}
              value={settings.provider_base_url}
              onChange={(e) => setSettings({ ...settings, provider_base_url: e.target.value })}
              placeholder="http://localhost:11434/v1"
            />
            <p className="text-2xs text-flinch-text-muted">Use standard OpenAI-compatible endpoints (Ollama, Groq, OpenRouter, Google AI Studio)</p>
            {errors.provider_base_url && <div className="text-xs text-flinch-error mt-1">{errors.provider_base_url}</div>}
          </div>

          <div className="space-y-1 pt-2">
            <label className="text-xs font-medium text-flinch-text-dim">Model Name</label>
            <input
              type="text"
              className={cn("w-full bg-flinch-deep border rounded px-3 py-2 text-sm text-flinch-text outline-none flinch-transition", errors.provider_model ? "border-flinch-error focus:border-flinch-error" : "border-flinch-border focus:border-flinch-text-muted")}
              value={settings.provider_model}
              onChange={(e) => setSettings({ ...settings, provider_model: e.target.value })}
              placeholder="qwen3.5:9b"
            />
            {errors.provider_model && <div className="text-xs text-flinch-error mt-1">{errors.provider_model}</div>}
          </div>

          <div className="space-y-1 pt-2">
            <label className="text-xs font-medium text-flinch-text-dim">API Key (Optional)</label>
            <input
              type="password"
              className={cn("w-full bg-flinch-deep border rounded px-3 py-2 text-sm text-flinch-text outline-none flinch-transition", errors.api_key ? "border-flinch-error focus:border-flinch-error" : "border-flinch-border focus:border-flinch-text-muted")}
              value={settings.api_key}
              onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
              placeholder="Leave empty for local models like Ollama"
            />
            <p className="text-2xs text-flinch-text-muted">Stored securely in your OS keychain. Never written to disk.</p>
            {errors.api_key && <div className="text-xs text-flinch-error mt-1">{errors.api_key}</div>}
          </div>

        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-flinch-border bg-flinch-deep flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-flinch-text-dim hover:text-flinch-text flinch-transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-flinch-text text-flinch-bg rounded hover:bg-flinch-text-dim flinch-transition disabled:opacity-50"
          >
            {isSaving ? (
              <span className="w-3 h-3 border-2 border-flinch-bg border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
