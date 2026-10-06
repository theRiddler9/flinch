use crate::error::Result;
use futures_core::Stream;
use serde::{Deserialize, Serialize};

pub mod openai_compat;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
}

#[derive(Debug, Clone)]
pub struct Chunk {
    pub content: String,
}

#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    async fn stream_chat(
        &self,
        req: ChatRequest,
    ) -> Result<std::pin::Pin<Box<dyn Stream<Item = Result<Chunk>> + Send>>>;
}
