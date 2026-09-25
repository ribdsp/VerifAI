/**
 * How the endpoint answers a method a route does not take and a path it does
 * not route. OpenAI's edge answers both with a 404 and a zero-byte body, where
 * most frameworks - and OpenAI's own older API - send an error document.
 */

import { MEASURED_OPENAI_EMPTY_404 } from '../../../sources/measured-conformance.js'
import type { Exchange, LlrTable, Probe, ProbeContext, Signal } from '../../types.js'
import { notFoundExchange, OPENAI_PROTOCOLS, observedSignal } from './shared.js'

const ID = 'conformance/openai/empty-404'

function isEmpty404(exchange: Exchange): boolean {
  return exchange.status === 404 && exchange.body.length === 0
}

function describe(label: string, exchange: Exchange): string {
  const body = exchange.body.length === 0 ? 'an empty body' : `a ${exchange.body.length}-byte body`
  return `${label} answered ${exchange.status} with ${body}`
}

type Verdict = 'match' | 'partial-match' | 'mismatch'

/** Indexed by how many of the two requests answered as OpenAI's edge does. */
const VERDICTS: readonly Verdict[] = Object.freeze(['mismatch', 'partial-match', 'match'])

const LLRS: Readonly<Record<Verdict, LlrTable>> = Object.freeze({
  match: { platform: { 'first-party': 0.2 }, translation: { direct: 0.2 } },
  'partial-match': { platform: { 'first-party': 0.1 } },
  mismatch: { platform: { 'first-party': -0.1 } },
})

const PLAIN_LANGUAGE: Readonly<Record<Verdict, string>> = Object.freeze({
  match:
    "The endpoint answers requests it cannot serve with an empty 404, as OpenAI's own servers do.",
  'partial-match':
    "The endpoint answered one of two requests it cannot serve with an empty 404, as OpenAI's own servers do, and the other differently.",
  mismatch:
    "The endpoint answers requests it cannot serve differently from OpenAI's own servers. Resellers and gateways commonly do; it says nothing about the model behind them.",
})

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const wrongMethod = await context.send({
    path: 'models',
    method: 'POST',
    credential: 'none',
    provokes: [404],
  })
  const unrouted = await notFoundExchange(context)
  const matched = [wrongMethod, unrouted].filter(isEmpty404).length
  const verdict = VERDICTS[matched] ?? 'mismatch'
  return [
    observedSignal(ID, MEASURED_OPENAI_EMPTY_404, {
      signalId: verdict,
      observed: `${describe('POST models', wrongMethod)}; ${describe('an unrouted path', unrouted)}.`,
      expected: 'A 404 with an empty body for both.',
      llr: LLRS[verdict],
      plainLanguage: PLAIN_LANGUAGE[verdict],
    }),
  ]
}

export const empty404: Probe = Object.freeze<Probe>({
  id: ID,
  title: "OpenAI's empty 404",
  group: 'A',
  protocols: OPENAI_PROTOCOLS,
  vendors: ['openai'],
  needsKey: false,
  cost: { requests: 2, tokens: 0 },
  citations: [MEASURED_OPENAI_EMPTY_404],
  run,
})
