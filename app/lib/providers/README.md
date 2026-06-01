# 自定义 Provider 适配层

本模块把应用内部的三类 AI 能力统一成可配置 provider：

- `image`：图片生成、图生图、扩图、Tiles / Sprite / Props 绘制。
- `text`：纯文本规划，例如场景 brief、道具创意 brief。
- `vision`：带图片输入的评审，例如 Tiles QA、Sprite QA。

默认配置保持原项目行为：三类能力都使用 OpenRouter 的 chat completions 协议。用户可以在前端 Settings 中为每类能力分别配置协议、base URL、API key 和模型。

## 支持的协议

- `openrouter-chat-completions`：OpenRouter 风格的 `/chat/completions`，图片生成请求会带 `modalities` 和 `image_config`，适合 Nano Banana / Gemini 图像模型。
- `openai-chat-completions`：OpenAI-compatible `/chat/completions`，适合只需要文本或视觉评审的兼容网关。
- `openai-responses`：OpenAI Responses 风格 `/responses`，图片生成走 `image_generation` 工具，适合 GPT Image 系列与支持 Responses 协议的自定义网关。
- `openai-images`：OpenAI Images 风格 `/images/generations`，仅用于纯文生图；带输入图的工作流会要求改用 Responses 或 chat image 协议。

## 环境变量覆盖

前端传入的 provider 配置优先。没有前端配置时，服务端按能力读取环境变量：

- `IMAGE_PROVIDER_PROTOCOL` / `TEXT_PROVIDER_PROTOCOL` / `VISION_PROVIDER_PROTOCOL`
- `IMAGE_PROVIDER_BASE_URL` / `TEXT_PROVIDER_BASE_URL` / `VISION_PROVIDER_BASE_URL`
- `IMAGE_PROVIDER_API_KEY` / `TEXT_PROVIDER_API_KEY` / `VISION_PROVIDER_API_KEY`
- `IMAGE_PROVIDER_MODEL` / `TEXT_PROVIDER_MODEL` / `VISION_PROVIDER_MODEL`

如果这些变量都没有设置，会回退到兼容旧版本的 `OPENROUTER_API_KEY` 和请求里的模型字段。
