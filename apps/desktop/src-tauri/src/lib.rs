use flinch_core::agent::loop_logic::{Agent, AgentConfig, AgentResult};
use flinch_core::provider::openai_compat::OpenAiCompatProvider;
use flinch_core::runner::process::{ExportOptions, Runner, RunnerConfig};
use flinch_core::store::db::Store;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::RwLock;

#[derive(Clone, serde::Serialize)]
struct LogEvent {
    message: String,
}

struct AppState {
    agent: RwLock<Agent>,
    runner: RwLock<Runner>,
    store: std::sync::Mutex<Store>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AppSettings {
    blender_bin: String,
    base_url: String,
    model: String,
    api_key: String,
}

#[derive(serde::Serialize)]
struct DoctorResult {
    blender_ok: bool,
    blender_version: Option<String>,
    provider_ok: bool,
    provider_error: Option<String>,
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

    let token_cb = {
        let app = app_handle.clone();
        move |token: String| {
            let app = app.clone();
            async move {
                let _ = app.emit("agent://token", LogEvent { message: token });
            }
        }
    };

    let agent = state.agent.read().await;
    let result = agent
        .run_task(&prompt, None, log_cb, token_cb)
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
    let runner = state.runner.read().await;
    runner
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
    let runner = state.runner.read().await;
    runner
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

#[tauri::command]
async fn get_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<AgentResult, String> {
    let store = state.store.lock().unwrap();
    store.get_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_settings() -> Result<AppSettings, String> {
    let config_path = resolve_workspace_path("flinch.toml");
    let config_str = fs::read_to_string(&config_path).unwrap_or_default();
    let app_config: Option<flinch_core::config::AppConfig> = toml::from_str(&config_str).ok();

    let (base_url, model, blender_bin) = match app_config {
        Some(cfg) => (cfg.provider.base_url, cfg.provider.model, cfg.blender.bin),
        None => (
            "http://localhost:11434/v1".to_string(),
            "qwen3.5:9b".to_string(),
            "blender".to_string(),
        ),
    };

    let api_key = match keyring::Entry::new("flinch", "api_key") {
        Ok(entry) => entry.get_password().unwrap_or_default(),
        Err(_) => "".to_string(),
    };

    Ok(AppSettings {
        blender_bin,
        base_url,
        model,
        api_key,
    })
}

#[tauri::command]
async fn save_settings(
    state: State<'_, Arc<AppState>>,
    settings: AppSettings,
) -> Result<(), String> {
    // Save to keyring
    if let Ok(entry) = keyring::Entry::new("flinch", "api_key") {
        let _ = entry.set_password(&settings.api_key);
    }

    // Save to flinch.toml
    let config = flinch_core::config::AppConfig {
        blender: flinch_core::config::BlenderConfig {
            bin: settings.blender_bin.clone(),
        },
        provider: flinch_core::config::ProviderConfig {
            kind: "openai_compatible".to_string(),
            base_url: settings.base_url.clone(),
            model: settings.model.clone(),
            api_key_env: "".to_string(),
            max_concurrency: 1,
        },
    };

    let toml_str = toml::to_string(&config).map_err(|e| e.to_string())?;
    let config_path = resolve_workspace_path("flinch.toml");
    fs::write(&config_path, toml_str).map_err(|e| e.to_string())?;

    // Update agent and runner
    let provider = OpenAiCompatProvider::new(settings.base_url, settings.model, settings.api_key);
    let runner_new = Runner::new(RunnerConfig {
        blender_bin: settings.blender_bin.clone(),
        timeout_sec: 60,
    });

    let sys_path = resolve_workspace_path("prompts/system.md");
    let system_prompt = fs::read_to_string(&sys_path).unwrap_or_default();
    let fb_path = resolve_workspace_path("prompts/feedback.md");
    let feedback_prompt = fs::read_to_string(&fb_path).unwrap_or_default();

    let agent_new = Agent::new(
        Arc::new(provider),
        Arc::new(Runner::new(RunnerConfig {
            blender_bin: settings.blender_bin.clone(),
            timeout_sec: 60,
        })),
        AgentConfig {
            max_attempts: 3,
            system_prompt,
            feedback_prompt_template: feedback_prompt,
        },
    );

    *state.runner.write().await = runner_new;
    *state.agent.write().await = agent_new;

    Ok(())
}

#[tauri::command]
async fn check_doctor() -> Result<DoctorResult, String> {
    let settings = get_settings().await?;

    // Check Blender
    let blender_out = tokio::process::Command::new(&settings.blender_bin)
        .arg("--version")
        .output()
        .await;

    let (blender_ok, blender_version) = match blender_out {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let first_line = stdout
                .lines()
                .next()
                .unwrap_or("Unknown version")
                .to_string();
            (true, Some(first_line))
        }
        _ => (false, None),
    };

    // Check Provider
    let client = reqwest::Client::new();
    let url = format!("{}/models", settings.base_url.trim_end_matches('/'));

    let req = client.get(&url);
    let req = if !settings.api_key.is_empty() {
        req.header("Authorization", format!("Bearer {}", settings.api_key))
    } else {
        req
    };

    let (provider_ok, provider_error) = match req.send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                (true, None)
            } else {
                (false, Some(format!("HTTP {}", resp.status())))
            }
        }
        Err(e) => (false, Some(e.to_string())),
    };

    Ok(DoctorResult {
        blender_ok,
        blender_version,
        provider_ok,
        provider_error,
    })
}

fn resolve_workspace_path(path: &str) -> PathBuf {
    // 1. Try tauri dev relative path
    let p = PathBuf::from("../../").join(path);
    if p.exists() {
        return p;
    }
    // 2. Try current working directory
    let p = PathBuf::from(path);
    if p.exists() {
        return p;
    }
    // 3. Try relative to the executable (production)
    if let Ok(mut exe_path) = std::env::current_exe() {
        exe_path.pop();
        let p = exe_path.join(path);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(path)
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
            let config_path = resolve_workspace_path("flinch.toml");
            let config_str = fs::read_to_string(&config_path).unwrap_or_default();
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
                    "qwen3.5:9b".to_string(),
                    "OPENAI_API_KEY".to_string(),
                    "blender".to_string(),
                ),
            };

            let mut api_key = if !api_key_env.is_empty() {
                std::env::var(&api_key_env).unwrap_or_default()
            } else {
                std::env::var("OPENAI_API_KEY").unwrap_or_default()
            };

            // Override with keyring if available
            if let Ok(entry) = keyring::Entry::new("flinch", "api_key") {
                if let Ok(pw) = entry.get_password() {
                    if !pw.is_empty() {
                        api_key = pw;
                    }
                }
            }

            let provider = OpenAiCompatProvider::new(base_url, model, api_key);
            let runner = Runner::new(RunnerConfig {
                blender_bin: blender_bin.clone(),
                timeout_sec: 60,
            });

            // We must read prompts from current dir if not packaged
            let sys_path = resolve_workspace_path("prompts/system.md");
            let system_prompt = fs::read_to_string(&sys_path).unwrap_or_default();

            let fb_path = resolve_workspace_path("prompts/feedback.md");
            let feedback_prompt = fs::read_to_string(&fb_path).unwrap_or_default();

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
                agent: RwLock::new(agent),
                runner: RwLock::new(runner),
                store: std::sync::Mutex::new(store),
            }));
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_prompt,
            cancel_run,
            check_blender,
            list_sessions,
            get_session,
            export_blend,
            export_script,
            export_preview,
            get_settings,
            save_settings,
            check_doctor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
