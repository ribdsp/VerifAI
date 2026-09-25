/**
 * OpenAI's own words, for the behaviours more than one probe relies on. A
 * citation only one probe uses lives in a file of its own under `sources/`.
 *
 * Retrieved from https://developers.openai.com/ with `.md` appended.
 * `platform.openai.com` answers 403 to clients that are not browsers, so it is
 * never cited: a buyer following the link from a report must be able to read
 * the same page the quote was checked against.
 */

import { citation } from './citation.js'

const RETRIEVED = '2026-09-24'

export const OPENAI_CHAT_PROMPT_TOKENS = citation(
  'https://developers.openai.com/api/reference/resources/chat',
  'Number of tokens in the prompt.',
  RETRIEVED,
)

export const OPENAI_CHAT_TOTAL_TOKENS = citation(
  'https://developers.openai.com/api/reference/resources/chat',
  'Total number of tokens used in the request (prompt + completion).',
  RETRIEVED,
)

export const OPENAI_LOGIT_BIAS = citation(
  'https://developers.openai.com/api/reference/resources/chat',
  'Accepts a JSON object that maps tokens (specified by their token ID in the tokenizer) to an associated bias value from -100 to 100.',
  RETRIEVED,
)
