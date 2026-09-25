import { describe, expect, it } from 'vitest'
import type { DilutionProbe, ProbeContext } from '../src/probes/types.js'
import { modeOf, replacementAllowance, spreadMoments } from '../src/runner/dilution.js'
import { type RunOptions, runProbes } from '../src/runner/run.js'
import type { RunEvent } from '../src/runner/types.js'
import type { ConnectionReuse, TransportResult } from '../src/transport/types.js'
import { probeTarget } from './fakes/context.js'
import { harness } from './fakes/environment.js'
import {
  DILUTION_ID,
  type DilutionOptions,
  MESSAGES_REQUEST,
  testDilutionProbe,
  testProbe,
} from './fakes/probes.js'
import { failure, fakeTransport, response } from './fakes/transport.js'

function on(connection: ConnectionReuse, body: string): TransportResult {
  return { ...response(200, body), connection }
}

/** Answers request `n` (from 0, prepare requests included) with `answer(n)`. */
function dilutionRun(
  answer: (index: number) => TransportResult,
  probe: DilutionOptions = {},
  overrides: Partial<RunOptions> = {},
) {
  let index = 0
  const events: RunEvent[] = []
  const h = harness()
  const run: RunOptions = {
    target: probeTarget(),
    transport: fakeTransport(() => {
      const result = answer(index)
      index += 1
      return result
    }),
    probes: [testDilutionProbe(probe)],
    maxRequests: 200,
    maxTokens: 1000,
    nonce: 'abcdefgh12',
    draws: 9,
    environment: h.environment,
    onEvent: (event) => events.push(event),
    ...overrides,
  }
  return { run, events, h }
}

function drawEvents(events: readonly RunEvent[]): string[] {
  return events.flatMap((event) =>
    event.kind === 'draw' ? [`${event.draw}:${event.outcome}`] : [],
  )
}

/** The test probe, with its plan changed after it was made. */
function withPlan(
  change: (plan: Record<string, unknown>) => Record<string, unknown>,
): DilutionProbe {
  const probe = testDilutionProbe()
  return {
    ...probe,
    prepare: async (context: ProbeContext) => {
      const plan = await probe.prepare(context)
      return change({ ...plan }) as unknown as typeof plan
    },
  }
}

