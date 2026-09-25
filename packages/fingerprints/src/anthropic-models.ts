/**
 * What Anthropic documents about each Claude model on the first-party API:
 * the IDs it accepts, what it costs, and which request shapes it rejects.
 * A probe that sends one of those shapes can tell a claimed model from a
 * substitute by whether the 400 arrives.
 *
 * A field is `undefined` wherever the docs do not settle it. That is not the
 * same as `false`: a probe must not treat a silence in the docs as evidence.
 */

import {
  ALIASES,
  CACHE_MINIMUM,
  FORCED_TOOL,
  LIKE_OPUS_5,
  LIMITS,
  modelIdSource,
  PREFILL,
  PRICES,
  SAMPLING,
  THINKING,
  THINKING_MESSAGES,
  TOKENIZER,
} from './anthropic-sources.js'
import { documented, type Fact, type FactSource, type Sources } from './source.js'

export type AnthropicFamily = 'fable' | 'mythos' | 'opus' | 'sonnet' | 'haiku'

/**
 * `claude-2026` is the tokenizer introduced with Claude Opus 4.7, which
 * produces roughly 30% more tokens for the same text; `claude-legacy` is the
 * one before it. Anthropic names neither - these names are the catalog's.
 */
export type AnthropicTokenizer = 'claude-legacy' | 'claude-2026'

/** Base prices in USD per million tokens, before caching or batch discounts. */
export interface AnthropicPricing {
  readonly inputPerMTok: number
  readonly outputPerMTok: number
}

/** Every `rejects*` field is about a 400 on the Messages API, not a silent ignore. */
export interface AnthropicModel {
  /** The value sent as `model`. */
  readonly id: string
  readonly family: AnthropicFamily
  readonly displayName: string
  readonly idSource: FactSource
  /** Other `model` values that resolve to this snapshot. Dateless IDs have none. */
  readonly aliases: Fact<readonly string[]>
  readonly pricing: Fact<AnthropicPricing> | undefined
  /** A non-default `temperature`, `top_p` or `top_k` is rejected. */
  readonly rejectsSamplingParameters: Fact<boolean> | undefined
  /** A conversation ending in an assistant message is rejected. */
  readonly rejectsPrefill: Fact<boolean> | undefined
  /** `thinking: {type: "enabled", budget_tokens}` is rejected. */
  readonly rejectsThinkingEnabled: Fact<boolean> | undefined
  /** `thinking: {type: "adaptive"}` is rejected. */
  readonly rejectsThinkingAdaptive: Fact<boolean> | undefined
  /** `thinking: {type: "disabled"}` is rejected. */
  readonly rejectsThinkingDisabled: Fact<boolean> | undefined
  /** `tool_choice` of type `any` or `tool` is rejected. */
  readonly rejectsForcedToolChoice: Fact<boolean> | undefined
  /** Shortest prompt prefix that prompt caching will store. */
  readonly cacheMinimumTokens: Fact<number> | undefined
  readonly tokenizer: Fact<AnthropicTokenizer> | undefined
  readonly contextWindowTokens: Fact<number> | undefined
  /** Synchronous Messages API limit on `max_tokens`. */
  readonly maxOutputTokens: Fact<number> | undefined
  /** Stops with `model_context_window_exceeded` instead of rejecting an oversized `max_tokens`. */
  readonly stopsAtContextWindow: Fact<boolean> | undefined
}

const ROUNDED = 'The docs round this limit ("1M", "128k", "200k", "64k"); read as a decimal count.'

const yes = (sources: Sources, note?: string): Fact<boolean> => documented(true, sources, note)
const no = (sources: Sources, note?: string): Fact<boolean> => documented(false, sources, note)
const price = (inputPerMTok: number, outputPerMTok: number, sources: Sources, note?: string) =>
  documented<AnthropicPricing>({ inputPerMTok, outputPerMTok }, sources, note)

const opusPrice = (row: FactSource) => price(5, 25, [row, PRICES.columns])
const sonnet4Price = (row: FactSource) => price(3, 15, [row, PRICES.columns])

const SAMPLING_FABLE = yes([SAMPLING.fable, SAMPLING.carriedFromFable5])
const SAMPLING_OPUS_47_UP = yes([SAMPLING.opus47AndLater, SAMPLING.afterOpus46])
const SAMPLING_BEFORE_OPUS_47 = no(
  [SAMPLING.opus46Checklist, SAMPLING.afterOpus46],
  'The Opus 5.5 checklist for code on "Claude Opus 4.6 or earlier" says to remove the parameters, and the Messages reference restricts only models released after Opus 4.6.',
)

