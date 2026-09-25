/**
 * Reference fingerprint database.
 *
 * This package is data plus the types that describe it. Every decision about
 * what a measurement *means* lives in `@verifai/core`, so that vendor releases
 * can be absorbed by shipping a new version of this package without touching
 * the detection engine.
 */

/** Bumped whenever the shape of the reference data changes incompatibly. */
export const FINGERPRINTS_SCHEMA_VERSION = 1

/** Bumped whenever the reference data itself changes, even if its shape does not. */
export const FINGERPRINTS_VERSION = '0.2.0'

export {
  ANTHROPIC_MODELS,
  ANTHROPIC_REJECTIONS,
  ANTHROPIC_SAMPLING_COMPATIBILITY,
  type AnthropicFamily,
  type AnthropicModel,
  type AnthropicPricing,
  type AnthropicRejection,
  type AnthropicSamplingCompatibility,
  type AnthropicTokenizer,
  anthropicModel,
  cheaperAnthropicModels,
} from './anthropic.js'
export {
  cheaperOpenaiModels,
  OPENAI_CHAT_MODEL_IDS,
  OPENAI_EXACT_ENCODINGS,
  OPENAI_MODELS,
  OPENAI_PREFIX_ENCODINGS,
  type OpenAIFingerprintExpectation,
  type OpenAIModel,
  type OpenAIPricing,
  type OpenAIPromptCache,
  type OpenAIReasoningEffort,
  type OpenAISnapshot,
  openaiEncodingFor,
  openaiFingerprintExpectation,
  openaiModel,
  openaiPromptCacheFor,
  openaiSnapshotFor,
  type TiktokenEncoding,
  type TiktokenRule,
} from './openai.js'
export {
  type Calibration,
  documented,
  type Fact,
  type FactSource,
  fact,
  MAX_QUOTE_LENGTH,
  RETRIEVED_AT,
  type Sources,
  source,
} from './source.js'
