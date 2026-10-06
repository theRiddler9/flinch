use super::{ChatRequest, Chunk, LlmProvider};
use crate::error::{FlinchError, Result};
use futures_core::Stream;
use futures_util::stream::StreamExt;
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::sleep;

pub struct OpenAiCompatProvider {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub client: Client,
}

impl OpenAiCompatProvider {
    pub fn new(base_url: String, model: String, api_key: String) -> Self {
        Self {
            base_url,
            model,
            api_key,
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .unwrap(),
        }
    }
}

#[derive(Serialize)]
struct OpenAiRequest<'a> {
    model: &'a str,
    messages: &'a [super::ChatMessage],
    temperature: f32,
    stream: bool,
}

#[derive(Deserialize, Debug)]
struct OpenAiResponseChunk {
    choices: Vec<ChoiceChunk>,
}

#[derive(Deserialize, Debug)]
struct ChoiceChunk {
    delta: Delta,
}

#[derive(Deserialize, Debug)]
struct Delta {
    content: Option<String>,
}

#[async_trait::async_trait]
impl LlmProvider for OpenAiCompatProvider {
    async fn stream_chat(
        &self,
        req: ChatRequest,
    ) -> Result<std::pin::Pin<Box<dyn Stream<Item = Result<Chunk>> + Send>>> {
        let url = format!("{}/chat/completions", self.base_url);
        let request_body = OpenAiRequest {
            model: &self.model,
            messages: &req.messages,
            temperature: req.temperature,
            stream: true,
        };

        let mut retries = 0;
        let max_retries = 5;

        loop {
            let req_builder = self
                .client
                .post(&url)
                .bearer_auth(&self.api_key)
                .json(&request_body);

            let response = req_builder.send().await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    let mut byte_stream = resp.bytes_stream();
                    let stream = async_stream::stream! {
                        let mut buffer = String::new();
                        while let Some(chunk_res) = byte_stream.next().await {
                            match chunk_res {
                                Ok(bytes) => {
                                    if let Ok(text) = std::str::from_utf8(&bytes) {
                                        buffer.push_str(text);
                                        while let Some(pos) = buffer.find("\n\n") {
                                            let event = buffer[..pos].to_string();
                                            buffer = buffer[pos + 2..].to_string();

                                            for line in event.split('\n') {
                                                if let Some(data) = line.strip_prefix("data: ") {
                                                    if data.trim() == "[DONE]" {
                                                        break;
                                                    }
                                                    if let Ok(parsed) = serde_json::from_str::<OpenAiResponseChunk>(data) {
                                                        if let Some(choice) = parsed.choices.first() {
                                                            if let Some(content) = &choice.delta.content {
                                                                yield Ok(Chunk { content: content.clone() });
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    yield Err(FlinchError::ProviderError(e.to_string()));
                                }
                            }
                        }
                    };
                    return Ok(Box::pin(stream));
                }
                Ok(resp) => {
                    let status = resp.status();
                    if status.as_u16() == 429 || status.is_server_error() {
                        if retries >= max_retries {
                            return Err(FlinchError::ProviderError(format!(
                                "HTTP error {}",
                                status
                            )));
                        }
                        let base_backoff = 2u64.pow(retries as u32) * 1000;
                        let jitter: u64 = rand::thread_rng().gen_range(0..1000);
                        sleep(Duration::from_millis(base_backoff + jitter)).await;
                        retries += 1;
                    } else {
                        let text = resp.text().await.unwrap_or_default();
                        return Err(FlinchError::ProviderError(format!(
                            "HTTP error {}: {}",
                            status, text
                        )));
                    }
                }
                Err(e) => {
                    if retries >= max_retries {
                        return Err(FlinchError::ProviderError(e.to_string()));
                    }
                    let base_backoff = 2u64.pow(retries as u32) * 1000;
                    let jitter: u64 = rand::thread_rng().gen_range(0..1000);
                    sleep(Duration::from_millis(base_backoff + jitter)).await;
                    retries += 1;
                }
            }
        }
    }
}
