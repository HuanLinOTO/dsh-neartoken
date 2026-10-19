/**
 * Generated from @earendil-works/pi-ai@1.1.0. Run node scripts/gen-model-caps.mjs; do not edit.
 *
 * CHAT_MODELS is every chat model the catalog describes. TIER_SETS holds each
 * distinct reasoning level list once; MODEL_TIERS points models at one of them.
 * Level names are the catalog own wire spellings. MODEL_CONTEXT_WINDOW is the
 * smallest context window the catalog states for the model, used only when
 * neither the site nor the plugin configuration answers.
 */

/** Distinct reasoning level lists. */
export const TIER_SETS: readonly (readonly string[])[] = [
  ['max'],
  ['max', 'minimal'],
  ['minimal', 'low', 'medium'],
  ['minimal', 'low', 'medium', 'high'],
  ['minimal', 'low', 'medium', 'high', 'max'],
  ['minimal', 'low', 'medium', 'high', 'xhigh'],
  ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  ['xhigh'],
  ['xhigh', 'max'],
  ['xhigh', 'max', 'minimal'],
]

/** Model id -> the index in TIER_SETS describing its reasoning levels. */
export const MODEL_TIERS: Readonly<Record<string, number>> = {
  '@cf/deepseek-ai/deepseek-v4-flash-0731': 4,
  '@cf/deepseek-ai/deepseek-v4-pro-0813': 4,
  '@cf/google/gemma-4-26b-a4b-it': 6,
  '@cf/moonshotai/kimi-k2.6': 6,
  '@cf/nvidia/nemotron-3-120b-a12b': 6,
  '@cf/openai/gpt-oss-120b': 6,
  '@cf/openai/gpt-oss-20b': 6,
  '@cf/qwen/qwen3.8-27b': 6,
  '@cf/zai-org/glm-5.2': 6,
  '@cf/zai-org/glm-5.3': 6,
  '@cf/zai-org/glm-5.3-flash': 6,
  'MiniMaxAI/MiniMax-M2.7': 2,
  'MiniMaxAI/MiniMax-M3': 2,
  'Qwen/Qwen3-VL-235B-A22B-Thinking': 6,
  'Qwen/Qwen3.5-397B-A17B': 6,
  'Qwen/Qwen3.5-9B': 2,
  'Qwen/Qwen3.6-Plus': 2,
  'Qwen/Qwen3.8-2.4T-A95B': 6,
  'Qwen/Qwen3.8-27B': 6,
  'Ring-2.6-1T': 5,
  'XiaomiMiMo/MiMo-V2.5': 6,
  'XiaomiMiMo/MiMo-V2.5-Pro': 6,
  'accounts/fireworks/models/deepseek-v4p1-flash': 6,
  'accounts/fireworks/models/ember-1': 6,
  'accounts/fireworks/models/glm-5p3': 6,
  'accounts/fireworks/models/glm-5p3-flash': 6,
  'accounts/fireworks/models/gpt-oss-120b': 6,
  'accounts/fireworks/models/kimi-k3': 6,
  'accounts/fireworks/models/minimax-m3': 6,
  'accounts/fireworks/models/qwen3p8-2p4t-a95b': 6,
  'accounts/fireworks/models/qwen3p8-max': 6,
  'accounts/fireworks/routers/deepseek-flash-latest': 6,
  'accounts/fireworks/routers/glm-5p3-fast': 6,
  'accounts/fireworks/routers/glm-fast-latest': 6,
  'accounts/fireworks/routers/glm-flash-latest': 6,
  'accounts/fireworks/routers/glm-latest': 6,
  'accounts/fireworks/routers/kimi-fast-latest': 6,
  'accounts/fireworks/routers/kimi-k3-fast': 6,
  'accounts/fireworks/routers/kimi-latest': 6,
  'accounts/fireworks/routers/minimax-latest': 6,
  'aion-labs/aion-3.5': 6,
  'aion-labs/aion-3.5-mini': 6,
  'anthropic.claude-fable-5': 8,
  'anthropic.claude-fable-5-1': 8,
  'anthropic.claude-haiku-5-5': 8,
  'anthropic.claude-opus-4-6-v1': 0,
  'anthropic.claude-opus-4-7': 8,
  'anthropic.claude-opus-4-8': 8,
  'anthropic.claude-opus-5-5': 8,
  'anthropic.claude-sonnet-4-6': 0,
  'anthropic.claude-sonnet-5': 8,
  'anthropic.claude-sonnet-5-5': 8,
  'anthropic/claude-fable-5': 6,
  'anthropic/claude-fable-5.1': 6,
  'anthropic/claude-fable-5.1:batch': 6,
  'anthropic/claude-fable-5:batch': 6,
  'anthropic/claude-haiku-5.5': 6,
  'anthropic/claude-haiku-5.5:batch': 6,
  'anthropic/claude-opus-4.6': 6,
  'anthropic/claude-opus-4.6:batch': 6,
  'anthropic/claude-opus-4.7': 6,
  'anthropic/claude-opus-4.7:batch': 6,
  'anthropic/claude-opus-4.8': 6,
  'anthropic/claude-opus-4.8-fast': 8,
  'anthropic/claude-opus-4.8:batch': 6,
  'anthropic/claude-opus-5': 6,
  'anthropic/claude-opus-5-fast': 8,
  'anthropic/claude-opus-5.5': 6,
  'anthropic/claude-opus-5.5-fast': 8,
  'anthropic/claude-opus-5.5:batch': 6,
  'anthropic/claude-opus-5:batch': 6,
  'anthropic/claude-sonnet-4.6': 6,
  'anthropic/claude-sonnet-4.6:batch': 6,
  'anthropic/claude-sonnet-5': 6,
  'anthropic/claude-sonnet-5.5': 6,
  'anthropic/claude-sonnet-5.5:batch': 6,
  'anthropic/claude-sonnet-5:batch': 6,
  'au.anthropic.claude-haiku-5-5': 8,
  'au.anthropic.claude-opus-4-6-v1': 0,
  'au.anthropic.claude-opus-4-7': 8,
  'au.anthropic.claude-opus-4-8': 8,
  'au.anthropic.claude-opus-5': 8,
  'au.anthropic.claude-opus-5-5': 8,
  'au.anthropic.claude-sonnet-4-6': 0,
  'au.anthropic.claude-sonnet-5': 8,
  'balanced': 6,
  'bytedance-seed/seed-2.0-code': 6,
  'bytedance-seed/seed-2.0-lite': 6,
  'bytedance-seed/seed-2.0-mini': 6,
  'cheap': 6,
  'claude-fable-5': 8,
  'claude-fable-5-1': 8,
  'claude-fable-5.1': 8,
  'claude-haiku-5-5': 6,
  'claude-opus-4-6': 0,
  'claude-opus-4-7': 8,
  'claude-opus-4-8': 8,
  'claude-opus-4.7': 9,
  'claude-opus-4.8': 9,
  'claude-opus-5': 9,
  'claude-opus-5-5': 6,
  'claude-opus-5.5': 6,
  'claude-sonnet-4-6': 0,
  'claude-sonnet-4.6': 1,
  'claude-sonnet-5': 8,
  'claude-sonnet-5-5': 6,
  'claude-sonnet-5.5': 8,
  'deepseek-ai/DeepSeek-V4-Flash-0731': 6,
  'deepseek-ai/DeepSeek-V4-Flash-Vision-Exp': 6,
  'deepseek-ai/DeepSeek-V4-Pro': 6,
  'deepseek-ai/DeepSeek-V4-Pro-0813': 6,
  'deepseek-ai/DeepSeek-V4.1-Flash': 6,
  'deepseek-ai/DeepSeek-V4.1-Flash-Fast': 6,
  'deepseek-ai/deepseek-v4.1-flash': 4,
  'deepseek-flash': 4,
  'deepseek-v4-flash': 6,
  'deepseek-v4-flash-0731': 6,
  'deepseek-v4-flash-vision-exp': 6,
  'deepseek-v4-pro': 6,
  'deepseek-v4-pro-0813': 6,
  'deepseek-v4.1-flash': 6,
  'deepseek/deepseek-v4-flash': 6,
  'deepseek/deepseek-v4-flash-0731': 6,
  'deepseek/deepseek-v4-flash-vision-exp': 6,
  'deepseek/deepseek-v4-pro': 6,
  'deepseek/deepseek-v4-pro-0813': 6,
  'deepseek/deepseek-v4.1-flash': 6,
  'deepseek/deepseek-v4.1-flash:batch': 6,
  'eu.anthropic.claude-fable-5': 8,
  'eu.anthropic.claude-haiku-5-5': 8,
  'eu.anthropic.claude-opus-4-6-v1': 0,
  'eu.anthropic.claude-opus-4-7': 8,
  'eu.anthropic.claude-opus-4-8': 8,
  'eu.anthropic.claude-opus-5': 8,
  'eu.anthropic.claude-opus-5-5': 8,
  'eu.anthropic.claude-sonnet-4-6': 0,
  'eu.anthropic.claude-sonnet-5': 8,
  'eu.anthropic.claude-sonnet-5-5': 8,
  'exo-free': 6,
  'fireworks/ember-1': 6,
  'fledge-alpha-free': 6,
  'gemini-3-flash': 6,
  'gemini-3-flash-preview': 6,
  'gemini-3.1-flash-lite': 6,
  'gemini-3.1-flash-lite-image': 6,
  'gemini-3.1-flash-lite-preview': 6,
  'gemini-3.1-flash-live-preview': 6,
  'gemini-3.1-pro': 6,
  'gemini-3.1-pro-preview': 6,
  'gemini-3.1-pro-preview-customtools': 6,
  'gemini-3.5-flash': 6,
  'gemini-3.5-flash-lite': 6,
  'gemini-3.6-flash': 6,
  'gemini-3.7-flash': 6,
  'gemini-3.8-flash': 6,
  'gemini-flash-latest': 6,
  'gemini-flash-lite-latest': 6,
  'gemma-4-26b-a4b-it': 3,
  'gemma-4-31b-it': 3,
  'glm-5': 6,
  'glm-5-2': 6,
  'glm-5.1': 6,
  'glm-5.2': 6,
  'glm-5.2-highspeed': 6,
  'glm-5.3': 6,
  'glm-5.3-flash': 6,
  'glm-5.3-highspeed': 6,
  'global.anthropic.claude-fable-5': 8,
  'global.anthropic.claude-fable-5-1': 8,
  'global.anthropic.claude-haiku-5-5': 8,
  'global.anthropic.claude-opus-4-6-v1': 0,
  'global.anthropic.claude-opus-4-7': 8,
  'global.anthropic.claude-opus-4-8': 8,
  'global.anthropic.claude-opus-5': 8,
  'global.anthropic.claude-opus-5-5': 8,
  'global.anthropic.claude-sonnet-4-6': 0,
  'global.anthropic.claude-sonnet-5': 8,
  'global.anthropic.claude-sonnet-5-5': 8,
  'global.openai.gpt-5.6-luna': 7,
  'global.openai.gpt-5.6-sol': 7,
  'global.openai.gpt-5.6-terra': 7,
  'global.openai.gpt-6-astra': 7,
  'global.openai.gpt-6-luna': 7,
  'global.openai.gpt-6-sol': 7,
  'global.openai.gpt-6.1-sol': 7,
  'google/gemini-3-flash-preview': 6,
  'google/gemini-3-flash-preview:batch': 6,
  'google/gemini-3.1-flash-lite': 6,
  'google/gemini-3.1-flash-lite-preview': 6,
  'google/gemini-3.1-flash-lite:batch': 6,
  'google/gemini-3.1-pro-preview': 6,
  'google/gemini-3.1-pro-preview-customtools': 6,
  'google/gemini-3.1-pro-preview:batch': 6,
  'google/gemini-3.5-flash': 6,
  'google/gemini-3.5-flash-lite': 6,
  'google/gemini-3.5-flash-lite:batch': 6,
  'google/gemini-3.5-flash:batch': 6,
  'google/gemini-3.6-flash': 6,
  'google/gemini-3.6-flash:batch': 6,
  'google/gemini-3.7-flash': 6,
  'google/gemini-3.7-flash:batch': 6,
  'google/gemini-3.8-flash': 6,
  'google/gemini-3.8-flash:batch': 6,
  'google/gemini-nano-banana-2.1': 6,
  'gpt-5': 6,
  'gpt-5-codex': 6,
  'gpt-5-mini': 6,
  'gpt-5-nano': 6,
  'gpt-5-pro': 6,
  'gpt-5.1': 6,
  'gpt-5.1-codex': 6,
  'gpt-5.1-codex-max': 6,
  'gpt-5.1-codex-mini': 6,
  'gpt-5.2': 6,
  'gpt-5.2-chat-latest': 6,
  'gpt-5.2-codex': 6,
  'gpt-5.2-pro': 6,
  'gpt-5.3-chat-latest': 7,
  'gpt-5.3-codex': 6,
  'gpt-5.3-codex-spark': 6,
  'gpt-5.4': 6,
  'gpt-5.4-mini': 6,
  'gpt-5.4-nano': 6,
  'gpt-5.4-pro': 6,
  'gpt-5.5': 6,
  'gpt-5.5-pro': 6,
  'gpt-5.6-luna': 6,
  'gpt-5.6-sol': 6,
  'gpt-5.6-terra': 6,
  'gpt-6-astra': 6,
  'gpt-6-luna': 6,
  'gpt-6-sol': 6,
  'gpt-6.1-sol': 6,
  'gpt-daybreak-blue-latest': 6,
  'gpt-daybreak-red-latest': 6,
  'gpt-oss-120b': 6,
  'gpt-realtime-2.1': 6,
  'grok-4.3': 6,
  'grok-4.5': 6,
  'grok-4.6': 6,
  'grok-4.7': 6,
  'grok-build-0.1': 2,
  'hy3': 6,
  'hy4-preview': 6,
  'ibm-granite/granite-4.2-8b': 6,
  'in.anthropic.claude-opus-5': 8,
  'in.anthropic.claude-sonnet-5': 8,
  'in.openai.gpt-5.6-luna': 7,
  'in.openai.gpt-5.6-terra': 7,
  'inception/mercury-2': 6,
  'inception/mercury-2.5': 6,
  'jp.anthropic.claude-haiku-5-5': 8,
  'jp.anthropic.claude-opus-4-7': 8,
  'jp.anthropic.claude-opus-4-8': 8,
  'jp.anthropic.claude-opus-5': 8,
  'jp.anthropic.claude-opus-5-5': 8,
  'jp.anthropic.claude-sonnet-4-6': 0,
  'jp.anthropic.claude-sonnet-5': 8,
  'k3': 6,
  'k3-256k': 6,
  'kimi-for-coding': 6,
  'kimi-k3': 6,
  'labs-leanstral-1-5-1': 6,
  'magistral-medium-latest': 6,
  'mai-code-1-flash-picker': 6,
  'mai-code-1.1-flash': 6,
  'meta/muse-glimmer-30b': 6,
  'meta/muse-spark-1.1': 6,
  'meta/muse-spark-1.2': 6,
  'meta/muse-spark-1.2-contributor': 6,
  'meta/muse-spark-1.3': 6,
  'meta/muse-spark-1.3-contributor': 6,
  'mistral-large-4': 6,
  'mistral-medium-2604': 6,
  'mistral-medium-3.5': 6,
  'mistral-medium-latest': 6,
  'mistral-small-2603': 6,
  'mistral-small-latest': 6,
  'mistralai/mistral-large-4-0': 6,
  'mistralai/mistral-medium-3-5': 6,
  'mistralai/mistral-medium-3-5:batch': 6,
  'mistralai/mistral-small-2603': 6,
  'mistralai/mistral-small-2603:batch': 6,
  'moonshotai/Kimi-K2.5': 6,
  'moonshotai/Kimi-K2.6': 6,
  'moonshotai/Kimi-K2.7-Code': 6,
  'moonshotai/Kimi-K3': 6,
  'moonshotai/kimi-k3': 6,
  'moonshotai/kimi-k3:batch': 6,
  'muse-spark-1.1': 6,
  'muse-spark-1.2': 6,
  'muse-spark-1.2-contributor': 6,
  'muse-spark-1.3': 6,
  'muse-spark-1.3-contributor': 6,
  'muse-spark-1.3-contributor-free': 6,
  'nex-agi/nex-n2.5-pro': 6,
  'nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B': 6,
  'nvidia/Nemotron-120B-A12B': 6,
  'nvidia/nemotron-3-super-120b-a12b': 6,
  'nvidia/nemotron-3-super-120b-a12b:free': 6,
  'nvidia/nemotron-3-ultra-550b-a55b': 6,
  'nvidia/nemotron-3-ultra-550b-a55b:free': 6,
  'o1': 6,
  'o1-pro': 6,
  'o3': 6,
  'o3-mini': 6,
  'o3-pro': 6,
  'o4-mini': 6,
  'openai.gpt-5.4': 7,
  'openai.gpt-5.5': 7,
  'openai.gpt-5.6-luna': 7,
  'openai.gpt-5.6-sol': 7,
  'openai.gpt-5.6-terra': 7,
  'openai.gpt-6-astra': 7,
  'openai.gpt-6-luna': 7,
  'openai.gpt-6-sol': 7,
  'openai.gpt-6.1-sol': 7,
  'openai/gpt-5': 6,
  'openai/gpt-5-mini': 6,
  'openai/gpt-5-mini:batch': 6,
  'openai/gpt-5-nano': 6,
  'openai/gpt-5-nano:batch': 6,
  'openai/gpt-5-pro': 6,
  'openai/gpt-5-pro:batch': 6,
  'openai/gpt-5.1': 6,
  'openai/gpt-5.1-codex': 6,
  'openai/gpt-5.1-codex-max': 6,
  'openai/gpt-5.1-codex-mini': 6,
  'openai/gpt-5.1:batch': 6,
  'openai/gpt-5.2': 6,
  'openai/gpt-5.2-chat': 7,
  'openai/gpt-5.2-codex': 6,
  'openai/gpt-5.2-fast': 7,
  'openai/gpt-5.2-pro': 6,
  'openai/gpt-5.2-pro:batch': 6,
  'openai/gpt-5.2:batch': 6,
  'openai/gpt-5.3-codex': 6,
  'openai/gpt-5.3-codex-fast': 7,
  'openai/gpt-5.4': 6,
  'openai/gpt-5.4-fast': 7,
  'openai/gpt-5.4-mini': 6,
  'openai/gpt-5.4-mini-fast': 7,
  'openai/gpt-5.4-mini:batch': 6,
  'openai/gpt-5.4-nano': 6,
  'openai/gpt-5.4-nano:batch': 6,
  'openai/gpt-5.4-pro': 6,
  'openai/gpt-5.4-pro:batch': 6,
  'openai/gpt-5.4:batch': 6,
  'openai/gpt-5.5': 6,
  'openai/gpt-5.5-fast': 7,
  'openai/gpt-5.5-pro': 6,
  'openai/gpt-5.5-pro:batch': 6,
  'openai/gpt-5.5:batch': 6,
  'openai/gpt-5.6-luna': 6,
  'openai/gpt-5.6-luna-fast': 7,
  'openai/gpt-5.6-luna-pro': 6,
  'openai/gpt-5.6-luna-pro:batch': 6,
  'openai/gpt-5.6-luna:batch': 6,
  'openai/gpt-5.6-sol': 6,
  'openai/gpt-5.6-sol-fast': 7,
  'openai/gpt-5.6-sol-pro': 6,
  'openai/gpt-5.6-sol-pro:batch': 6,
  'openai/gpt-5.6-sol:batch': 6,
  'openai/gpt-5.6-terra': 6,
  'openai/gpt-5.6-terra-fast': 7,
  'openai/gpt-5.6-terra-pro': 6,
  'openai/gpt-5.6-terra-pro:batch': 6,
  'openai/gpt-5.6-terra:batch': 6,
  'openai/gpt-5:batch': 6,
  'openai/gpt-6-astra': 6,
  'openai/gpt-6-astra-fast': 7,
  'openai/gpt-6-astra-pro': 6,
  'openai/gpt-6-astra-pro:batch': 6,
  'openai/gpt-6-astra:batch': 6,
  'openai/gpt-6-luna': 6,
  'openai/gpt-6-luna-fast': 7,
  'openai/gpt-6-luna-pro': 6,
  'openai/gpt-6-luna-pro:batch': 6,
  'openai/gpt-6-luna:batch': 6,
  'openai/gpt-6-sol': 6,
  'openai/gpt-6-sol-fast': 7,
  'openai/gpt-6-sol-pro': 6,
  'openai/gpt-6-sol-pro:batch': 6,
  'openai/gpt-6-sol:batch': 6,
  'openai/gpt-6.1-sol': 6,
  'openai/gpt-6.1-sol-fast': 7,
  'openai/gpt-6.1-sol-pro': 6,
  'openai/gpt-oss-120b': 6,
  'openai/gpt-oss-120b:batch': 6,
  'openai/gpt-oss-20b': 6,
  'openai/gpt-oss-20b:batch': 6,
  'openai/gpt-oss-safeguard-20b': 6,
  'openai/o3-mini-high': 6,
  'openai/o4-mini-high': 6,
  'perceptron/perceptron-mk1.5': 6,
  'precise': 6,
  'prism-ml/ternary-bonsai-2-27b': 6,
  'qwen-3.8-27b': 6,
  'qwen/qwen3.6-27b': 6,
  'qwen/qwen3.8-2.4t-a95b': 6,
  'qwen/qwen3.8-27b': 6,
  'qwen/qwen3.8-max-0902': 6,
  'qwen/qwen3.8-max-prime': 6,
  'qwen3.8-flash': 6,
  'qwen3.8-max': 6,
  'sakana/fugu-max': 6,
  'sakana/fugu-ultra': 6,
  'sakana/fugu-ultra-v2': 6,
  'sakana/sakana-namazu': 6,
  'space-bunny': 6,
  'space-bunny-free': 6,
  'stepfun-ai/Step-3.7-Flash': 6,
  'stepfun/step-3.7-flash': 6,
  'tencent/Hy3': 6,
  'tencent/Hy4-preview': 6,
  'tencent/hy3': 6,
  'tencent/hy3-preview': 6,
  'tencent/hy4-preview': 6,
  'thinkingmachines/Inkling': 6,
  'thinkingmachines/inkling': 6,
  'thinkingmachines/inkling-small': 6,
  'thinkingmachines/inkling-small:free': 6,
  'thinkingmachines/inkling:free': 6,
  'upstage/solar-mini4': 6,
  'upstage/solar-pro-3': 6,
  'upstage/solar-pro4': 6,
  'us.anthropic.claude-fable-5': 8,
  'us.anthropic.claude-fable-5-1': 8,
  'us.anthropic.claude-haiku-5-5': 8,
  'us.anthropic.claude-opus-4-6-v1': 0,
  'us.anthropic.claude-opus-4-7': 8,
  'us.anthropic.claude-opus-4-8': 8,
  'us.anthropic.claude-opus-5': 8,
  'us.anthropic.claude-opus-5-5': 8,
  'us.anthropic.claude-sonnet-4-6': 0,
  'us.anthropic.claude-sonnet-5': 8,
  'us.anthropic.claude-sonnet-5-5': 8,
  'us.openai.gpt-5.6-luna': 7,
  'us.openai.gpt-5.6-sol': 7,
  'us.openai.gpt-5.6-terra': 7,
  'us.openai.gpt-6-astra': 7,
  'us.openai.gpt-6-luna': 7,
  'us.openai.gpt-6-sol': 7,
  'us.openai.gpt-6.1-sol': 7,
  'workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731': 4,
  'workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813': 4,
  'x-ai/grok-4.3': 6,
  'x-ai/grok-4.3:batch': 6,
  'x-ai/grok-4.5': 6,
  'x-ai/grok-4.6': 6,
  'x-ai/grok-4.7': 6,
  'z-ai/glm-5.2': 6,
  'z-ai/glm-5.3': 6,
  'z-ai/glm-5.3-flash': 6,
  'z-ai/glm-5.3-flash:batch': 6,
  'z-ai/glm-5.3-flashx': 6,
  'z-ai/glm-5.3-prime': 6,
  'z-ai/glm-5.3:batch': 6,
  'zai-glm-5-2': 6,
  'zai-glm-5-3': 6,
  'zai-org/GLM-4.7': 6,
  'zai-org/GLM-5': 6,
  'zai-org/GLM-5.1': 6,
  'zai-org/GLM-5.2': 6,
  'zai-org/GLM-5.2-Fast': 6,
  'zai-org/GLM-5.3': 6,
  'zai-org/GLM-5.3-Fast': 6,
  'zai-org/GLM-5.3-Flash': 6,
  '~anthropic/claude-fable-latest': 6,
  '~anthropic/claude-haiku-latest': 6,
  '~anthropic/claude-opus-latest': 6,
  '~anthropic/claude-sonnet-latest': 6,
  '~deepseek/deepseek-flash-latest': 6,
  '~deepseek/deepseek-pro-latest': 6,
  '~deepseek/deepseek-v4-flash-latest': 6,
  '~google/gemini-flash-latest': 6,
  '~google/gemini-pro-latest': 6,
  '~moonshotai/kimi-latest': 6,
  '~openai/gpt-astra-latest': 6,
  '~openai/gpt-luna-latest': 6,
  '~openai/gpt-mini-latest': 6,
  '~openai/gpt-sol-latest': 6,
  '~openai/gpt-terra-latest': 6,
  '~x-ai/grok-latest': 6,
  '~z-ai/glm-flash-latest': 6,
  '~z-ai/glm-latest': 6,
}

