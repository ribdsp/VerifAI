/**
 * Static guarantees about the page's source: nothing in it can put the API
 * key, or anything else, into browser storage, a cookie or the console, and
 * nothing in it renders raw HTML or evaluates a string.
 *
 * A static scan is blunt on purpose. A comment that names a banned API fails
 * it too, which is cheaper to reword than an exception is to keep honest.
 */

import { describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'

const SOURCES = import.meta.glob<string>('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const BANNED: readonly (readonly [name: string, pattern: RegExp])[] = [
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['document.cookie', /\bdocument\s*\.\s*cookie\b/],
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['eval(', /\beval\s*\(/],
  ['new Function', /\bnew\s+Function\b/],
  ['console.', /\bconsole\s*\./],
]

/** The only modules that may name the key: the form that holds it and the builder it hands it to. */
const KEY_HOLDERS: ReadonlySet<string> = new Set([
  '../src/components/CheckForm.tsx',
  '../src/lib/request.ts',
])

const files = Object.entries(SOURCES)

describe('page source', () => {
  it('finds the source files to scan', () => {
    expect(files.length).toBeGreaterThan(0)
    expect(files.map(([path]) => path)).toContain('../src/lib/api.ts')
  })

  it.each(BANNED)('never uses %s', (_name, pattern) => {
    const offenders = files.filter(([, source]) => pattern.test(source)).map(([path]) => path)

    expect(offenders).toEqual([])
  })

  it('names the API key only where it is held and built into the request', () => {
    const offenders = files
      .filter(([path, source]) => !KEY_HOLDERS.has(path) && /\bapiKey\b/.test(source))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })

  it('takes the key in a password field that the browser does not remember or spell-check', () => {
    const form = SOURCES['../src/components/CheckForm.tsx'] ?? ''
    const keyInputs = (form.match(/<input\b[\s\S]*?\/>/g) ?? []).filter((input) =>
      input.includes('type="password"'),
    )
    const [keyInput = ''] = keyInputs

    expect(keyInputs).toHaveLength(1)
    expect(keyInput).toContain('autoComplete="off"')
    expect(keyInput).toContain('spellCheck={false}')
    expect(keyInput).toContain('value={apiKey}')
  })

  it('reaches only its own origin', () => {
    const offenders = files
      .filter(([, source]) => /fetch\(\s*['"`]https?:/.test(source))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })
})

describe('index.html', () => {
  it('has no inline script or style, and loads nothing from the network', () => {
    const scripts = indexHtml.match(/<script\b[^>]*>/g) ?? []

    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) {
      expect(script).toMatch(/\bsrc="\/[^/]/)
    }
    expect(indexHtml).not.toMatch(/<style\b/)
    expect(indexHtml).not.toMatch(/\sstyle=/)
    expect(indexHtml).not.toMatch(/\son[a-z]+=/)
    expect(indexHtml).not.toMatch(/(?:src|href)="(?:https?:)?\/\//)
  })

  it('sends no referrer', () => {
    expect(indexHtml).toContain('<meta name="referrer" content="no-referrer" />')
  })
})
