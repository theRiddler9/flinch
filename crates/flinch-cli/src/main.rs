use clap::{Parser, Subcommand};
use flinch_core::agent::loop_logic::{Agent, AgentConfig};
use flinch_core::provider::openai_compat::OpenAiCompatProvider;
use flinch_core::runner::process::{Runner, RunnerConfig};
use serde::Deserialize;
use std::fs;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Doctor,
    Harness {
        script: String,
    },
    Run {
        prompt: String,
    },
    Eval {
        #[arg(long)]
        tier: Option<String>,
        #[arg(long)]
        id: Option<String>,
        #[arg(long)]
        provider: Option<String>,
        #[arg(long)]
        model: Option<String>,
    },
}

#[derive(Deserialize, Debug)]
struct EvalPrompt {
    id: String,
    tier: String,
    prompt: String,
    #[serde(default)]
    checks: serde_json::Value,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Doctor => {
            println!("Doctor: checking dependencies...");
            let config_str = fs::read_to_string("flinch.toml").unwrap_or_default();
            let app_config: Option<flinch_core::config::AppConfig> =
                toml::from_str(&config_str).ok();

            if let Some(cfg) = app_config {
                println!("- Blender configured bin: {}", cfg.blender.bin);
                let api_key = cfg.provider.resolve_api_key();
                let key_status = if api_key.is_empty() {
                    "None (local or unauthenticated)"
                } else {
                    "Present (configured)"
                };
                println!(
                    "- Provider: {} ({})",
                    cfg.provider.base_url, cfg.provider.model
                );
                println!("- API Key status: {}", key_status);

                let client = reqwest::Client::new();
                let url = format!("{}/models", cfg.provider.base_url.trim_end_matches('/'));
                let mut req = client.get(&url);
                if !api_key.is_empty() {
                    req = req.header("Authorization", format!("Bearer {}", api_key));
                }
                match req.send().await {
                    Ok(resp) => {
                        if resp.status().is_success() {
                            println!(
                                "  [OK] Provider reachable and authenticated (HTTP {}).",
                                resp.status()
                            );
                        } else {
                            println!("  [WARN] Provider returned status: HTTP {}", resp.status());
                        }
                    }
                    Err(e) => {
                        println!("  [WARN] Provider connection error: {}", e);
                    }
                }
            } else {
                println!("- Warning: flinch.toml not found or invalid.");
            }
            println!("Doctor check completed.");
        }
        Commands::Harness { script } => {
            let config_str = fs::read_to_string("flinch.toml").unwrap_or_default();
            let app_config: Option<flinch_core::config::AppConfig> =
                toml::from_str(&config_str).ok();
            let blender_bin = app_config
                .map(|c| c.blender.bin)
                .unwrap_or_else(|| "blender".to_string());

            let runner = Runner::new(RunnerConfig {
                blender_bin,
                timeout_sec: 60,
            });
            let code = fs::read_to_string(&script)?;
            let res = runner
                .run_script(&code, None, None, |log| async move {
                    println!("{}", log);
                })
                .await?;
            println!("Harness result: {:#?}", res);
        }
        Commands::Run { prompt } => {
            let agent = setup_agent(None, None)?;
            let res = agent
                .run_task(
                    &prompt,
                    None,
                    |log| async move {
                        println!("{}", log);
                    },
                    |token| async move {
                        use std::io::Write;
                        print!("{}", token);
                        let _ = std::io::stdout().flush();
                    },
                )
                .await?;
            println!("Run completed. Success: {}", res.success);
        }
        Commands::Eval {
            tier,
            id,
            model,
            provider,
        } => {
            let model_name = model.clone().unwrap_or_else(|| "llama3".to_string());
            let agent = setup_agent(model, provider)?;
            let prompts_data = fs::read_to_string("evals/prompts.json")?;
            let mut eval_prompts: Vec<EvalPrompt> = serde_json::from_str(&prompts_data)?;

            if let Some(ref t) = tier {
                eval_prompts.retain(|p| p.tier == *t);
            }
            if let Some(ref i) = id {
                eval_prompts.retain(|p| p.id == *i);
            }

            println!("Starting eval on {} prompts...", eval_prompts.len());

            let mut executes_at_1 = 0;
            let mut pass_at_1 = 0;
            let mut pass_at_3 = 0;

            let mut results_json = Vec::new();

            for ep in eval_prompts.iter() {
                println!("Evaluating prompt {}: {}", ep.id, ep.prompt);
                let spec_str = if ep.checks.is_null() {
                    None
                } else {
                    Some(serde_json::to_string(&ep.checks)?)
                };
                let res = agent
                    .run_task(
                        &ep.prompt,
                        spec_str.as_deref(),
                        |_log| async move {},
                        |_token| async move {},
                    )
                    .await?;

                if let Some(first) = res.attempts.first() {
                    if let Some(hr) = &first.harness_result {
                        if hr.stage != "syntax" && hr.stage != "runtime" && hr.stage != "timeout" {
                            executes_at_1 += 1;
                        }
                    }
                }

                if res.success {
                    if res.attempts.len() == 1 {
                        pass_at_1 += 1;
                    }
                    pass_at_3 += 1;
                }

                results_json.push(res);
            }

            let total = eval_prompts.len();
            println!("\nEval Results:");
            println!("Total: {}", total);
            println!(
                "Executes@1: {} ({}%)",
                executes_at_1,
                (executes_at_1 * 100_usize).checked_div(total).unwrap_or(0)
            );
            println!(
                "Pass@1: {} ({}%)",
                pass_at_1,
                (pass_at_1 * 100_usize).checked_div(total).unwrap_or(0)
            );
            println!(
                "Pass@3: {} ({}%)",
                pass_at_3,
                (pass_at_3 * 100_usize).checked_div(total).unwrap_or(0)
            );

            // Write results
            fs::create_dir_all("evals/results")?;
            let ts = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
            let res_file = format!("evals/results/{}.json", ts);
            let res_str = serde_json::to_string_pretty(&results_json)?;
            fs::write(&res_file, res_str)?;

            println!("Detailed results written to {}", res_file);

            // Generate Markdown table
            fs::create_dir_all("docs")?;
            let mut md = String::new();
            md.push_str("# Evals\n\n");
            md.push_str("| Model | Tier | n | executes@1 | pass@1 | pass@3 (feedback) |\n");
            md.push_str("|-------|------|---|------------|--------|-------------------|\n");

            let tier_name = tier.unwrap_or_else(|| "all".to_string());

            md.push_str(&format!(
                "| {} | {} | {} | {} | {} | {} |\n",
                model_name, tier_name, total, executes_at_1, pass_at_1, pass_at_3
            ));
            fs::write("docs/EVALS.md", md)?;
            println!("Summary written to docs/EVALS.md");
        }
    }

    Ok(())
}

