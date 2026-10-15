use serde::{Deserialize, Serialize};

fn default_concurrency() -> usize {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlenderConfig {
    pub bin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub kind: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_key_env: String,
    #[serde(default = "default_concurrency")]
    pub max_concurrency: usize,
}

impl ProviderConfig {
    /// Resolves the API key using:
    /// 1. Direct `api_key` in config if non-empty
    /// 2. Value of environment variable specified in `api_key_env`
    /// 3. Standard fallback environment variables (NVIDIA_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY)
    pub fn resolve_api_key(&self) -> String {
        if let Some(ref key) = self.api_key {
            let trimmed = key.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }

        if !self.api_key_env.trim().is_empty() {
            if let Ok(val) = std::env::var(self.api_key_env.trim()) {
                let trimmed = val.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }

        for env_var in [
            "NVIDIA_API_KEY",
            "OPENAI_API_KEY",
            "GROQ_API_KEY",
            "OPENROUTER_API_KEY",
        ] {
            if let Ok(val) = std::env::var(env_var) {
                let trimmed = val.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }

        String::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub blender: BlenderConfig,
    pub provider: ProviderConfig,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_direct_api_key() {
        let cfg = ProviderConfig {
            kind: "openai_compatible".to_string(),
            base_url: "https://integrate.api.nvidia.com/v1".to_string(),
            model: "meta/llama-3.3-70b-instruct".to_string(),
            api_key: Some("nvapi-test-key".to_string()),
            api_key_env: "".to_string(),
            max_concurrency: 1,
        };
        assert_eq!(cfg.resolve_api_key(), "nvapi-test-key");
    }

    #[test]
    fn test_resolve_api_key_env() {
        std::env::set_var("TEST_NIM_KEY", "nvapi-from-env");
        let cfg = ProviderConfig {
            kind: "openai_compatible".to_string(),
            base_url: "https://integrate.api.nvidia.com/v1".to_string(),
            model: "meta/llama-3.3-70b-instruct".to_string(),
            api_key: None,
            api_key_env: "TEST_NIM_KEY".to_string(),
            max_concurrency: 1,
        };
        assert_eq!(cfg.resolve_api_key(), "nvapi-from-env");
        std::env::remove_var("TEST_NIM_KEY");
    }

    #[test]
    fn test_resolve_empty_fallback() {
        let cfg = ProviderConfig {
            kind: "openai_compatible".to_string(),
            base_url: "http://localhost:11434/v1".to_string(),
            model: "qwen3.5:9b".to_string(),
            api_key: Some("  ".to_string()),
            api_key_env: "".to_string(),
            max_concurrency: 1,
        };
        // If neither direct key nor env var exists, returns empty string or fallback
        assert_eq!(cfg.resolve_api_key(), "");
    }
}
