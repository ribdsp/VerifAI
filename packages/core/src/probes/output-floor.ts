/**
 * The smallest generation an endpoint will run, for probes that read what a
 * generation reports rather than what it says.
 *
 * Each vendor's API accepts an output limit of one token - sixteen on the
 * Responses API - and a probe that only reads usage asks for no more. Some
 * platforms that serve the genuine model refuse a limit that small: Snowflake
 * Cortex answers `max_completion_tokens` 1 with a 400 for GPT-5.1 and later,
 * and accepts 16. So a 400 at the smallest limit is tried once more at 16, and
 * whichever limit the endpoint accepted is kept for the rest of the run, so
 * each later prompt is sent once.
 */

import type { Protocol } from '../types/target.js'
import {
  generationOf,
  generationRequest,
  isSuccess,
  RESPONSES_MIN_OUTPUT_TOKENS,
} from './shared.js'
import type { Exchange, ProbeContext, ProbeRequest } from './types.js'

/** The most output a request sent here sets, for the budget. */
export const MAX_OUTPUT_FLOOR = RESPONSES_MIN_OUTPUT_TOKENS

const REFUSED_STATUS = 400
const ONE_TOKEN = 1

export function smallestOutputLimit(protocol: Protocol): number {
  return protocol === 'openai-responses' ? RESPONSES_MIN_OUTPUT_TOKENS : ONE_TOKEN
}

/**
 * What finding the floor may add, for the budget, to a probe whose prompts
 * are at most `promptTokens` long: the first prompt sent once more, at one
 * output token, before the endpoint refuses it.
 */
export function discoveryCost(promptTokens: number): {
  readonly requests: number
  readonly tokens: number
} {
  return Object.freeze({ requests: 1, tokens: promptTokens + ONE_TOKEN })
}

interface Floor {
  /** The output limit the request set. */
  readonly outputLimit: number
  /** The smaller limit the endpoint refused earlier in the run, if it refused one. */
  readonly refusedLimit?: number
}

export interface FloorGeneration extends Floor {
  readonly request: ProbeRequest
  readonly exchange: Exchange
}

async function sendAt(
  context: ProbeContext,
  prompt: string,
  floor: Floor,
): Promise<FloorGeneration> {
  const request = generationRequest(context.target, { prompt, maxTokens: floor.outputLimit })
  const exchange = await context.send(request)
  return Object.freeze({ ...floor, request, exchange })
}

async function discover(context: ProbeContext, prompt: string): Promise<FloorGeneration> {
  const { protocol } = context.target
  const smallest = smallestOutputLimit(protocol)
  const first = await sendAt(context, prompt, { outputLimit: smallest })
  if (first.exchange.status !== REFUSED_STATUS || smallest >= MAX_OUTPUT_FLOOR) {
    return first
  }
  const retried = await sendAt(context, prompt, {
    outputLimit: MAX_OUTPUT_FLOOR,
    refusedLimit: smallest,
  })
  const isAccepted =
    isSuccess(retried.exchange) && generationOf(retried.exchange, protocol) !== undefined
  // Refused again, the limit was not what the endpoint objected to.
  return isAccepted ? retried : first
}

function floorOf({ outputLimit, refusedLimit }: FloorGeneration): Floor {
  return Object.freeze(refusedLimit === undefined ? { outputLimit } : { outputLimit, refusedLimit })
}

/**
 * `prompt` as a generation at the smallest output limit the endpoint accepts,
 * found by the first call in a run. A request lost on the way decides nothing.
 */
export async function sendAtOutputFloor(
  context: ProbeContext,
  prompt: string,
): Promise<FloorGeneration> {
  // Set only when this call's own closure ran, so only when this prompt was the one sent.
  let discovered: FloorGeneration | undefined
  const floor = await context.shared(
    `generation/${context.target.protocol}-output-floor`,
    async () => {
      discovered = await discover(context, prompt)
      return floorOf(discovered)
    },
  )
  return discovered ?? sendAt(context, prompt, floor)
}
