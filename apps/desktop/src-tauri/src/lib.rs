use flinch_core::agent::loop_logic::{Agent, AgentConfig, AgentResult};
use flinch_core::provider::openai_compat::OpenAiCompatProvider;
use flinch_core::runner::process::{ExportOptions, Runner, RunnerConfig};
use flinch_core::store::db::Store;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

#[derive(Clone, serde::Serialize)]
struct LogEvent {
    message: String,
}

struct AppState {
    agent: Agent,
    runner: Runner,
    store: std::sync::Mutex<Store>,
}

#[tauri::command]
async fn run_prompt(
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    prompt: String,
) -> Result<AgentResult, String> {
    let log_cb = {
        let app = app_handle.clone();
        move |log_line: String| {
            let app = app.clone();
            async move {
                let _ = app.emit("blender://log", LogEvent { message: log_line });
            }
        }
    };

    let result = state
        .agent
        .run_task(&prompt, None, log_cb)
        .await
        .map_err(|e| e.to_string())?;

    {
        let store = state.store.lock().unwrap();
        let _ = store.save_session(&prompt, &result);
    }

    Ok(result)
}

#[tauri::command]
async fn export_blend(
    state: State<'_, Arc<AppState>>,
    script: String,
    out_path: String,
) -> Result<(), String> {
    state
        .runner
        .run_script(
            &script,
            None,
            Some(ExportOptions {
                save_blend: Some(out_path),
                render_image: None,
            }),
            |_log| async move {},
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn export_script(script: String, out_path: String) -> Result<(), String> {
    fs::write(out_path, script).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn export_preview(
    state: State<'_, Arc<AppState>>,
    script: String,
    out_path: String,
) -> Result<(), String> {
    state
        .runner
        .run_script(
            &script,
            None,
            Some(ExportOptions {
                save_blend: None,
                render_image: Some(out_path),
            }),
            |_log| async move {},
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn cancel_run() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn check_blender() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
async fn list_sessions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<(String, String, bool, String)>, String> {
    let store = state.store.lock().unwrap();
    store.list_sessions().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Setup Store
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("history.db");
            let store = Store::new(db_path).expect("Failed to initialize SQLite store");

            // Setup Agent & Runner
            let config_str = fs::read_to_string("../../flinch.toml").unwrap_or_default();
            let app_config: Option<flinch_core::config::AppConfig> =
                toml::from_str(&config_str).ok();

            let (base_url, model, api_key_env, blender_bin) = match app_config {
                Some(cfg) => (
                    cfg.provider.base_url,
                    cfg.provider.model,
                    cfg.provider.api_key_env,
                    cfg.blender.bin,
                ),
                None => (
                    "http://localhost:11434/v1".to_string(),
                    "llama3".to_string(),
                    "OPENAI_API_KEY".to_string(),
                    "blender".to_string(),
                ),
            };

            let api_key = if !api_key_env.is_empty() {
                std::env::var(&api_key_env).unwrap_or_default()
            } else {
                std::env::var("OPENAI_API_KEY").unwrap_or_default()
            };

            let provider = OpenAiCompatProvider::new(base_url, model, api_key);
            let runner = Runner::new(RunnerConfig {
                blender_bin: blender_bin.clone(),
                timeout_sec: 60,
            });

            // We must read prompts from current dir if not packaged
            let system_prompt = fs::read_to_string("../../prompts/system.md").unwrap_or_default();
            let feedback_prompt =
                fs::read_to_string("../../prompts/feedback.md").unwrap_or_default();

            let agent = Agent::new(
                Arc::new(provider),
                Arc::new(Runner::new(RunnerConfig {
                    blender_bin: blender_bin.clone(),
                    timeout_sec: 60,
                })),
                AgentConfig {
                    max_attempts: 3,
                    system_prompt,
                    feedback_prompt_template: feedback_prompt,
                },
            );

            app.manage(Arc::new(AppState {
                agent,
                runner,
                store: std::sync::Mutex::new(store),
            }));
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_prompt,
            cancel_run,
            check_blender,
            list_sessions,
            export_blend,
            export_script,
            export_preview
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
