/**
 * Pure decision logic for one OpenAI Chat Completions or Responses request:
 * whether a genuine endpoint serving `facts.id` would refuse this body, and
 * if not, what it would answer. Everything here is a function of the request
 * and the answering model's own documented facts (`OpenaiModelFacts`) -
 * nothing is keyed off a probe id or nonce.
 *
 * Rejection wording reproduces what `conformance/openai/*` measures against
 * a real endpoint: an unrecognised top-level field, a model name this
 * fixture's catalogue does not know, and a temperature outside what the
 * model accepts. A reasoning effort the model's page does not list is refused
 * too, and whether a temperature is taken at all follows what OpenAI
 * documents for the effort the request runs at. `logit_bias` and
 * `logprobs.content` are answered with the
 * real tokenizer for whichever encoding `facts.encoding` names, the same way
 * `tokenizer/openai-local-count.ts` and `causal/logit-bias.ts` /
 * `causal/logprobs-retokenize.ts` read them - never by recognising the
 * probes' own prompts.
 */

import { openaiEncodingFor } from '@verifai/fingerprints'
import { type LocalTokenizer, loadTokenizer } from '../../../src/tokenizer/local.js'
import type { OpenaiModelFacts } from './model-facts.js'
import { instanceFor } from './schema-instance.js'
import {
  chatCompletionId,
  isJsonObject,
  type JsonObject,
  openaiChatBody,
  openaiChatPromptText,
  openaiErrorBody,
  openaiResponseBody,
  openaiResponsesPromptText,
  resolvedOpenaiEncoding,
  responseId,
} from './shared.js'

export interface OpenaiAnswer {
  readonly status: number
  readonly body: JsonObject
}

const ANSWER_TEXT = 'ok'
/** OpenAI's `logit_bias` range is -100 to 100; a bias this close to the top forces the token. */
const FORCING_BIAS = 90
const ACCEPTED_TEMPERATURE = 1
const TEMPERATURE_CEILING = 2

/** Every top-level field the Chat Completions `create` body documents. Anything else is foreign. */
const CHAT_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'model',
  'messages',
  'max_completion_tokens',
  'max_tokens',
  'temperature',
  'top_p',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'response_format',
  'stream',
  'stop',
  'n',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'service_tier',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'user',
  'metadata',
  'store',
  'modalities',
  'reasoning_effort',
])

/** Every top-level field the Responses `create` body documents. Anything else is foreign. */
const RESPONSES_ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'model',
  'input',
  'instructions',
  'max_output_tokens',
  'temperature',
  'top_p',
  'text',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'metadata',
  'stream',
  'store',
  'user',
  'service_tier',
  'reasoning',
  'include',
  'previous_response_id',
  'truncation',
])

function rejected(status: number, options: Parameters<typeof openaiErrorBody>[0]): OpenaiAnswer {
  return { status, body: openaiErrorBody(options) }
}

function unknownFieldRejection(
  body: JsonObject,
  allowed: ReadonlySet<string>,
): OpenaiAnswer | undefined {
  const foreign = Object.keys(body).find((key) => !allowed.has(key))
  return foreign === undefined
    ? undefined
    : rejected(400, {
        message: `Unknown parameter: '${foreign}'.`,
        param: foreign,
        code: 'unknown_parameter',
      })
}

export function modelNotFoundBody(model: string): JsonObject {
  return openaiErrorBody({
    message: `The model \`${model}\` does not exist or you do not have access to it.`,
    param: null,
    code: 'model_not_found',
  })
}

/** Whether this fixture's OpenAI catalogue recognises `model` as an id it can answer as. */
export function isKnownOpenaiModel(model: string, facts: OpenaiModelFacts): boolean {
  return model === facts.id || openaiEncodingFor(model) !== undefined
}

function modelNotFoundRejection(
  body: JsonObject,
  facts: OpenaiModelFacts,
): OpenaiAnswer | undefined {
  const model = typeof body.model === 'string' ? body.model : undefined
  return model === undefined || isKnownOpenaiModel(model, facts)
    ? undefined
    : { status: 404, body: modelNotFoundBody(model) }
}

type OpenaiProtocol = 'openai-chat' | 'openai-responses'

function effortField(protocol: OpenaiProtocol): string {
  return protocol === 'openai-chat' ? 'reasoning_effort' : 'reasoning.effort'
}

function requestedEffort(protocol: OpenaiProtocol, body: JsonObject): unknown {
  if (protocol === 'openai-chat') {
    return body.reasoning_effort
  }
  return isJsonObject(body.reasoning) ? body.reasoning.effort : undefined
}

