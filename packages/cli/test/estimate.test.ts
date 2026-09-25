import type { CheckEstimate } from '@verifai/core'
import { describe, expect, it } from 'vitest'
import { estimateText } from '../src/check/estimate.js'

const ESTIMATE: CheckEstimate = {
  protocol: 'anthropic-messages',
  vendor: 'anthropic',
  pairing: 'native',
  auth: 'x-api-key',
  profile: 'quick',
  requests: 12,
  tokens: 0,
  maxRequests: 100,
  maxTokens: 5000,
  draws: 0,
  spreadMs: 0,
  probes: [],
  skipped: [],
  warnings: [],
}

describe('estimateText', () => {
  it('lists the warnings that change what to do apart from the notes, each as a plain bullet', () => {
    const text = estimateText(
      { ...ESTIMATE, warnings: ['private-targets-allowed', 'plain-http'] },
      'claude-opus-5-5',
    )

    expect(text).toContain(
      [
        'Warnings:',
        '  - Plain HTTP: The endpoint is http:, not https:. Your API key and every prompt cross the network unencrypted.',
        '',
        'Notes:',
        '  - Private addresses allowed: This run may reach loopback and private-network addresses.',
      ].join('\n'),
    )
    expect(text).not.toMatch(/^ {2}! /m)
  })

  it('leaves out a heading with nothing under it', () => {
    const notesOnly = estimateText({ ...ESTIMATE, warnings: ['no-api-key'] }, 'claude-opus-5-5')
    expect(notesOnly).toContain(
      'Notes:\n  - No API key: Only the probes that need no key will run.',
    )
    expect(notesOnly).not.toContain('Warnings:')

    const neither = estimateText(ESTIMATE, 'claude-opus-5-5')
    expect(neither).not.toContain('Warnings:')
    expect(neither).not.toContain('Notes:')
  })
})
