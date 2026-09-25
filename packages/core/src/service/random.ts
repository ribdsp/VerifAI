/**
 * Fresh identifiers for a check: its nonce, its probe-order seed, and the id a
 * daemon hands out. Drawn from `crypto.getRandomValues`, which every runtime
 * core supports has.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** The largest multiple of the alphabet's size a byte can hold; bytes above it are redrawn. */
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length)

const MAX_LENGTH = 256

/** `length` characters of [a-z0-9], every one equally likely. */
export function randomId(length: number): string {
  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    throw new TypeError(`A random id is 1 to ${MAX_LENGTH} characters`)
  }
  let id = ''
  while (id.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < UNBIASED_LIMIT && id.length < length) {
        id += ALPHABET[byte % ALPHABET.length]
      }
    }
  }
  return id
}
