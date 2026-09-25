/**
 * How the endpoint's unauthenticated 401s are laid out and worded, route by
 * route. OpenAI's edge answers four routes with three different serializers -
 * compact, 2-space and 4-space JSON, in two wordings - which only its own
 * routing produces. A reseller that checks keys itself answers every route the
 * same way, so a mismatch weighs very little; a full match is hard to arrive at
 * by accident.
 */

import { MEASURED_OPENAI_ROUTE_SERIALIZERS } from '../../../sources/measured-conformance.js'
import type { Exchange, LlrTable, Probe, ProbeContext, Signal } from '../../types.js'
import {
  describeError,
  type Layout,
  layoutOf,
  NO_KEY_ROUTES,
  type NoKeyRoute,
  noKeyExchange,
  OPENAI_PROTOCOLS,
  observedSignal,
  openaiError,
  routeLabel,
} from './shared.js'

const ID = 'conformance/openai/route-serializers'

/** A full match needs at least this many routes to have answered 401. */
const MIN_ROUTES_FOR_FULL_MATCH = 3

interface Serializer {
  readonly layout: Layout
  readonly matches: (message: string) => boolean
}

const BEARER_ONLY = 'Missing bearer authentication in header'
const BEARER_OR_BASIC = 'Missing bearer or basic authentication in header'
const LEGACY_PREFIX = "You didn't provide an API key."

const SERIALIZERS: Readonly<Record<NoKeyRoute, Serializer>> = Object.freeze({
  'get-models': { layout: 'indent-2', matches: (message) => message === BEARER_ONLY },
  'get-chat-completions': { layout: 'compact', matches: (message) => message === BEARER_OR_BASIC },
  'post-chat-completions': {
    layout: 'indent-4',
    matches: (message) => message.startsWith(LEGACY_PREFIX),
  },
  'post-responses': { layout: 'indent-2', matches: (message) => message === BEARER_OR_BASIC },
})

interface RouteReading {
  readonly route: NoKeyRoute
  readonly exchange: Exchange
  readonly matches: boolean
}

function read(route: NoKeyRoute, exchange: Exchange): RouteReading {
  const serializer = SERIALIZERS[route]
  const message = openaiError(exchange)?.message
  const matches =
    layoutOf(exchange) === serializer.layout && message !== undefined && serializer.matches(message)
  return { route, exchange, matches }
}

function describe(reading: RouteReading): string {
  const layout = layoutOf(reading.exchange) ?? 'not JSON'
  const verdict = reading.matches ? 'as OpenAI' : 'unlike OpenAI'
  return `${routeLabel(reading.route)}: ${layout}, ${describeError(reading.exchange)} (${verdict})`
}

type Verdict = 'match' | 'partial-match' | 'mismatch'

function verdictOf(readings: readonly RouteReading[], matched: number): Verdict {
  if (matched === readings.length && matched >= MIN_ROUTES_FOR_FULL_MATCH) {
    return 'match'
  }
  return matched > 0 ? 'partial-match' : 'mismatch'
}

const LLRS: Readonly<Record<Verdict, LlrTable>> = Object.freeze({
  match: { platform: { 'first-party': 0.3 }, translation: { direct: 0.3 } },
  'partial-match': { platform: { 'first-party': 0.1 } },
  mismatch: { platform: { 'first-party': -0.1 } },
})

function conclude(readings: readonly RouteReading[]): Signal {
  const matched = readings.filter((reading) => reading.matches).length
  const verdict = verdictOf(readings, matched)
  return observedSignal(ID, MEASURED_OPENAI_ROUTE_SERIALIZERS, {
    signalId: verdict,
    observed: readings.map(describe).join('; '),
    expected:
      "GET models: 2-space JSON, 'Missing bearer authentication in header'; GET chat/completions: compact, 'Missing bearer or basic authentication in header'; POST chat/completions: 4-space, 'You didn't provide an API key. …'; POST responses: 2-space, 'Missing bearer or basic authentication in header'.",
    llr: LLRS[verdict],
    plainLanguage:
      verdict === 'match'
        ? "Asked without a key, the endpoint's error on every route was laid out and worded exactly as OpenAI's own servers do it, route by route."
        : `Asked without a key, the endpoint's error matched OpenAI's own on ${matched} of ${readings.length} routes. Resellers that check keys themselves answer in their own format, which says nothing about the model behind them.`,
  })
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const exchanges = await Promise.all(
    NO_KEY_ROUTES.map(async (route) => [route, await noKeyExchange(context, route)] as const),
  )
  const readings = exchanges
    .filter(([, exchange]) => exchange.status === 401)
    .map(([route, exchange]) => read(route, exchange))
  return readings.length === 0 ? [] : [conclude(readings)]
}

export const routeSerializers: Probe = Object.freeze<Probe>({
  id: ID,
  title: "OpenAI's per-route 401 serializers",
  group: 'A',
  protocols: OPENAI_PROTOCOLS,
  vendors: ['openai'],
  needsKey: false,
  cost: { requests: NO_KEY_ROUTES.length, tokens: 0 },
  citations: [MEASURED_OPENAI_ROUTE_SERIALIZERS],
  run,
})
