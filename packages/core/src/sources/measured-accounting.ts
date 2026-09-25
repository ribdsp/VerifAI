/**
 * This project's own method for Groups B and C, where the vendors document
 * each field but not the comparison a probe makes between them.
 *
 * None of this is vendor documentation and none of it was recorded with
 * `verifai record`: it is how a reading is taken and what it is taken to
 * mean. Each quote is a line of `docs/PROVENANCE.md`, under the entry of the
 * probe that relies on it.
 */

import { citation } from './citation.js'

const PROVENANCE = 'https://github.com/ribdsp/VerifAI/blob/main/docs/PROVENANCE.md'
const WRITTEN = '2026-09-24'

export const MEASURED_DIFFERENTIAL_COUNT = citation(
  PROVENANCE,
  'A differential count subtracts the input tokens reported for a base prompt from those reported for the same prompt with a probe string appended, so the message template and any tokens a server adds, which are the same in both requests, cancel.',
  WRITTEN,
)

export const MEASURED_ESTIMATED_USAGE = citation(
  PROVENANCE,
  "A layer that estimates usage instead of passing on the model's own count reports numbers that follow the length of the text, about one token per three or four characters or bytes, and match no vocabulary; such counts show that usage was rewritten, not which model answered.",
  WRITTEN,
)

export const MEASURED_RECOUNTED_USAGE = citation(
  PROVENANCE,
  'A layer can recount usage with a public OpenAI encoding, so a count that matches one exactly is as consistent with a recounting layer in front of the model as with an OpenAI model behind it.',
  WRITTEN,
)

export const MEASURED_MODEL_SPELLINGS = citation(
  PROVENANCE,
  "Before a response's `model` is compared with the claimed model, both are lowercased and stripped of the spellings clouds and routers add: a region prefix such as `us.`, a vendor prefix such as `anthropic.` or `openai/`, a `-v1` or `-v1:0` suffix, `@` before a date, and dots between version numbers in a Claude name.",
  WRITTEN,
)

export const MEASURED_OTHER_FAMILIES = citation(
  PROVENANCE,
  "A `model` naming a model family that neither Anthropic nor OpenAI documents, such as `deepseek`, `qwen`, `llama`, `mistral`, `gemini`, `glm`, `kimi` or `grok`, is read as another developer's model.",
  WRITTEN,
)

export const MEASURED_COUNT_STEP = citation(
  PROVENANCE,
  "Counts from `count_tokens` and from the `usage` of a generation with the same messages are taken to agree within 8 tokens or 8 percent; a ratio between 1.08 and 1.45 is read as the tokenizer step between Claude generations, the documented 1x to 1.35x widened for the estimate's own error.",
  WRITTEN,
)

export const MEASURED_ADDED_INPUT = citation(
  PROVENANCE,
  "The accounting baseline sends one user message and no system prompt or tools, so an input count above three times the prompt's `o200k_base` count plus 64 for the message template is read as input a layer added; Claude models behind a partner cloud reported 1.1 times that count (Opus 4.5 and 4.6) and 1.55 times (Opus 4.7 and later) for the same prompt, template included.",
  '2026-09-25',
)