/** An effort the model's page does not list. A model the guides do not list takes any. */
function effortRejection(
  protocol: OpenaiProtocol,
  body: JsonObject,
  facts: OpenaiModelFacts,
): OpenaiAnswer | undefined {
  const effort = requestedEffort(protocol, body)
  const efforts: readonly unknown[] | undefined = facts.reasoning?.efforts
  if (effort === undefined || efforts === undefined || efforts.includes(effort)) {
    return undefined
  }
  const param = effortField(protocol)
  const supported = efforts.map((value) => `'${String(value)}'`).join(', ')
  return rejected(400, {
    message: `Unsupported value: '${param}' does not support '${String(effort)}' with this model. Supported values are: ${supported}.`,
    param,
    code: 'unsupported_value',
  })
}

/**
 * Whether the model takes only its default temperature at the effort this
 * request runs at: the one it names, else the model's documented default. A
 * model whose page names no default lists no `none` either, so it runs at some
 * other effort. Where the docs are silent, a reasoning model takes only the
 * default, as it did before OpenAI documented any effort.
 */
function takesOnlyDefaultTemperature(
  protocol: OpenaiProtocol,
  body: JsonObject,
  facts: OpenaiModelFacts,
): boolean {
  const reasoning = facts.reasoning
  const effort = requestedEffort(protocol, body) ?? reasoning?.defaultEffort
  const documented =
    effort === 'none'
      ? reasoning?.rejectsSamplingAtNoneEffort
      : reasoning?.rejectsSamplingAtOtherEffort
  return documented ?? facts.isReasoningModel
}

/**
 * Wording straight from `conformance/openai/temperature-above-max.ts`'s exact
 * regexes: a model that takes only its default temperature (chat states the
 * value and the default; responses names neither and carries no error
 * `code`), any other model rejects anything above the documented ceiling.
 */
function temperatureRejection(
  protocol: OpenaiProtocol,
  body: JsonObject,
  facts: OpenaiModelFacts,
): OpenaiAnswer | undefined {
  const temperature = body.temperature
  if (typeof temperature !== 'number') {
    return undefined
  }
  if (takesOnlyDefaultTemperature(protocol, body, facts)) {
    if (temperature === ACCEPTED_TEMPERATURE) {
      return undefined
    }
    return protocol === 'openai-chat'
      ? rejected(400, {
          message: `Unsupported value: 'temperature' does not support ${temperature} with this model. Only the default (${ACCEPTED_TEMPERATURE}) value is supported.`,
          param: 'temperature',
          code: 'unsupported_value',
        })
      : rejected(400, {
          message: "Unsupported parameter: 'temperature' is not supported with this model.",
          param: 'temperature',
          code: null,
        })
  }
  if (temperature > TEMPERATURE_CEILING) {
    return rejected(400, {
      message: `Invalid 'temperature': decimal above maximum value. Expected a value <= ${TEMPERATURE_CEILING}, but got ${temperature} instead.`,
      param: 'temperature',
      code: 'decimal_above_max_value',
    })
  }
  return undefined
}

function schemaFromChatBody(body: JsonObject): unknown {
  const responseFormat = isJsonObject(body.response_format) ? body.response_format : undefined
  const jsonSchema = isJsonObject(responseFormat?.json_schema)
    ? responseFormat.json_schema
    : undefined
  return responseFormat?.type === 'json_schema' ? jsonSchema?.schema : undefined
}

function schemaFromResponsesBody(body: JsonObject): unknown {
  const text = isJsonObject(body.text) ? body.text : undefined
  const format = isJsonObject(text?.format) ? text.format : undefined
  return format?.type === 'json_schema' ? format.schema : undefined
}

/**
 * The default answer text: a schema instance when this model enforces one, else the request's
 * own prompt echoed back. A fake with no model behind it has no real reply to give; echoing is
 * the plainest one that is still made of genuine words of whatever the caller actually asked,
 * rather than one fixed word every time - which is what lets a probe that reads tokens back
 * (`causal/logprobs-retokenize`) see real encoding-distinguishing words instead of none.
 */
function defaultAnswerText(schema: unknown, facts: OpenaiModelFacts, promptText: string): string {
  if (facts.supportsStructuredOutputs && schema !== undefined) {
    return JSON.stringify(instanceFor(schema))
  }
  return promptText.length > 0 ? promptText : ANSWER_TEXT
}

/** The single most-forced `logit_bias` token, if any bias is close enough to the top to force it. */
function forcedWord(bias: JsonObject, tokenizer: LocalTokenizer): string | undefined {
  const forcing = Object.entries(bias)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .filter(([, value]) => value >= FORCING_BIAS)
    .toSorted((a, b) => b[1] - a[1])
  const [tokenId] = forcing[0] ?? []
  return tokenId === undefined ? undefined : tokenizer.decode([Number(tokenId)]).trim()
}

/** `logprobs.content`: one real entry per token of `text`, decoded with the same tokenizer. */
function logprobsFor(text: string, tokenizer: LocalTokenizer): JsonObject {
  const encoder = new TextEncoder()
  const content = tokenizer.encode(text).map((id, index) => {
    const token = tokenizer.decode([id])
    // A synthetic, strictly negative, strictly increasing-magnitude confidence - genuine
    // logprobs are never zero or positive, and nothing here claims to model real sampling.
    return { token, logprob: -0.01 * (index + 1), bytes: [...encoder.encode(token)] }
  })
  return { content }
}

