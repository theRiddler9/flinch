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

#[derive(serde::Serialize, Clone, Debug)]
pub struct SystemMetrics {
    pub cpu_percent: f32,
    pub cpu_cores: usize,
    pub cpu_brand: String,
    pub ram_used_gb: f32,
    pub ram_total_gb: f32,
    pub ram_percent: f32,
    pub gpu_name: Option<String>,
    pub gpu_percent: Option<f32>,
    pub vram_used_gb: Option<f32>,
    pub vram_total_gb: Option<f32>,
    pub vram_percent: Option<f32>,
    pub disk_read_mbps: f32,
    pub disk_write_mbps: f32,
    pub disk_used_gb: f32,
    pub disk_total_gb: f32,
    pub disk_percent: f32,
}

impl Default for SystemMetrics {
    fn default() -> Self {
        Self {
            cpu_percent: 0.0,
            cpu_cores: 0,
            cpu_brand: "CPU".to_string(),
            ram_used_gb: 0.0,
            ram_total_gb: 0.0,
            ram_percent: 0.0,
            gpu_name: None,
            gpu_percent: None,
            vram_used_gb: None,
            vram_total_gb: None,
            vram_percent: None,
            disk_read_mbps: 0.0,
            disk_write_mbps: 0.0,
            disk_used_gb: 0.0,
            disk_total_gb: 0.0,
            disk_percent: 0.0,
        }
    }
}

