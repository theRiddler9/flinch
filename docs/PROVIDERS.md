# Provider Configuration Guide

Flinch connects to any LLM service exposing an **OpenAI-compatible** `/v1/chat/completions` endpoint.

You can configure your provider in `flinch.toml`, in the desktop Preferences modal (**Model & API** tab), or via environment variables.

---

## 1. NVIDIA NIM (Recommended Cloud Provider)

NVIDIA NIM provides hosted API endpoints for frontier open models like Llama 3.3 70B, Mistral, and DeepSeek.

1. Create a free account at [build.nvidia.com](https://build.nvidia.com/).
2. Generate an API key starting with `nvapi-...`.
3. In `flinch.toml`:
   ```toml
   [provider]
   kind = "openai_compatible"
   base_url = "https://integrate.api.nvidia.com/v1"
   model = "meta/llama-3.3-70b-instruct"
   api_key = "nvapi-..."  # Paste your key here
   api_key_env = "NVIDIA_API_KEY"
   max_concurrency = 1
   ```
   Or set the environment variable:
   ```bash
   export NVIDIA_API_KEY="nvapi-..."
   ```

**Popular Models on NVIDIA NIM:**
- `meta/llama-3.3-70b-instruct` (Fast, highly capable with Python/bpy)
- `mistralai/mixtral-8x22b-instruct-v0.1`
- `deepseek-ai/deepseek-r1`

---

## 2. Groq

1. Obtain an API key from [console.groq.com](https://console.groq.com/).
2. Configure `flinch.toml`:
   ```toml
   [provider]
   kind = "openai_compatible"
   base_url = "https://api.groq.com/openai/v1"
   model = "llama-3.3-70b-versatile"
   api_key = "gsk_..."
   api_key_env = "GROQ_API_KEY"
   max_concurrency = 1
   ```

---

## 3. OpenRouter

1. Obtain an API key from [openrouter.ai](https://openrouter.ai/).
2. Configure `flinch.toml`:
   ```toml
   [provider]
   kind = "openai_compatible"
   base_url = "https://openrouter.ai/api/v1"
   model = "anthropic/claude-3.5-sonnet"
   api_key = "sk-or-..."
   api_key_env = "OPENROUTER_API_KEY"
   max_concurrency = 1
   ```

---

## 4. Local Ollama (Zero Cost)

1. Run Ollama locally: `ollama run qwen2.5-coder:7b`
2. Configure `flinch.toml`:
   ```toml
   [provider]
   kind = "openai_compatible"
   base_url = "http://localhost:11434/v1"
   model = "qwen2.5-coder:7b"
   api_key = ""
   api_key_env = ""
   max_concurrency = 1
   ```
