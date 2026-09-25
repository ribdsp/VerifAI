import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forgetSessionToken,
  type SessionHistory,
  sessionToken,
  takeSessionToken,
  tokenFromHash,
} from '../src/lib/session'
import { TOKEN } from './fixtures'

function fakeHistory() {
  const replaceState = vi.fn<SessionHistory['replaceState']>()
  return { history: { replaceState }, replaceState }
}

function locationOf(hash: string) {
  return { hash, pathname: '/', search: '?view=1' }
}

afterEach(() => {
  forgetSessionToken()
})

describe('tokenFromHash', () => {
  it('reads the token from the fragment, with or without the leading #', () => {
    expect(tokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN)
    expect(tokenFromHash(`token=${TOKEN}`)).toBe(TOKEN)
  })

  it('ignores other fragment keys', () => {
    expect(tokenFromHash(`#other=${TOKEN}`)).toBeUndefined()
    expect(tokenFromHash('')).toBeUndefined()
  })

  it('rejects a token that is too short, too long, or carries unsafe characters', () => {
    expect(tokenFromHash('#token=short')).toBeUndefined()
    expect(tokenFromHash(`#token=${'a'.repeat(513)}`)).toBeUndefined()
    expect(tokenFromHash('#token=abcdefghijklmnop%0Aevil')).toBeUndefined()
    expect(tokenFromHash('#token=abcdefghijklmnop%20space')).toBeUndefined()
  })
})

describe('takeSessionToken', () => {
  it('keeps the token and strips the fragment from the address bar', () => {
    const { history, replaceState } = fakeHistory()

    const token = takeSessionToken(locationOf(`#token=${TOKEN}`), history)

    expect(token).toBe(TOKEN)
    expect(sessionToken()).toBe(TOKEN)
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/?view=1')
  })

  it('strips a fragment even when the token in it is malformed', () => {
    const { history, replaceState } = fakeHistory()

    expect(takeSessionToken(locationOf('#token=bad'), history)).toBeUndefined()
    expect(replaceState).toHaveBeenCalledOnce()
  })

  it('leaves history alone when there is no fragment, and keeps the token it has', () => {
    const first = fakeHistory()
    takeSessionToken(locationOf(`#token=${TOKEN}`), first.history)
    const second = fakeHistory()

    expect(takeSessionToken(locationOf(''), second.history)).toBe(TOKEN)
    expect(second.replaceState).not.toHaveBeenCalled()
  })

  it('holds nothing before a token is taken or after it is forgotten', () => {
    expect(sessionToken()).toBeUndefined()
    takeSessionToken(locationOf(`#token=${TOKEN}`), fakeHistory().history)

    forgetSessionToken()

    expect(sessionToken()).toBeUndefined()
  })
})
