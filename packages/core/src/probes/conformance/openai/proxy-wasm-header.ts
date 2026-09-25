/**
 * Whether the endpoint sends `x-openai-proxy-wasm`, an undocumented header
 * OpenAI's edge adds to what its routed paths answer but not to its 404s.
 *
 * Only the header's presence is read. Its absence says nothing: a browser
 * hides every response header the server does not expose to it, so a genuine
 * endpoint reached from a browser shows no such header either.
 */

import { MEASURED_OPENAI_PROXY_WASM } from '../../../sources/measured-conformance.js'
import { header, quoted } from '../../shared.js'
import type { Probe, ProbeContext, Signal } from '../../types.js'
import { noKeyExchange, notFoundExchange, OPENAI_PROTOCOLS, observedSignal } from './shared.js'

const ID = 'conformance/openai/proxy-wasm-header'
const HEADER = 'x-openai-proxy-wasm'

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const routed = await noKeyExchange(context, 'get-models')
  const onRouted = header(routed, HEADER)
  if (routed.status !== 401 || onRouted === undefined) {
    return []
  }
  const unrouted = await notFoundExchange(context)
  const onUnrouted = unrouted.status === 404 ? header(unrouted, HEADER) : undefined
  const expected =
    'x-openai-proxy-wasm on the 401 a routed path returns without a key, and not on the 404 a path OpenAI does not route returns.'

  if (unrouted.status === 404 && onUnrouted === undefined) {
    return [
      observedSignal(ID, MEASURED_OPENAI_PROXY_WASM, {
        signalId: 'routed-only',
        observed: `x-openai-proxy-wasm: ${quoted(onRouted)} on the 401 from GET models, and absent from the 404 for an unrouted path.`,
        expected,
        llr: { platform: { 'first-party': 0.3 }, translation: { direct: 0.2 } },
        plainLanguage:
          "The endpoint sends a header that OpenAI's own servers add, and leaves it off exactly where they leave it off.",
      }),
    ]
  }
  return [
    observedSignal(ID, MEASURED_OPENAI_PROXY_WASM, {
      signalId: 'present',
      observed: `x-openai-proxy-wasm: ${quoted(onRouted)} on the 401 from GET models; the unrouted path answered ${unrouted.status}${onUnrouted === undefined ? '' : ' with the header as well'}.`,
      expected,
      llr: { platform: { 'first-party': 0.1 } },
      plainLanguage:
        "The endpoint sends a header that OpenAI's own servers add, though not in exactly the places they send it.",
    }),
  ]
}

export const proxyWasmHeader: Probe = Object.freeze<Probe>({
  id: ID,
  title: "OpenAI's x-openai-proxy-wasm header",
  group: 'A',
  protocols: OPENAI_PROTOCOLS,
  vendors: ['openai'],
  needsKey: false,
  cost: { requests: 2, tokens: 0 },
  citations: [MEASURED_OPENAI_PROXY_WASM],
  run,
})
