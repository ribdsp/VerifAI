import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DrawStrip } from '../src/components/DrawStrip'

function stripMarkup(props: Parameters<typeof DrawStrip>[0]): string {
  return renderToStaticMarkup(createElement(DrawStrip, props))
}

describe('DrawStrip', () => {
  it('says nothing has been drawn before the first draw', () => {
    const html = stripMarkup({ draws: [], planned: 3 })

    expect(html).toContain('No draws yet; 3 to go')
    expect(html.match(/aria-label="Draw \d+: not yet drawn"/g)).toHaveLength(3)
  })

  it('counts the draws by outcome, and what is left', () => {
    const html = stripMarkup({
      draws: [
        { draw: 1, outcome: 'agree' },
        { draw: 2, outcome: 'disagree' },
      ],
      planned: 4,
    })

    expect(html).toContain('1 agreed, 1 disagreed; 2 to go')
  })

  it('shows draws taken but not yet judged apart from those still to draw', () => {
    const html = stripMarkup({ draws: [{ draw: 2, outcome: 'lost' }], taken: 3, planned: 5 })

    expect(html).toContain('2 taken, judged once every draw is in, 1 lost; 2 to go')
    expect(html).toContain('aria-label="Draw 1: taken, not yet judged"')
    expect(html).toContain('aria-label="Draw 2: lost"')
    expect(html).toContain('aria-label="Draw 3: taken, not yet judged"')
    expect(html).toContain('aria-label="Draw 4: not yet drawn"')
  })

  it('stops calling a draw pending once it is judged', () => {
    const html = stripMarkup({
      draws: [
        { draw: 1, outcome: 'agree' },
        { draw: 2, outcome: 'agree' },
      ],
      taken: 2,
      planned: 2,
    })

    expect(html).toContain('2 agreed')
    expect(html).not.toContain('taken')
  })

  it('keys each kind of square it shows, and only those', () => {
    const html = stripMarkup({
      draws: [
        { draw: 1, outcome: 'agree' },
        { draw: 2, outcome: 'disagree' },
      ],
      taken: 3,
      planned: 4,
    })
    const key = /<ul aria-hidden="true"[^>]*>(.*?)<\/ul>/.exec(html)?.[1] ?? ''
    const words = [...key.matchAll(/<\/span>([^<]+)<\/li>/g)].map((match) => match[1])

    expect(words).toEqual(['agreed', 'disagreed', 'taken, not yet judged', 'not yet drawn'])
  })

  it('shows no key before there is a square to key', () => {
    expect(stripMarkup({ draws: [] })).not.toContain('<ul')
  })
})
