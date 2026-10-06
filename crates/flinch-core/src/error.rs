use thiserror::Error;

#[derive(Error, Debug)]
pub enum FlinchError {
    #[error("Provider error: {0}")]
    ProviderError(String),

    #[error("Blender execution timeout")]
    RunnerTimeout,

    #[error("Runner error: {0}")]
    RunnerError(String),

    #[error("Database error: {0}")]
    DbError(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),
}

pub type Result<T> = std::result::Result<T, FlinchError>;
