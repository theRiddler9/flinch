use crate::error::{FlinchError, Result};
use crate::harness::HarnessResult;
use command_group::AsyncCommandGroup;
use std::process::Stdio;
use tempfile::tempdir;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

pub struct RunnerConfig {
    pub blender_bin: String,
    pub timeout_sec: u64,
}

pub struct Runner {
    config: RunnerConfig,
}

impl Runner {
    pub fn new(config: RunnerConfig) -> Self {
        Self { config }
    }

    pub async fn run_script<F, Fut>(
        &self,
        script: &str,
        spec: Option<&str>,
        mut log_callback: F,
    ) -> Result<HarnessResult>
    where
        F: FnMut(String) -> Fut,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let dir = tempdir().map_err(FlinchError::IoError)?;
        let script_path = dir.path().join("generated.py");
        let result_path = dir.path().join("result.json");

        fs::write(&script_path, script)
            .await
            .map_err(FlinchError::IoError)?;

        let mut cmd = Command::new(&self.config.blender_bin);
        cmd.arg("-b")
            .arg("--factory-startup")
            .arg("--python-exit-code")
            .arg("1")
            .arg("--python")
            .arg("blender/harness.py")
            .arg("--")
            .arg("--script")
            .arg(&script_path)
            .arg("--out")
            .arg(&result_path);

        let spec_path = dir.path().join("spec.json");
        if let Some(spec_str) = spec {
            fs::write(&spec_path, spec_str)
                .await
                .map_err(FlinchError::IoError)?;
            cmd.arg("--spec").arg(&spec_path);
        }

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        // Spawn with process group / job object
        let mut child = cmd
            .group_spawn()
            .map_err(|e| FlinchError::RunnerError(e.to_string()))?;

        let stdout = child.inner().stdout.take().expect("stdout piped");
        let stderr = child.inner().stderr.take().expect("stderr piped");

        let (tx, mut rx) = tokio::sync::mpsc::channel(100);

        let tx_out = tx.clone();
        tokio::spawn(async move {
            let mut out_reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = out_reader.next_line().await {
                if tx_out.send(format!("[stdout] {}", line)).await.is_err() {
                    break;
                }
            }
        });

        let tx_err = tx.clone();
        tokio::spawn(async move {
            let mut err_reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = err_reader.next_line().await {
                if tx_err.send(format!("[stderr] {}", line)).await.is_err() {
                    break;
                }
            }
        });

        drop(tx);

        let run_task = async {
            let mut child_status = None;
            loop {
                tokio::select! {
                    line_opt = rx.recv() => {
                        match line_opt {
                            Some(line) => log_callback(line).await,
                            None => {
                                if let Some(status) = child_status {
                                    return status;
                                } else {
                                    return child.wait().await;
                                }
                            }
                        }
                    }
                    status = child.wait(), if child_status.is_none() => {
                        child_status = Some(status);
                    }
                }
            }
        };

        let timeout_duration = Duration::from_secs(self.config.timeout_sec);

        match timeout(timeout_duration, run_task).await {
            Ok(Ok(_status)) => {
                // Done normally
            }
            Ok(Err(e)) => {
                return Err(FlinchError::RunnerError(e.to_string()));
            }
            Err(_) => {
                // Timeout => kill process group
                let _ = child.kill().await;
                return Ok(HarnessResult {
                    schema: 1,
                    ok: false,
                    stage: "timeout".to_string(),
                    error: Some(crate::harness::ErrorDetail {
                        error_type: "TimeoutError".to_string(),
                        message: "Blender process exceeded timeout".to_string(),
                        traceback: "".to_string(),
                        line: 0,
                    }),
                    stdout: "".to_string(),
                    warnings: vec![],
                    scene_stats: crate::harness::SceneStats {
                        blender_version: "".to_string(),
                        objects: vec![],
                        counts: crate::harness::CountsStat {
                            mesh: 0,
                            light: 0,
                            camera: 0,
                            grease_pencil: 0,
                        },
                        frame_range: (0, 0),
                        fps: 0,
                        keyframe_count: 0,
                    },
                    checks: vec![],
                    duration_ms: (self.config.timeout_sec * 1000) as u32,
                });
            }
        }

        // Read result.json
        if result_path.exists() {
            let data = fs::read_to_string(&result_path)
                .await
                .map_err(FlinchError::IoError)?;
            let res: HarnessResult = serde_json::from_str(&data).map_err(FlinchError::JsonError)?;
            Ok(res)
        } else {
            Err(FlinchError::RunnerError(
                "result.json not found".to_string(),
            ))
        }
    }
}