fn setup_agent(
    model_override: Option<String>,
    provider_override: Option<String>,
) -> anyhow::Result<Agent> {
    let system_prompt = fs::read_to_string("prompts/system.md").unwrap_or_default();
    let feedback_prompt = fs::read_to_string("prompts/feedback.md").unwrap_or_default();

    let config_str = fs::read_to_string("flinch.toml").unwrap_or_default();
    let app_config: Option<flinch_core::config::AppConfig> = toml::from_str(&config_str).ok();

    let (mut base_url, mut model, api_key, blender_bin, max_tokens) = match app_config {
        Some(cfg) => {
            let key = cfg.provider.resolve_api_key();
            (
                cfg.provider.base_url,
                cfg.provider.model,
                key,
                cfg.blender.bin,
                cfg.provider.max_tokens,
            )
        }
        None => {
            let key = std::env::var("NVIDIA_API_KEY")
                .or_else(|_| std::env::var("OPENAI_API_KEY"))
                .unwrap_or_default();
            (
                "http://localhost:11434/v1".to_string(),
                "llama3".to_string(),
                key,
                "blender".to_string(),
                None,
            )
        }
    };

    if let Some(m) = model_override {
        model = m;
    }
    if let Some(p) = provider_override {
        base_url = p;
    }

    let provider = OpenAiCompatProvider::new(base_url, model, api_key).with_max_tokens(max_tokens);

    let runner = Runner::new(RunnerConfig {
        blender_bin,
        timeout_sec: 60,
    });

    let config = AgentConfig {
        max_attempts: 3,
        system_prompt,
        feedback_prompt_template: feedback_prompt,
    };

    Ok(Agent::new(Arc::new(provider), Arc::new(runner), config))
}
