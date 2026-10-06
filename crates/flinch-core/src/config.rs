use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlenderConfig {
    pub bin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub api_key_env: String,
    pub max_concurrency: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub blender: BlenderConfig,
    pub provider: ProviderConfig,
}
