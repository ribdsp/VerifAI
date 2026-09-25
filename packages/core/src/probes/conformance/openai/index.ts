/** OpenAI's protocol-conformance probes, in the order a run reports them. */

import type { Probe } from '../../types.js'
import { authOnlyHeaders } from './auth-only-headers.js'
import { cors } from './cors.js'
import { empty404 } from './empty-404.js'
import { modelNotFound } from './model-not-found.js'
import { proxyWasmHeader } from './proxy-wasm-header.js'
import { reasoningMatrix } from './reasoning-matrix.js'
import { routeSerializers } from './route-serializers.js'
import { temperatureAboveMax } from './temperature-above-max.js'
import { unknownParameter } from './unknown-parameter.js'

export const OPENAI_CONFORMANCE_PROBES: readonly Probe[] = Object.freeze([
  routeSerializers,
  proxyWasmHeader,
  empty404,
  cors,
  authOnlyHeaders,
  unknownParameter,
  modelNotFound,
  temperatureAboveMax,
  reasoningMatrix,
])
