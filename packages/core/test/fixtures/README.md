# Fixtures

Response bodies used by the adapter tests. Each is a vendor's own published
example, copied verbatim, so a test that reads one checks the adapter against
the shape the vendor documents rather than against a shape this repository
invented. Retrieved 2026-09-24.

The OpenAI examples are the `x-oaiMeta.examples` of each operation in the
OpenAI OpenAPI specification, named here by their titles. Every non-streaming
example of both operations is included; the streaming ones are event
sequences, not bodies, and belong to the streaming tests.

| File | Source |
|---|---|
| `anthropic-messages.documented.json` | "Response (200)" example of https://platform.claude.com/docs/en/api/messages/create |
| `openai-chat.documented.json` | `POST /chat/completions` example "Default" |
| `openai-chat.documented-image-input.json` | `POST /chat/completions` example "Image input" |
| `openai-chat.documented-functions.json` | `POST /chat/completions` example "Functions" |
| `openai-chat.documented-logprobs.json` | `POST /chat/completions` example "Logprobs" |
| `openai-responses.documented.json` | `POST /responses` example "Text input" |
| `openai-responses.documented-image-input.json` | `POST /responses` example "Image input" |
| `openai-responses.documented-file-input.json` | `POST /responses` example "File input" |
| `openai-responses.documented-web-search.json` | `POST /responses` example "Web search" |
| `openai-responses.documented-file-search.json` | `POST /responses` example "File search" |
| `openai-responses.documented-functions.json` | `POST /responses` example "Functions" |
| `openai-responses.documented-reasoning.json` | `POST /responses` example "Reasoning" |

Published examples are illustrations, not recordings, and several disagree
with the specification they illustrate:

- The Anthropic example pairs a refusal `stop_details` with
  `stop_reason: "end_turn"`.
- The Chat Completions "Functions" and "Logprobs" examples leave out the
  message's `refusal`, which `ChatCompletionResponseMessage` requires, and the
  "Logprobs" example leaves `refusal` out of its `logprobs` object too.
- The Responses "File input" example sends `logprobs: []` on its output text;
  the others leave `logprobs` out, although `OutputTextContent` requires it.
- The Responses "Functions" example has no `usage.input_tokens_details`, which
  `ResponseUsage` requires.
- The "Functions" and "Logprobs" Chat Completions examples use placeholder ids
  (`chatcmpl-abc123`, `chatcmpl-123`), so no id format is ever derived from an
  example.

The adapters' schemas are written so that every example here reads without a
deviation; where an example and the specification disagree, the schema
asserts neither.

Recordings of real traffic belong in `fixtures/` at the repository root, in
HAR form, redacted.
