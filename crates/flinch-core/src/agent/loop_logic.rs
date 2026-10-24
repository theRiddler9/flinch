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
        log_cb: F,
        token_cb: T,
    ) -> Result<AgentResult>
    where
        F: FnMut(String) -> Fut1,
        Fut1: std::future::Future<Output = ()> + Send,
        T: FnMut(String) -> Fut2,
        Fut2: std::future::Future<Output = ()> + Send,
    {
        self.run_task_with_prompts(
            user_prompt,
            spec,
            &self.config.system_prompt,
            &self.config.feedback_prompt_template,
            log_cb,
            token_cb,
        )
        .await
    }

    /// Run with caller-supplied prompts (hot-reload support — reads fresh from disk each call).
    pub async fn run_task_with_prompts<F, Fut1, T, Fut2>(
        &self,
        user_prompt: &str,
        spec: Option<&str>,
        system_prompt: &str,
        feedback_prompt_template: &str,
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
                content: system_prompt.to_string(),
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

            let mut raw_response = String::new();
            let mut stream_err = None;

            for retry in 0..3 {
                let req = ChatRequest {
                    messages: messages.clone(),
                    temperature: 0.2, // low temp for coding
                    max_tokens: None,
                };

                let stream_res = self.provider.stream_chat(req).await;
                let mut stream = match stream_res {
                    Ok(s) => s,
                    Err(e) => {
                        stream_err = Some(e.to_string());
                        raw_response.clear();
                        tokio::time::sleep(std::time::Duration::from_millis(500 * (retry + 1)))
                            .await;
                        continue;
                    }
                };

                raw_response.clear();
                let mut chunk_err = false;
                while let Some(chunk_res) = stream.next().await {
                    match chunk_res {
                        Ok(chunk) => {
                            raw_response.push_str(&chunk.content);
                            token_cb(chunk.content).await;
                        }
                        Err(e) => {
                            stream_err = Some(e.to_string());
                            chunk_err = true;
                            raw_response.clear();
                            // Signal token_cb to reset UI tokens before retrying
                            token_cb("\x1b[RESET]".to_string()).await;
                            break;
                        }
                    }
                }

                if !chunk_err && !raw_response.trim().is_empty() {
                    stream_err = None;
                    break;
                } else if chunk_err {
                    raw_response.clear();
                }
                tokio::time::sleep(std::time::Duration::from_millis(500 * (retry + 1))).await;
            }

            if stream_err.is_some() || raw_response.trim().is_empty() {
                let err_msg = stream_err.unwrap_or_else(|| {
                    "Provider returned empty response after retries".to_string()
                });
                let full_err = format!("Network or provider error: {}", err_msg);
                attempts_record.push(AttemptRecord {
                    prompt: user_prompt.to_string(),
                    raw_response: raw_response.clone(),
                    script: "".to_string(),
                    harness_result: None,
                });
                messages.push(ChatMessage {
                    role: "user".to_string(),
                    content: full_err,
                });
                continue 'attempt_loop;
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
                    content: "No Python code block found in your response. Reply with the manual guide, then the complete script in a single ```python block under \"### \u{1F40D} Executable Blender Python (bpy) Script\".".to_string(),
                });
                continue;
            }

            let harness_res = match self
                .runner
                .run_script(&script, spec, None, &mut log_cb)
                .await
            {
                Ok(res) => res,
                Err(e) => {
                    log_cb(format!("[runner error] {}", e)).await;
                    HarnessResult {
                        schema: 1,
                        ok: false,
                        stage: "runner_error".to_string(),
                        error: Some(crate::harness::ErrorDetail {
                            error_type: "RunnerError".to_string(),
                            message: e.to_string(),
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
                            frame_range: (1, 120),
                            fps: 24,
                            keyframe_count: 0,
                        },
                        checks: vec![],
                        duration_ms: 0,
                        rewritten_script: None,
                    }
                }
            };

            let final_script = if let Some(ref rw) = harness_res.rewritten_script {
                rw.clone()
            } else {
                script.clone()
            };

            attempts_record.push(AttemptRecord {
                prompt: user_prompt.to_string(),
                raw_response: raw_response.clone(),
                script: final_script,
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

                let feedback = feedback_prompt_template
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

/// One fenced code block found in a model reply.
struct FencedBlock {
    /// Lower-cased first word of the info string (`python`, `text`, ...); empty when untagged.
    lang: String,
    body: String,
    /// False when the reply ended before the closing fence (truncated output).
    closed: bool,
}

fn is_python_lang(lang: &str) -> bool {
    matches!(lang, "python" | "py" | "python3" | "py3" | "bpy")
}

/// Splits a reply into fenced code blocks, following CommonMark's fence rules closely enough for
/// LLM output: a fence is 3+ backticks (no backticks in its info string), and only a bare fence
/// at least as long closes it, so longer outer fences can contain shorter inner ones. Indent on
/// a fence (e.g. inside a list item) is removed from its content.
fn parse_fenced_blocks(text: &str) -> Vec<FencedBlock> {
    struct Open {
        fence_len: usize,
        indent: usize,
        lang: String,
        body: String,
    }

    let mut blocks = Vec::new();
    let mut open: Option<Open> = None;

    for line in text.lines() {
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        let ticks = trimmed.chars().take_while(|c| *c == '`').count();

        if let Some(cur) = open.as_mut() {
            if ticks >= cur.fence_len && trimmed[ticks..].trim().is_empty() {
                if let Some(done) = open.take() {
                    blocks.push(FencedBlock {
                        lang: done.lang,
                        body: done.body,
                        closed: true,
                    });
                }
            } else {
                cur.body.push_str(&line[indent.min(cur.indent)..]);
                cur.body.push('\n');
            }
        } else if ticks >= 3 && !trimmed[ticks..].contains('`') {
            let lang = trimmed[ticks..]
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_start_matches('{')
                .trim_start_matches('.')
                .trim_end_matches('}')
                .to_lowercase();
            open = Some(Open {
                fence_len: ticks,
                indent,
                lang,
                body: String::new(),
            });
        }
    }

    if let Some(done) = open {
        blocks.push(FencedBlock {
            lang: done.lang,
            body: done.body,
            closed: false,
        });
    }
    blocks
}

/// Returns the script to execute: the contents of the fenced Python block only.
///
/// Replies hold a manual modeling guide (headings, steps, inline code, maybe other fenced blocks)
/// followed by the script; none of that may reach the harness. Selection order, so a stray
/// snippet in the guide never beats the real script:
///   1. the last closed python block that imports `bpy`
///   2. the last closed python block
///   3. a python block cut off by truncation (no closing fence)
///   4. the last untagged closed block that imports `bpy`
///
/// Returns an empty string when nothing qualifies.
fn extract_python_code(text: &str) -> String {
    let blocks = parse_fenced_blocks(text);
    let imports_bpy = |b: &FencedBlock| {
        b.body.lines().any(|l| {
            let l = l.trim_start();
            l.starts_with("import bpy") || l.starts_with("from bpy")
        })
    };
    let python = |b: &&FencedBlock| is_python_lang(&b.lang);

    blocks
        .iter()
        .rev()
        .filter(python)
        .find(|b| b.closed && imports_bpy(b))
        .or_else(|| blocks.iter().rev().filter(python).find(|b| b.closed))
        .or_else(|| blocks.iter().rev().filter(python).find(|b| !b.closed))
        .or_else(|| {
            blocks
                .iter()
                .rev()
                .find(|b| b.lang.is_empty() && b.closed && imports_bpy(b))
        })
        .map(|b| b.body.clone())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::extract_python_code as x;

    const GUIDE: &str = "### \u{1F6E0}\u{FE0F} Manual Blender Step-by-Step Modeling Guide\n\
1. **Add a cube.** `Shift + A > Mesh > Cube`, then `Tab` for Edit Mode.\n\
2. **Bevel it.** `Ctrl + B`.\n\
\n\
**Tips for making it your own**\n\
- Add a `Ctrl + R` loop cut.\n\
\n\
### \u{1F40D} Executable Blender Python (bpy) Script\n";

    #[test]
    fn isolates_script_from_guide_headings_and_trailing_text() {
        let text = format!(
            "{GUIDE}```python\nimport bpy\nx = 1\n```\nHope this helps! `Ctrl + Z` undoes.\n"
        );
        let script = x(&text);
        assert_eq!(script, "import bpy\nx = 1\n");
        assert!(
            !script.contains("Manual") && !script.contains("###") && !script.contains("Shift + A")
        );
    }

    #[test]
    fn ignores_other_fenced_blocks() {
        let text = format!(
            "{GUIDE}```text\nShift + A\n```\n```bash\nblender -b\n```\n```json\n{{\"a\": 1}}\n```\n```python\nimport bpy\nx = 1\n```\n"
        );
        assert_eq!(x(&text), "import bpy\nx = 1\n");
    }

    #[test]
    fn real_script_wins_over_snippets_and_last_bpy_block_wins() {
        let snippet = "```python\nobj.location.z = 2\n```\n```python\nimport bpy\nreal = 1\n```\n";
        assert_eq!(x(snippet), "import bpy\nreal = 1\n");
        let two = "```python\nimport bpy\nold = 1\n```\n```python\nimport bpy\nnew = 2\n```\n";
        assert_eq!(x(two), "import bpy\nnew = 2\n");
    }

    #[test]
    fn longer_outer_fence_keeps_inner_fences_as_content() {
        let text = "````python\nimport bpy\ns = \"\"\"\n```\n\"\"\"\n````\n";
        assert_eq!(x(text), "import bpy\ns = \"\"\"\n```\n\"\"\"\n");
    }

    #[test]
    fn indented_fence_in_a_list_is_dedented() {
        let text = "1. Do this:\n   ```python\n   import bpy\n   if True:\n       pass\n   ```\n";
        assert_eq!(x(text), "import bpy\nif True:\n    pass\n");
    }

    #[test]
    fn language_aliases_and_lookalikes() {
        assert_eq!(x("```py\nimport bpy\n```\n"), "import bpy\n");
        assert_eq!(x("```Python3\nimport bpy\n```\n"), "import bpy\n");
        assert_eq!(
            x("```python title=\"a.py\"\nimport bpy\n```\n"),
            "import bpy\n"
        );
        assert_eq!(x("```{.python}\nimport bpy\n```\n"), "import bpy\n");
        assert_eq!(x("```pythonic\nimport bpy\n```\n"), "");
        assert_eq!(x("```pyrex\nimport bpy\n```\n"), "");
    }

    #[test]
    fn handles_crlf_line_endings() {
        assert_eq!(
            x("### Guide\r\n1. Step\r\n```python\r\nimport bpy\r\nx = 1\r\n```\r\n"),
            "import bpy\nx = 1\n"
        );
    }

    #[test]
    fn truncated_reply_returns_partial_script_but_closed_block_wins() {
        let text = format!("{GUIDE}```python\nimport bpy\nbpy.ops.mesh.primitive_cube_add(");
        assert_eq!(x(&text), "import bpy\nbpy.ops.mesh.primitive_cube_add(\n");
        let both = "```python\nimport bpy\nok = 1\n```\n```python\nimport bpy\nbroken = (";
        assert_eq!(x(both), "import bpy\nok = 1\n");
    }

    #[test]
    fn untagged_block_only_when_it_imports_bpy() {
        assert_eq!(x("```\nimport bpy\nx = 1\n```\n"), "import bpy\nx = 1\n");
        assert_eq!(x("```\njust notes\n```\n"), "");
    }

    #[test]
    fn guide_only_and_inline_code_never_count() {
        assert_eq!(x(GUIDE), "");
        assert_eq!(x(""), "");
        assert_eq!(
            x("```inline``` is a span.\n```python\nimport bpy\n```\n"),
            "import bpy\n"
        );
        assert_eq!(
            x("Use ```inline``` and `Ctrl + B`.\n```python\nimport bpy\n```\n"),
            "import bpy\n"
        );
    }
}
