/**
 * Words for the warnings an estimate carries, shared by the CLI and the web UI
 * so the two never describe the same run differently.
 */

import type { EstimateWarning } from './contract.js'

export interface EstimateWarningText {
  readonly title: string
  readonly text: string
  /** Shown above everything else on the estimate screen. */
  readonly prominent: boolean
}

export const ESTIMATE_WARNING_TEXT: Readonly<Record<EstimateWarning, EstimateWarningText>> =
  Object.freeze({
    'plain-http': {
      title: 'Plain HTTP',
      text: 'The endpoint is http:, not https:. Your API key and every prompt cross the network unencrypted.',
      prominent: true,
    },
    'cross-protocol': {
      title: 'Cross-protocol pairing',
      text: 'The claimed model is served over the other vendor’s protocol. Fewer probes apply, and the confidence ceiling is lower.',
      prominent: true,
    },
    'no-api-key': {
      title: 'No API key',
      text: 'Only the probes that need no key will run.',
      prominent: false,
    },
    'private-targets-allowed': {
      title: 'Private addresses allowed',
      text: 'This run may reach loopback and private-network addresses.',
      prominent: false,
    },
    'protocol-detected': {
      title: 'Protocol detected',
      text: 'The protocol was detected from the endpoint’s answers rather than given.',
      prominent: false,
    },
    'model-mapped': {
      title: 'Model name mapped',
      text: 'The model name you gave is a gateway’s or platform’s spelling of a documented model name. Requests carry your name; the checks compare against the documented model’s behaviour.',
      prominent: false,
    },
    'vendor-inferred': {
      title: 'Vendor inferred',
      text: 'The vendor was read from the model name rather than given.',
      prominent: false,
    },
    'dilution-unsupported': {
      title: 'Group F unavailable',
      text: 'This transport cannot open a fresh connection per request, so the routing-dilution test will not run.',
      prominent: false,
    },
    'budget-limited': {
      title: 'Budget-limited',
      text: 'The request or token budget leaves out probes this profile would otherwise run.',
      prominent: false,
    },
  })