interface ChatContent {
  readonly text: string
  readonly wantsLogprobs: boolean
}

/** `logit_bias` forces its one word regardless of what would otherwise be answered. */
function chatContent(
  body: JsonObject,
  tokenizer: LocalTokenizer,
  defaultText: string,
): ChatContent {
  const bias = isJsonObject(body.logit_bias) ? body.logit_bias : undefined
  const forced = bias === undefined ? undefined : forcedWord(bias, tokenizer)
  return { text: forced ?? defaultText, wantsLogprobs: body.logprobs === true }
}

function withLogprobs(body: JsonObject, logprobs: JsonObject): JsonObject {
  const [choice] = Array.isArray(body.choices) ? body.choices : []
  return isJsonObject(choice) ? { ...body, choices: [{ ...choice, logprobs }] } : body
}

function chatCeiling(body: JsonObject): number | undefined {
  if (typeof body.max_completion_tokens === 'number') {
    return body.max_completion_tokens
  }
  return typeof body.max_tokens === 'number' ? body.max_tokens : undefined
}

interface Truncated {
  readonly text: string
  readonly tokens: number
}

/**
 * `text` cut to at most `ceiling` tokens of `tokenizer`. A genuine endpoint stopped at a token
 * limit never reports a count detached from what it actually sent back, so the text returned is
 * always exactly what its own reported token count decodes to.
 */
function truncate(tokenizer: LocalTokenizer, text: string, ceiling: number | undefined): Truncated {
  const ids = tokenizer.encode(text)
  if (ceiling === undefined || ids.length <= ceiling) {
    return { text, tokens: ids.length }
  }
  return { text: tokenizer.decode(ids.slice(0, ceiling)), tokens: ceiling }
}

/** @throws never - an unresolvable body still gets a best-effort answer, not a throw. */
export async function answerOpenaiChat(
  body: JsonObject,
  facts: OpenaiModelFacts,
  reportedModel: string = facts.id,
): Promise<OpenaiAnswer> {
  const rejection =
    unknownFieldRejection(body, CHAT_ALLOWED_FIELDS) ??
    modelNotFoundRejection(body, facts) ??
    effortRejection('openai-chat', body, facts) ??
    temperatureRejection('openai-chat', body, facts)
  if (rejection !== undefined) {
    return rejection
  }
  const tokenizer = await loadTokenizer(resolvedOpenaiEncoding(facts.id))
  const promptText = openaiChatPromptText(body)
  const defaultText = defaultAnswerText(schemaFromChatBody(body), facts, promptText)
  const content = chatContent(body, tokenizer, defaultText)
  const ceiling = chatCeiling(body)
  const { text, tokens: completionTokens } = truncate(tokenizer, content.text, ceiling)
  const finishReason = ceiling !== undefined && completionTokens === ceiling ? 'length' : 'stop'
  const wireBody = openaiChatBody({
    id: chatCompletionId(),
    model: reportedModel,
    text,
    finishReason,
    usage: { promptTokens: tokenizer.count(promptText), completionTokens },
    systemFingerprint: facts.systemFingerprint,
  })
  const logprobs = content.wantsLogprobs ? logprobsFor(text, tokenizer) : undefined
  return {
    status: 200,
    body: logprobs === undefined ? wireBody : withLogprobs(wireBody, logprobs),
  }
}

/** @throws never - an unresolvable body still gets a best-effort answer, not a throw. */
export async function answerOpenaiResponses(
  body: JsonObject,
  facts: OpenaiModelFacts,
  reportedModel: string = facts.id,
): Promise<OpenaiAnswer> {
  const rejection =
    unknownFieldRejection(body, RESPONSES_ALLOWED_FIELDS) ??
    modelNotFoundRejection(body, facts) ??
    effortRejection('openai-responses', body, facts) ??
    temperatureRejection('openai-responses', body, facts)
  if (rejection !== undefined) {
    return rejection
  }
  const tokenizer = await loadTokenizer(resolvedOpenaiEncoding(facts.id))
  const promptText = openaiResponsesPromptText(body)
  const defaultText = defaultAnswerText(schemaFromResponsesBody(body), facts, promptText)
  const ceiling = typeof body.max_output_tokens === 'number' ? body.max_output_tokens : undefined
  const { text, tokens: outputTokens } = truncate(tokenizer, defaultText, ceiling)
  const incomplete = ceiling !== undefined && outputTokens === ceiling
  return {
    status: 200,
    body: openaiResponseBody({
      id: responseId(),
      model: reportedModel,
      text,
      incomplete,
      usage: { inputTokens: tokenizer.count(promptText), outputTokens },
    }),
  }
}