/** Model id -> the smallest context window the catalog states for it, in tokens. */
export const MODEL_CONTEXT_WINDOW: Readonly<Record<string, number>> = {
  '@cf/deepseek-ai/deepseek-v4-flash-0731': 1048576,
  '@cf/deepseek-ai/deepseek-v4-pro-0813': 1048576,
  '@cf/google/gemma-4-26b-a4b-it': 256000,
  '@cf/ibm-granite/granite-4.0-h-micro': 131000,
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 24000,
  '@cf/meta/llama-4-scout-17b-16e-instruct': 131000,
  '@cf/mistralai/mistral-small-3.1-24b-instruct': 128000,
  '@cf/moonshotai/kimi-k2.6': 262144,
  '@cf/moonshotai/kimi-k2.7-code': 262144,
  '@cf/nvidia/nemotron-3-120b-a12b': 256000,
  '@cf/openai/gpt-oss-120b': 128000,
  '@cf/openai/gpt-oss-20b': 128000,
  '@cf/qwen/qwen3-30b-a3b-fp8': 32768,
  '@cf/qwen/qwen3.8-27b': 262144,
  '@cf/zai-org/glm-4.7-flash': 131072,
  '@cf/zai-org/glm-5.2': 262144,
  '@cf/zai-org/glm-5.3': 1048576,
  '@cf/zai-org/glm-5.3-flash': 1048576,
  'Ling-2.6-1T': 262144,
  'Ling-2.6-flash': 262144,
  'MiniMax-M2.5': 196608,
  'MiniMax-M2.7': 204800,
  'MiniMax-M2.7-highspeed': 204800,
  'MiniMax-M3': 1000000,
  'MiniMaxAI/MiniMax-M2': 204800,
  'MiniMaxAI/MiniMax-M2.1': 204800,
  'MiniMaxAI/MiniMax-M2.5': 204800,
  'MiniMaxAI/MiniMax-M2.7': 196608,
  'MiniMaxAI/MiniMax-M3': 524288,
  'Qwen/Qwen2.5-7B-Instruct-Turbo': 32768,
  'Qwen/Qwen2.5-Coder-32B-Instruct': 131072,
  'Qwen/Qwen3-235B-A22B': 40960,
  'Qwen/Qwen3-235B-A22B-Instruct-2507': 262144,
  'Qwen/Qwen3-235B-A22B-Thinking-2507': 262144,
  'Qwen/Qwen3-30B-A3B': 40960,
  'Qwen/Qwen3-32B': 131072,
  'Qwen/Qwen3-Coder-30B-A3B-Instruct': 262144,
  'Qwen/Qwen3-Coder-480B-A35B-Instruct': 262144,
  'Qwen/Qwen3-Coder-Next': 262144,
  'Qwen/Qwen3-Next-80B-A3B-Instruct': 262144,
  'Qwen/Qwen3-Next-80B-A3B-Thinking': 262144,
  'Qwen/Qwen3-VL-235B-A22B-Instruct': 131072,
  'Qwen/Qwen3-VL-235B-A22B-Thinking': 131072,
  'Qwen/Qwen3.5-122B-A10B': 262144,
  'Qwen/Qwen3.5-27B': 262144,
  'Qwen/Qwen3.5-35B-A3B': 262144,
  'Qwen/Qwen3.5-397B-A17B': 262144,
  'Qwen/Qwen3.5-9B': 262144,
  'Qwen/Qwen3.6-27B': 262144,
  'Qwen/Qwen3.6-35B-A3B': 262144,
  'Qwen/Qwen3.6-Plus': 1000000,
  'Qwen/Qwen3.7-Max': 1000000,
  'Qwen/Qwen3.8-2.4T-A95B': 262144,
  'Qwen/Qwen3.8-27B': 262144,
  'Ring-2.6-1T': 262144,
  'XiaomiMiMo/MiMo-V2-Flash': 262144,
  'XiaomiMiMo/MiMo-V2.5': 262144,
  'XiaomiMiMo/MiMo-V2.5-Pro': 1048576,
  'accounts/fireworks/models/deepseek-v4p1-flash': 1000000,
  'accounts/fireworks/models/ember-1': 1048576,
  'accounts/fireworks/models/glm-5p3': 1048573,
  'accounts/fireworks/models/glm-5p3-flash': 1048573,
  'accounts/fireworks/models/gpt-oss-120b': 131072,
  'accounts/fireworks/models/inkling': 1048576,
  'accounts/fireworks/models/kimi-k3': 1048576,
  'accounts/fireworks/models/minimax-m3': 512000,
  'accounts/fireworks/models/nemotron-3-ultra-nvfp4': 262144,
  'accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b': 262144,
  'accounts/fireworks/models/qwen3p8-2p4t-a95b': 262144,
  'accounts/fireworks/models/qwen3p8-max': 262144,
  'accounts/fireworks/routers/deepseek-flash-latest': 1000000,
  'accounts/fireworks/routers/glm-5p3-fast': 1048572,
  'accounts/fireworks/routers/glm-fast-latest': 1048572,
  'accounts/fireworks/routers/glm-flash-latest': 1048573,
  'accounts/fireworks/routers/glm-latest': 1048573,
  'accounts/fireworks/routers/kimi-fast-latest': 1048576,
  'accounts/fireworks/routers/kimi-k3-fast': 1048576,
  'accounts/fireworks/routers/kimi-latest': 1048576,
  'accounts/fireworks/routers/minimax-latest': 512000,
  'accounts/fireworks/routers/qwen-max-latest': 262144,
  'aion-labs/aion-2.0': 131072,
  'aion-labs/aion-3.0': 131072,
  'aion-labs/aion-3.0-mini': 131072,
  'aion-labs/aion-3.5': 262144,
  'aion-labs/aion-3.5-mini': 262144,
  'alibaba/qwen-3-14b': 40960,
  'alibaba/qwen-3-235b': 262144,
  'alibaba/qwen-3-30b': 40960,
  'alibaba/qwen-3-32b': 128000,
  'alibaba/qwen-3.6-max-preview': 240000,
  'alibaba/qwen3-235b-a22b-thinking': 131072,
  'alibaba/qwen3-coder': 262144,
  'alibaba/qwen3-coder-30b-a3b': 262144,
  'alibaba/qwen3-coder-next': 256000,
  'alibaba/qwen3-coder-plus': 1000000,
  'alibaba/qwen3-max': 262144,
  'alibaba/qwen3-max-preview': 262144,
  'alibaba/qwen3-max-thinking': 256000,
  'alibaba/qwen3-next-80b-a3b-instruct': 262114,
  'alibaba/qwen3-next-80b-a3b-thinking': 262144,
  'alibaba/qwen3-vl-235b-a22b-instruct': 131072,
  'alibaba/qwen3-vl-instruct': 131072,
  'alibaba/qwen3-vl-thinking': 131072,
  'alibaba/qwen3.5-flash': 1000000,
  'alibaba/qwen3.5-plus': 1000000,
  'alibaba/qwen3.6-27b': 256000,
  'alibaba/qwen3.6-plus': 1000000,
  'alibaba/qwen3.7-flash': 991000,
  'alibaba/qwen3.7-max': 991000,
  'alibaba/qwen3.7-plus': 1000000,
  'alibaba/qwen3.8-2.4t-a95b': 262144,
  'alibaba/qwen3.8-27b': 1000000,
  'alibaba/qwen3.8-flash': 991000,
  'alibaba/qwen3.8-max': 262144,
  'alibaba/qwen3.8-max-0902': 991000,
  'alibaba/qwen3.8-max-prime': 1000000,
  'alibaba/qwen3.8-omni-flash': 1000000,
  'amazon.nova-2-lite-v1:0': 1000000,
  'amazon.nova-lite-v1:0': 300000,
  'amazon.nova-micro-v1:0': 128000,
  'amazon.nova-pro-v1:0': 300000,
  'amazon/nova-2-lite': 1000000,
  'amazon/nova-2-lite-v1': 1000000,
  'amazon/nova-lite': 300000,
  'amazon/nova-lite-v1': 300000,
  'amazon/nova-micro': 128000,
  'amazon/nova-micro-v1': 128000,
  'amazon/nova-premier-v1': 1000000,
  'amazon/nova-pro': 300000,
  'amazon/nova-pro-v1': 300000,
  'anthropic.claude-fable-5': 1000000,
  'anthropic.claude-fable-5-1': 1000000,
  'anthropic.claude-haiku-4-5-20251001-v1:0': 200000,
  'anthropic.claude-haiku-5-5': 1000000,
  'anthropic.claude-opus-4-1-20250805-v1:0': 200000,
  'anthropic.claude-opus-4-5-20251101-v1:0': 200000,
  'anthropic.claude-opus-4-6-v1': 1000000,
  'anthropic.claude-opus-4-7': 1000000,
  'anthropic.claude-opus-4-8': 1000000,
  'anthropic.claude-opus-5-5': 1000000,
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 200000,
  'anthropic.claude-sonnet-4-6': 1000000,
  'anthropic.claude-sonnet-5': 1000000,
  'anthropic.claude-sonnet-5-5': 1000000,
  'anthropic/claude-3-haiku': 200000,
  'anthropic/claude-fable-5': 1000000,
  'anthropic/claude-fable-5.1': 1000000,
  'anthropic/claude-fable-5.1:batch': 1000000,
  'anthropic/claude-fable-5:batch': 1000000,
  'anthropic/claude-haiku-4.5': 200000,
  'anthropic/claude-haiku-4.5:batch': 200000,
  'anthropic/claude-haiku-5.5': 1000000,
  'anthropic/claude-haiku-5.5:batch': 1000000,
  'anthropic/claude-opus-4': 200000,
  'anthropic/claude-opus-4.1': 200000,
  'anthropic/claude-opus-4.1:batch': 200000,
  'anthropic/claude-opus-4.5': 200000,
  'anthropic/claude-opus-4.5:batch': 200000,
  'anthropic/claude-opus-4.6': 1000000,
  'anthropic/claude-opus-4.6:batch': 1000000,
  'anthropic/claude-opus-4.7': 1000000,
  'anthropic/claude-opus-4.7:batch': 1000000,
  'anthropic/claude-opus-4.8': 1000000,
  'anthropic/claude-opus-4.8-fast': 1000000,
  'anthropic/claude-opus-4.8:batch': 1000000,
  'anthropic/claude-opus-5': 1000000,
  'anthropic/claude-opus-5-fast': 1000000,
  'anthropic/claude-opus-5.5': 1000000,
  'anthropic/claude-opus-5.5-fast': 1000000,
  'anthropic/claude-opus-5.5:batch': 1000000,
  'anthropic/claude-opus-5:batch': 1000000,
  'anthropic/claude-sonnet-4': 200000,
  'anthropic/claude-sonnet-4.5': 1000000,
  'anthropic/claude-sonnet-4.5:batch': 1000000,
  'anthropic/claude-sonnet-4.6': 1000000,
  'anthropic/claude-sonnet-4.6:batch': 1000000,
  'anthropic/claude-sonnet-5': 1000000,
  'anthropic/claude-sonnet-5.5': 1000000,
  'anthropic/claude-sonnet-5.5:batch': 1000000,
  'anthropic/claude-sonnet-5:batch': 1000000,
  'apac.amazon.nova-lite-v1:0': 300000,
  'apac.amazon.nova-micro-v1:0': 128000,
  'apac.amazon.nova-pro-v1:0': 300000,
  'apac.anthropic.claude-sonnet-4-20250514-v1:0': 200000,
  'apodex/apodex-1.1-mini:free': 262144,
  'arcee-ai/trinity-large-thinking': 262100,
  'au.anthropic.claude-haiku-4-5-20251001-v1:0': 200000,
  'au.anthropic.claude-haiku-5-5': 1000000,
  'au.anthropic.claude-opus-4-6-v1': 1000000,
  'au.anthropic.claude-opus-4-7': 1000000,
  'au.anthropic.claude-opus-4-8': 1000000,
  'au.anthropic.claude-opus-5': 1000000,
  'au.anthropic.claude-opus-5-5': 1000000,
  'au.anthropic.claude-sonnet-4-5-20250929-v1:0': 200000,
  'au.anthropic.claude-sonnet-4-6': 1000000,
  'au.anthropic.claude-sonnet-5': 1000000,
  'auto': 2000000,
  'balanced': 1048576,
  'big-pickle': 200000,
  'bytedance-seed/seed-1.6': 262144,
  'bytedance-seed/seed-1.6-flash': 262144,
  'bytedance-seed/seed-2-1-turbo': 262144,
  'bytedance-seed/seed-2.0-code': 262144,
  'bytedance-seed/seed-2.0-lite': 262144,
  'bytedance-seed/seed-2.0-mini': 262144,
  'bytedance/seed-1.6': 256000,
  'bytedance/seed-1.8': 256000,
  'bytedance/seed-2.1-turbo': 262144,
  'ca.amazon.nova-lite-v1:0': 300000,
  'cheap': 1000000,
  'claude-fable-5': 1000000,
  'claude-fable-5-1': 1000000,
  'claude-fable-5.1': 1000000,
  'claude-haiku-4-5': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'claude-haiku-4.5': 200000,
  'claude-haiku-5-5': 1000000,
  'claude-opus-4-5': 200000,
  'claude-opus-4-5-20251101': 200000,
  'claude-opus-4-6': 1000000,
  'claude-opus-4-7': 1000000,
  'claude-opus-4-8': 1000000,
  'claude-opus-4.7': 1000000,
  'claude-opus-4.8': 1000000,
  'claude-opus-5': 1000000,
  'claude-opus-5-5': 1000000,
  'claude-opus-5.5': 1000000,
  'claude-sonnet-4': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-sonnet-4-5-20250929': 1000000,
  'claude-sonnet-4-6': 1000000,
  'claude-sonnet-4.6': 1000000,
  'claude-sonnet-5': 1000000,
  'claude-sonnet-5-5': 1000000,
  'claude-sonnet-5.5': 1000000,
  'codestral-2508': 256000,
  'codestral-latest': 256000,
  'cohere/command-a': 256000,
  'cohere/command-a-plus': 192000,
  'cohere/command-r-08-2024': 128000,
  'cohere/command-r-plus-08-2024': 128000,
  'cohere/north-mini-code:free': 256000,
  'deep-research-max-preview-04-2026': 131072,
  'deep-research-preview-04-2026': 131072,
  'deepseek-ai/DeepSeek-R1': 64000,
  'deepseek-ai/DeepSeek-R1-0528': 163840,
  'deepseek-ai/DeepSeek-V3': 64000,
  'deepseek-ai/DeepSeek-V3-0324': 163840,
  'deepseek-ai/DeepSeek-V3.1': 131072,
  'deepseek-ai/DeepSeek-V3.2': 163840,
  'deepseek-ai/DeepSeek-V4-Flash': 1048576,
  'deepseek-ai/DeepSeek-V4-Flash-0731': 1048576,
  'deepseek-ai/DeepSeek-V4-Flash-Vision-Exp': 1048576,
  'deepseek-ai/DeepSeek-V4-Pro': 1048576,
  'deepseek-ai/DeepSeek-V4-Pro-0813': 1000000,
  'deepseek-ai/DeepSeek-V4.1-Flash': 1048576,
  'deepseek-ai/DeepSeek-V4.1-Flash-Fast': 1048576,
  'deepseek-ai/deepseek-v4.1-flash': 1000000,
  'deepseek-flash': 1000000,
  'deepseek-v3.2': 131072,
  'deepseek-v4-flash': 1000000,
  'deepseek-v4-flash-0731': 1000000,
  'deepseek-v4-flash-vision-exp': 1000000,
  'deepseek-v4-pro': 1000000,
  'deepseek-v4-pro-0813': 1000000,
  'deepseek-v4.1-flash': 1000000,
  'deepseek.v3-v1:0': 163840,
  'deepseek.v3.2': 163840,
  'deepseek/deepseek-chat': 128000,
  'deepseek/deepseek-chat-v3-0324': 128000,
  'deepseek/deepseek-chat-v3.1': 163840,
  'deepseek/deepseek-r1': 64000,
  'deepseek/deepseek-r1-0528': 163840,
  'deepseek/deepseek-v3.1': 163840,
  'deepseek/deepseek-v3.1-terminus': 163840,
  'deepseek/deepseek-v3.2': 128000,
  'deepseek/deepseek-v3.2-exp': 163840,
  'deepseek/deepseek-v3.2-thinking': 128000,
  'deepseek/deepseek-v4-flash': 1000000,
  'deepseek/deepseek-v4-flash-0731': 1000000,
  'deepseek/deepseek-v4-flash-vision-exp': 1048576,
  'deepseek/deepseek-v4-pro': 1000000,
  'deepseek/deepseek-v4-pro-0813': 1000000,
  'deepseek/deepseek-v4.1-flash': 1048576,
  'deepseek/deepseek-v4.1-flash-fast': 1048576,
  'deepseek/deepseek-v4.1-flash:batch': 1048576,
  'devstral-2512': 262144,
  'devstral-latest': 262144,
  'devstral-medium-2507': 128000,
  'devstral-medium-latest': 262144,
  'devstral-small-2505': 128000,
  'devstral-small-2507': 128000,
  'dots-studio/dots-3-note-preview:free': 512000,
  'eu.amazon.nova-2-lite-v1:0': 1000000,
  'eu.amazon.nova-lite-v1:0': 300000,
  'eu.amazon.nova-micro-v1:0': 128000,
  'eu.amazon.nova-pro-v1:0': 300000,
  'eu.anthropic.claude-fable-5': 1000000,
  'eu.anthropic.claude-haiku-4-5-20251001-v1:0': 200000,
  'eu.anthropic.claude-haiku-5-5': 1000000,
  'eu.anthropic.claude-opus-4-5-20251101-v1:0': 200000,
  'eu.anthropic.claude-opus-4-6-v1': 1000000,
  'eu.anthropic.claude-opus-4-7': 1000000,
  'eu.anthropic.claude-opus-4-8': 1000000,
  'eu.anthropic.claude-opus-5': 1000000,
  'eu.anthropic.claude-opus-5-5': 1000000,
  'eu.anthropic.claude-sonnet-4-20250514-v1:0': 200000,
  'eu.anthropic.claude-sonnet-4-5-20250929-v1:0': 200000,
  'eu.anthropic.claude-sonnet-4-6': 1000000,
  'eu.anthropic.claude-sonnet-5': 1000000,
  'eu.anthropic.claude-sonnet-5-5': 1000000,
  'eu.mistral.pixtral-large-2502-v1:0': 128000,
  'exo-free': 1048576,
  'fireworks/ember-1': 1048576,
  'fledge-alpha-free': 1048576,
  'gemini-2.5-computer-use-preview-10-2025': 128000,
  'gemini-2.5-flash': 1048576,
  'gemini-2.5-flash-lite': 1048576,
  'gemini-2.5-pro': 1048576,
  'gemini-3-flash': 1048576,
  'gemini-3-flash-preview': 1048576,
  'gemini-3.1-flash-lite': 1048576,
  'gemini-3.1-flash-lite-image': 65536,
  'gemini-3.1-flash-lite-preview': 1048576,
  'gemini-3.1-flash-live-preview': 131072,
  'gemini-3.1-pro': 1048576,
  'gemini-3.1-pro-preview': 1048576,
  'gemini-3.1-pro-preview-customtools': 1048576,
  'gemini-3.5-flash': 200000,
  'gemini-3.5-flash-lite': 1048576,
  'gemini-3.6-flash': 1000000,
  'gemini-3.7-flash': 1000000,
  'gemini-3.8-flash': 1000000,
  'gemini-flash-latest': 1048576,
  'gemini-flash-lite-latest': 1048576,
  'gemma-4-26b-a4b-it': 262144,
  'gemma-4-31b-it': 262144,
  'glm-4.6v': 128000,
  'glm-4.7': 204800,
  'glm-5': 202752,
  'glm-5-2': 1048576,
  'glm-5-turbo': 200000,
  'glm-5.1': 202752,
  'glm-5.2': 1000000,
  'glm-5.2-highspeed': 1000000,
  'glm-5.3': 1000000,
  'glm-5.3-flash': 1000000,
  'glm-5.3-highspeed': 1000000,
  'global.amazon.nova-2-lite-v1:0': 1000000,
  'global.anthropic.claude-fable-5': 1000000,
  'global.anthropic.claude-fable-5-1': 1000000,
  'global.anthropic.claude-haiku-4-5-20251001-v1:0': 200000,
  'global.anthropic.claude-haiku-5-5': 1000000,
  'global.anthropic.claude-opus-4-5-20251101-v1:0': 200000,
  'global.anthropic.claude-opus-4-6-v1': 1000000,
  'global.anthropic.claude-opus-4-7': 1000000,
  'global.anthropic.claude-opus-4-8': 1000000,
  'global.anthropic.claude-opus-5': 1000000,
  'global.anthropic.claude-opus-5-5': 1000000,
  'global.anthropic.claude-sonnet-4-20250514-v1:0': 200000,
  'global.anthropic.claude-sonnet-4-5-20250929-v1:0': 200000,
  'global.anthropic.claude-sonnet-4-6': 1000000,
  'global.anthropic.claude-sonnet-5': 1000000,
  'global.anthropic.claude-sonnet-5-5': 1000000,
  'global.moonshotai.kimi-k3': 1048576,
  'global.openai.gpt-5.6-luna': 1050000,
  'global.openai.gpt-5.6-sol': 1050000,
  'global.openai.gpt-5.6-terra': 1050000,
  'global.openai.gpt-6-astra': 1050000,
  'global.openai.gpt-6-luna': 1050000,
  'global.openai.gpt-6-sol': 1050000,
  'global.openai.gpt-6.1-sol': 1050000,
  'global.xai.grok-4.6': 500000,
  'global.xai.grok-4.7': 500000,
  'global.zai.glm-5.3': 1000000,
  'google.gemma-4-26b-a4b': 262144,
  'google.gemma-4-31b': 262144,
  'google.gemma-4-e2b': 131072,
  'google/diffusiongemma-26b-a4b-it': 250000,
  'google/gemini-2.5-flash': 1000000,
  'google/gemini-2.5-flash-lite': 1048576,
  'google/gemini-2.5-flash-lite:batch': 1048576,
  'google/gemini-2.5-flash:batch': 1048576,
  'google/gemini-2.5-pro': 1048576,
  'google/gemini-2.5-pro-preview': 1048576,
  'google/gemini-2.5-pro:batch': 1048576,
  'google/gemini-3-flash': 1000000,
  'google/gemini-3-flash-preview': 1048576,
  'google/gemini-3-flash-preview:batch': 1048576,
  'google/gemini-3-pro-image': 65536,
  'google/gemini-3.1-flash-lite': 1000000,
  'google/gemini-3.1-flash-lite-preview': 1048576,
  'google/gemini-3.1-flash-lite:batch': 1048576,
  'google/gemini-3.1-pro-preview': 1000000,
  'google/gemini-3.1-pro-preview-customtools': 1048576,
  'google/gemini-3.1-pro-preview:batch': 1048576,
  'google/gemini-3.5-flash': 1000000,
  'google/gemini-3.5-flash-lite': 1000000,
  'google/gemini-3.5-flash-lite:batch': 1048576,
  'google/gemini-3.5-flash:batch': 1048576,
  'google/gemini-3.6-flash': 1000000,
  'google/gemini-3.6-flash:batch': 1048576,
  'google/gemini-3.7-flash': 1000000,
  'google/gemini-3.7-flash:batch': 1048576,
  'google/gemini-3.8-flash': 1000000,
  'google/gemini-3.8-flash:batch': 1048576,
  'google/gemini-nano-banana-2.1': 65536,
  'google/gemma-3-12b-it': 131072,
  'google/gemma-3-27b-it': 131072,
  'google/gemma-3-4b-it': 131072,
  'google/gemma-4-26B-A4B-it': 262144,
  'google/gemma-4-26b-a4b-it': 262144,
  'google/gemma-4-26b-a4b-it:free': 262144,
  'google/gemma-4-31B-it': 262144,
  'google/gemma-4-31b-it': 262144,
  'google/gemma-4-31b-it:free': 262144,
  'gpt-4': 8192,
  'gpt-4-turbo': 128000,
  'gpt-4.1': 1047576,
  'gpt-4.1-mini': 1047576,
  'gpt-4.1-nano': 1000000,
  'gpt-4o': 128000,
  'gpt-4o-2024-05-13': 128000,
  'gpt-4o-2024-08-06': 128000,
  'gpt-4o-2024-11-20': 128000,
  'gpt-4o-mini': 128000,
  'gpt-5': 128000,
  'gpt-5-chat-latest': 128000,
  'gpt-5-codex': 400000,
  'gpt-5-mini': 128000,
  'gpt-5-nano': 128000,
  'gpt-5-pro': 400000,
  'gpt-5.1': 128000,
  'gpt-5.1-codex': 400000,
  'gpt-5.1-codex-max': 400000,
  'gpt-5.1-codex-mini': 400000,
  'gpt-5.2': 400000,
  'gpt-5.2-chat-latest': 128000,
  'gpt-5.2-codex': 400000,
  'gpt-5.2-pro': 400000,
  'gpt-5.3-chat-latest': 128000,
  'gpt-5.3-codex': 400000,
  'gpt-5.3-codex-spark': 128000,
  'gpt-5.4': 272000,
  'gpt-5.4-mini': 128000,
  'gpt-5.4-nano': 128000,
  'gpt-5.4-pro': 1000000,
  'gpt-5.5': 272000,
  'gpt-5.5-pro': 1000000,
  'gpt-5.6-luna': 272000,
  'gpt-5.6-sol': 272000,
  'gpt-5.6-terra': 272000,
  'gpt-6-astra': 272000,
  'gpt-6-luna': 272000,
  'gpt-6-sol': 272000,
  'gpt-6.1-sol': 272000,
  'gpt-daybreak-blue-latest': 1050000,
  'gpt-daybreak-red-latest': 400000,
  'gpt-oss-120b': 131072,
  'gpt-realtime-2.1': 128000,
  'grok-4.3': 1000000,
  'grok-4.5': 500000,
  'grok-4.6': 500000,
  'grok-4.7': 500000,
  'grok-build-0.1': 256000,
  'hy3': 256000,
  'hy4-preview': 1024000,
  'ibm-granite/granite-4.2-8b': 131072,
  'in.anthropic.claude-haiku-4-5-20251001-v1:0': 200000,
  'in.anthropic.claude-opus-5': 1000000,
  'in.anthropic.claude-sonnet-5': 1000000,
  'in.openai.gpt-5.6-luna': 1050000,
  'in.openai.gpt-5.6-terra': 1050000,
  'inception/mercury-2': 128000,
  'inception/mercury-2.5': 260000,
  'inception/mercury-coder-small': 32000,
  'inclusionai/ling-3.0-flash': 256000,
  'inclusionai/ling-3.0-flash-fin': 256000,
  'inclusionai/ling-3.0-flash-sante': 256000,
  'inclusionai/ling-3.0-flash-sante:free': 262144,
  'inclusionai/ling-3.0-flash-vl': 256000,
  'inclusionai/ling-3.1-flash': 262144,
  'inclusionai/ling-3.1-flash-free': 262144,
  'interfaze/interfaze-beta': 1000000,
  'jp.amazon.nova-2-lite-v1:0': 1000000,
  'jp.anthropic.claude-haiku-4-5-20251001-v1:0': 200000,
  'jp.anthropic.claude-haiku-5-5': 1000000,
  'jp.anthropic.claude-opus-4-7': 1000000,
  'jp.anthropic.claude-opus-4-8': 1000000,
  'jp.anthropic.claude-opus-5': 1000000,
  'jp.anthropic.claude-opus-5-5': 1000000,
  'jp.anthropic.claude-sonnet-4-5-20250929-v1:0': 200000,
  'jp.anthropic.claude-sonnet-4-6': 1000000,
  'jp.anthropic.claude-sonnet-5': 1000000,
  'k3': 1048576,
  'k3-256k': 262144,
  'kimi-for-coding': 1048576,
  'kimi-for-coding-highspeed': 262144,
  'kimi-k2.5': 262144,
  'kimi-k2.6': 262144,
  'kimi-k2.7-code': 256000,
  'kimi-k2.7-code-highspeed': 262144,
  'kimi-k3': 1048576,
  'labs-devstral-small-2512': 256000,
  'labs-leanstral-1-5-1': 262144,
  'ling-3.0-flash-fin-free': 262144,
  'ling-3.1-flash-free': 262144,
  'liquid/lfm-2.5-2.6b:free': 65536,
  'llama-3.1-8b-instant': 131072,
  'llama-3.3-70b-versatile': 131072,
  'longcat-2.0': 1000000,
  'longcat-2.5-preview-free': 1000000,
  'magistral-medium-latest': 262144,
  'mai-code-1-flash-picker': 256000,
  'mai-code-1.1-flash': 256000,
  'meituan/longcat-2.0': 1048756,
  'meituan/longcat-2.5-preview': 1048576,
  'meta-llama/Llama-3.1-8B-Instruct': 131072,
  'meta-llama/Llama-3.3-70B-Instruct': 131072,
  'meta-llama/Llama-3.3-70B-Instruct-Turbo': 131072,
  'meta-llama/llama-3.1-70b-instruct': 131072,
  'meta-llama/llama-3.1-8b-instruct': 131072,
  'meta-llama/llama-3.3-70b-instruct': 131072,
  'meta-llama/llama-4-maverick': 128000,
  'meta-llama/llama-4-scout': 327680,
  'meta.llama3-1-70b-instruct-v1:0': 128000,
  'meta.llama3-1-8b-instruct-v1:0': 128000,
  'meta.llama3-3-70b-instruct-v1:0': 128000,
  'meta.llama4-maverick-17b-instruct-v1:0': 1000000,
  'meta.llama4-scout-17b-instruct-v1:0': 10000000,
  'meta/llama-3.1-70b': 128000,
  'meta/llama-3.1-8b': 128000,
  'meta/llama-3.2-11b-vision-instruct': 128000,
  'meta/llama-3.2-90b-vision-instruct': 128000,
  'meta/llama-3.3-70b': 128000,
  'meta/llama-4-maverick': 128000,
  'meta/llama-4-scout': 128000,
  'meta/muse-glimmer-30b': 131072,
  'meta/muse-spark-1.1': 1048576,
  'meta/muse-spark-1.2': 1048576,
  'meta/muse-spark-1.2-contributor': 1048576,
  'meta/muse-spark-1.3': 1048576,
  'meta/muse-spark-1.3-contributor': 1048576,
  'mimo-v2.5': 1000000,
  'mimo-v2.5-pro': 1048576,
  'mimo-v2.5-pro-ultraspeed': 1048576,
  'mimo-v2.6-flash': 1048576,
  'mimo-v2.6-flash-free': 200000,
  'mimo-v2.6-pro': 1048576,
  'mimo-v2.6-pro-ultraspeed': 1048576,
  'minimax-m2.5': 204800,
  'minimax-m2.7': 204800,
  'minimax-m3': 512000,
  'minimax.minimax-m2': 204608,
  'minimax.minimax-m2.1': 196608,
  'minimax.minimax-m2.5': 196608,
  'minimax/minimax-m1': 1000000,
  'minimax/minimax-m2': 196608,
  'minimax/minimax-m2.1': 204800,
  'minimax/minimax-m2.1-lightning': 204800,
  'minimax/minimax-m2.5': 200000,
  'minimax/minimax-m2.5-highspeed': 204800,
  'minimax/minimax-m2.7': 196608,
  'minimax/minimax-m2.7-highspeed': 204800,
  'minimax/minimax-m3': 512000,
  'ministral-14b-2512': 262144,
  'ministral-3b-2512': 131072,
  'ministral-3b-latest': 131072,
  'ministral-8b-2512': 262144,
  'ministral-8b-latest': 262144,
  'mistral-large-2411': 131072,
  'mistral-large-2512': 262144,
  'mistral-large-4': 524288,
  'mistral-large-latest': 262144,
  'mistral-medium-2505': 131072,
  'mistral-medium-2508': 262144,
  'mistral-medium-2604': 262144,
  'mistral-medium-3.5': 262144,
  'mistral-medium-latest': 262144,
  'mistral-nemo': 128000,
  'mistral-small-2506': 128000,
  'mistral-small-2603': 262144,
  'mistral-small-latest': 262144,
  'mistral.devstral-2-123b': 262144,
  'mistral.magistral-small-2509': 128000,
  'mistral.ministral-3-14b-instruct': 128000,
  'mistral.ministral-3-3b-instruct': 256000,
  'mistral.ministral-3-8b-instruct': 128000,
  'mistral.mistral-large-3-675b-instruct': 262144,
  'mistral.pixtral-large-2502-v1:0': 128000,
  'mistral.voxtral-mini-3b-2507': 32768,
  'mistral.voxtral-small-24b-2507': 32768,
  'mistral/codestral': 128000,
  'mistral/ministral-14b': 262144,
  'mistral/ministral-3b': 131072,
  'mistral/ministral-8b': 262144,
  'mistral/mistral-large-3': 262144,
  'mistral/mistral-large-4': 524288,
  'mistral/mistral-medium-3.5': 262144,
  'mistral/mistral-nemo': 60288,
  'mistral/mistral-small': 262144,
  'mistralai/codestral-2508': 256000,
  'mistralai/codestral-2508:batch': 256000,
  'mistralai/devstral-2512': 262144,
  'mistralai/ministral-14b-2512': 262144,
  'mistralai/ministral-3b-2512': 131072,
  'mistralai/ministral-8b-2512': 262144,
  'mistralai/ministral-8b-2512:batch': 262144,
  'mistralai/mistral-7b-instruct-v0.3': 65536,
  'mistralai/mistral-large': 128000,
  'mistralai/mistral-large-2407': 131072,
  'mistralai/mistral-large-2512': 262144,
  'mistralai/mistral-large-2512:batch': 262144,
  'mistralai/mistral-large-4-0': 524288,
  'mistralai/mistral-medium-3': 131072,
  'mistralai/mistral-medium-3-5': 262144,
  'mistralai/mistral-medium-3-5:batch': 262144,
  'mistralai/mistral-medium-3.1': 131072,
  'mistralai/mistral-medium-3.1:batch': 131072,
  'mistralai/mistral-nemo': 131072,
  'mistralai/mistral-saba': 32768,
  'mistralai/mistral-small-2603': 262144,
  'mistralai/mistral-small-2603:batch': 262144,
  'mistralai/mistral-small-3.1-24b-instruct': 128000,
  'mistralai/mistral-small-3.2-24b-instruct': 256000,
  'mistralai/mixtral-8x22b-instruct': 65536,
  'mistralai/voxtral-small-24b-2507': 32768,
  'mixedbread/toast-1': 131000,
  'moonshot.kimi-k2-thinking': 262144,
  'moonshotai.kimi-k2.5': 262144,
  'moonshotai/Kimi-K2-Instruct': 131072,
  'moonshotai/Kimi-K2-Instruct-0905': 262144,
  'moonshotai/Kimi-K2-Thinking': 262144,
  'moonshotai/Kimi-K2.5': 262000,
  'moonshotai/Kimi-K2.6': 262000,
  'moonshotai/Kimi-K2.7-Code': 262000,
  'moonshotai/Kimi-K3': 1000000,
  'moonshotai/kimi-k2': 131072,
  'moonshotai/kimi-k2-0905': 262144,
  'moonshotai/kimi-k2-thinking': 262144,
  'moonshotai/kimi-k2.5': 256000,
  'moonshotai/kimi-k2.6': 262000,
  'moonshotai/kimi-k2.7-code': 256000,
  'moonshotai/kimi-k2.7-code-highspeed': 262144,
  'moonshotai/kimi-k3': 1000000,
  'moonshotai/kimi-k3-fast': 1000000,
  'moonshotai/kimi-k3:batch': 1048576,
  'muse-spark-1.1': 1048576,
  'muse-spark-1.2': 1048576,
  'muse-spark-1.2-contributor': 1048576,
  'muse-spark-1.3': 1048576,
  'muse-spark-1.3-contributor': 1048576,
  'muse-spark-1.3-contributor-free': 1048576,
  'nemotron-3-ultra-free': 1000000,
  'nemotron-3.5-lightning-free': 262144,
  'nex-agi/nex-n2.5-pro': 262144,
  'nvidia.nemotron-nano-12b-v2': 131072,
  'nvidia.nemotron-nano-3-30b': 262144,
  'nvidia.nemotron-nano-9b-v2': 131072,
  'nvidia.nemotron-super-3-120b': 262144,
  'nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B': 202800,
  'nvidia/Nemotron-120B-A12B': 202800,
  'nvidia/cosmos-reason2-8b': 131072,
  'nvidia/llama-3.1-nemotron-70b-instruct': 128000,
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': 128000,
  'nvidia/nemotron-3-nano-30b-a3b': 262144,
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': 256000,
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': 256000,
  'nvidia/nemotron-3-super-120b-a12b': 256000,
  'nvidia/nemotron-3-super-120b-a12b:free': 262144,
  'nvidia/nemotron-3-ultra-550b-a55b': 262144,
  'nvidia/nemotron-3-ultra-550b-a55b:free': 1000000,
  'nvidia/nemotron-3.5-lightning': 262144,
  'nvidia/nemotron-3.5-lightning-30b-a3b': 262144,
  'nvidia/nemotron-3.5-lightning:free': 1000000,
  'nvidia/nemotron-nano-12b-v2-vl': 131072,
  'nvidia/nemotron-nano-9b-v2': 131072,
  'o1': 200000,
  'o1-pro': 200000,
  'o3': 200000,
  'o3-mini': 200000,
  'o3-pro': 200000,
  'o4-mini': 200000,
  'open-mistral-7b': 8000,
  'open-mistral-nemo': 128000,
  'open-mixtral-8x22b': 64000,
  'open-mixtral-8x7b': 32000,
  'openai.gpt-5.4': 1000000,
  'openai.gpt-5.5': 1000000,
  'openai.gpt-5.6-luna': 1050000,
  'openai.gpt-5.6-sol': 1050000,
  'openai.gpt-5.6-terra': 1050000,
  'openai.gpt-6-astra': 1050000,
  'openai.gpt-6-luna': 1050000,
  'openai.gpt-6-sol': 1050000,
  'openai.gpt-6.1-sol': 1050000,
  'openai.gpt-oss-120b': 131072,
  'openai.gpt-oss-120b-1:0': 131072,
  'openai.gpt-oss-20b': 131072,
  'openai.gpt-oss-20b-1:0': 131072,
  'openai.gpt-oss-safeguard-120b': 128000,
  'openai.gpt-oss-safeguard-20b': 128000,
  'openai/gpt-3.5-turbo': 16385,
  'openai/gpt-3.5-turbo-0613': 4095,
  'openai/gpt-3.5-turbo-16k': 16385,
  'openai/gpt-3.5-turbo:batch': 16385,
  'openai/gpt-4': 8191,
  'openai/gpt-4-turbo': 128000,
  'openai/gpt-4-turbo:batch': 128000,
  'openai/gpt-4.1': 1047576,
  'openai/gpt-4.1-fast': 1047576,
  'openai/gpt-4.1-mini': 1047576,
  'openai/gpt-4.1-mini-fast': 1047576,
  'openai/gpt-4.1-mini:batch': 1047576,
  'openai/gpt-4.1-nano': 1047576,
  'openai/gpt-4.1-nano-fast': 1047576,
  'openai/gpt-4.1-nano:batch': 1047576,
  'openai/gpt-4.1:batch': 1047576,
  'openai/gpt-4o': 128000,
  'openai/gpt-4o-2024-05-13': 128000,
  'openai/gpt-4o-2024-08-06': 128000,
  'openai/gpt-4o-2024-11-20': 128000,
  'openai/gpt-4o-fast': 128000,
  'openai/gpt-4o-mini': 128000,
  'openai/gpt-4o-mini-2024-07-18': 128000,
  'openai/gpt-4o-mini-fast': 128000,
  'openai/gpt-4o-mini:batch': 128000,
  'openai/gpt-4o:batch': 128000,
  'openai/gpt-5': 400000,
  'openai/gpt-5-codex': 400000,
  'openai/gpt-5-fast': 400000,
  'openai/gpt-5-mini': 400000,
  'openai/gpt-5-mini-fast': 400000,
  'openai/gpt-5-mini:batch': 400000,
  'openai/gpt-5-nano': 400000,
  'openai/gpt-5-nano:batch': 400000,
  'openai/gpt-5-pro': 400000,
  'openai/gpt-5-pro:batch': 400000,
  'openai/gpt-5.1': 400000,
  'openai/gpt-5.1-codex': 400000,
  'openai/gpt-5.1-codex-max': 400000,
  'openai/gpt-5.1-codex-mini': 400000,
  'openai/gpt-5.1-thinking': 400000,
  'openai/gpt-5.1-thinking-fast': 400000,
  'openai/gpt-5.1:batch': 400000,
  'openai/gpt-5.2': 400000,
  'openai/gpt-5.2-chat': 128000,
  'openai/gpt-5.2-codex': 400000,
  'openai/gpt-5.2-fast': 400000,
  'openai/gpt-5.2-pro': 400000,
  'openai/gpt-5.2-pro:batch': 400000,
  'openai/gpt-5.2:batch': 400000,
  'openai/gpt-5.3-codex': 400000,
  'openai/gpt-5.3-codex-fast': 400000,
  'openai/gpt-5.4': 1050000,
  'openai/gpt-5.4-fast': 1050000,
  'openai/gpt-5.4-mini': 400000,
  'openai/gpt-5.4-mini-fast': 400000,
  'openai/gpt-5.4-mini:batch': 400000,
  'openai/gpt-5.4-nano': 400000,
  'openai/gpt-5.4-nano:batch': 400000,
  'openai/gpt-5.4-pro': 1050000,
  'openai/gpt-5.4-pro:batch': 1050000,
  'openai/gpt-5.4:batch': 1050000,
  'openai/gpt-5.5': 1000000,
  'openai/gpt-5.5-fast': 1000000,
  'openai/gpt-5.5-pro': 1000000,
  'openai/gpt-5.5-pro:batch': 1050000,
  'openai/gpt-5.5:batch': 1050000,
  'openai/gpt-5.6-luna': 1050000,
  'openai/gpt-5.6-luna-fast': 1050000,
  'openai/gpt-5.6-luna-pro': 1050000,
  'openai/gpt-5.6-luna-pro:batch': 1050000,
  'openai/gpt-5.6-luna:batch': 1050000,
  'openai/gpt-5.6-sol': 1050000,
  'openai/gpt-5.6-sol-fast': 1050000,
  'openai/gpt-5.6-sol-pro': 1050000,
  'openai/gpt-5.6-sol-pro:batch': 1050000,
  'openai/gpt-5.6-sol:batch': 1050000,
  'openai/gpt-5.6-terra': 1050000,
  'openai/gpt-5.6-terra-fast': 1050000,
  'openai/gpt-5.6-terra-pro': 1050000,
  'openai/gpt-5.6-terra-pro:batch': 1050000,
  'openai/gpt-5.6-terra:batch': 1050000,
  'openai/gpt-5:batch': 400000,
  'openai/gpt-6-astra': 1050000,
  'openai/gpt-6-astra-fast': 1050000,
  'openai/gpt-6-astra-pro': 1050000,
  'openai/gpt-6-astra-pro:batch': 1050000,
  'openai/gpt-6-astra:batch': 1050000,
  'openai/gpt-6-luna': 1050000,
  'openai/gpt-6-luna-fast': 1050000,
  'openai/gpt-6-luna-pro': 1050000,
  'openai/gpt-6-luna-pro:batch': 1050000,
  'openai/gpt-6-luna:batch': 1050000,
  'openai/gpt-6-sol': 1050000,
  'openai/gpt-6-sol-fast': 1050000,
  'openai/gpt-6-sol-pro': 1050000,
  'openai/gpt-6-sol-pro:batch': 1050000,
  'openai/gpt-6-sol:batch': 1050000,
  'openai/gpt-6.1-sol': 1050000,
  'openai/gpt-6.1-sol-fast': 1050000,
  'openai/gpt-6.1-sol-pro': 1050000,
  'openai/gpt-audio': 128000,
  'openai/gpt-audio-mini': 128000,
  'openai/gpt-chat-latest': 400000,
  'openai/gpt-oss-120b': 128072,
  'openai/gpt-oss-120b:batch': 131072,
  'openai/gpt-oss-20b': 131072,
  'openai/gpt-oss-20b:batch': 131072,
  'openai/gpt-oss-safeguard-120b': 128000,
  'openai/gpt-oss-safeguard-20b': 128000,
  'openai/o1': 200000,
  'openai/o3': 200000,
  'openai/o3-fast': 200000,
  'openai/o3-mini': 200000,
  'openai/o3-mini-high': 200000,
  'openai/o3-mini:batch': 200000,
  'openai/o3-pro': 200000,
  'openai/o3:batch': 200000,
  'openai/o4-mini': 200000,
  'openai/o4-mini-fast': 200000,
  'openai/o4-mini-high': 200000,
  'openai/o4-mini:batch': 200000,
  'openrouter/auto': 2000000,
  'openrouter/auto-beta': 2000000,
  'openrouter/free': 200000,
  'openrouter/fusion': 1000000,
  'perceptron/perceptron-mk1.5': 36864,
  'pixtral-12b': 128000,
  'pixtral-large-latest': 128000,
  'poolside/laguna-s-2.1': 1000000,
  'poolside/laguna-s-2.1-free': 256000,
  'poolside/laguna-s-2.1:free': 262144,
  'poolside/laguna-xs-2.1': 262144,
  'poolside/laguna-xs-2.1:free': 262144,
  'precise': 272000,
  'prism-ml/ternary-bonsai-2-27b': 262144,
  'quiverai/arrow-2': 131072,
  'quiverai/arrow-2-telos': 131072,
  'qwen-3.8-27b': 131072,
  'qwen.qwen3-235b-a22b-2507-v1:0': 262144,
  'qwen.qwen3-32b-v1:0': 32768,
  'qwen.qwen3-coder-30b-a3b-v1:0': 262144,
  'qwen.qwen3-coder-480b-a35b-v1:0': 131072,
  'qwen.qwen3-coder-next': 262144,
  'qwen.qwen3-next-80b-a3b': 262144,
  'qwen.qwen3-vl-235b-a22b': 262144,
  'qwen/qwen-2.5-72b-instruct': 32768,
  'qwen/qwen-2.5-7b-instruct': 32768,
  'qwen/qwen-plus': 1000000,
  'qwen/qwen-plus-2025-07-28': 1000000,
  'qwen/qwen3-14b': 40960,
  'qwen/qwen3-235b-a22b': 131072,
  'qwen/qwen3-235b-a22b-2507': 262144,
  'qwen/qwen3-235b-a22b-thinking-2507': 131072,
  'qwen/qwen3-30b-a3b': 40960,
  'qwen/qwen3-30b-a3b-instruct-2507': 128000,
  'qwen/qwen3-30b-a3b-thinking-2507': 81920,
  'qwen/qwen3-32b': 40960,
  'qwen/qwen3-8b': 131072,
  'qwen/qwen3-coder': 262144,
  'qwen/qwen3-coder-30b-a3b-instruct': 262144,
  'qwen/qwen3-coder-flash': 1000000,
  'qwen/qwen3-coder-next': 262144,
  'qwen/qwen3-coder-plus': 1000000,
  'qwen/qwen3-max': 262144,
  'qwen/qwen3-max-thinking': 262144,
  'qwen/qwen3-next-80b-a3b-instruct': 262144,
  'qwen/qwen3-next-80b-a3b-thinking': 131072,
  'qwen/qwen3-vl-235b-a22b-instruct': 131072,
  'qwen/qwen3-vl-235b-a22b-thinking': 131072,
  'qwen/qwen3-vl-30b-a3b-instruct': 262144,
  'qwen/qwen3-vl-30b-a3b-thinking': 131072,
  'qwen/qwen3-vl-32b-instruct': 131072,
  'qwen/qwen3-vl-8b-instruct': 131072,
  'qwen/qwen3-vl-8b-thinking': 131072,
  'qwen/qwen3.5-122b-a10b': 262144,
  'qwen/qwen3.5-27b': 262144,
  'qwen/qwen3.5-35b-a3b': 262144,
  'qwen/qwen3.5-397b-a17b': 262144,
  'qwen/qwen3.5-9b': 256000,
  'qwen/qwen3.5-flash-02-23': 1000000,
  'qwen/qwen3.5-plus-02-15': 1000000,
  'qwen/qwen3.5-plus-20260420': 1000000,
  'qwen/qwen3.6-27b': 131072,
  'qwen/qwen3.6-35b-a3b': 262144,
  'qwen/qwen3.6-flash': 1000000,
  'qwen/qwen3.6-max-preview': 262144,
  'qwen/qwen3.6-plus': 1000000,
  'qwen/qwen3.7-flash': 1000000,
  'qwen/qwen3.7-max': 1000000,
  'qwen/qwen3.7-plus': 1000000,
  'qwen/qwen3.8-2.4t-a95b': 1048576,
  'qwen/qwen3.8-27b': 131042,
  'qwen/qwen3.8-flash': 1000000,
  'qwen/qwen3.8-max-0902': 1000000,
  'qwen/qwen3.8-max-prime': 1000000,
  'qwen/qwen3.8-omni-flash': 1000000,
  'qwen3.5-plus': 262144,
  'qwen3.6-flash': 1000000,
  'qwen3.6-plus': 262144,
  'qwen3.7-max': 1000000,
  'qwen3.7-plus': 1000000,
  'qwen3.8-flash': 1000000,
  'qwen3.8-max': 262144,
  'rekaai/reka-edge': 16384,
  'relace/relace-search': 256000,
  'sakana/fugu-max': 1000000,
  'sakana/fugu-ultra': 1000000,
  'sakana/fugu-ultra-v2': 1000000,
  'sakana/namazu': 256000,
  'sakana/sakana-namazu': 262144,
  'sao10k/l3.1-euryale-70b': 131072,
  'space-bunny': 1048576,
  'space-bunny-free': 1048576,
  'spacexai/grok-4.1-fast-non-reasoning': 1000000,
  'spacexai/grok-4.1-fast-reasoning': 1000000,
  'spacexai/grok-4.20-multi-agent': 2000000,
  'spacexai/grok-4.20-multi-agent-beta': 2000000,
  'spacexai/grok-4.20-non-reasoning': 2000000,
  'spacexai/grok-4.20-non-reasoning-beta': 2000000,
  'spacexai/grok-4.20-reasoning': 2000000,
  'spacexai/grok-4.20-reasoning-beta': 2000000,
  'spacexai/grok-4.3': 1000000,
  'spacexai/grok-4.5': 500000,
  'spacexai/grok-4.6': 500000,
  'spacexai/grok-4.7': 500000,
  'spacexai/grok-build-0.1': 256000,
  'stealth/glyph-cluster': 256000,
  'stepfun-ai/Step-3.5-Flash': 262144,
  'stepfun-ai/Step-3.7-Flash': 262144,
  'stepfun/step-3.5-flash': 262144,
  'stepfun/step-3.7-flash': 256000,
  'tencent/Hy3': 262144,
  'tencent/Hy4-preview': 1000000,
  'tencent/hy3': 262144,
  'tencent/hy3-preview': 262144,
  'tencent/hy4-preview': 1024000,
  'thinkingmachines/Inkling': 524288,
  'thinkingmachines/Inkling-Small': 524288,
  'thinkingmachines/inkling': 256000,
  'thinkingmachines/inkling-small': 524288,
  'thinkingmachines/inkling-small:free': 1048576,
  'thinkingmachines/inkling:free': 1048576,
  'typesafe/jev-router': 1000000,
  'unbiased/pareto': 262144,
  'unbiased/pareto-26.10-preview': 1048576,
  'upstage/solar-mini4': 524288,
  'upstage/solar-pro-3': 131072,
  'upstage/solar-pro4': 524288,
  'us-gov.openai.gpt-oss-120b-1:0': 128000,
  'us-gov.openai.gpt-oss-20b-1:0': 128000,
  'us.amazon.nova-2-lite-v1:0': 1000000,
  'us.amazon.nova-lite-v1:0': 300000,
  'us.amazon.nova-micro-v1:0': 128000,
  'us.amazon.nova-premier-v1:0': 1000000,
  'us.amazon.nova-pro-v1:0': 300000,
  'us.anthropic.claude-fable-5': 1000000,
  'us.anthropic.claude-fable-5-1': 1000000,
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': 200000,
  'us.anthropic.claude-haiku-5-5': 1000000,
  'us.anthropic.claude-opus-4-1-20250805-v1:0': 200000,
  'us.anthropic.claude-opus-4-5-20251101-v1:0': 200000,
  'us.anthropic.claude-opus-4-6-v1': 1000000,
  'us.anthropic.claude-opus-4-7': 1000000,
  'us.anthropic.claude-opus-4-8': 1000000,
  'us.anthropic.claude-opus-5': 1000000,
  'us.anthropic.claude-opus-5-5': 1000000,
  'us.anthropic.claude-sonnet-4-20250514-v1:0': 200000,
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': 200000,
  'us.anthropic.claude-sonnet-4-6': 1000000,
  'us.anthropic.claude-sonnet-5': 1000000,
  'us.anthropic.claude-sonnet-5-5': 1000000,
  'us.meta.llama3-1-70b-instruct-v1:0': 128000,
  'us.meta.llama3-1-8b-instruct-v1:0': 128000,
  'us.meta.llama3-3-70b-instruct-v1:0': 128000,
  'us.meta.llama4-maverick-17b-instruct-v1:0': 1000000,
  'us.meta.llama4-scout-17b-instruct-v1:0': 10000000,
  'us.mistral.pixtral-large-2502-v1:0': 128000,
  'us.moonshotai.kimi-k3': 1048576,
  'us.openai.gpt-5.6-luna': 1050000,
  'us.openai.gpt-5.6-sol': 1050000,
  'us.openai.gpt-5.6-terra': 1050000,
  'us.openai.gpt-6-astra': 1050000,
  'us.openai.gpt-6-luna': 1050000,
  'us.openai.gpt-6-sol': 1050000,
  'us.openai.gpt-6.1-sol': 1050000,
  'us.writer.palmyra-x4-v1:0': 122880,
  'us.writer.palmyra-x5-v1:0': 1040000,
  'us.xai.grok-4.6': 500000,
  'us.xai.grok-4.7': 500000,
  'us.zai.glm-5.3': 1000000,
  'voxtral-small-2507': 32768,
  'voxtral-small-latest': 32768,
  'workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731': 1048576,
  'workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813': 1048576,
  'workers-ai/@cf/google/gemma-4-26b-a4b-it': 256000,
  'workers-ai/@cf/ibm-granite/granite-4.0-h-micro': 131000,
  'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast': 24000,
  'workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct': 131000,
  'workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct': 128000,
  'workers-ai/@cf/moonshotai/kimi-k2.6': 262144,
  'workers-ai/@cf/moonshotai/kimi-k2.7-code': 262144,
  'workers-ai/@cf/nvidia/nemotron-3-120b-a12b': 256000,
  'workers-ai/@cf/openai/gpt-oss-120b': 128000,
  'workers-ai/@cf/openai/gpt-oss-20b': 128000,
  'workers-ai/@cf/qwen/qwen3-30b-a3b-fp8': 32768,
  'workers-ai/@cf/qwen/qwen3.8-27b': 262144,
  'workers-ai/@cf/zai-org/glm-4.7-flash': 131072,
  'workers-ai/@cf/zai-org/glm-5.2': 262144,
  'workers-ai/@cf/zai-org/glm-5.3': 1048576,
  'workers-ai/@cf/zai-org/glm-5.3-flash': 1048576,
  'writer.palmyra-x4-v1:0': 122880,
  'writer.palmyra-x5-v1:0': 1040000,
  'x-ai/grok-4.20': 2000000,
  'x-ai/grok-4.3': 1000000,
  'x-ai/grok-4.3:batch': 1000000,
  'x-ai/grok-4.5': 500000,
  'x-ai/grok-4.6': 500000,
  'x-ai/grok-4.7': 500000,
  'x-ai/grok-build-0.1': 256000,
  'xai.grok-4.3': 1000000,
  'xai.grok-4.6': 500000,
  'xiaomi/mimo-v2.5': 1048576,
  'xiaomi/mimo-v2.5-pro': 1048576,
  'xiaomi/mimo-v2.6-flash': 1048576,
  'xiaomi/mimo-v2.6-pro': 1048576,
  'xiaomi/mimo-v2.6-pro-ultraspeed': 1048576,
  'z-ai/glm-4.5': 131072,
  'z-ai/glm-4.5-air': 131072,
  'z-ai/glm-4.5v': 65536,
  'z-ai/glm-4.6': 198000,
  'z-ai/glm-4.6v': 131072,
  'z-ai/glm-4.7': 202752,
  'z-ai/glm-4.7-flash': 131072,
  'z-ai/glm-5': 198000,
  'z-ai/glm-5-turbo': 202752,
  'z-ai/glm-5.1': 200000,
  'z-ai/glm-5.2': 1048576,
  'z-ai/glm-5.3': 1000000,
  'z-ai/glm-5.3-flash': 1000000,
  'z-ai/glm-5.3-flash:batch': 1048576,
  'z-ai/glm-5.3-flashx': 1048576,
  'z-ai/glm-5.3-prime': 1000000,
  'z-ai/glm-5.3:batch': 1048576,
  'z-ai/glm-5v-turbo': 202752,
  'zai-glm-5-2': 1048576,
  'zai-glm-5-3': 1048576,
  'zai-org/GLM-4.5': 131072,
  'zai-org/GLM-4.5-Air': 131072,
  'zai-org/GLM-4.5V': 65536,
  'zai-org/GLM-4.6': 204800,
  'zai-org/GLM-4.6V-Flash': 131072,
  'zai-org/GLM-4.7': 200000,
  'zai-org/GLM-4.7-Flash': 200000,
  'zai-org/GLM-5': 202752,
  'zai-org/GLM-5.1': 202752,
  'zai-org/GLM-5.2': 262144,
  'zai-org/GLM-5.2-Fast': 1048576,
  'zai-org/GLM-5.3': 1048576,
  'zai-org/GLM-5.3-Fast': 1048576,
  'zai-org/GLM-5.3-Flash': 1048575,
  'zai.glm-4.7': 202752,
  'zai.glm-4.7-flash': 202752,
  'zai.glm-5': 202752,
  'zai/glm-4.5': 128000,
  'zai/glm-4.5-air': 128000,
  'zai/glm-4.5v': 66000,
  'zai/glm-4.6': 200000,
  'zai/glm-4.7': 200000,
  'zai/glm-4.7-flash': 200000,
  'zai/glm-4.7-flashx': 200000,
  'zai/glm-5': 202800,
  'zai/glm-5-turbo': 202800,
  'zai/glm-5.1': 202800,
  'zai/glm-5.2': 1000000,
  'zai/glm-5.2-fast': 1000000,
  'zai/glm-5.3': 1000000,
  'zai/glm-5.3-fast': 1048576,
  'zai/glm-5.3-flash': 1000000,
  'zai/glm-5.3-flashx': 1000000,
  'zai/glm-5v-turbo': 200000,
  '~anthropic/claude-fable-latest': 1000000,
  '~anthropic/claude-haiku-latest': 1000000,
  '~anthropic/claude-opus-latest': 1000000,
  '~anthropic/claude-sonnet-latest': 1000000,
  '~deepseek/deepseek-flash-latest': 1048576,
  '~deepseek/deepseek-pro-latest': 1048576,
  '~deepseek/deepseek-v4-flash-latest': 1048576,
  '~google/gemini-flash-latest': 1048576,
  '~google/gemini-pro-latest': 1048576,
  '~moonshotai/kimi-latest': 1048576,
  '~openai/gpt-astra-latest': 1050000,
  '~openai/gpt-luna-latest': 1050000,
  '~openai/gpt-mini-latest': 400000,
  '~openai/gpt-sol-latest': 1050000,
  '~openai/gpt-terra-latest': 1050000,
  '~x-ai/grok-latest': 500000,
  '~z-ai/glm-flash-latest': 1048576,
  '~z-ai/glm-latest': 1048576,
}