const PREFILL_FROM_46 = yes([PREFILL.from46, PREFILL.status])
const PREFILL_FABLE = yes([PREFILL.fable, PREFILL.from46, SAMPLING.carriedFromFable5])

const ENABLED_FROM_47 = yes([THINKING.enabledRemovedFrom47, THINKING.enabledRejectedFrom47])
const ENABLED_FABLE = yes([THINKING.fableEnabledAndDisabled, THINKING.enabledRemovedFrom47])
const ENABLED_DEPRECATED_46 = no(
  [THINKING.enabledDeprecatedOn46],
  'Deprecated on the Claude 4.6 models; requests using it still succeed.',
)
const ENABLED_ONLY_MODE = no([THINKING.enabledOnlyModeTo45])

const ADAPTIVE_FROM_47 = no(
  [THINKING.enabledStatus, THINKING_MESSAGES.enabled],
  'The 400 for manual thinking on Claude 4.7 and later tells the caller to use "thinking.type.adaptive".',
)
const ADAPTIVE_ALWAYS_ON = no([THINKING.alwaysOn, THINKING.alwaysOnRunsAdaptive])
const ADAPTIVE_TO_45 = yes([THINKING.adaptiveRejectedTo45])

const DISABLED_ALWAYS_ON = yes([THINKING.alwaysOn])

const CACHE_512 = documented(512, [CACHE_MINIMUM.t512])
const CACHE_512_FABLE = documented(512, [CACHE_MINIMUM.fable, CACHE_MINIMUM.t512])
const CACHE_1024 = documented(1024, [CACHE_MINIMUM.t1024])
const CACHE_2048 = documented(2048, [CACHE_MINIMUM.t2048])
const CACHE_4096_OPUS = documented(4096, [CACHE_MINIMUM.t4096Opus])

const TOKENIZER_2026 = documented<AnthropicTokenizer>('claude-2026', [TOKENIZER.from47])
const TOKENIZER_LEGACY = documented<AnthropicTokenizer>(
  'claude-legacy',
  [TOKENIZER.from47, TOKENIZER.earlierModels],
  'Not among the "Claude 4.7 and later models and Claude Mythos Preview", so the earlier tokenizer.',
)

const CONTEXT_1M = documented(1_000_000, [LIMITS.oneMillion], ROUNDED)
const CONTEXT_200K = documented(200_000, [LIMITS.otherModels], ROUNDED)
const OUTPUT_128K = documented(128_000, [LIMITS.oneMillion], ROUNDED)
const STOPS_AT_WINDOW = yes([LIMITS.windowExceeded])

const DATELESS = documented<readonly string[]>([], [ALIASES.dateless])

type Spec = Pick<AnthropicModel, 'id' | 'family' | 'displayName'> &
  Partial<Omit<AnthropicModel, 'id' | 'family' | 'displayName' | 'idSource' | 'aliases'>> & {
    readonly alias?: string
  }

/** Fills in the ID source and alias fact, and every field the spec leaves out as `undefined`. */
function define(spec: Spec): AnthropicModel {
  const { alias, id, family, displayName, ...fields } = spec
  return Object.freeze({
    id,
    family,
    displayName,
    idSource: modelIdSource(id),
    aliases:
      alias === undefined
        ? DATELESS
        : documented<readonly string[]>([alias], [ALIASES.dated, modelIdSource(alias)]),
    pricing: undefined,
    rejectsSamplingParameters: undefined,
    rejectsPrefill: undefined,
    rejectsThinkingEnabled: undefined,
    rejectsThinkingAdaptive: undefined,
    rejectsThinkingDisabled: undefined,
    rejectsForcedToolChoice: undefined,
    cacheMinimumTokens: undefined,
    tokenizer: undefined,
    contextWindowTokens: undefined,
    maxOutputTokens: undefined,
    stopsAtContextWindow: undefined,
    ...fields,
  })
}