describe('Group F draws', () => {
  it('judges every draw against the reference and concludes on the readings', async () => {
    const { run, events } = dilutionRun((index) => response(200, index === 4 ? 'other' : 'genuine'))
    const result = await runProbes(run)

    expect(result.outcomes).toEqual([{ probeId: DILUTION_ID, group: 'F', status: 'ran' }])
    expect(result.dilution?.planned).toBe(9)
    expect(result.dilution?.basis).toBe('reference')
    expect(result.dilution?.draws.filter((draw) => draw.outcome === 'disagree')).toEqual([
      { draw: 5, outcome: 'disagree' },
    ])
    expect(result.dilution?.readings).toHaveLength(9)
    expect(result.signals.map((signal) => signal.signalId)).toEqual(['uniform'])
    expect(drawEvents(events)).toHaveLength(9)
    expect(drawEvents(events)[4]).toBe('5:disagree')
    expect(result.evidence.map((entry) => entry.draw)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('judges against the most frequent reading when there is no reference', async () => {
    const { run, events } = dilutionRun(
      (index) => response(200, index % 3 === 0 ? 'minority' : 'majority'),
      { basis: 'mode' },
    )
    const result = await runProbes(run)
    expect(result.dilution?.draws.map((draw) => draw.outcome)).toEqual([
      'disagree',
      'agree',
      'agree',
      'disagree',
      'agree',
      'agree',
      'disagree',
      'agree',
      'agree',
    ])
    expect(drawEvents(events)).toHaveLength(9)
  })

  it('re-runs a lost draw at once, up to a ninth of the draws', async () => {
    const { run, h } = dilutionRun((index) =>
      index < 2 ? response(503) : response(200, 'genuine'),
    )
    const result = await runProbes(run)
    const outcomes = result.dilution?.draws.map((draw) => draw.outcome) ?? []
    // A draw is never retried in place: two lost draws, and one replacement allowed.
    expect(outcomes.filter((outcome) => outcome === 'lost')).toHaveLength(2)
    expect(outcomes.filter((outcome) => outcome === 'agree')).toHaveLength(8)
    expect(outcomes).toHaveLength(10)
    expect(h.slept).toHaveLength(2)
  })

  it('counts a draw the probe could not read as lost', async () => {
    const { run } = dilutionRun(() => response(200, ''), { read: () => undefined })
    const result = await runProbes(run)
    expect(result.dilution?.draws.every((draw) => draw.outcome === 'lost')).toBe(true)
    expect(result.dilution?.readings).toEqual([])
  })

  it('excludes a draw on a reused connection, and gives up when too many are', async () => {
    const once = dilutionRun((index) => on(index === 3 ? 'reused' : 'fresh', 'genuine'))
    const result = await runProbes(once.run)
    expect(result.dilution?.draws.filter((draw) => draw.outcome === 'excluded')).toHaveLength(1)
    expect(result.dilution?.draws).toHaveLength(10)

    const often = dilutionRun((index) => on(index % 2 === 0 ? 'reused' : 'fresh', 'genuine'))
    const refused = await runProbes(often.run)
    expect(refused.skipped).toEqual([{ probeId: DILUTION_ID, reason: 'unsupported-by-transport' }])
    expect(refused.dilution).toBeUndefined()
    expect(refused.signals).toEqual([])
  })

  it('does not run on a transport that cannot see connections', async () => {
    const { run } = dilutionRun(() => on('unobserved', 'genuine'))
    const result = await runProbes(run)
    expect(result.skipped).toEqual([{ probeId: DILUTION_ID, reason: 'unsupported-by-transport' }])
  })

  it('keeps the draws the budget allowed, and says the budget cut them short', async () => {
    const { run } = dilutionRun(() => response(200, 'genuine'), {}, { maxRequests: 4 })
    const result = await runProbes(run)
    expect(result.skipped).toEqual([{ probeId: DILUTION_ID, reason: 'budget-exceeded' }])
    expect(result.dilution?.draws).toHaveLength(4)
    expect(result.signals).toEqual([])
  })

  it('reports a mode-basis run the budget cut short once it stops', async () => {
    const { run, events } = dilutionRun(
      () => response(200, 'genuine'),
      { basis: 'mode' },
      { maxRequests: 3 },
    )
    const result = await runProbes(run)
    expect(result.skipped[0]?.reason).toBe('budget-exceeded')
    expect(drawEvents(events)).toEqual(['1:agree', '2:agree', '3:agree'])
  })

  it('spreads planned draws over the spread, in order', async () => {
    let calls = 0
    const h = harness(() => {
      calls += 1
      return (10 - calls) / 10
    })
    const { run } = dilutionRun(
      () => response(200, 'genuine'),
      {},
      {
        spreadMs: 1000,
        environment: h.environment,
      },
    )
    const result = await runProbes(run)
    expect(result.outcomes[0]?.status).toBe('ran')
    expect(h.slept).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100])
    expect(h.now).toBe(900)
  })

  it('sends prepare requests outside any draw', async () => {
    const { run } = dilutionRun(() => response(200, 'genuine'), {
      prepare: async (context) => {
        await context.send(MESSAGES_REQUEST)
      },
    })
    const result = await runProbes(run)
    expect(result.evidence[0]?.draw).toBeUndefined()
    expect(result.evidence[1]?.draw).toBe(1)
  })

  it('treats a draw that sends more than it declares as a bug in the probe', async () => {
    const { run } = dilutionRun(() => response(200, 'genuine'), { drawRequests: 2 })
    const result = await runProbes(run)
    expect(result.skipped).toEqual([{ probeId: DILUTION_ID, reason: 'probe-error' }])
  })

  it('treats a plan it cannot follow as a bug in the probe', async () => {
    const broken = [
      withPlan(({ reference: _, ...plan }) => plan),
      withPlan((plan) => ({ ...plan, basis: 'vote' })),
    ]
    for (const probe of broken) {
      const { run } = dilutionRun(() => response(200, 'genuine'), {}, { probes: [probe] })
      const result = await runProbes(run)
      expect(result.skipped).toEqual([{ probeId: DILUTION_ID, reason: 'probe-error' }])
    }
  })

  it('loses a draw whose transport failure would otherwise be retried', async () => {
    const { run, h } = dilutionRun((index) =>
      index === 0 ? failure('timeout', true) : response(200, 'genuine'),
    )
    const result = await runProbes(run)
    expect(result.dilution?.draws[0]).toEqual({ draw: 1, outcome: 'lost' })
    expect(h.slept).toHaveLength(1)
  })

  it('excludes, rather than loses, a draw whose request never left', async () => {
    const { run } = dilutionRun((index) =>
      index === 0 ? failure('connection-failed') : response(200, 'genuine'),
    )
    const result = await runProbes(run)
    expect(result.dilution?.draws[0]).toEqual({ draw: 1, outcome: 'excluded' })
    expect(result.outcomes[0]?.status).toBe('ran')
  })

  it('refuses a run with two Group F probes', async () => {
    const { run } = dilutionRun(
      () => response(200, 'genuine'),
      {},
      {
        probes: [testDilutionProbe(), { ...testDilutionProbe(), id: 'dilution/other' }],
      },
    )
    await expect(runProbes(run)).rejects.toThrow(TypeError)
  })

  it('runs alongside ordinary probes', async () => {
    const { run } = dilutionRun(
      () => response(200, 'genuine'),
      {},
      {
        probes: [testProbe('conformance/test/one'), testDilutionProbe()],
      },
    )
    const result = await runProbes(run)
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['ran', 'ran'])
    expect(result.signals).toHaveLength(2)
  })
})

describe('dilution helpers', () => {
  it('picks the most frequent reading, the first seen on a tie', () => {
    expect(modeOf(['a', 'b', 'b', 'a', 'c'])).toBe('a')
    expect(modeOf(['c', 'b', 'b'])).toBe('b')
    expect(modeOf([])).toBeUndefined()
  })

  it('spreads moments in order, or not at all', () => {
    const values = [0.9, 0.1, 0.5]
    let index = 0
    const random = () => {
      const value = values[index] ?? 0
      index += 1
      return value
    }
    expect(spreadMoments(3, 1000, random)).toEqual([100, 500, 900])
    expect(spreadMoments(3, 0, random)).toEqual([])
  })

  it('allows a ninth of the draws as replacements', () => {
    expect(replacementAllowance(30)).toBe(3)
    expect(replacementAllowance(8)).toBe(0)
    expect(replacementAllowance(9)).toBe(1)
  })
})