/** Every chat model the catalog describes, one per line. */
export const CHAT_MODELS: ReadonlySet<string> = new Set(`
@cf/deepseek-ai/deepseek-v4-flash-0731
@cf/deepseek-ai/deepseek-v4-pro-0813
@cf/google/gemma-4-26b-a4b-it
@cf/ibm-granite/granite-4.0-h-micro
@cf/meta/llama-3.3-70b-instruct-fp8-fast
@cf/meta/llama-4-scout-17b-16e-instruct
@cf/mistralai/mistral-small-3.1-24b-instruct
@cf/moonshotai/kimi-k2.6
@cf/moonshotai/kimi-k2.7-code
@cf/nvidia/nemotron-3-120b-a12b
@cf/openai/gpt-oss-120b
@cf/openai/gpt-oss-20b
@cf/qwen/qwen3-30b-a3b-fp8
@cf/qwen/qwen3.8-27b
@cf/zai-org/glm-4.7-flash
@cf/zai-org/glm-5.2
@cf/zai-org/glm-5.3
@cf/zai-org/glm-5.3-flash
Ling-2.6-1T
Ling-2.6-flash
MiniMax-M2.5
MiniMax-M2.7
MiniMax-M2.7-highspeed
MiniMax-M3
MiniMaxAI/MiniMax-M2
MiniMaxAI/MiniMax-M2.1
MiniMaxAI/MiniMax-M2.5
MiniMaxAI/MiniMax-M2.7
MiniMaxAI/MiniMax-M3
Qwen/Qwen2.5-7B-Instruct-Turbo
Qwen/Qwen2.5-Coder-32B-Instruct
Qwen/Qwen3-235B-A22B
Qwen/Qwen3-235B-A22B-Instruct-2507
Qwen/Qwen3-235B-A22B-Thinking-2507
Qwen/Qwen3-30B-A3B
Qwen/Qwen3-32B
Qwen/Qwen3-Coder-30B-A3B-Instruct
Qwen/Qwen3-Coder-480B-A35B-Instruct
Qwen/Qwen3-Coder-Next
Qwen/Qwen3-Next-80B-A3B-Instruct
Qwen/Qwen3-Next-80B-A3B-Thinking
Qwen/Qwen3-VL-235B-A22B-Instruct
Qwen/Qwen3-VL-235B-A22B-Thinking
Qwen/Qwen3.5-122B-A10B
Qwen/Qwen3.5-27B
Qwen/Qwen3.5-35B-A3B
Qwen/Qwen3.5-397B-A17B
Qwen/Qwen3.5-9B
Qwen/Qwen3.6-27B
Qwen/Qwen3.6-35B-A3B
Qwen/Qwen3.6-Plus
Qwen/Qwen3.7-Max
Qwen/Qwen3.8-2.4T-A95B
Qwen/Qwen3.8-27B
Ring-2.6-1T
XiaomiMiMo/MiMo-V2-Flash
XiaomiMiMo/MiMo-V2.5
XiaomiMiMo/MiMo-V2.5-Pro
accounts/fireworks/models/deepseek-v4p1-flash
accounts/fireworks/models/ember-1
accounts/fireworks/models/glm-5p3
accounts/fireworks/models/glm-5p3-flash
accounts/fireworks/models/gpt-oss-120b
accounts/fireworks/models/inkling
accounts/fireworks/models/kimi-k3
accounts/fireworks/models/minimax-m3
accounts/fireworks/models/nemotron-3-ultra-nvfp4
accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b
accounts/fireworks/models/qwen3p8-2p4t-a95b
accounts/fireworks/models/qwen3p8-max
accounts/fireworks/routers/deepseek-flash-latest
accounts/fireworks/routers/glm-5p3-fast
accounts/fireworks/routers/glm-fast-latest
accounts/fireworks/routers/glm-flash-latest
accounts/fireworks/routers/glm-latest
accounts/fireworks/routers/kimi-fast-latest
accounts/fireworks/routers/kimi-k3-fast
accounts/fireworks/routers/kimi-latest
accounts/fireworks/routers/minimax-latest
accounts/fireworks/routers/qwen-max-latest
aion-labs/aion-2.0
aion-labs/aion-3.0
aion-labs/aion-3.0-mini
aion-labs/aion-3.5
aion-labs/aion-3.5-mini
alibaba/qwen-3-14b
alibaba/qwen-3-235b
alibaba/qwen-3-30b
alibaba/qwen-3-32b
alibaba/qwen-3.6-max-preview
alibaba/qwen3-235b-a22b-thinking
alibaba/qwen3-coder
alibaba/qwen3-coder-30b-a3b
alibaba/qwen3-coder-next
alibaba/qwen3-coder-plus
alibaba/qwen3-max
alibaba/qwen3-max-preview
alibaba/qwen3-max-thinking
alibaba/qwen3-next-80b-a3b-instruct
alibaba/qwen3-next-80b-a3b-thinking
alibaba/qwen3-vl-235b-a22b-instruct
alibaba/qwen3-vl-instruct
alibaba/qwen3-vl-thinking
alibaba/qwen3.5-flash
alibaba/qwen3.5-plus
alibaba/qwen3.6-27b
alibaba/qwen3.6-plus
alibaba/qwen3.7-flash
alibaba/qwen3.7-max
alibaba/qwen3.7-plus
alibaba/qwen3.8-2.4t-a95b
alibaba/qwen3.8-27b
alibaba/qwen3.8-flash
alibaba/qwen3.8-max
alibaba/qwen3.8-max-0902
alibaba/qwen3.8-max-prime
alibaba/qwen3.8-omni-flash
amazon.nova-2-lite-v1:0
amazon.nova-lite-v1:0
amazon.nova-micro-v1:0
amazon.nova-pro-v1:0
amazon/nova-2-lite
amazon/nova-2-lite-v1
amazon/nova-lite
amazon/nova-lite-v1
amazon/nova-micro
amazon/nova-micro-v1
amazon/nova-premier-v1
amazon/nova-pro
amazon/nova-pro-v1
anthropic.claude-fable-5
anthropic.claude-fable-5-1
anthropic.claude-haiku-4-5-20251001-v1:0
anthropic.claude-haiku-5-5
anthropic.claude-opus-4-1-20250805-v1:0
anthropic.claude-opus-4-5-20251101-v1:0
anthropic.claude-opus-4-6-v1
anthropic.claude-opus-4-7
anthropic.claude-opus-4-8
anthropic.claude-opus-5-5
anthropic.claude-sonnet-4-5-20250929-v1:0
anthropic.claude-sonnet-4-6
anthropic.claude-sonnet-5
anthropic.claude-sonnet-5-5
anthropic/claude-3-haiku
anthropic/claude-fable-5
anthropic/claude-fable-5.1
anthropic/claude-fable-5.1:batch
anthropic/claude-fable-5:batch
anthropic/claude-haiku-4.5
anthropic/claude-haiku-4.5:batch
anthropic/claude-haiku-5.5
anthropic/claude-haiku-5.5:batch
anthropic/claude-opus-4
anthropic/claude-opus-4.1
anthropic/claude-opus-4.1:batch
anthropic/claude-opus-4.5
anthropic/claude-opus-4.5:batch
anthropic/claude-opus-4.6
anthropic/claude-opus-4.6:batch
anthropic/claude-opus-4.7
anthropic/claude-opus-4.7:batch
anthropic/claude-opus-4.8
anthropic/claude-opus-4.8-fast
anthropic/claude-opus-4.8:batch
anthropic/claude-opus-5
anthropic/claude-opus-5-fast
anthropic/claude-opus-5.5
anthropic/claude-opus-5.5-fast
anthropic/claude-opus-5.5:batch
anthropic/claude-opus-5:batch
anthropic/claude-sonnet-4
anthropic/claude-sonnet-4.5
anthropic/claude-sonnet-4.5:batch
anthropic/claude-sonnet-4.6
anthropic/claude-sonnet-4.6:batch
anthropic/claude-sonnet-5
anthropic/claude-sonnet-5.5
anthropic/claude-sonnet-5.5:batch
anthropic/claude-sonnet-5:batch
apac.amazon.nova-lite-v1:0
apac.amazon.nova-micro-v1:0
apac.amazon.nova-pro-v1:0
apac.anthropic.claude-sonnet-4-20250514-v1:0
apodex/apodex-1.1-mini:free
arcee-ai/trinity-large-thinking
au.anthropic.claude-haiku-4-5-20251001-v1:0
au.anthropic.claude-haiku-5-5
au.anthropic.claude-opus-4-6-v1
au.anthropic.claude-opus-4-7
au.anthropic.claude-opus-4-8
au.anthropic.claude-opus-5
au.anthropic.claude-opus-5-5
au.anthropic.claude-sonnet-4-5-20250929-v1:0
au.anthropic.claude-sonnet-4-6
au.anthropic.claude-sonnet-5
auto
balanced
big-pickle
bytedance-seed/seed-1.6
bytedance-seed/seed-1.6-flash
bytedance-seed/seed-2-1-turbo
bytedance-seed/seed-2.0-code
bytedance-seed/seed-2.0-lite
bytedance-seed/seed-2.0-mini
bytedance/seed-1.6
bytedance/seed-1.8
bytedance/seed-2.1-turbo
ca.amazon.nova-lite-v1:0
cheap
claude-fable-5
claude-fable-5-1
claude-fable-5.1
claude-haiku-4-5
claude-haiku-4-5-20251001
claude-haiku-4.5
claude-haiku-5-5
claude-opus-4-5
claude-opus-4-5-20251101
claude-opus-4-6
claude-opus-4-7
claude-opus-4-8
claude-opus-4.7
claude-opus-4.8
claude-opus-5
claude-opus-5-5
claude-opus-5.5
claude-sonnet-4
claude-sonnet-4-5
claude-sonnet-4-5-20250929
claude-sonnet-4-6
claude-sonnet-4.6
claude-sonnet-5
claude-sonnet-5-5
claude-sonnet-5.5
codestral-2508
codestral-latest
cohere/command-a
cohere/command-a-plus
cohere/command-r-08-2024
cohere/command-r-plus-08-2024
cohere/north-mini-code:free
deep-research-max-preview-04-2026
deep-research-preview-04-2026
deepseek-ai/DeepSeek-R1
deepseek-ai/DeepSeek-R1-0528
deepseek-ai/DeepSeek-V3
deepseek-ai/DeepSeek-V3-0324
deepseek-ai/DeepSeek-V3.1
deepseek-ai/DeepSeek-V3.2
deepseek-ai/DeepSeek-V4-Flash
deepseek-ai/DeepSeek-V4-Flash-0731
deepseek-ai/DeepSeek-V4-Flash-Vision-Exp
deepseek-ai/DeepSeek-V4-Pro
deepseek-ai/DeepSeek-V4-Pro-0813
deepseek-ai/DeepSeek-V4.1-Flash
deepseek-ai/DeepSeek-V4.1-Flash-Fast
deepseek-ai/deepseek-v4.1-flash
deepseek-flash
deepseek-v3.2
deepseek-v4-flash
deepseek-v4-flash-0731
deepseek-v4-flash-vision-exp
deepseek-v4-pro
deepseek-v4-pro-0813
deepseek-v4.1-flash
deepseek.v3-v1:0
deepseek.v3.2
deepseek/deepseek-chat
deepseek/deepseek-chat-v3-0324
deepseek/deepseek-chat-v3.1
deepseek/deepseek-r1
deepseek/deepseek-r1-0528
deepseek/deepseek-v3.1
deepseek/deepseek-v3.1-terminus
deepseek/deepseek-v3.2
deepseek/deepseek-v3.2-exp
deepseek/deepseek-v3.2-thinking
deepseek/deepseek-v4-flash
deepseek/deepseek-v4-flash-0731
deepseek/deepseek-v4-flash-vision-exp
deepseek/deepseek-v4-pro
deepseek/deepseek-v4-pro-0813
deepseek/deepseek-v4.1-flash
deepseek/deepseek-v4.1-flash-fast
deepseek/deepseek-v4.1-flash:batch
devstral-2512
devstral-latest
devstral-medium-2507
devstral-medium-latest
devstral-small-2505
devstral-small-2507
dots-studio/dots-3-note-preview:free
eu.amazon.nova-2-lite-v1:0
eu.amazon.nova-lite-v1:0
eu.amazon.nova-micro-v1:0
eu.amazon.nova-pro-v1:0
eu.anthropic.claude-fable-5
eu.anthropic.claude-haiku-4-5-20251001-v1:0
eu.anthropic.claude-haiku-5-5
eu.anthropic.claude-opus-4-5-20251101-v1:0
eu.anthropic.claude-opus-4-6-v1
eu.anthropic.claude-opus-4-7
eu.anthropic.claude-opus-4-8
eu.anthropic.claude-opus-5
eu.anthropic.claude-opus-5-5
eu.anthropic.claude-sonnet-4-20250514-v1:0
eu.anthropic.claude-sonnet-4-5-20250929-v1:0
eu.anthropic.claude-sonnet-4-6
eu.anthropic.claude-sonnet-5
eu.anthropic.claude-sonnet-5-5
eu.mistral.pixtral-large-2502-v1:0
exo-free
fireworks/ember-1
fledge-alpha-free
gemini-2.5-computer-use-preview-10-2025
gemini-2.5-flash
gemini-2.5-flash-lite
gemini-2.5-pro
gemini-3-flash
gemini-3-flash-preview
gemini-3.1-flash-lite
gemini-3.1-flash-lite-image
gemini-3.1-flash-lite-preview
gemini-3.1-flash-live-preview
gemini-3.1-pro
gemini-3.1-pro-preview
gemini-3.1-pro-preview-customtools
gemini-3.5-flash
gemini-3.5-flash-lite
gemini-3.6-flash
gemini-3.7-flash
gemini-3.8-flash
gemini-flash-latest
gemini-flash-lite-latest
gemma-4-26b-a4b-it
gemma-4-31b-it
glm-4.6v
glm-4.7
glm-5
glm-5-2
glm-5-turbo
glm-5.1
glm-5.2
glm-5.2-highspeed
glm-5.3
glm-5.3-flash
glm-5.3-highspeed
global.amazon.nova-2-lite-v1:0
global.anthropic.claude-fable-5
global.anthropic.claude-fable-5-1
global.anthropic.claude-haiku-4-5-20251001-v1:0
global.anthropic.claude-haiku-5-5
global.anthropic.claude-opus-4-5-20251101-v1:0
global.anthropic.claude-opus-4-6-v1
global.anthropic.claude-opus-4-7
global.anthropic.claude-opus-4-8
global.anthropic.claude-opus-5
global.anthropic.claude-opus-5-5
global.anthropic.claude-sonnet-4-20250514-v1:0
global.anthropic.claude-sonnet-4-5-20250929-v1:0
global.anthropic.claude-sonnet-4-6
global.anthropic.claude-sonnet-5
global.anthropic.claude-sonnet-5-5
global.moonshotai.kimi-k3
global.openai.gpt-5.6-luna
global.openai.gpt-5.6-sol
global.openai.gpt-5.6-terra
global.openai.gpt-6-astra
global.openai.gpt-6-luna
global.openai.gpt-6-sol
global.openai.gpt-6.1-sol
global.xai.grok-4.6
global.xai.grok-4.7
global.zai.glm-5.3
google.gemma-4-26b-a4b
google.gemma-4-31b
google.gemma-4-e2b
google/diffusiongemma-26b-a4b-it
google/gemini-2.5-flash
google/gemini-2.5-flash-lite
google/gemini-2.5-flash-lite:batch
google/gemini-2.5-flash:batch
google/gemini-2.5-pro
google/gemini-2.5-pro-preview
google/gemini-2.5-pro:batch
google/gemini-3-flash
google/gemini-3-flash-preview
google/gemini-3-flash-preview:batch
google/gemini-3-pro-image
google/gemini-3.1-flash-lite
google/gemini-3.1-flash-lite-preview
google/gemini-3.1-flash-lite:batch
google/gemini-3.1-pro-preview
google/gemini-3.1-pro-preview-customtools
google/gemini-3.1-pro-preview:batch
google/gemini-3.5-flash
google/gemini-3.5-flash-lite
google/gemini-3.5-flash-lite:batch
google/gemini-3.5-flash:batch
google/gemini-3.6-flash
google/gemini-3.6-flash:batch
google/gemini-3.7-flash
google/gemini-3.7-flash:batch
google/gemini-3.8-flash
google/gemini-3.8-flash:batch
google/gemini-nano-banana-2.1
google/gemma-3-12b-it
google/gemma-3-27b-it
google/gemma-3-4b-it
google/gemma-4-26B-A4B-it
google/gemma-4-26b-a4b-it
google/gemma-4-26b-a4b-it:free
google/gemma-4-31B-it
google/gemma-4-31b-it
google/gemma-4-31b-it:free
gpt-4
gpt-4-turbo
gpt-4.1
gpt-4.1-mini
gpt-4.1-nano
gpt-4o
gpt-4o-2024-05-13
gpt-4o-2024-08-06
gpt-4o-2024-11-20
gpt-4o-mini
gpt-5
gpt-5-chat-latest
gpt-5-codex
gpt-5-mini
gpt-5-nano
gpt-5-pro
gpt-5.1
gpt-5.1-codex
gpt-5.1-codex-max
gpt-5.1-codex-mini
gpt-5.2
gpt-5.2-chat-latest
gpt-5.2-codex
gpt-5.2-pro
gpt-5.3-chat-latest
gpt-5.3-codex
gpt-5.3-codex-spark
gpt-5.4
gpt-5.4-mini
gpt-5.4-nano
gpt-5.4-pro
gpt-5.5
gpt-5.5-pro
gpt-5.6-luna
gpt-5.6-sol
gpt-5.6-terra
gpt-6-astra
gpt-6-luna
gpt-6-sol
gpt-6.1-sol
gpt-daybreak-blue-latest
gpt-daybreak-red-latest
gpt-oss-120b
gpt-realtime-2.1
grok-4.3
grok-4.5
grok-4.6
grok-4.7
grok-build-0.1
hy3
hy4-preview
ibm-granite/granite-4.2-8b
in.anthropic.claude-haiku-4-5-20251001-v1:0
in.anthropic.claude-opus-5
in.anthropic.claude-sonnet-5
in.openai.gpt-5.6-luna
in.openai.gpt-5.6-terra
inception/mercury-2
inception/mercury-2.5
inception/mercury-coder-small
inclusionai/ling-3.0-flash
inclusionai/ling-3.0-flash-fin
inclusionai/ling-3.0-flash-sante
inclusionai/ling-3.0-flash-sante:free
inclusionai/ling-3.0-flash-vl
inclusionai/ling-3.1-flash
inclusionai/ling-3.1-flash-free
interfaze/interfaze-beta
jp.amazon.nova-2-lite-v1:0
jp.anthropic.claude-haiku-4-5-20251001-v1:0
jp.anthropic.claude-haiku-5-5
jp.anthropic.claude-opus-4-7
jp.anthropic.claude-opus-4-8
jp.anthropic.claude-opus-5
jp.anthropic.claude-opus-5-5
jp.anthropic.claude-sonnet-4-5-20250929-v1:0
jp.anthropic.claude-sonnet-4-6
jp.anthropic.claude-sonnet-5
k3
k3-256k
kimi-for-coding
kimi-for-coding-highspeed
kimi-k2.5
kimi-k2.6
kimi-k2.7-code
kimi-k2.7-code-highspeed
kimi-k3
labs-devstral-small-2512
labs-leanstral-1-5-1
ling-3.0-flash-fin-free
ling-3.1-flash-free
liquid/lfm-2.5-2.6b:free
llama-3.1-8b-instant
llama-3.3-70b-versatile
longcat-2.0
longcat-2.5-preview-free
magistral-medium-latest
mai-code-1-flash-picker
mai-code-1.1-flash
meituan/longcat-2.0
meituan/longcat-2.5-preview
meta-llama/Llama-3.1-8B-Instruct
meta-llama/Llama-3.3-70B-Instruct
meta-llama/Llama-3.3-70B-Instruct-Turbo
meta-llama/llama-3.1-70b-instruct
meta-llama/llama-3.1-8b-instruct
meta-llama/llama-3.3-70b-instruct
meta-llama/llama-4-maverick
meta-llama/llama-4-scout
meta.llama3-1-70b-instruct-v1:0
meta.llama3-1-8b-instruct-v1:0
meta.llama3-3-70b-instruct-v1:0
meta.llama4-maverick-17b-instruct-v1:0
meta.llama4-scout-17b-instruct-v1:0
meta/llama-3.1-70b
meta/llama-3.1-8b
meta/llama-3.2-11b-vision-instruct
meta/llama-3.2-90b-vision-instruct
meta/llama-3.3-70b
meta/llama-4-maverick
meta/llama-4-scout
meta/muse-glimmer-30b
meta/muse-spark-1.1
meta/muse-spark-1.2
meta/muse-spark-1.2-contributor
meta/muse-spark-1.3
meta/muse-spark-1.3-contributor
mimo-v2.5
mimo-v2.5-pro
mimo-v2.5-pro-ultraspeed
mimo-v2.6-flash
mimo-v2.6-flash-free
mimo-v2.6-pro
mimo-v2.6-pro-ultraspeed
minimax-m2.5
minimax-m2.7
minimax-m3
minimax.minimax-m2
minimax.minimax-m2.1
minimax.minimax-m2.5
minimax/minimax-m1
minimax/minimax-m2
minimax/minimax-m2.1
minimax/minimax-m2.1-lightning
minimax/minimax-m2.5
minimax/minimax-m2.5-highspeed
minimax/minimax-m2.7
minimax/minimax-m2.7-highspeed
minimax/minimax-m3
ministral-14b-2512
ministral-3b-2512
ministral-3b-latest
ministral-8b-2512
ministral-8b-latest
mistral-large-2411
mistral-large-2512
mistral-large-4
mistral-large-latest
mistral-medium-2505
mistral-medium-2508
mistral-medium-2604
mistral-medium-3.5
mistral-medium-latest
mistral-nemo
mistral-small-2506
mistral-small-2603
mistral-small-latest
mistral.devstral-2-123b
mistral.magistral-small-2509
mistral.ministral-3-14b-instruct
mistral.ministral-3-3b-instruct
mistral.ministral-3-8b-instruct
mistral.mistral-large-3-675b-instruct
mistral.pixtral-large-2502-v1:0
mistral.voxtral-mini-3b-2507
mistral.voxtral-small-24b-2507
mistral/codestral
mistral/ministral-14b
mistral/ministral-3b
mistral/ministral-8b
mistral/mistral-large-3
mistral/mistral-large-4
mistral/mistral-medium-3.5
mistral/mistral-nemo
mistral/mistral-small
mistralai/codestral-2508
mistralai/codestral-2508:batch
mistralai/devstral-2512
mistralai/ministral-14b-2512
mistralai/ministral-3b-2512
mistralai/ministral-8b-2512
mistralai/ministral-8b-2512:batch
mistralai/mistral-7b-instruct-v0.3
mistralai/mistral-large
mistralai/mistral-large-2407
mistralai/mistral-large-2512
mistralai/mistral-large-2512:batch
mistralai/mistral-large-4-0
mistralai/mistral-medium-3
mistralai/mistral-medium-3-5
mistralai/mistral-medium-3-5:batch
mistralai/mistral-medium-3.1
mistralai/mistral-medium-3.1:batch
mistralai/mistral-nemo
mistralai/mistral-saba
mistralai/mistral-small-2603
mistralai/mistral-small-2603:batch
mistralai/mistral-small-3.1-24b-instruct
mistralai/mistral-small-3.2-24b-instruct
mistralai/mixtral-8x22b-instruct
mistralai/voxtral-small-24b-2507
mixedbread/toast-1
moonshot.kimi-k2-thinking
moonshotai.kimi-k2.5
moonshotai/Kimi-K2-Instruct
moonshotai/Kimi-K2-Instruct-0905
moonshotai/Kimi-K2-Thinking
moonshotai/Kimi-K2.5
moonshotai/Kimi-K2.6
moonshotai/Kimi-K2.7-Code
moonshotai/Kimi-K3
moonshotai/kimi-k2
moonshotai/kimi-k2-0905
moonshotai/kimi-k2-thinking
moonshotai/kimi-k2.5
moonshotai/kimi-k2.6
moonshotai/kimi-k2.7-code
moonshotai/kimi-k2.7-code-highspeed
moonshotai/kimi-k3
moonshotai/kimi-k3-fast
moonshotai/kimi-k3:batch
muse-spark-1.1
muse-spark-1.2
muse-spark-1.2-contributor
muse-spark-1.3
muse-spark-1.3-contributor
muse-spark-1.3-contributor-free
nemotron-3-ultra-free
nemotron-3.5-lightning-free
nex-agi/nex-n2.5-pro
nvidia.nemotron-nano-12b-v2
nvidia.nemotron-nano-3-30b
nvidia.nemotron-nano-9b-v2
nvidia.nemotron-super-3-120b
nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B
nvidia/Nemotron-120B-A12B
nvidia/cosmos-reason2-8b
nvidia/llama-3.1-nemotron-70b-instruct
nvidia/llama-3.1-nemotron-ultra-253b-v1
nvidia/nemotron-3-nano-30b-a3b
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
nvidia/nemotron-3-super-120b-a12b
nvidia/nemotron-3-super-120b-a12b:free
nvidia/nemotron-3-ultra-550b-a55b
nvidia/nemotron-3-ultra-550b-a55b:free
nvidia/nemotron-3.5-lightning
nvidia/nemotron-3.5-lightning-30b-a3b
nvidia/nemotron-3.5-lightning:free
nvidia/nemotron-nano-12b-v2-vl
nvidia/nemotron-nano-9b-v2
o1
o1-pro
o3
o3-mini
o3-pro
o4-mini
open-mistral-7b
open-mistral-nemo
open-mixtral-8x22b
open-mixtral-8x7b
openai.gpt-5.4
openai.gpt-5.5
openai.gpt-5.6-luna
openai.gpt-5.6-sol
openai.gpt-5.6-terra
openai.gpt-6-astra
openai.gpt-6-luna
openai.gpt-6-sol
openai.gpt-6.1-sol
openai.gpt-oss-120b
openai.gpt-oss-120b-1:0
openai.gpt-oss-20b
openai.gpt-oss-20b-1:0
openai.gpt-oss-safeguard-120b
openai.gpt-oss-safeguard-20b
openai/gpt-3.5-turbo
openai/gpt-3.5-turbo-0613
openai/gpt-3.5-turbo-16k
openai/gpt-3.5-turbo:batch
openai/gpt-4
openai/gpt-4-turbo
openai/gpt-4-turbo:batch
openai/gpt-4.1
openai/gpt-4.1-fast
openai/gpt-4.1-mini
openai/gpt-4.1-mini-fast
openai/gpt-4.1-mini:batch
openai/gpt-4.1-nano
openai/gpt-4.1-nano-fast
openai/gpt-4.1-nano:batch
openai/gpt-4.1:batch
openai/gpt-4o
openai/gpt-4o-2024-05-13
openai/gpt-4o-2024-08-06
openai/gpt-4o-2024-11-20
openai/gpt-4o-fast
openai/gpt-4o-mini
openai/gpt-4o-mini-2024-07-18
openai/gpt-4o-mini-fast
openai/gpt-4o-mini:batch
openai/gpt-4o:batch
openai/gpt-5
openai/gpt-5-codex
openai/gpt-5-fast
openai/gpt-5-mini
openai/gpt-5-mini-fast
openai/gpt-5-mini:batch
openai/gpt-5-nano
openai/gpt-5-nano:batch
openai/gpt-5-pro
openai/gpt-5-pro:batch
openai/gpt-5.1
openai/gpt-5.1-codex
openai/gpt-5.1-codex-max
openai/gpt-5.1-codex-mini
openai/gpt-5.1-thinking
openai/gpt-5.1-thinking-fast
openai/gpt-5.1:batch
openai/gpt-5.2
openai/gpt-5.2-chat
openai/gpt-5.2-codex
openai/gpt-5.2-fast
openai/gpt-5.2-pro
openai/gpt-5.2-pro:batch
openai/gpt-5.2:batch
openai/gpt-5.3-codex
openai/gpt-5.3-codex-fast
openai/gpt-5.4
openai/gpt-5.4-fast
openai/gpt-5.4-mini
openai/gpt-5.4-mini-fast
openai/gpt-5.4-mini:batch
openai/gpt-5.4-nano
openai/gpt-5.4-nano:batch
openai/gpt-5.4-pro
openai/gpt-5.4-pro:batch
openai/gpt-5.4:batch
openai/gpt-5.5
openai/gpt-5.5-fast
openai/gpt-5.5-pro
openai/gpt-5.5-pro:batch
openai/gpt-5.5:batch
openai/gpt-5.6-luna
openai/gpt-5.6-luna-fast
openai/gpt-5.6-luna-pro
openai/gpt-5.6-luna-pro:batch
openai/gpt-5.6-luna:batch
openai/gpt-5.6-sol
openai/gpt-5.6-sol-fast
openai/gpt-5.6-sol-pro
openai/gpt-5.6-sol-pro:batch
openai/gpt-5.6-sol:batch
openai/gpt-5.6-terra
openai/gpt-5.6-terra-fast
openai/gpt-5.6-terra-pro
openai/gpt-5.6-terra-pro:batch
openai/gpt-5.6-terra:batch
openai/gpt-5:batch
openai/gpt-6-astra
openai/gpt-6-astra-fast
openai/gpt-6-astra-pro
openai/gpt-6-astra-pro:batch
openai/gpt-6-astra:batch
openai/gpt-6-luna
openai/gpt-6-luna-fast
openai/gpt-6-luna-pro
openai/gpt-6-luna-pro:batch
openai/gpt-6-luna:batch
openai/gpt-6-sol
openai/gpt-6-sol-fast
openai/gpt-6-sol-pro
openai/gpt-6-sol-pro:batch
openai/gpt-6-sol:batch
openai/gpt-6.1-sol
openai/gpt-6.1-sol-fast
openai/gpt-6.1-sol-pro
openai/gpt-audio
openai/gpt-audio-mini
openai/gpt-chat-latest
openai/gpt-oss-120b
openai/gpt-oss-120b:batch
openai/gpt-oss-20b
openai/gpt-oss-20b:batch
openai/gpt-oss-safeguard-120b
openai/gpt-oss-safeguard-20b
openai/o1
openai/o3
openai/o3-fast
openai/o3-mini
openai/o3-mini-high
openai/o3-mini:batch
openai/o3-pro
openai/o3:batch
openai/o4-mini
openai/o4-mini-fast
openai/o4-mini-high
openai/o4-mini:batch
openrouter/auto
openrouter/auto-beta
openrouter/free
openrouter/fusion
perceptron/perceptron-mk1.5
pixtral-12b
pixtral-large-latest
poolside/laguna-s-2.1
poolside/laguna-s-2.1-free
poolside/laguna-s-2.1:free
poolside/laguna-xs-2.1
poolside/laguna-xs-2.1:free
precise
prism-ml/ternary-bonsai-2-27b
quiverai/arrow-2
quiverai/arrow-2-telos
qwen-3.8-27b
qwen.qwen3-235b-a22b-2507-v1:0
qwen.qwen3-32b-v1:0
qwen.qwen3-coder-30b-a3b-v1:0
qwen.qwen3-coder-480b-a35b-v1:0
qwen.qwen3-coder-next
qwen.qwen3-next-80b-a3b
qwen.qwen3-vl-235b-a22b
qwen/qwen-2.5-72b-instruct
qwen/qwen-2.5-7b-instruct
qwen/qwen-plus
qwen/qwen-plus-2025-07-28
qwen/qwen3-14b
qwen/qwen3-235b-a22b
qwen/qwen3-235b-a22b-2507
qwen/qwen3-235b-a22b-thinking-2507
qwen/qwen3-30b-a3b
qwen/qwen3-30b-a3b-instruct-2507
qwen/qwen3-30b-a3b-thinking-2507
qwen/qwen3-32b
qwen/qwen3-8b
qwen/qwen3-coder
qwen/qwen3-coder-30b-a3b-instruct
qwen/qwen3-coder-flash
qwen/qwen3-coder-next
qwen/qwen3-coder-plus
qwen/qwen3-max
qwen/qwen3-max-thinking
qwen/qwen3-next-80b-a3b-instruct
qwen/qwen3-next-80b-a3b-thinking
qwen/qwen3-vl-235b-a22b-instruct
qwen/qwen3-vl-235b-a22b-thinking
qwen/qwen3-vl-30b-a3b-instruct
qwen/qwen3-vl-30b-a3b-thinking
qwen/qwen3-vl-32b-instruct
qwen/qwen3-vl-8b-instruct
qwen/qwen3-vl-8b-thinking
qwen/qwen3.5-122b-a10b
qwen/qwen3.5-27b
qwen/qwen3.5-35b-a3b
qwen/qwen3.5-397b-a17b
qwen/qwen3.5-9b
qwen/qwen3.5-flash-02-23
qwen/qwen3.5-plus-02-15
qwen/qwen3.5-plus-20260420
qwen/qwen3.6-27b
qwen/qwen3.6-35b-a3b
qwen/qwen3.6-flash
qwen/qwen3.6-max-preview
qwen/qwen3.6-plus
qwen/qwen3.7-flash
qwen/qwen3.7-max
qwen/qwen3.7-plus
qwen/qwen3.8-2.4t-a95b
qwen/qwen3.8-27b
qwen/qwen3.8-flash
qwen/qwen3.8-max-0902
qwen/qwen3.8-max-prime
qwen/qwen3.8-omni-flash
qwen3.5-plus
qwen3.6-flash
qwen3.6-plus
qwen3.7-max
qwen3.7-plus
qwen3.8-flash
qwen3.8-max
rekaai/reka-edge
relace/relace-search
sakana/fugu-max
sakana/fugu-ultra
sakana/fugu-ultra-v2
sakana/namazu
sakana/sakana-namazu
sao10k/l3.1-euryale-70b
space-bunny
space-bunny-free
spacexai/grok-4.1-fast-non-reasoning
spacexai/grok-4.1-fast-reasoning
spacexai/grok-4.20-multi-agent
spacexai/grok-4.20-multi-agent-beta
spacexai/grok-4.20-non-reasoning
spacexai/grok-4.20-non-reasoning-beta
spacexai/grok-4.20-reasoning
spacexai/grok-4.20-reasoning-beta
spacexai/grok-4.3
spacexai/grok-4.5
spacexai/grok-4.6
spacexai/grok-4.7
spacexai/grok-build-0.1
stealth/glyph-cluster
stepfun-ai/Step-3.5-Flash
stepfun-ai/Step-3.7-Flash
stepfun/step-3.5-flash
stepfun/step-3.7-flash
tencent/Hy3
tencent/Hy4-preview
tencent/hy3
tencent/hy3-preview
tencent/hy4-preview
thinkingmachines/Inkling
thinkingmachines/Inkling-Small
thinkingmachines/inkling
thinkingmachines/inkling-small
thinkingmachines/inkling-small:free
thinkingmachines/inkling:free
typesafe/jev-router
unbiased/pareto
unbiased/pareto-26.10-preview
upstage/solar-mini4
upstage/solar-pro-3
upstage/solar-pro4
us-gov.openai.gpt-oss-120b-1:0
us-gov.openai.gpt-oss-20b-1:0
us.amazon.nova-2-lite-v1:0
us.amazon.nova-lite-v1:0
us.amazon.nova-micro-v1:0
us.amazon.nova-premier-v1:0
us.amazon.nova-pro-v1:0
us.anthropic.claude-fable-5
us.anthropic.claude-fable-5-1
us.anthropic.claude-haiku-4-5-20251001-v1:0
us.anthropic.claude-haiku-5-5
us.anthropic.claude-opus-4-1-20250805-v1:0
us.anthropic.claude-opus-4-5-20251101-v1:0
us.anthropic.claude-opus-4-6-v1
us.anthropic.claude-opus-4-7
us.anthropic.claude-opus-4-8
us.anthropic.claude-opus-5
us.anthropic.claude-opus-5-5
us.anthropic.claude-sonnet-4-20250514-v1:0
us.anthropic.claude-sonnet-4-5-20250929-v1:0
us.anthropic.claude-sonnet-4-6
us.anthropic.claude-sonnet-5
us.anthropic.claude-sonnet-5-5
us.meta.llama3-1-70b-instruct-v1:0
us.meta.llama3-1-8b-instruct-v1:0
us.meta.llama3-3-70b-instruct-v1:0
us.meta.llama4-maverick-17b-instruct-v1:0
us.meta.llama4-scout-17b-instruct-v1:0
us.mistral.pixtral-large-2502-v1:0
us.moonshotai.kimi-k3
us.openai.gpt-5.6-luna
us.openai.gpt-5.6-sol
us.openai.gpt-5.6-terra
us.openai.gpt-6-astra
us.openai.gpt-6-luna
us.openai.gpt-6-sol
us.openai.gpt-6.1-sol
us.writer.palmyra-x4-v1:0
us.writer.palmyra-x5-v1:0
us.xai.grok-4.6
us.xai.grok-4.7
us.zai.glm-5.3
voxtral-small-2507
voxtral-small-latest
workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731
workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813
workers-ai/@cf/google/gemma-4-26b-a4b-it
workers-ai/@cf/ibm-granite/granite-4.0-h-micro
workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast
workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct
workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct
workers-ai/@cf/moonshotai/kimi-k2.6
workers-ai/@cf/moonshotai/kimi-k2.7-code
workers-ai/@cf/nvidia/nemotron-3-120b-a12b
workers-ai/@cf/openai/gpt-oss-120b
workers-ai/@cf/openai/gpt-oss-20b
workers-ai/@cf/qwen/qwen3-30b-a3b-fp8
workers-ai/@cf/qwen/qwen3.8-27b
workers-ai/@cf/zai-org/glm-4.7-flash
workers-ai/@cf/zai-org/glm-5.2
workers-ai/@cf/zai-org/glm-5.3
workers-ai/@cf/zai-org/glm-5.3-flash
writer.palmyra-x4-v1:0
writer.palmyra-x5-v1:0
x-ai/grok-4.20
x-ai/grok-4.3
x-ai/grok-4.3:batch
x-ai/grok-4.5
x-ai/grok-4.6
x-ai/grok-4.7
x-ai/grok-build-0.1
xai.grok-4.3
xai.grok-4.6
xiaomi/mimo-v2.5
xiaomi/mimo-v2.5-pro
xiaomi/mimo-v2.6-flash
xiaomi/mimo-v2.6-pro
xiaomi/mimo-v2.6-pro-ultraspeed
z-ai/glm-4.5
z-ai/glm-4.5-air
z-ai/glm-4.5v
z-ai/glm-4.6
z-ai/glm-4.6v
z-ai/glm-4.7
z-ai/glm-4.7-flash
z-ai/glm-5
z-ai/glm-5-turbo
z-ai/glm-5.1
z-ai/glm-5.2
z-ai/glm-5.3
z-ai/glm-5.3-flash
z-ai/glm-5.3-flash:batch
z-ai/glm-5.3-flashx
z-ai/glm-5.3-prime
z-ai/glm-5.3:batch
z-ai/glm-5v-turbo
zai-glm-5-2
zai-glm-5-3
zai-org/GLM-4.5
zai-org/GLM-4.5-Air
zai-org/GLM-4.5V
zai-org/GLM-4.6
zai-org/GLM-4.6V-Flash
zai-org/GLM-4.7
zai-org/GLM-4.7-Flash
zai-org/GLM-5
zai-org/GLM-5.1
zai-org/GLM-5.2
zai-org/GLM-5.2-Fast
zai-org/GLM-5.3
zai-org/GLM-5.3-Fast
zai-org/GLM-5.3-Flash
zai.glm-4.7
zai.glm-4.7-flash
zai.glm-5
zai/glm-4.5
zai/glm-4.5-air
zai/glm-4.5v
zai/glm-4.6
zai/glm-4.7
zai/glm-4.7-flash
zai/glm-4.7-flashx
zai/glm-5
zai/glm-5-turbo
zai/glm-5.1
zai/glm-5.2
zai/glm-5.2-fast
zai/glm-5.3
zai/glm-5.3-fast
zai/glm-5.3-flash
zai/glm-5.3-flashx
zai/glm-5v-turbo
~anthropic/claude-fable-latest
~anthropic/claude-haiku-latest
~anthropic/claude-opus-latest
~anthropic/claude-sonnet-latest
~deepseek/deepseek-flash-latest
~deepseek/deepseek-pro-latest
~deepseek/deepseek-v4-flash-latest
~google/gemini-flash-latest
~google/gemini-pro-latest
~moonshotai/kimi-latest
~openai/gpt-astra-latest
~openai/gpt-luna-latest
~openai/gpt-mini-latest
~openai/gpt-sol-latest
~openai/gpt-terra-latest
~x-ai/grok-latest
~z-ai/glm-flash-latest
~z-ai/glm-latest
`.split('\n'))