struct AppState {
    agent: RwLock<Agent>,
    runner: RwLock<Runner>,
    store: std::sync::Mutex<Store>,
    metrics: Arc<RwLock<SystemMetrics>>,
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
async fn render_frame(
    state: State<'_, Arc<AppState>>,
    script: String,
    frame: i32,
    out_path: String,
    engine: String,
) -> Result<(), String> {
    let tmp = std::env::temp_dir();
    let script_path = tmp.join(format!("flinch_frame_{}.py", frame));
    let result_path = tmp.join(format!("flinch_frame_{}_result.json", frame));
    std::fs::write(&script_path, &script).map_err(|e| e.to_string())?;

    let runner = state.runner.read().await;
    // Use the runner's blender bin directly for a frame render
    let blender_bin = resolve_blender_binary(runner.blender_bin());

    let harness_path = resolve_workspace_path("blender/harness.py");

    let output = tokio::process::Command::new(&blender_bin)
        .arg("-b")
        .arg("--factory-startup")
        .arg("--python-exit-code")
        .arg("1")
        .arg("--python")
        .arg(&harness_path)
        .arg("--")
        .arg("--script")
        .arg(&script_path)
        .arg("--out")
        .arg(&result_path)
        .arg("--render-image")
        .arg(&out_path)
        .arg("--frame")
        .arg(frame.to_string())
        .arg("--engine")
        .arg(&engine)
        .output()
        .await
        .map_err(|e| format!("Failed to spawn blender: {}", e))?;

    let _ = std::fs::remove_file(&script_path);
    let _ = std::fs::remove_file(&result_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Blender frame render failed: {}", stderr));
    }
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

    let resolved_blender_bin = resolve_blender_binary(&blender_bin);

    Ok(AppSettings {
        blender_bin: resolved_blender_bin,
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
    let resolved_bin = resolve_blender_binary(&settings.blender_bin);

    // Save to keyring
    if let Ok(entry) = keyring::Entry::new("flinch", "api_key") {
        let _ = entry.set_password(&settings.api_key);
    }

    // Save to flinch.toml
    let config = flinch_core::config::AppConfig {
        blender: flinch_core::config::BlenderConfig {
            bin: resolved_bin.clone(),
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
        blender_bin: resolved_bin.clone(),
        timeout_sec: 60,
    });

    let sys_path = resolve_workspace_path("prompts/system.md");
    let system_prompt = fs::read_to_string(&sys_path).unwrap_or_default();
    let fb_path = resolve_workspace_path("prompts/feedback.md");
    let feedback_prompt = fs::read_to_string(&fb_path).unwrap_or_default();

    let agent_new = Agent::new(
        Arc::new(provider),
        Arc::new(Runner::new(RunnerConfig {
            blender_bin: resolved_bin,
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

pub fn resolve_blender_binary(path_str: &str) -> String {
    let p = std::path::Path::new(path_str);
    if p.is_dir() {
        let exe = p.join("blender.exe");
        if exe.exists() {
            return exe.to_string_lossy().to_string();
        }
        let bin = p.join("blender");
        if bin.exists() {
            return bin.to_string_lossy().to_string();
        }
    }
    if p.is_file() && p.exists() {
        return p.to_string_lossy().to_string();
    }
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
        ];
        for cand in candidates {
            if std::path::Path::new(cand).exists() {
                return cand.to_string();
            }
        }
        if let Ok(entries) = std::fs::read_dir(r"C:\Program Files\Blender Foundation") {
            for entry in entries.flatten() {
                let exe = entry.path().join("blender.exe");
                if exe.exists() {
                    return exe.to_string_lossy().to_string();
                }
            }
        }
    }
    path_str.to_string()
}

async fn query_gpu_info() -> (
    Option<String>,
    Option<f32>,
    Option<f32>,
    Option<f32>,
    Option<f32>,
) {
    let output = tokio::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total,memory.used,utilization.gpu",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await;
    if let Ok(out) = output {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout);
            let line = s.lines().next().unwrap_or("").trim();
            let parts: Vec<&str> = line.split(',').map(|p| p.trim()).collect();
            if parts.len() >= 4 {
                let name = parts[0].to_string();
                let total_mb: f32 = parts[1].parse().unwrap_or(0.0);
                let used_mb: f32 = parts[2].parse().unwrap_or(0.0);
                let util: f32 = parts[3].parse().unwrap_or(0.0);
                let total_gb = total_mb / 1024.0;
                let used_gb = used_mb / 1024.0;
                let pct = if total_gb > 0.0 {
                    (used_gb / total_gb) * 100.0
                } else {
                    0.0
                };
                return (
                    Some(name),
                    Some(util),
                    Some(used_gb),
                    Some(total_gb),
                    Some(pct),
                );
            }
        }
    }
    (None, None, None, None, None)
}

async fn collect_system_metrics(
    sys: &mut sysinfo::System,
    last_instant: &mut std::time::Instant,
) -> SystemMetrics {
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_percent = sys.global_cpu_usage();
    let cpu_cores = sys.cpus().len();
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_else(|| "CPU".to_string());

    let ram_used_gb = sys.used_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
    let ram_total_gb = sys.total_memory() as f32 / (1024.0 * 1024.0 * 1024.0);
    let ram_percent = if ram_total_gb > 0.0 {
        (ram_used_gb / ram_total_gb) * 100.0
    } else {
        0.0
    };

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let (mut disk_total_bytes, mut disk_avail_bytes) = (0u64, 0u64);
    for disk in disks.list() {
        disk_total_bytes += disk.total_space();
        disk_avail_bytes += disk.available_space();
    }
    let disk_used_bytes = disk_total_bytes.saturating_sub(disk_avail_bytes);
    let disk_used_gb = disk_used_bytes as f32 / (1024.0 * 1024.0 * 1024.0);
    let disk_total_gb = disk_total_bytes as f32 / (1024.0 * 1024.0 * 1024.0);
    let disk_percent = if disk_total_gb > 0.0 {
        (disk_used_gb / disk_total_gb) * 100.0
    } else {
        0.0
    };

    let now = std::time::Instant::now();
    let elapsed = now.duration_since(*last_instant).as_secs_f32().max(0.1);
    *last_instant = now;

    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let mut total_read_bytes = 0u64;
    let mut total_written_bytes = 0u64;
    for proc in sys.processes().values() {
        let du = proc.disk_usage();
        total_read_bytes = total_read_bytes.saturating_add(du.read_bytes);
        total_written_bytes = total_written_bytes.saturating_add(du.written_bytes);
    }
    let disk_read_mbps = (total_read_bytes as f32 / elapsed) / (1024.0 * 1024.0);
    let disk_write_mbps = (total_written_bytes as f32 / elapsed) / (1024.0 * 1024.0);

    let (gpu_name, gpu_percent, vram_used_gb, vram_total_gb, vram_percent) = query_gpu_info().await;

    SystemMetrics {
        cpu_percent,
        cpu_cores,
        cpu_brand,
        ram_used_gb,
        ram_total_gb,
        ram_percent,
        gpu_name,
        gpu_percent,
        vram_used_gb,
        vram_total_gb,
        vram_percent,
        disk_read_mbps,
        disk_write_mbps,
        disk_used_gb,
        disk_total_gb,
        disk_percent,
    }
}

#[tauri::command]
async fn open_in_blender(script: String) -> Result<(), String> {
    let settings = get_settings().await?;
    let bin = resolve_blender_binary(&settings.blender_bin);

    let tmp_dir = std::env::temp_dir().join("flinch_open");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_micros();
    let script_path = tmp_dir.join(format!("open_{}.py", ts));
    std::fs::write(&script_path, script).map_err(|e| e.to_string())?;

    std::process::Command::new(&bin)
        .arg("--python")
        .arg(&script_path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn get_system_metrics(state: State<'_, Arc<AppState>>) -> Result<SystemMetrics, String> {
    let metrics = state.metrics.read().await.clone();
    Ok(metrics)
}

#[tauri::command]
async fn check_doctor() -> Result<DoctorResult, String> {
    let settings = get_settings().await?;
    let bin = resolve_blender_binary(&settings.blender_bin);

    // Check Blender
    let blender_out = tokio::process::Command::new(&bin)
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
    if let Ok(mut dir) = std::env::current_dir() {
        let mut best_dir = dir.clone();
        loop {
            let candidate = dir.join(path);
            if candidate.exists() {
                return candidate;
            }
            if dir.join("Cargo.toml").exists() && dir.join("bunfig.toml").exists() {
                best_dir = dir.clone();
            }
            if !dir.pop() {
                break;
            }
        }
        return best_dir.join(path);
    }
    if let Ok(mut exe) = std::env::current_exe() {
        loop {
            let candidate = exe.join(path);
            if candidate.exists() {
                return candidate;
            }
            if !exe.pop() {
                break;
            }
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

            let resolved_blender_bin = resolve_blender_binary(&blender_bin);
            let provider = OpenAiCompatProvider::new(base_url, model, api_key);
            let runner = Runner::new(RunnerConfig {
                blender_bin: resolved_blender_bin.clone(),
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
                    blender_bin: resolved_blender_bin,
                    timeout_sec: 60,
                })),
                AgentConfig {
                    max_attempts: 3,
                    system_prompt,
                    feedback_prompt_template: feedback_prompt,
                },
            );

            let metrics = Arc::new(RwLock::new(SystemMetrics::default()));
            let metrics_worker = metrics.clone();
            tauri::async_runtime::spawn(async move {
                let mut sys = sysinfo::System::new_all();
                sys.refresh_all();
                let mut last_instant = std::time::Instant::now();
                loop {
                    let m = collect_system_metrics(&mut sys, &mut last_instant).await;
                    *metrics_worker.write().await = m;
                    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
                }
            });

            app.manage(Arc::new(AppState {
                agent: RwLock::new(agent),
                runner: RwLock::new(runner),
                store: std::sync::Mutex::new(store),
                metrics,
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
            open_in_blender,
            render_frame,
            get_system_metrics,
            get_settings,
            save_settings,
            check_doctor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
