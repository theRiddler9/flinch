use crate::error::Result;
use crate::harness::HarnessResult;
use crate::provider::{ChatMessage, ChatRequest, LlmProvider};
use crate::runner::process::Runner;
use futures_util::StreamExt;
use std::sync::Arc;

pub struct AgentConfig {
    pub max_attempts: u32,
    pub system_prompt: String,
    pub feedback_prompt_template: String,
}

pub struct Agent {
    provider: Arc<dyn LlmProvider>,
    runner: Arc<Runner>,
    config: AgentConfig,
}

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub struct AttemptRecord {
    pub prompt: String,
    pub raw_response: String,
    pub script: String,
    pub harness_result: Option<HarnessResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../apps/desktop/ui/src/bindings/")]
pub struct AgentResult {
    pub success: bool,
    pub attempts: Vec<AttemptRecord>,
}

impl Agent {
    pub fn new(provider: Arc<dyn LlmProvider>, runner: Arc<Runner>, config: AgentConfig) -> Self {
        Self {
            provider,
            runner,
            config,
        }
    }

    pub async fn run_task<F, Fut1, T, Fut2>(
        &self,
        user_prompt: &str,
        spec: Option<&str>,
        mut log_cb: F,
        mut token_cb: T,
    ) -> Result<AgentResult>
    where
        F: FnMut(String) -> Fut1,
        Fut1: std::future::Future<Output = ()> + Send,
        T: FnMut(String) -> Fut2,
        Fut2: std::future::Future<Output = ()> + Send,
    {
        let mut messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: self.config.system_prompt.clone(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            },
        ];

        let mut attempts_record = Vec::new();

        'attempt_loop: for attempt in 1..=self.config.max_attempts {
            log_cb(format!(
                "--- Attempt {}/{} ---",
                attempt, self.config.max_attempts
            ))
            .await;

            let req = ChatRequest {
                messages: messages.clone(),
                temperature: 0.2, // low temp for coding
            };

            let mut stream = self.provider.stream_chat(req).await?;
            let mut raw_response = String::new();

            while let Some(chunk_res) = stream.next().await {
                match chunk_res {
                    Ok(chunk) => {
                        raw_response.push_str(&chunk.content);
                        token_cb(chunk.content).await;
                    }
                    Err(e) => {
                        let err_msg = format!("Network or provider error: {}", e);
                        attempts_record.push(AttemptRecord {
                            prompt: user_prompt.to_string(),
                            raw_response: raw_response.clone(),
                            script: "".to_string(),
                            harness_result: None,
                        });
                        messages.push(ChatMessage {
                            role: "user".to_string(),
                            content: err_msg,
                        });
                        continue 'attempt_loop;
                    }
                }
            }

            messages.push(ChatMessage {
                role: "assistant".to_string(),
                content: raw_response.clone(),
            });

            let script = extract_python_code(&raw_response);
            if script.is_empty() {
                attempts_record.push(AttemptRecord {
                    prompt: user_prompt.to_string(),
                    raw_response: raw_response.clone(),
                    script: "".to_string(),
                    harness_result: None,
                });

                messages.push(ChatMessage {
                    role: "user".to_string(),
                    content: "No Python code block found in your response. Please provide the complete script in a single ```python block.".to_string(),
                });
                continue;
            }

            let harness_res = self
                .runner
                .run_script(&script, spec, None, &mut log_cb)
                .await?;

            attempts_record.push(AttemptRecord {
                prompt: user_prompt.to_string(),
                raw_response: raw_response.clone(),
                script: script.clone(),
                harness_result: Some(harness_res.clone()),
            });

            if harness_res.ok {
                return Ok(AgentResult {
                    success: true,
                    attempts: attempts_record,
                });
            } else {
                let error_detail = harness_res
                    .error
                    .map(|e| format!("{}: {}\n{}", e.error_type, e.message, e.traceback))
                    .unwrap_or_default();

                let trunc = |s: &str, max_len: usize| -> String {
                    if s.len() <= max_len {
                        s.to_string()
                    } else {
                        let keep = max_len / 2;
                        format!(
                            "{} ...\n[TRUNCATED]\n... {}",
                            &s[..keep],
                            &s[s.len() - keep..]
                        )
                    }
                };

                let feedback = self
                    .config
                    .feedback_prompt_template
                    .replace("{stage}", &harness_res.stage)
                    .replace("{error}", &trunc(&error_detail, 2000))
                    .replace("{stdout}", &trunc(&harness_res.stdout, 1500))
                    .replace("{script}", &trunc(&script, 6000));

                messages.push(ChatMessage {
                    role: "user".to_string(),
                    content: feedback,
                });
            }
        }

        Ok(AgentResult {
            success: false,
            attempts: attempts_record,
        })
    }
}

fn extract_python_code(text: &str) -> String {
    let mut script = String::new();
    let mut in_block = false;

    for line in text.lines() {
        if line.starts_with("```python") || line.starts_with("``` python") {
            in_block = true;
            continue;
        } else if line.starts_with("```") && in_block {
            break;
        }

        if in_block {
            script.push_str(line);
            script.push('\n');
        }
    }

    script
}