/** Newest first, as the Messages API reference lists them. */
export const ANTHROPIC_MODELS: readonly AnthropicModel[] = Object.freeze([
  define({
    id: 'claude-fable-5-1',
    family: 'fable',
    displayName: 'Claude Fable 5.1',
    pricing: price(10, 50, [PRICES.overviewRow, PRICES.overviewColumns, PRICES.sameAsFable5]),
    rejectsSamplingParameters: SAMPLING_FABLE,
    rejectsPrefill: PREFILL_FABLE,
    rejectsThinkingEnabled: ENABLED_FABLE,
    rejectsThinkingAdaptive: no([THINKING.fableEnabledAndDisabled, THINKING.alwaysOnRunsAdaptive]),
    rejectsThinkingDisabled: yes([THINKING.alwaysOn, THINKING.fableEnabledAndDisabled]),
    rejectsForcedToolChoice: yes([FORCED_TOOL.rejected, FORCED_TOOL.fable51Rejected]),
    cacheMinimumTokens: CACHE_512_FABLE,
    tokenizer: documented('claude-2026', [TOKENIZER.fable, TOKENIZER.from47]),
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-opus-5-5',
    family: 'opus',
    displayName: 'Claude Opus 5.5',
    pricing: price(4, 20, [PRICES.opus55]),
    rejectsSamplingParameters: SAMPLING_OPUS_47_UP,
    rejectsPrefill: yes([PREFILL.opus45Accepts, PREFILL.from46]),
    rejectsThinkingEnabled: yes([THINKING.opus55EnabledAndDisabled, THINKING.enabledRemovedFrom47]),
    rejectsThinkingAdaptive: no([THINKING.opus55Adaptive, THINKING.alwaysOnRunsAdaptive]),
    rejectsThinkingDisabled: yes([THINKING.opus55EnabledAndDisabled, THINKING.alwaysOn]),
    rejectsForcedToolChoice: yes([FORCED_TOOL.rejected, FORCED_TOOL.status]),
    cacheMinimumTokens: CACHE_512,
    tokenizer: documented('claude-2026', [TOKENIZER.opus47Introduced, TOKENIZER.from47]),
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-mythos-5-1',
    family: 'mythos',
    displayName: 'Claude Mythos 5.1',
    pricing: price(
      10,
      50,
      [PRICES.sameAsFable5, PRICES.fable5, PRICES.columns],
      'Priced as Claude Fable 5, except for cache reads.',
    ),
    rejectsSamplingParameters: yes(
      [SAMPLING.mythos51LikeFable51, SAMPLING.fable],
      'The Fable 5.1 guide gives Mythos 5.1 the same capabilities as Fable 5.1.',
    ),
    rejectsPrefill: PREFILL_FROM_46,
    rejectsThinkingEnabled: ENABLED_FROM_47,
    rejectsThinkingAdaptive: ADAPTIVE_ALWAYS_ON,
    rejectsThinkingDisabled: DISABLED_ALWAYS_ON,
    rejectsForcedToolChoice: yes([FORCED_TOOL.rejected, FORCED_TOOL.fable51Rejected]),
    cacheMinimumTokens: CACHE_512,
    tokenizer: TOKENIZER_2026,
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-sonnet-5',
    family: 'sonnet',
    displayName: 'Claude Sonnet 5',
    pricing: price(2, 10, [PRICES.sonnet5]),
    rejectsSamplingParameters: yes([SAMPLING.sonnet5]),
    rejectsPrefill: yes([PREFILL.sonnet46AndLater, PREFILL.from46]),
    rejectsThinkingEnabled: yes([THINKING.sonnet5Reversed, THINKING.enabledRemovedFrom47]),
    rejectsThinkingAdaptive: no([THINKING.sonnet5Reversed]),
    rejectsThinkingDisabled: no(
      [LIKE_OPUS_5.sonnet5Disables, LIKE_OPUS_5.sonnet5, THINKING.opus5AndSonnet5Disable],
      'Accepted at any effort level.',
    ),
    rejectsForcedToolChoice: no([LIKE_OPUS_5.sonnet5ForcesTools, LIKE_OPUS_5.sonnet5]),
    cacheMinimumTokens: CACHE_1024,
    tokenizer: documented('claude-2026', [TOKENIZER.sonnet5, TOKENIZER.from47]),
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-fable-5',
    family: 'fable',
    displayName: 'Claude Fable 5',
    pricing: price(10, 50, [PRICES.fable5, PRICES.columns]),
    rejectsSamplingParameters: SAMPLING_FABLE,
    rejectsPrefill: PREFILL_FABLE,
    rejectsThinkingEnabled: yes([THINKING.fableEnabledAndDisabled, SAMPLING.carriedFromFable5]),
    rejectsThinkingAdaptive: ADAPTIVE_ALWAYS_ON,
    rejectsThinkingDisabled: DISABLED_ALWAYS_ON,
    rejectsForcedToolChoice: no(
      [FORCED_TOOL.fable5Accepts],
      'The Fable 5.1 guide calls the forced-tool-use error a breaking change for code already calling Fable 5.',
    ),
    cacheMinimumTokens: CACHE_512_FABLE,
    tokenizer: documented('claude-2026', [TOKENIZER.fable, TOKENIZER.from47]),
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-mythos-5',
    family: 'mythos',
    displayName: 'Claude Mythos 5',
    pricing: price(10, 50, [PRICES.mythos5, PRICES.columns]),
    rejectsPrefill: PREFILL_FROM_46,
    rejectsThinkingEnabled: ENABLED_FROM_47,
    rejectsThinkingAdaptive: ADAPTIVE_ALWAYS_ON,
    rejectsThinkingDisabled: DISABLED_ALWAYS_ON,
    cacheMinimumTokens: CACHE_512,
    tokenizer: TOKENIZER_2026,
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-opus-5',
    family: 'opus',
    displayName: 'Claude Opus 5',
    pricing: opusPrice(PRICES.opus5),
    rejectsSamplingParameters: SAMPLING_OPUS_47_UP,
    rejectsPrefill: PREFILL_FROM_46,
    rejectsThinkingEnabled: ENABLED_FROM_47,
    rejectsThinkingAdaptive: ADAPTIVE_FROM_47,
    rejectsThinkingDisabled: no(
      [THINKING.opus5DisableUpToHigh, THINKING.opus5NotAtXhigh, THINKING.opus5AndSonnet5Disable],
      'Accepted only at effort `high` or below; `xhigh` and `max` reject it.',
    ),
    rejectsForcedToolChoice: no(
      [FORCED_TOOL.opus5Accepts],
      'The Opus 5.5 overview calls the forced-tool-use error a breaking change for code already running on Opus 5.',
    ),
    cacheMinimumTokens: CACHE_512,
    tokenizer: documented('claude-2026', [TOKENIZER.opus47Introduced, TOKENIZER.from47]),
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-opus-4-8',
    family: 'opus',
    displayName: 'Claude Opus 4.8',
    pricing: opusPrice(PRICES.opus48),
    rejectsSamplingParameters: SAMPLING_OPUS_47_UP,
    rejectsPrefill: PREFILL_FROM_46,
    rejectsThinkingEnabled: ENABLED_FROM_47,
    rejectsThinkingAdaptive: ADAPTIVE_FROM_47,
    rejectsThinkingDisabled: no(
      [LIKE_OPUS_5.opus48Accepts, LIKE_OPUS_5.opus48],
      'Accepted like Claude Opus 5; the docs do not say whether the Opus 5 effort limit applies.',
    ),
    rejectsForcedToolChoice: no([LIKE_OPUS_5.opus48Accepts, LIKE_OPUS_5.opus48]),
    cacheMinimumTokens: CACHE_1024,
    tokenizer: documented('claude-2026', [TOKENIZER.opus47Introduced, TOKENIZER.from47]),
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-opus-4-7',
    family: 'opus',
    displayName: 'Claude Opus 4.7',
    pricing: opusPrice(PRICES.opus47),
    rejectsSamplingParameters: SAMPLING_OPUS_47_UP,
    rejectsPrefill: PREFILL_FROM_46,
    rejectsThinkingEnabled: ENABLED_FROM_47,
    rejectsThinkingAdaptive: no([THINKING.opus47Adaptive, THINKING_MESSAGES.enabled]),
    cacheMinimumTokens: CACHE_2048,
    tokenizer: documented('claude-2026', [TOKENIZER.opus47Introduced, TOKENIZER.from47]),
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-mythos-preview',
    family: 'mythos',
    displayName: 'Claude Mythos Preview',
    rejectsPrefill: PREFILL_FROM_46,
    rejectsThinkingEnabled: no([THINKING.mythosPreviewBothModes]),
    rejectsThinkingAdaptive: no([THINKING.mythosPreviewBothModes]),
    rejectsThinkingDisabled: yes(
      [THINKING.alwaysOn, THINKING_MESSAGES.disabledMythosPreview],
      'The 400 message differs from the other always-on models.',
    ),
    cacheMinimumTokens: CACHE_2048,
    tokenizer: TOKENIZER_2026,
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
  }),
  define({
    id: 'claude-opus-4-6',
    family: 'opus',
    displayName: 'Claude Opus 4.6',
    pricing: opusPrice(PRICES.opus46),
    rejectsSamplingParameters: SAMPLING_BEFORE_OPUS_47,
    rejectsPrefill: PREFILL_FROM_46,
    rejectsThinkingEnabled: ENABLED_DEPRECATED_46,
    rejectsThinkingAdaptive: no([THINKING.opus46Adaptive]),
    cacheMinimumTokens: CACHE_4096_OPUS,
    tokenizer: TOKENIZER_LEGACY,
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-sonnet-4-6',
    family: 'sonnet',
    displayName: 'Claude Sonnet 4.6',
    pricing: sonnet4Price(PRICES.sonnet46),
    rejectsSamplingParameters: no(
      [SAMPLING.sonnet46Breaking, SAMPLING.sonnet5],
      'The Sonnet 5 guide lists the sampling 400 as a breaking change for code already running on Sonnet 4.6.',
    ),
    rejectsPrefill: yes([PREFILL.sonnet46AndLater, PREFILL.from46]),
    rejectsThinkingEnabled: ENABLED_DEPRECATED_46,
    rejectsThinkingAdaptive: no([THINKING.sonnet46Adaptive]),
    cacheMinimumTokens: CACHE_1024,
    tokenizer: documented(
      'claude-legacy',
      [TOKENIZER.sonnet5, TOKENIZER.from47],
      'Sonnet 5 produces about 30% more tokens than Sonnet 4.6 for the same text.',
    ),
    contextWindowTokens: CONTEXT_1M,
    maxOutputTokens: OUTPUT_128K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-opus-4-5-20251101',
    alias: 'claude-opus-4-5',
    family: 'opus',
    displayName: 'Claude Opus 4.5',
    pricing: opusPrice(PRICES.opus45),
    rejectsSamplingParameters: SAMPLING_BEFORE_OPUS_47,
    rejectsPrefill: no(
      [PREFILL.opus45Accepts],
      'The Opus 5.5 guide calls the prefill 400 a change only for code coming from Opus 4.5 or earlier.',
    ),
    rejectsThinkingEnabled: ENABLED_ONLY_MODE,
    rejectsThinkingAdaptive: ADAPTIVE_TO_45,
    cacheMinimumTokens: CACHE_4096_OPUS,
    tokenizer: TOKENIZER_LEGACY,
    contextWindowTokens: documented(
      200_000,
      [LIMITS.otherModels, LIMITS.oneMillion],
      `Not in the 1M list, so one of the "other Claude models". ${ROUNDED}`,
    ),
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-sonnet-4-5-20250929',
    alias: 'claude-sonnet-4-5',
    family: 'sonnet',
    displayName: 'Claude Sonnet 4.5',
    pricing: sonnet4Price(PRICES.sonnet45),
    rejectsPrefill: no(
      [PREFILL.sonnet45Accepts, PREFILL.haiku45Accepts],
      'The Sonnet 5 guide calls the prefill 400 a breaking change when migrating from Sonnet 4.5 or earlier.',
    ),
    rejectsThinkingEnabled: ENABLED_ONLY_MODE,
    rejectsThinkingAdaptive: ADAPTIVE_TO_45,
    cacheMinimumTokens: CACHE_1024,
    tokenizer: TOKENIZER_LEGACY,
    contextWindowTokens: CONTEXT_200K,
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
  define({
    id: 'claude-haiku-4-5-20251001',
    alias: 'claude-haiku-4-5',
    family: 'haiku',
    displayName: 'Claude Haiku 4.5',
    pricing: price(1, 5, [PRICES.overviewRow, PRICES.overviewColumns]),
    rejectsSamplingParameters: no(
      [SAMPLING.haiku45],
      '`temperature` and `top_p` work one at a time, not both; `top_k` is not mentioned.',
    ),
    rejectsPrefill: no([PREFILL.haiku45Accepts]),
    rejectsThinkingEnabled: no([THINKING.haiku45]),
    rejectsThinkingAdaptive: yes([THINKING.haiku45, THINKING.adaptiveRejectedTo45]),
    cacheMinimumTokens: documented(4096, [CACHE_MINIMUM.t4096Haiku]),
    tokenizer: documented('claude-legacy', [TOKENIZER.haiku45, TOKENIZER.from47]),
    contextWindowTokens: documented(200_000, [LIMITS.haiku45, LIMITS.otherModels], ROUNDED),
    maxOutputTokens: documented(64_000, [LIMITS.haiku45], ROUNDED),
    stopsAtContextWindow: STOPS_AT_WINDOW,
  }),
])
