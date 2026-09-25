/**
 * What the Anthropic conformance probes share: the malformed request two of
 * them read, and the rejection-matrix readings bound to Anthropic's docs.
 * `../shared.ts` explains how a documented rejection becomes evidence.
 */

import { type AnthropicModel, anthropicModel, cheaperAnthropicModels } from '@verifai/fingerprints'
import { adapterFor } from '../../../adapters/adapter.js'
import { ANTHROPIC_ERROR_ENVELOPE } from '../../../sources/anthropic.js'
import { ANTHROPIC_ERROR_400 } from '../../../sources/anthropic-conformance.js'
import type { Protocol, Vendor } from '../../../types/target.js'
import type { Exchange, ProbeContext } from '../../types.js'
import {
  type CellResult as MatrixCellResult,
  type RejectionCell as MatrixRejectionCell,
  REFUSAL,
  rejectionMatrix,
} from '../shared.js'

export {
  CELL_TOKENS,
  type CellOutcome,
  conformanceSignal,
  describeAnswer,
  PROMPT,
  refusableRequest,
  settledCells,
  uniqueCitations,
} from '../shared.js'

export const ANTHROPIC_PROTOCOLS: readonly Protocol[] = Object.freeze(['anthropic-messages'])
export const ANTHROPIC_VENDORS: readonly Vendor[] = Object.freeze(['anthropic'])

const MESSAGES_PATH = adapterFor('anthropic-messages').generatePath

/** A Messages body cut off mid-array: no JSON parser accepts it. */
const MALFORMED_BODY = '{"max_tokens":1,"messages":['

/** The endpoint's answer to a body that is not JSON, sent once per run. */
export function malformedBody(context: ProbeContext): Promise<Exchange> {
  return context.shared('conformance/anthropic/malformed-body', () =>
    context.send({
      path: MESSAGES_PATH,
      body: { bytes: new TextEncoder().encode(MALFORMED_BODY) },
      provokes: REFUSAL,
    }),
  )
}

export type RejectionCell = MatrixRejectionCell<AnthropicModel>
export type CellResult = MatrixCellResult<AnthropicModel>

const ANTHROPIC_MATRIX = rejectionMatrix<AnthropicModel>({
  name: 'Anthropic',
  family: 'Claude',
  dialect: 'anthropic',
  model: anthropicModel,
  cheaper: cheaperAnthropicModels,
  refusal: [ANTHROPIC_ERROR_400, ANTHROPIC_ERROR_ENVELOPE],
})

export const {
  documentsAny,
  foreignRejectionSignals,
  outcomeOf,
  rejectionSignals,
  runMatrix,
  sendCells,
} = ANTHROPIC_MATRIX
