# Provenance

Every expected behaviour VerifAI asserts has to come from somewhere you can check.
This file is that record. It exists for two reasons:

1. **Credibility.** VerifAI tells a buyer that an endpoint is probably not serving the
   model it advertises. That is a serious claim about someone's business. The only
   honest basis for it is a documented vendor behaviour, a published method, or a
   measurement we can reproduce — never a hunch about how an API "should" behave.
2. **Licence hygiene.** VerifAI is MIT with no third-party detection code. This file is
   the audit trail for that claim.

`test/provenance.test.ts` enforces it: a probe module with no entry here fails CI.

---

## Calibration tiers

Every signal carries a `calibration` field. The tier caps how much the scoring engine
is willing to move on that signal, so an unmeasured guess can never outvote a
measurement. See `docs/scoring.md` for the caps themselves.

| Tier | Meaning | Where the number comes from |
|---|---|---|
| `measured` | We have recorded ground truth from a first-party key and computed the rate | `fixtures/`, `verifai record`, `verifai calibrate` |
| `documented` | The vendor states the behaviour in its own published documentation | URL + verbatim quote, both required |
| `derived` | A published method with a published baseline, implemented by us from its description | Paper ID + the specific result we rely on |
| `heuristic` | Plausible and useful, but neither measured nor documented | Capped low and always labelled as such in the report |

A probe may only claim `documented` if this file records a URL **and** a verbatim quote.
"The docs say so somewhere" is not provenance.

---

## Allowed sources

- **Official vendor documentation.** Anthropic: `https://platform.claude.com/docs/en/...`.
  OpenAI: `https://developers.openai.com/api/docs/...`. Both serve raw markdown when the
  URL is given a `.md` suffix, which is what the citation fetcher uses.
  Note: `platform.openai.com` returns 403 to non-browser clients — cite
  `developers.openai.com` instead.
- **Official SDK type definitions.** These are published API specifications, not detection
  algorithms.
- **Academic papers.** Method descriptions only. We implement from the description; a
  method is not a copyrightable work, but somebody else's source code is.
- **Our own empirical measurement.** Recorded against a first-party key, with the date.

## Forbidden sources

- **Any third-party model-detection implementation.** Specifically `ai-model-verifier`
  (AGPL-3.0-only) must not be read, copied, forked, or depended upon. Touching it would
  relicense this project permanently. `test/clean-room.test.ts` enforces its absence from
  the manifests and the lockfile.
- **Anything we cannot cite.** If a behaviour cannot be attributed, it does not become an
  assertion. It may become a `heuristic` signal with a low cap, or it may be dropped.

General-purpose utility dependencies (tokenizers, CLI prompts, statistics, bundlers) are
fine. The line is that *the logic deciding whether an endpoint is genuine* must be ours.

---

## Methods implemented from published descriptions

| Method | Source | Used by |
|---|---|---|
| Tokenizer differential (send `BASE` and `BASE + probe`, subtract the reported counts so the constant per-request template overhead cancels) | Elementary arithmetic; no attribution needed beyond this note | Group C, Anthropic side, where no local tokenizer exists |
| Answer-distribution fingerprinting via Jensen–Shannon divergence | arXiv:2607.10252 — the only behavioural method here with a published calibration baseline (EER 7.3%) | Group E |
| Routing-dilution (ε) estimation | arXiv:2607.20860 (IRIS), text-only variant | Group F |
| Honest limits on what any software-only method can conclude | arXiv:2504.04715; arXiv:2606.16100 (PEFT-spoofable fingerprints); arXiv:2603.01919 (identity verification failed 45.83% of fingerprint tests across 17 shadow APIs) | `docs/threat-model.md`, confidence ceilings |

---

## Rejected candidates

Kept deliberately. Each of these looked like a good signal and is not one; without this
record, a future contributor re-adds it.

| Candidate | Why it was rejected |
|---|---|
| `{"role": "system"}` inside `messages` returns 400 (Anthropic) | It is a valid enum value in the current schema. |
| Consecutive same-role messages return 400 (Anthropic) | The documentation states they are merged: "Consecutive `user` or `assistant` turns in your request will be combined into a single turn." |
| The error string `messages: roles must alternate…` | Appears in secondary material but is contradicted by the live documentation. |
| The numeric tail of `prompt is too long: N tokens > M maximum` | Only the substring `prompt is too long` is documented. Replaced by the cleaner generational discriminator `stop_reason: "model_context_window_exceeded"`. |
| Anthropic 404 bodies prefixed with `model: ` | Neither the status nor the message is documented. |
| Glitch tokens (`SolidGoldMagikarp` and relatives) | No verified list exists for cl100k_base or o200k_base; the research is weights-based and does not transfer to closed models. Replaced by tokenizer-boundary probes, which are deterministic and documented. |
| `seed` determinism as a pass/fail gate | Documented as best-effort: "Determinism is not guaranteed." Corroborating signal at most. |
| `Not allowed to POST on /v1/models. (HINT: …)` | Legacy. The current behaviour is 404 with an empty body. |
| `x-should-retry` as a Messages API header | Not a Messages API header. |
| A hardcoded per-family support matrix for `logit_bias` / `logprobs` / `seed` / `n` on GPT-5.x and GPT-6 | No authoritative matrix exists. Discover at runtime. |
| A full expected list of Responses API SSE event names | SDK literals and the documentation page disagree. Discover at runtime. |
| Streaming required above `max_tokens > 21333` | An SDK client-side restriction, not an API behaviour. |
| **A model's own statement about its identity, in either direction** | arXiv:2411.10683 shows models routinely misreport their identity. This has no path into the score at all, enforced by unit test rather than by convention. |

---

## Numbers that are not vendor documentation

Some useful figures come from secondary material. They may guide implementation but must
never be cited to a buyer as though a vendor published them, and they may not carry a
`documented` calibration tier:

- Claimed magnitudes for how far OpenAI tokenizers diverge from Anthropic's on typical
  text. Directionally reliable, not a published vendor figure. The `measured` path
  replaces these as soon as `verifai record` runs against a first-party key.

---

## Probe entries

Each probe module under `packages/core/src/probes/` gets an entry below, added in the
same commit as the probe. Required fields: what it observes, the source, the verbatim
quote (for `documented`) or the measurement date (for `measured`), and what a failure
does and does not imply.

Template:

```markdown
### `<probe-module-name>`

- **Observes:** <the measurable thing>
- **Applies to:** <protocols / vendors / model families>
- **Calibration:** documented | measured | derived | heuristic
- **Source:** <URL, paper ID, or "measured YYYY-MM-DD against <first-party endpoint>">
- **Quote:** > <verbatim text from the source>
- **Implies:** <which axis findings this moves (`identity: different-vendor`, …), and why>
- **Does not imply:** <the false conclusion a reader would otherwise jump to>
```

Entries are kept in the order the probes landed. This section is last in the file on
purpose, so an entry is always an append.

### `conformance/openai/route-serializers`

- **Observes:** the JSON layout (compact, 2-space, 4-space) and the message of the 401 that `GET models`, `GET chat/completions`, `POST chat/completions` and `POST responses` return without a key. Only routes that answered 401 are compared.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; no key; 4 requests, 0 tokens.
- **Calibration:** heuristic
- **Source:** observed live against https://api.openai.com/v1 during this project's research; not yet recorded with `verifai record`, so heuristic. Written 2026-09-24.
- **Quote:** > Without a key, api.openai.com answers `GET /v1/models` with 2-space-indented JSON saying `Missing bearer authentication in header`, `GET /v1/chat/completions` with compact JSON saying `Missing bearer or basic authentication in header`, `POST /v1/chat/completions` with 4-space-indented JSON whose message begins `You didn't provide an API key.`, and `POST /v1/responses` with 2-space-indented JSON saying `Missing bearer or basic authentication in header`.
- **Implies:** `platform: first-party` and `translation: direct` when every answering route matches and at least 3 answered; a small move either way otherwise.
- **Does not imply:** anything about the model. A reseller that checks keys itself answers every route in its own format while serving the claimed model faithfully, so a mismatch weighs very little and never moves `identity`.

| Signal | platform | translation | identity |
|---|---|---|---|
| `match` | first-party +0.3 | direct +0.3 | - |
| `partial-match` | first-party +0.1 | - | - |
| `mismatch` | first-party -0.1 | - | - |

Vetoes: none. A key-checking proxy in front of the genuine API is causally compatible with every finding.

### `conformance/openai/proxy-wasm-header`

- **Observes:** whether an `x-openai-proxy-wasm` header is present on the 401 from `GET models` without a key, and whether it is absent on the 404 from a path carrying the run's nonce.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; no key; 2 requests, 0 tokens.
- **Calibration:** heuristic
- **Source:** observed live against https://api.openai.com/v1 during this project's research; not yet recorded with `verifai record`, so heuristic. Written 2026-09-24.
- **Quote:** > api.openai.com sends an `x-openai-proxy-wasm` header on the 401 a routed path returns without a key, and does not send it on the 404 a path it does not route returns.
- **Implies:** `platform: first-party`, mildly, when the header is present; more, with `translation: direct`, when it is present only on the routed path.
- **Does not imply:** that its absence means a third party. A browser hides every response header the server does not expose, so absence produces no signal at all. Headers can be copied, so presence is never conclusive.

| Signal | platform | translation | identity |
|---|---|---|---|
| `routed-only` | first-party +0.3 | direct +0.2 | - |
| `present` | first-party +0.1 | - | - |

Vetoes: none.

### `conformance/openai/empty-404`

- **Observes:** the status and body length of `POST models` and of `GET` on a path carrying the run's nonce, both without a key.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; no key; 2 requests, 0 tokens.
- **Calibration:** heuristic
- **Source:** observed live against https://api.openai.com/v1 during this project's research; not yet recorded with `verifai record`, so heuristic. Written 2026-09-24.
- **Quote:** > api.openai.com answers `POST /v1/models`, and a path it does not route, with a 404 whose body is empty.
- **Implies:** `platform: first-party` and `translation: direct` when both are empty 404s; a small move either way otherwise.
- **Does not imply:** a different model. Most web frameworks answer unrouted paths with an error document, so a mismatch is what any reseller's own server produces.

| Signal | platform | translation | identity |
|---|---|---|---|
| `match` | first-party +0.2 | direct +0.2 | - |
| `partial-match` | first-party +0.1 | - | - |
| `mismatch` | first-party -0.1 | - | - |

Vetoes: none.

### `conformance/openai/cors`

- **Observes:** the status, `access-control-allow-methods` and `access-control-max-age` of a CORS preflight for `POST chat/completions`, and how many times `CF-Ray` is listed in `Access-Control-Expose-Headers` on the no-key 401 from `GET models`. Duplicates that arrive comma-joined are counted as tokens.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; no key; 2 requests, 0 tokens.
- **Calibration:** heuristic
- **Source:** observed live against https://api.openai.com/v1 during this project's research; not yet recorded with `verifai record`, so heuristic. Written 2026-09-24.
- **Quote:** > api.openai.com answers a CORS preflight with 200, `access-control-allow-methods: GET, OPTIONS, POST` and `access-control-max-age: 86400`.
- **Quote:** > api.openai.com sends the header `Access-Control-Expose-Headers: CF-Ray` twice in the same response.
- **Implies:** `platform: first-party` when the preflight or the doubled header matches; a small move against it when the preflight is refused or its headers carry other values.
- **Does not imply:** anything from a missing header. A browser hides headers the server does not expose, so a preflight whose headers are absent with a 2xx status produces no signal, and a single `CF-Ray` produces none either.

| Signal | platform | translation | identity |
|---|---|---|---|
| `preflight-match` | first-party +0.2 | direct +0.1 | - |
| `preflight-mismatch` | first-party -0.1 | - | - |
| `expose-headers-duplicated` | first-party +0.2 | - | - |

Vetoes: none.

### `conformance/openai/auth-only-headers`

- **Observes:** on the no-key 401 from `GET models`, whether `openai-organization`, `openai-processing-ms` or `openai-version` is present, and the format of `x-request-id`.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; no key; 1 request (shared with `route-serializers`), 0 tokens.
- **Calibration:** heuristic
- **Source:** observed live against https://api.openai.com/v1 during this project's research; not yet recorded with `verifai record`, so heuristic. Written 2026-09-24.
- **Quote:** > On a 401 to a request without a key, api.openai.com sends `x-request-id` as `req_` and 32 lowercase hex digits, and sends none of `openai-organization`, `openai-processing-ms` or `openai-version`, which appear only on authenticated requests.
- **Implies:** against `platform: first-party` when an authenticated-only header is on an unauthenticated 401, since the edge that refused the request did not write it; for it when `x-request-id` has OpenAI's format.
- **Does not imply:** anything from absent headers, which a browser hides. It never moves `identity`.

| Signal | platform | translation | identity |
|---|---|---|---|
| `authenticated-headers-present` | first-party -0.3 | - | - |
| `request-id-match` | first-party +0.2 | - | - |
| `request-id-mismatch` | first-party -0.1 | - | - |

Vetoes: none.

### `conformance/openai/unknown-parameter`

- **Observes:** the answer to a one-token generation carrying a body parameter `verifai_<nonce>`, which no OpenAI API defines and no layer can have learned in advance.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; key needed; 1 request, at most 94 tokens.
- **Calibration:** heuristic
- **Source:** observed live against https://api.openai.com/v1 during this project's research; not yet recorded with `verifai record`, so heuristic. Written 2026-09-24.
- **Quote:** > OpenAI rejects an unknown body parameter with a 400 whose message is `Unknown parameter: '<name>'.` and whose `code` is `unknown_parameter`; older routes say `Unrecognized request argument supplied: <name>` instead.
- **Implies:** `translation: translated` when the request is answered, since a layer that rebuilds requests from the fields it knows drops the parameter silently; `platform: first-party` when it is refused in OpenAI's words. Server errors and redirects produce no signal.
- **Does not imply:** a different model. A translating gateway serving the claimed model drops unknown fields too, so an answer never moves `identity`.

| Signal | platform | translation | identity |
|---|---|---|---|
| `rejected-as-openai` | first-party +0.3 | direct +0.2 | - |
| `rejected-otherwise` | first-party -0.1 | - | - |
| `accepted` | first-party -0.2 | translated +0.2 | - |

Vetoes: none.

### `conformance/openai/model-not-found`

- **Observes:** the answer to a one-token generation for the model `gpt-verifai-<nonce>-absent`, a 404 the request declares it provokes.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; key needed; 1 request, at most 94 tokens.
- **Calibration:** heuristic
- **Source:** observed live against https://api.openai.com/v1 during this project's research; not yet recorded with `verifai record`, so heuristic. Written 2026-09-24.
- **Quote:** > OpenAI answers a request for a model that does not exist with a 404 whose message is: The model `<id>` does not exist or you do not have access to it. Its `type` is `invalid_request_error`, its `param` is null and its `code` is `model_not_found`.
- **Implies:** `platform: first-party` when the refusal matches message, `type`, `param` and `code`; against it when a made-up model is answered, since some layer mapped the name to a model of its choosing.
- **Does not imply:** that the model named in the claim is not served. A made-up name being answered says how unknown names are routed, not what a known name reaches, so `identity` does not move.

| Signal | platform | translation | identity |
|---|---|---|---|
| `refused-as-openai` | first-party +0.3 | direct +0.2 | - |
| `refused-otherwise` | first-party -0.1 | - | - |
| `answered` | first-party -0.3 | translated +0.1 | - |

Vetoes: none.

### `conformance/openai/temperature-above-max`

- **Observes:** the wording of the 400 that a one-token generation at `temperature: 99` receives. The request is shared with `conformance/common/permissive-validator`, which reads whether it was accepted.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; key needed; 1 request (shared), at most 94 tokens.
- **Calibration:** heuristic
- **Source:** observed live against https://api.openai.com/v1 during this project's research; not yet recorded with `verifai record`, so heuristic. Written 2026-09-24.
- **Quote:** > OpenAI answers `temperature: 99` with a 400 whose message is `Invalid 'temperature': decimal above maximum value. Expected a value <= 2, but got 99.0 instead.` and whose `code` is `decimal_above_max_value`.
- **Quote:** > For a model that takes only the default temperature, Chat Completions says `Unsupported value: 'temperature' does not support <value> with this model. Only the default (1) value is supported.` where the Responses API says `Unsupported parameter: 'temperature' is not supported with this model.` with a null `code`.
- **Implies:** `platform: first-party` when the range error, or the default-only wording of the route that was called, matches. `translation: translated` when the other route's default-only wording comes back, which is what a gateway serving one OpenAI API by calling the other produces. Any other 4xx is a refusal in the endpoint's own words.
- **Does not imply:** which model answers. A default-only refusal names a class of model, not a model, so `identity` does not move; an accepted request is left to `permissive-validator`.

| Signal | platform | translation | identity |
|---|---|---|---|
| `above-max` | first-party +0.3 | direct +0.2 | - |
| `own-route` | first-party +0.2 | direct +0.1 | - |
| `other-route` | first-party -0.2 | translated +0.2 | - |
| `other` | first-party -0.1 | - | - |

Vetoes: none.

### `conformance/common/permissive-validator`

- **Observes:** whether a one-token generation at `temperature: 99` is answered or refused.
- **Applies to:** all three protocols; vendors `anthropic` and `openai`; native pairings only; key needed; 1 request (shared with `conformance/openai/temperature-above-max`), at most 94 tokens. The cross pairing is excluded because Anthropic's OpenAI-compatible endpoint documents clamping rather than refusing; its request-field table's `temperature` row reads "Between 0 and 1 (inclusive). Values greater than 1 are capped at 1." (https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk, retrieved 2026-09-24).
- **Calibration:** documented
- **Source:** https://platform.claude.com/docs/en/api/messages/create; https://developers.openai.com/api/reference/resources/chat; https://developers.openai.com/api/reference/resources/responses/methods/create (retrieved 2026-09-24)
- **Quote:** > Defaults to `1.0`. Ranges from `0.0` to `1.0`.
- **Quote:** > What sampling temperature to use, between 0 and 2.
- **Implies:** `translation: translated` and against `platform: first-party` when the request is answered, since the vendor's own validator refuses it and a layer that rebuilds or clamps the request does not. A refusal is weak evidence for `translation: direct`. Server errors and redirects produce no signal. The OpenAI sentence appears word for word on both the Chat Completions and the Responses page; the signal cites the page of the protocol that was called.
- **Does not imply:** which model answers. A translating gateway in front of the claimed model accepts the value just as well, so `identity` does not move.

| Signal | platform | translation | identity |
|---|---|---|---|
| `accepted` | first-party -0.4 | translated +0.6, direct -0.6 | - |
| `rejected` | - | direct +0.1 | - |

Vetoes: none.

### `conformance/common/protocol-leakage`

- **Observes:** whether a successful one-token answer carries a marker another API documents as its own: `"object": "chat.completion"`, `"object": "response"` or a `system_fingerprint` field on Messages; `"type": "message"` or the other OpenAI API's object type on Chat Completions and Responses.
- **Applies to:** all three protocols; vendors `anthropic` and `openai`; native pairings only; key needed; 1 request, at most 94 tokens.
- **Calibration:** documented
- **Source:** https://developers.openai.com/api/reference/resources/chat; https://developers.openai.com/api/reference/resources/responses/methods/create; https://platform.claude.com/docs/en/api/messages/create (retrieved 2026-09-24)
- **Quote:** > The object type, which is always `chat.completion`.
- **Quote:** > The object type of this resource - always set to `response`.
- **Quote:** > This fingerprint represents the backend configuration that the model runs with.
- **Quote:** > For Messages, this is always `"message"`.
- **Implies:** `translation: translated` and against `platform: first-party`. A layer that builds its answer from another API's response and renames only what it knows leaves the rest behind. The signal cites the documentation of each marker found.
- **Does not imply:** a different model. The markers say how the answer was assembled, not who wrote it; a translating gateway in front of the claimed model leaks the same way, so `identity` does not move.

| Signal | platform | translation | identity |
|---|---|---|---|
| `foreign-markers` | first-party -0.5 | translated +0.8, direct -0.5 | - |

Vetoes: none.

### `conformance/common/compat-fields`

- **Observes:** in a one-token Chat Completions answer that asked for `logprobs`, whether `system_fingerprint` has a value and whether the first choice carries real token log-probabilities (finite and below zero); or, on a 4xx, whether the refusal names `logprobs`.
- **Applies to:** `openai-chat`; vendor `anthropic` (Claude sold over Chat Completions, the cross pairing); key needed; 1 request, at most 94 tokens.
- **Calibration:** documented
- **Source:** https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk (retrieved 2026-09-24). The quotes are the table rows as the page serves them.
- **Quote:** > ``| `system_fingerprint`              | Always empty                   |``
- **Quote:** > ``| `logprobs`                        | Always empty                   |``
- **Quote:** > ``| `logprobs`              | Ignored                                                                                                                                                 |``
- **Implies:** against `platform: first-party` for a filled fingerprint or a refusal naming `logprobs`, since Anthropic's endpoint leaves the first empty and ignores the second. Real log-probabilities also move `identity` toward `different-vendor`: they are computed from the answering model's own output distribution, which Anthropic's endpoint does not return, so their presence is behaviour of the model behind the endpoint, not only of the serializer.
- **Does not imply:** proof of substitution. A layer can fabricate log-probabilities, so nothing is vetoed; and an empty fingerprint or empty `logprobs` is what any layer that drops them produces, so their absence produces no signal.

| Signal | platform | translation | identity |
|---|---|---|---|
| `fingerprint-present` | first-party -0.6 | - | - |
| `logprobs-present` | first-party -0.6 | - | different-vendor +0.6, matches-claim -0.6, same-vendor-cheaper -0.6 |
| `logprobs-rejected` | first-party -0.3 | - | - |

Vetoes: none. Fabricated log-probabilities are causally possible, so the evidence is weighed rather than decisive.

### `conformance/anthropic/error-envelope`

- **Observes:** how the endpoint refuses a Messages body that is not JSON. It checks that the refusal uses Anthropic's envelope: top-level `"type": "error"`, an `error` object with a `type` and a `message`, and a `request_id`. It also checks that the response carries a `request-id` header equal to that `request_id`.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; 1 request (shared with `error-vocabulary`), 0 tokens. A body that cannot be parsed never reaches a model.
- **Calibration:** documented
- **Source:** https://platform.claude.com/docs/en/api/errors (retrieved 2026-09-24)
- **Quote:** > The API always returns errors as JSON, with a top-level `error` object that always includes a `type` and `message` value. The response also includes a `request_id` field for easier tracking and debugging.
- **Quote:** > Every API response includes a unique `request-id` header. This header contains a value such as `req_018EeWyXxfu5pfWkrYcMdjWG`.
- **Quote:** > The same identifier appears as the `request_id` field in error response bodies.
- **Quote:** > 400 - `invalid_request_error`: There was an issue with the format or content of your request. This error type may also be used for other 4XX status codes not listed in this section.
- **Implies:**
  - An endpoint that refuses in OpenAI's error dialect has something in front of the model that parses requests the way OpenAI's API does. This moves strongly toward `translation: translated`.
  - An endpoint that refuses with no envelope at all, or answers 2xx, moves the same way, but weaker.
  - Missing parts of the envelope, and a header that disagrees with the body, count against `platform: first-party`.
  - An exact envelope with a matching header counts mildly for the first-party API.
- **Does not imply:** anything about the model. The error is produced before any model runs, so `identity` never moves. A faithful proxy passes Anthropic's envelope through unchanged, so a clean envelope is weak evidence for first-party, not proof of it.

| Signal | platform | translation | identity |
|---|---|---|---|
| `envelope` (exact) | first-party +0.2 | direct +0.3 | - |
| `envelope` (Anthropic dialect with gaps) | first-party -0.3 | - | - |
| `envelope` (OpenAI dialect) | first-party -0.3 | translated +0.8, direct -0.6 | - |
| `envelope` (no envelope, or 2xx) | first-party -0.4 | translated +0.3, direct -0.3 | - |
| `request-id-header` (absent) | first-party -0.4 | - | - |
| `request-id-header` (equals body `request_id`) | first-party +0.3 | - | - |
| `request-id-header` (differs from body `request_id`) | first-party -0.3 | - | - |
| `request-id-header` (body has no `request_id`) | - | - | - |

Vetoes: none. A layer can rebuild Anthropic's envelope faithfully, so a conforming envelope is weighed, and so is a non-conforming one.

### `conformance/anthropic/error-vocabulary`

- **Observes:** whether the error `type` in Anthropic's envelope sits on the status Anthropic's error page lists it for. Two requests are read:
  - a body that is not JSON, expecting a 400 `invalid_request_error`;
  - `GET /v1/models/verifai-absent-<nonce>`, expecting a 404 `not_found_error`. `invalid_request_error` is also accepted there, because the page allows it on any 4XX.
  - Answers outside Anthropic's envelope are left to `error-envelope`.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; 2 requests (the first shared with `error-envelope`), 0 tokens.
- **Calibration:** documented for types on the page. Types the page does not list are heuristic, because the page says the list may grow.
- **Source:** https://platform.claude.com/docs/en/api/errors (retrieved 2026-09-24)
- **Quote:** > 400 - `invalid_request_error`: There was an issue with the format or content of your request. This error type may also be used for other 4XX status codes not listed in this section.
- **Quote:** > 401 - `authentication_error`: There's an issue with your API key (for example, it's malformed, revoked, or expired; see Key expiration).
- **Quote:** > 402 - `billing_error`: There's an issue with your billing or payment information.
- **Quote:** > 403 - `permission_error`: Your API key does not have permission to use the specified resource.
- **Quote:** > 404 - `not_found_error`: The requested resource was not found. Check the endpoint path and any resource IDs in the request URL.
- **Quote:** > 409 - `conflict_error`: The request conflicts with the current state of a resource.
- **Quote:** > 413 - `request_too_large`: Request exceeds the maximum allowed number of bytes.
- **Quote:** > 429 - `rate_limit_error`: Your organization has hit a rate limit, reached its usage tier's monthly spend cap, or reached a spend limit on the Claude Code workspace.
- **Quote:** > 500 - `api_error`: An unexpected error has occurred internal to Anthropic's systems.
- **Quote:** > 504 - `timeout_error`: The request timed out while processing.
- **Quote:** > 529 - `overloaded_error`: The API is temporarily overloaded.
- **Quote:** > In accordance with the versioning policy, the values within these objects may expand, and it is possible that the `type` values will grow over time.
- **Implies:**
  - A type that belongs to another status on the page moves against `platform: first-party` and toward `translation: translated`. So does a status the page gives no type for. A layer that maps another vendor's errors into Anthropic's envelope tends to keep the envelope and lose the pairing.
  - A 2xx for a model id no one serves moves the same way.
  - A type the page does not list is only a faint hint.
- **Does not imply:** anything about the model. Neither request reaches one, so `identity` never moves.

| Signal | platform | translation | identity |
|---|---|---|---|
| `malformed-body-type` / `absent-model-type` (type fits status) | first-party +0.2 | - | - |
| `malformed-body-type` / `absent-model-type` (type of another status, or unlisted status) | first-party -0.3 | translated +0.3 | - |
| `malformed-body-type` / `absent-model-type` (type not on the page; heuristic) | - | translated +0.1 | - |
| `absent-model-type` (2xx for the absent model) | first-party -0.3 | translated +0.2 | - |

Vetoes: none. A missing `type`, or an OpenAI-dialect answer, produces no signal here; `error-envelope` already reads it.

### `conformance/anthropic/extra-inputs`

- **Observes:** what the endpoint does with `seed: 7`. The Messages API does not define that field; OpenAI's Chat Completions API does. The request is a one-token generation that is otherwise valid.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; 1 request, at most 88 tokens.
- **Calibration:** heuristic
- **Source:** https://platform.claude.com/docs/en/api/errors (retrieved 2026-09-24)
- **Quote:** > Sending `thinking.block_binding` without the `thinking-binding-controls-2026-08-01` beta header returns a 400 `invalid_request_error` whose message ends in:
- **Quote:** > block_binding: Extra inputs are not permitted
- **Implies:**
  - The page shows Anthropic's validator refusing a field it does not define with `<field>: Extra inputs are not permitted`.
  - A generation that succeeds with `seed` set came through something that passed the field on or dropped it. That moves toward `translation: translated` and against `platform: first-party`.
  - A 400 in Anthropic's envelope with the validator's wording counts mildly for a direct connection.
  - Any other 4XX counts mildly toward a layer.
- **Does not imply:** anything about the model. The field is judged before generation. It is heuristic because the page documents the wording for one field, not for every undefined field.

| Signal | platform | translation | identity |
|---|---|---|---|
| `accepted` | first-party -0.3 | translated +0.3 | - |
| `refused-as-anthropic` | first-party +0.1 | direct +0.2 | - |
| `refused-otherwise` | - | translated +0.2 | - |

Vetoes: none. A 3xx or 5xx produces no signal.

### `conformance/anthropic/beta-header`

- **Observes:** what the endpoint does with an `anthropic-beta` header naming a beta that does not exist: `verifai-probe-<nonce>-2026-09-24`. The nonce means no layer can know the name in advance. The name follows Anthropic's `feature-name-YYYY-MM-DD` pattern, so it cannot be refused for its shape alone.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; 1 request, at most 88 tokens.
- **Calibration:** documented
- **Source:** https://platform.claude.com/docs/en/api/beta-headers (retrieved 2026-09-24)
- **Quote:** > If you use an invalid beta name, or a beta your organization doesn't have access to, you'll receive a `400` error response:
- **Quote:** > Unexpected value(s) `invalid-beta-name` for the `anthropic-beta` header. Please consult our documentation at platform.claude.com/docs or try again without the header.
- **Quote:** > Beta feature names typically follow the pattern `feature-name-YYYY-MM-DD`, where the date indicates when the beta was released.
- **Implies:**
  - A success means the header did not reach Anthropic's API unchanged, so something forwards only the headers it knows. That moves toward `translation: translated` and against `platform: first-party`.
  - A 400 `invalid_request_error` that names the value back in the documented words counts for a direct, first-party connection.
  - A 400 in other words counts mildly toward a layer.
- **Does not imply:** anything about the model. Headers are read before generation. A proxy that forwards all headers unchanged answers exactly like the first-party API.

| Signal | platform | translation | identity |
|---|---|---|---|
| `accepted` | first-party -0.4 | translated +0.3, direct -0.3 | - |
| `refused-as-anthropic` | first-party +0.3 | direct +0.4 | - |
| `refused-otherwise` | first-party -0.2 | translated +0.2 | - |
| `other-status` | - | - | - |

Vetoes: none.

### `conformance/anthropic/missing-max-tokens`

- **Observes:** what the endpoint does with a Messages request that leaves out `max_tokens`.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; 1 request, at most 1111 tokens. The budget covers the prompt plus a 1024-token default a layer might fill in. The prompt asks for one word.
- **Calibration:** documented
- **Source:** https://platform.claude.com/docs/en/api/messages/create; https://platform.claude.com/docs/en/api/errors (retrieved 2026-09-24)
- **Quote:** > `max_tokens: number`
- **Quote:** > `metadata: optional Metadata`
- **Quote:** > 400 - `invalid_request_error`: There was an issue with the format or content of your request. This error type may also be used for other 4XX status codes not listed in this section.
- **Implies:**
  - The API reference marks optional body parameters `optional` and leaves `max_tokens` unmarked, so the API requires it.
  - An answer means something filled in a default. That moves against `platform: first-party` and toward `translation: translated`.
  - A 400 in Anthropic's envelope counts mildly for a direct, first-party connection.
- **Does not imply:** anything about the model, which never sees the missing field.

| Signal | platform | translation | identity |
|---|---|---|---|
| `accepted` | first-party -0.4 | translated +0.3 | - |
| `refused` | first-party +0.1 | direct +0.2 | - |

Vetoes: none. Any status other than a 2xx or an Anthropic-envelope 400 produces no signal.

### `conformance/anthropic/model-retrieve`

- **Observes:** what `GET /v1/models/<claimed model>` answers.
  - The object must have `type` `"model"`, a string `id` and `display_name`, and an RFC 3339 `created_at`. `capabilities`, `max_input_tokens` and `max_tokens` must each be present, possibly `null`.
  - The reported `id` must be the claimed model's documented id.
  - When the claim is a pinned snapshot with a documented alias, the alias is looked up as well. It must resolve to the snapshot.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; up to 2 requests, 0 tokens.
- **Calibration:** documented for the object's shape, a matching id, and Bedrock/Vertex id forms. Heuristic for any other id and for an unresolved lookup.
- **Source:** https://platform.claude.com/docs/en/api/models/retrieve; https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions (retrieved 2026-09-24)
- **Quote:** > For Models, this is always `"model"`.
- **Quote:** > A human-readable name for the model.
- **Quote:** > RFC 3339 datetime string representing the time at which the model was released. May be set to an epoch value if the release date is unknown.
- **Quote:** > `capabilities: ModelCapabilities or null`
- **Quote:** > `max_input_tokens: number or null`
- **Quote:** > `max_tokens: number or null`
- **Quote:** > The Models API response can be used to determine information about a specific model or resolve a model alias to a model ID.
- **Quote:** > For example: `anthropic.claude-sonnet-4-6`, `anthropic.claude-sonnet-5`, `anthropic.claude-opus-4-7`, `anthropic.claude-opus-4-8`, `anthropic.claude-opus-5`
- **Quote:** > On Google Cloud, the date is separated with `@`:
- **Implies:**
  - A complete object counts mildly for `platform: first-party`. A malformed one counts against it and mildly toward `translation: translated`.
  - An id in Bedrock's `anthropic.` form or Google Cloud's `@` form points to `platform: partner-cloud`.
  - Any other id that differs from the documented one hints at a layer that lists models its own way.
  - A lookup that returns no model object counts mildly against first-party.
- **Does not imply:** which model generates answers. A listing reports the platform's catalogue, not the behaviour of the model behind it, so `identity` never moves. An id that differs from the claim is not evidence of substitution.

| Signal | platform | translation | identity |
|---|---|---|---|
| `model-object` (conforms) | first-party +0.2 | - | - |
| `model-object` (gaps) | first-party -0.3 | translated +0.2 | - |
| `claimed-id` / `alias-id` (documented id) | first-party +0.1 | - | - |
| `claimed-id` / `alias-id` (Bedrock or Google Cloud form) | partner-cloud +0.4, first-party -0.4 | - | - |
| `claimed-id` / `alias-id` (other id; heuristic) | - | translated +0.2 | - |
| `claimed-id-unresolved` / `alias-id-unresolved` (heuristic) | first-party -0.2 | - | - |

Vetoes: none.

### `conformance/anthropic/sampling-matrix`

- **Observes:** which sampling settings the endpoint refuses for the claimed model.
  - A control goes first: `temperature: 1`, which every model accepts.
  - If the control is accepted, three cells follow: `temperature: 0.5`, `top_p: 0.5`, `top_k: 5`.
  - The cells are compared with what Anthropic documents for the claimed model and for each cheaper Claude model (the per-model facts in `@verifai/fingerprints`).
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; only claimed models whose sampling behaviour the docs settle; up to 4 requests, at most 352 tokens.
- **Calibration:** documented for the comparison with the docs and for a refused control. Heuristic for the readings about a layer.
- **Source:** https://platform.claude.com/docs/en/api/messages/create (retrieved 2026-09-24)
- **Quote:** > Models released after Claude Opus 4.6 do not support setting temperature. A value of 1.0 will be accepted for backwards compatibility, all other values will be rejected with a 400 error.
- **Quote:** > Models released after Claude Opus 4.6 do not support setting top_p. A value >= 0.99 will be accepted for backwards compatibility, all other values will be rejected with a 400 error.
- **Quote:** > Models released after Claude Opus 4.6 do not accept top_k; any value will be rejected with a 400 error.
- **Implies:**
  - Whether the model refuses a sampling setting is a property of the model, so the pattern speaks on `identity`.
    - Refusals that match the docs for the claimed model count for `matches-claim`; a refusal where the docs say the model accepts counts against it.
    - An acceptance where the docs say refusal counts neither way: a layer that drops the setting accepts it whatever model is behind it, so it reads only as `translation`.
    - `same-vendor-cheaper` moves the same way, but only when the docs settle the same cells for a cheaper Claude model.
  - A layer that strips the settings also turns refusals into answers, so that case is additionally read as `translation: translated`.
  - So is a refusal outside Anthropic's envelope.
  - A refused control is read only as the layer, because every model accepts it.
- **Does not imply:** a different vendor. No signal moves `different-vendor`: a translating gateway can change which settings arrive, so these answers cannot separate a gateway from another vendor's model. When the claimed model and a cheaper one share the same documented answers, the report says the answers do not tell them apart.

| Signal | platform | translation | identity |
|---|---|---|---|
| `documented-rejections` (as documented) | - | - | matches-claim +0.3; same-vendor-cheaper +0.3 if a cheaper model answers alike, -0.4 if a refusal rules out every cheaper model, nothing while one of them is a model the docs settle none of the cells for or one that differs only by accepting |
| `documented-rejections` (refused where the docs say accepted) | - | - | matches-claim -0.4; same-vendor-cheaper as above |
| `documented-rejections` (differs only by accepting) | - | - | nothing for the claim; same-vendor-cheaper as above |
| `accepted-where-documented-rejected` (heuristic) | - | translated +0.2 | - |
| `foreign-rejection` (heuristic) | - | translated +0.2 | - |
| `control-rejected` | first-party -0.3 | translated +0.2 | - |

Vetoes: none. Cells the docs do not settle for a model are never scored for it, and there is no `rejection-wording` signal: the page documents no message text for these refusals.

### `conformance/anthropic/assistant-prefill`

- **Observes:** whether the endpoint refuses a conversation that ends in an assistant message, a one-character prefill. It also records the wording of any refusal. Both are compared with what Anthropic documents for the claimed model and for each cheaper Claude model (the per-model facts in `@verifai/fingerprints`).
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; only claimed models whose prefill behaviour the docs settle; 1 request, at most 89 tokens.
- **Calibration:** documented for the comparison with the docs and for the exact wording. Heuristic for the readings about a layer.
- **Source:** https://platform.claude.com/docs/en/api/errors (retrieved 2026-09-24)
- **Quote:** > Sending a request with a prefilled last assistant message to any of these models returns a 400 `invalid_request_error`:
- **Quote:** > This model does not support assistant message prefill. The conversation must end with a user message.
- **Implies:**
  - Whether the model refuses a prefill is a property of the model, so it speaks on `identity`. The reading is the same as in `sampling-matrix`.
  - A refusal in the exact documented words counts for a direct, first-party connection.
  - A refusal in other words inside Anthropic's envelope counts mildly toward a layer that rewrites errors.
- **Does not imply:** a different vendor. No signal moves `different-vendor`. A layer that rewrites the conversation can turn a refusal into an answer, which is why that case also reads as `translation: translated`.

| Signal | platform | translation | identity |
|---|---|---|---|
| `documented-rejections` (as documented) | - | - | matches-claim +0.3; same-vendor-cheaper +0.3 if a cheaper model answers alike, -0.4 if a refusal rules out every cheaper model, nothing while one of them is a model the docs settle none of the cells for or one that differs only by accepting |
| `documented-rejections` (refused where the docs say accepted) | - | - | matches-claim -0.4; same-vendor-cheaper as above |
| `documented-rejections` (differs only by accepting) | - | - | nothing for the claim; same-vendor-cheaper as above |
| `accepted-where-documented-rejected` (heuristic) | - | translated +0.2 | - |
| `foreign-rejection` (heuristic) | - | translated +0.2 | - |
| `rejection-wording` (documented words) | first-party +0.2 | direct +0.3 | - |
| `rejection-wording` (other words; heuristic) | first-party -0.2 | translated +0.2 | - |

Vetoes: none.

### `conformance/anthropic/forced-tool-choice`

- **Observes:** whether the endpoint refuses forced tool use (`tool_choice` `{"type": "any"}` with one tool that has nothing behind it), and in what words. Both are compared with what Anthropic documents for the claimed model and for each cheaper Claude model (the per-model facts in `@verifai/fingerprints`).
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; only claimed models whose forced-tool-use behaviour the docs settle; 1 request, at most 749 tokens. The budget covers the tool schema and the system prompt that tool use adds.
- **Calibration:** documented for the comparison with the docs and for the exact wording. Heuristic for the readings about a layer.
- **Source:** https://platform.claude.com/docs/en/api/errors (retrieved 2026-09-24)
- **Quote:** > Sending `tool_choice: {"type": "any"}` or `tool_choice: {"type": "tool", "name": "..."}` to any of these models, including on the token counting endpoint, returns a 400 `invalid_request_error`:
- **Quote:** > tool_choice: type "tool" and "any" are not supported for this model.
- **Implies:**
  - Whether forced tool use is supported is a property of the model, so it speaks on `identity`. The reading is the same as in `sampling-matrix`.
  - The wording speaks on the layer, as in `assistant-prefill`.
- **Does not imply:** a different vendor. No signal moves `different-vendor`. A layer that drops `tool_choice` turns a refusal into an answer, which is why that case also reads as `translation: translated`.

| Signal | platform | translation | identity |
|---|---|---|---|
| `documented-rejections` (as documented) | - | - | matches-claim +0.3; same-vendor-cheaper +0.3 if a cheaper model answers alike, -0.4 if a refusal rules out every cheaper model, nothing while one of them is a model the docs settle none of the cells for or one that differs only by accepting |
| `documented-rejections` (refused where the docs say accepted) | - | - | matches-claim -0.4; same-vendor-cheaper as above |
| `documented-rejections` (differs only by accepting) | - | - | nothing for the claim; same-vendor-cheaper as above |
| `accepted-where-documented-rejected` (heuristic) | - | translated +0.2 | - |
| `foreign-rejection` (heuristic) | - | translated +0.2 | - |
| `rejection-wording` (documented words) | first-party +0.2 | direct +0.3 | - |
| `rejection-wording` (other words; heuristic) | first-party -0.2 | translated +0.2 | - |

Vetoes: none.

### `conformance/anthropic/thinking-matrix`

- **Observes:** which `thinking` modes the endpoint refuses, and in what words.
  - The modes are `enabled` with a 1024-token budget, `adaptive`, and `disabled`.
  - Only the modes the docs settle for the claimed model are sent.
  - The refusals are compared with what Anthropic documents for the claimed model and for each cheaper Claude model (the per-model facts in `@verifai/fingerprints`). Models whose thinking is always on refuse `enabled` and `disabled`; the 4.5 generation and earlier refuse `adaptive`.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key needed; only claimed models with at least one settled mode; up to 3 requests, at most 2312 tokens. The thinking cells get `max_tokens` 1025 so that a model which does think can answer.
- **Calibration:** documented for the comparison with the docs and for the exact wording. Heuristic for the readings about a layer.
- **Source:** https://platform.claude.com/docs/en/api/errors (retrieved 2026-09-24)
- **Quote:** > Sending `thinking: {"type": "enabled"}` to any of these models returns a 400 `invalid_request_error`:
- **Quote:** > "thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.
- **Quote:** > Models that support only extended thinking (Claude 4.5 and earlier models) reject `thinking: {"type": "adaptive"}` with a 400 `invalid_request_error`:
- **Quote:** > adaptive thinking is not supported on this model
- **Quote:** > On Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude Mythos 5, Claude Opus 5.5, and Claude Mythos Preview, thinking is always on. Sending `thinking: {"type": "disabled"}` to any of these models returns a 400 `invalid_request_error`.
- **Quote:** > "thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.
- **Quote:** > "thinking.type.disabled" is not supported for this model. Thinking defaults to adaptive mode when not specified; use "thinking.type.enabled" with "budget_tokens" for extended thinking.
- **Implies:**
  - Which thinking modes a model supports is a property of the model, so the pattern speaks on `identity`. The reading is the same as in `sampling-matrix`.
  - The wording of each refusal speaks on the layer, as in `assistant-prefill`. Either documented `disabled` message counts as documented words; the second is Claude Mythos Preview's.
- **Does not imply:** a different vendor. No signal moves `different-vendor`. A layer that drops or rewrites `thinking` changes the answers, which is why that case also reads as `translation: translated`.

| Signal | platform | translation | identity |
|---|---|---|---|
| `documented-rejections` (as documented) | - | - | matches-claim +0.3; same-vendor-cheaper +0.3 if a cheaper model answers alike, -0.4 if a refusal rules out every cheaper model, nothing while one of them is a model the docs settle none of the cells for or one that differs only by accepting |
| `documented-rejections` (refused where the docs say accepted) | - | - | matches-claim -0.4; same-vendor-cheaper as above |
| `documented-rejections` (differs only by accepting) | - | - | nothing for the claim; same-vendor-cheaper as above |
| `accepted-where-documented-rejected` (heuristic) | - | translated +0.2 | - |
| `foreign-rejection` (heuristic) | - | translated +0.2 | - |
| `rejection-wording` (documented words) | first-party +0.2 | direct +0.3 | - |
| `rejection-wording` (other words; heuristic) | first-party -0.2 | translated +0.2 | - |

Vetoes: none.

### `dilution/differential-count`

- **Observes:** per draw, the input tokens reported for a numbered base prompt and for the same prompt with a test string appended, both as generations at the smallest output limit the endpoint accepts (see `accounting/output-limit`); the reading is the difference. The test string is two neighbouring strings of the tokenizer battery, chosen by the run's nonce and fixed for the run. One base generation first checks that the endpoint reports a count at all.
- **Applies to:** `anthropic-messages`, `openai-chat`, `openai-responses`; vendors `anthropic`, `openai`; key required; Group F, 2 requests a draw, the draws and their replacements planned by the profile.
- **Calibration:** derived
- **Source:** this project's scoring method, docs/scoring.md, and the differential count this document describes for Group C. Written 2026-09-24.
- **Quote:** > The input-token count of a fixed probe string, measured differentially, is the model example: the same model tokenizes the same string identically wherever it is hosted, while a different model generally does not.
- **Implies:** nothing by itself. The readings are judged against the run's own majority; how many disagree, and in what order, is ε in docs/scoring.md, which decides `consistency` and clamps the genuine readings when the draws were split.
- **Does not imply:** which model the majority is; that comes from the other groups. Uniform readings bound the share that could be going elsewhere; they do not certify it is zero. Two models that share a tokenizer (the o200k_base GPT family, or Claude models from 4.7 on) read the same, so routing between them is not seen. A layer that recounts or estimates usage makes every draw read the same whatever answered. Generations are read rather than `count_tokens`, because a count can be answered without the model that generates.

| Signal | consistency | identity |
|---|---|---|
| none; ε from the draws | see docs/scoring.md | - |

Vetoes: none.

### `accounting/usage-arithmetic`

- **Observes:** whether the counts in the baseline generation's `usage` add up the way the protocol's vendor defines them: a total that is the sum of input and output, a cached share no larger than the input and a reasoning share no larger than the output, an Anthropic `output_tokens` that is never zero; and whether `usage` is there at all.
- **Applies to:** `anthropic-messages`, `openai-chat`, `openai-responses`; vendors `anthropic`, `openai`; key; 1 request, the baseline every accounting probe shares.
- **Calibration:** documented for the rules a vendor states; heuristic for the presence of Chat and Responses counts and for the Responses total, whose reference says only "The total number of tokens used." without saying what it sums. A signal takes the strongest tier among the rules it reports.
- **Source:** https://platform.claude.com/docs/en/api/messages/create, https://developers.openai.com/api/reference/resources/chat, https://developers.openai.com/api/reference/resources/responses/methods/create, retrieved 2026-09-24.
- **Quote:** > Total input tokens in a request is the summation of `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`.
  > For example, `output_tokens` will be non-zero, even for an empty string response from Claude.
  > Total number of tokens used in the request (prompt + completion).
- **Implies:** `translation: translated` - counts that break the vendor's own arithmetic were written by something other than the vendor's accounting, a layer that rebuilt `usage`.
- **Does not imply:** anything about which model answered. A translation gateway that rebuilds `usage` in front of the genuine model breaks the same rules, so identity never moves; consistent counts prove nothing either, since a careful layer adds up correctly.

| Signal | platform | translation | identity |
|---|---|---|---|
| `consistent` | - | - | - |
| `inconsistent` | - | translated +0.3 to +0.5, the heaviest broken rule | - |
| `no-usage` (Anthropic, documented) | - | translated +0.4 | - |
| `no-usage` (OpenAI, heuristic) | - | translated +0.3 | - |

Vetoes: none.

### `accounting/output-limit`

- **Observes:** under the smallest output limit each protocol accepts (`max_tokens` 1, `max_completion_tokens` 1, `max_output_tokens` 16) and a prompt asking for far more, whether the reported output count or the text itself exceeds the limit, and whether the response reports the length stop the vendor names. When the endpoint refuses a limit of 1 with a 400 - Snowflake Cortex does for GPT-5.1 and later, and accepts 16 - the same prompt is sent once more at 16, the observation names the refused limit, and 16 then holds for every generation of the run that reads usage rather than text (this probe, Group C and `dilution/differential-count`).
- **Applies to:** `anthropic-messages`, `openai-chat`, `openai-responses`; vendors `anthropic`, `openai`; key; the shared baseline.
- **Calibration:** documented. Text is only called too long past 128 bytes per token plus 64, which no tokenizer fits into the limit; a response that ends on its own before the limit keeps its natural stop.
- **Source:** https://platform.claude.com/docs/en/api/messages/create, https://developers.openai.com/api/reference/resources/chat, https://developers.openai.com/api/reference/resources/responses/methods/create, https://developers.openai.com/api/docs/guides/reasoning, retrieved 2026-09-24.
- **Quote:** > This parameter only specifies the absolute maximum number of tokens to generate.
  > `length` if the maximum number of tokens specified in the request was reached,
  > If the generated tokens reach the context window limit or the `max_output_tokens` value you've set, you'll receive a response with a `status` of `incomplete` and `incomplete_details` with `reason` set to `max_output_tokens`.
- **Implies:** `translation: translated` when output passes the limit or the stop is reported in other words; output past the limit also moves `identity: not-a-live-model` a little, since it was not generated under the request that was sent.
- **Does not imply:** a different model. A layer that raises the limit or rewrites the stop reason in front of the genuine model produces the same result.

| Signal | platform | translation | identity |
|---|---|---|---|
| `within-limit` | - | - | - |
| `over-limit` | - | translated +0.5 | not-a-live-model +0.2 |
| `stop-reason` | - | translated +0.4 | - |

Vetoes: none.

### `accounting/id-format`

- **Observes:** whether the response's `id` has the shape of the reference's examples: `chatcmpl-` and 29 letters and digits for a chat completion, `resp_` and 48 lowercase hex digits for a response. An Anthropic `msg_` prefix is read as Anthropic's.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; key; the shared baseline. Not Anthropic Messages, whose ID format Anthropic says may change.
- **Calibration:** heuristic - the shapes are read off examples, not specified.
- **Source:** https://developers.openai.com/api/reference/resources/chat, https://developers.openai.com/api/reference/resources/responses/methods/create, https://platform.claude.com/docs/en/api/messages/create, retrieved 2026-09-24.
- **Quote:** > "id": "chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT",
  > "id": "resp_686eef60237881a2bd1180bb8b13de430e34c516d176ff86",
  > The format and length of IDs may change over time.
- **Implies:** `translation: translated` for a missing ID, another prefix or another shape; `identity: different-vendor` a little for `msg_`.
- **Does not imply:** a different model for any shape but `msg_`: a gateway that mints its own IDs is ordinary. Anthropic IDs are not checked at all, so a change in their format cannot convict anyone.

| Signal | platform | translation | identity |
|---|---|---|---|
| `openai-shaped` | - | - | - |
| `missing` | - | translated +0.3 | - |
| `anthropic-shaped` | - | translated +0.3 | different-vendor +0.3 |
| `foreign-prefix` | - | translated +0.3 | - |
| `foreign-shape` | - | translated +0.2 | - |

Vetoes: none.

### `accounting/snapshot-echo`

- **Observes:** the response's `model`, normalised, against the claimed model, its alias or dated snapshots, and the models each vendor lists.
- **Applies to:** `anthropic-messages`, `openai-chat`, `openai-responses`; vendors `anthropic`, `openai`; key; the shared baseline.
- **Calibration:** documented when a vendor's list backs the reading over the claimed vendor's own protocol; heuristic over a protocol the claimed vendor does not own and for renames and unlisted names; derived for names only this project's method places.
- **Source:** https://platform.claude.com/docs/en/api/messages/create, https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions, https://developers.openai.com/api/reference/resources/chat, https://developers.openai.com/api/reference/resources/responses/methods/create, retrieved 2026-09-24; each model's listing and price from `@verifai/fingerprints`; this project's method, written 2026-09-24.
- **Quote:** > The model that will complete your prompt.
  > The model used for the chat completion.
  > Claude Opus 4.6 is the last Bedrock model ID to include the `-v1` suffix (`anthropic.claude-opus-4-6-v1`).
  > Before a response's `model` is compared with the claimed model, both are lowercased and stripped of the spellings clouds and routers add: a region prefix such as `us.`, a vendor prefix such as `anthropic.` or `openai/`, a `-v1` or `-v1:0` suffix, `@` before a date, and dots between version numbers in a Claude name.
  > A `model` naming a model family that neither Anthropic nor OpenAI documents, such as `deepseek`, `qwen`, `llama`, `mistral`, `gemini`, `glm`, `kimi` or `grok`, is read as another developer's model.
- **Implies:** `identity` when the response names a different model: `same-vendor-cheaper` for a listed model priced below the claim, `different-vendor` for the other vendor's or another developer's model. A rename moves `translation`, or `platform: partner-cloud` for a Bedrock or Vertex spelling.
- **Does not imply:** that a matching `model` proves the claim - any layer can echo the name it was sent. A missing `model` says nothing, and an empty one says only that a layer rebuilt the response: Snowflake Cortex sends `"model": ""` for the genuine models it serves (observed 2026-09-25).

| Signal | platform | translation | identity |
|---|---|---|---|
| `matches`, `missing` | - | - | - |
| `empty` | first-party -0.2 | translated +0.2 | - |
| `renamed` (cloud spelling) | partner-cloud +0.2 | translated +0.1 | - |
| `renamed` (router spelling) | - | translated +0.2 | - |
| `cheaper-model` (native, documented) | - | - | same-vendor-cheaper +0.8, matches-claim -0.8 |
| `cheaper-model` (cross, heuristic) | - | - | same-vendor-cheaper +0.3, matches-claim -0.3 |
| `other-claude` | - | - | matches-claim -0.6 native, -0.3 cross |
| `unlisted-claude` | - | - | same-vendor-cheaper +0.2, matches-claim -0.3 |
| `smaller-model` | - | - | same-vendor-cheaper +0.3, matches-claim -0.3 |
| `other-gpt` | - | - | matches-claim -0.3 |
| `other-vendor` (listed, documented) | - | - | different-vendor +0.8, matches-claim -0.6 |
| `other-vendor` (unlisted, derived) | - | - | different-vendor +0.6, matches-claim -0.5 |
| `other-family` | - | - | different-vendor +0.6, matches-claim -0.6 |
| `unrecognised` | - | translated +0.2 | different-vendor +0.2 |

Vetoes: none. A layer can rewrite `model` in either direction.

### `accounting/system-fingerprint`

- **Observes:** the `system_fingerprint` of a chat completion: `fp_` and ten hex digits, `null`, an empty string, another value, or no field.
- **Applies to:** `openai-chat`; vendor `openai`; only models `@verifai/fingerprints` documents a fingerprint for; key; the shared baseline.
- **Calibration:** heuristic - the reference marks the field optional and shows its shape only by example.
- **Source:** https://developers.openai.com/api/reference/resources/chat, https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk, retrieved 2026-09-24.
- **Quote:** > This fingerprint represents the backend configuration that the model runs with.
  > | `system_fingerprint`              | Always empty                   |
- **Implies:** for an empty string, which Anthropic's compatible endpoint documents it always returns, that a layer other than OpenAI's own API wrote the response (`platform`, `translation`); `identity: different-vendor` and `translation` a little for another shape; `translation` alone when the field is gone.
- **Does not imply:** that `fp_` proves an OpenAI backend - the value is easy to copy. Nor that an empty string means a Claude model: Snowflake Cortex sends it empty for the genuine GPT-5 models it serves (observed 2026-09-25).

| Signal | platform | translation | identity |
|---|---|---|---|
| `openai-shaped` | - | - | - |
| `empty` | first-party -0.3 | translated +0.2 | - |
| `foreign-shape` | - | translated +0.2 | different-vendor +0.2 |
| `absent` | - | translated +0.2 | - |

Vetoes: none.

### `accounting/count-tokens-agreement`

- **Observes:** the input count Anthropic's free `count_tokens` endpoint gives the baseline's own messages under the claimed model, against the input (plus cache reads and writes) the baseline's `usage` reported.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key; the shared baseline plus 1 counting request that bills nothing.
- **Calibration:** documented for agreement, a missing endpoint and the tokenizer step; heuristic for any other gap.
- **Source:** https://platform.claude.com/docs/en/api/messages/count_tokens, https://platform.claude.com/docs/en/build-with-claude/token-counting, https://platform.claude.com/docs/en/models/opus-5-5/migration-guide, retrieved 2026-09-24; this project's method, written 2026-09-24.
- **Quote:** > The total number of tokens across the provided list of messages, system prompt, and tools.
  > Claude 4.7 and later models and Claude Mythos Preview use a newer tokenizer. The same input text produces approximately 30 percent more tokens than on earlier models.
  > it may use roughly 1x to 1.35x as many tokens when processing text compared to models before Claude Opus 4.7
  > Counts from `count_tokens` and from the `usage` of a generation with the same messages are taken to agree within 8 tokens or 8 percent; a ratio between 1.08 and 1.45 is read as the tokenizer step between Claude generations, the documented 1x to 1.35x widened for the estimate's own error.
- **Implies:** `identity` when the gap is one tokenizer step in the direction of the other tokenizer: the generation was counted as a Claude model on the other tokenizer counts, and `same-vendor-cheaper` moves only when a cheaper listed model uses it. A missing endpoint points away from `platform: first-party`.
- **Does not imply:** a substitution from any other gap - that says only that one of the two counts was not Anthropic's, which a gateway that rebuilds `usage` also produces.

| Signal | platform | translation | identity |
|---|---|---|---|
| `agree` | - | - | - |
| `older-tokenizer` | - | translated +0.2 | matches-claim -0.3, same-vendor-cheaper +0.4 |
| `newer-tokenizer` | - | translated +0.2 | matches-claim -0.3, same-vendor-cheaper +0.3 |
| `no-count` | first-party -0.4 | translated +0.2 | - |
| `disagree` | - | translated +0.3 | - |

Vetoes: none.

### `tokenizer/openai-local-count`

- **Observes:** the input tokens eight battery strings add to a base prompt (a differential count), against the deltas the public encoding `@verifai/fingerprints` names for the claimed model, and the other public encoding, compute locally.
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; only models with a locally available encoding (`o200k_base`, `cl100k_base`); key; 9 requests with the smallest output limit.
- **Calibration:** derived - OpenAI's API documentation names no encoding; the model-to-encoding table is OpenAI's tokenizer library.
- **Source:** https://github.com/openai/tiktoken/blob/main/tiktoken/model.py, via `@verifai/fingerprints`; this project's method, written 2026-09-24.
- **Quote:** > A differential count subtracts the input tokens reported for a base prompt from those reported for the same prompt with a probe string appended, so the message template and any tokens a server adds, which are the same in both requests, cancel.
  > A layer can recount usage with a public OpenAI encoding, so a count that matches one exactly is as consistent with a recounting layer in front of the model as with an OpenAI model behind it.
  > A layer that estimates usage instead of passing on the model's own count reports numbers that follow the length of the text, about one token per three or four characters or bytes, and match no vocabulary; such counts show that usage was rewritten, not which model answered.
- **Implies:** `identity` split with `translation` for an exact match with the other encoding, because a recounting layer gives the same match; `different-vendor` for counts at least two tokens per string from both encodings; `translation` alone for constant or length-estimated counts.
- **Does not imply:** that a match with the claimed encoding proves the claim - a recounting layer matches too.

| Signal | platform | translation | identity |
|---|---|---|---|
| `claimed-encoding` | - | - | matches-claim +0.2, different-vendor -0.4 |
| `older-encoding` | - | translated +0.5 | same-vendor-cheaper +0.2, matches-claim -0.4 |
| `newer-encoding` | - | translated +0.3 | same-vendor-cheaper +0.5, matches-claim -0.6 |
| `foreign-tokenizer` | - | translated +0.3 | different-vendor +0.4, matches-claim -0.4 |
| `near-encoding`, `no-counts` | - | - | - |
| `constant-counts` | - | translated +0.5 | not-a-live-model +0.2 |
| `estimated-counts` | - | translated +0.5 | - |

Vetoes: none.

### `tokenizer/anthropic-differential`

- **Observes:** the differential counts of the same battery for a Claude claim, against the deltas of OpenAI's two public encodings computed locally.
- **Applies to:** `anthropic-messages`, `openai-chat`, `openai-responses`; vendor `anthropic`; key; 9 requests with the smallest output limit. It measures the generating backend's `usage` only; the counting endpoint is not used here.
- **Calibration:** derived - Anthropic publishes no tokenizer, so only a match with a public encoding is read.
- **Source:** https://platform.claude.com/docs/en/build-with-claude/token-counting, retrieved 2026-09-24; this project's method, written 2026-09-24.
- **Quote:** > A differential count subtracts the input tokens reported for a base prompt from those reported for the same prompt with a probe string appended, so the message template and any tokens a server adds, which are the same in both requests, cancel.
  > A layer can recount usage with a public OpenAI encoding, so a count that matches one exactly is as consistent with a recounting layer in front of the model as with an OpenAI model behind it.
  > A layer that estimates usage instead of passing on the model's own count reports numbers that follow the length of the text, about one token per three or four characters or bytes, and match no vocabulary; such counts show that usage was rewritten, not which model answered.
- **Implies:** for an exact match with a public encoding, `identity: different-vendor` split with `translation: translated`, with more weight on translation over an OpenAI protocol, where a recounting layer is the ordinary case.
- **Does not imply:** that counts matching neither encoding are Claude's - any other tokenizer gives that result.

| Signal | platform | translation | identity |
|---|---|---|---|
| `not-openai-encoding`, `no-counts` | - | - | - |
| `openai-encoding` (native, `o200k_base`) | - | translated +0.4 | different-vendor +0.4, matches-claim -0.4 |
| `openai-encoding` (native, `cl100k_base`) | - | translated +0.5 | different-vendor +0.3 |
| `openai-encoding` (cross) | - | translated +0.5 | different-vendor +0.2 |
| `constant-counts` | - | translated +0.5 | not-a-live-model +0.2 |
| `estimated-counts` | - | translated +0.5 | - |

Vetoes: none.

### `causal/thinking-signature`

- **Observes:** a first turn with thinking on, then its assistant content sent back twice with a follow-up.
  - The first replay is unchanged. It must be accepted, and its prompt tokens must grow by at least half the first turn's thinking tokens beyond the replayed text and the follow-up.
  - The second replay has one character of the thinking block's `signature` changed. It is sent and judged only when the first replay was kept.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key; claimed models Anthropic documents as keeping earlier thinking (Opus 4.5 and later, Sonnet 4.6 and later, Fable, Mythos) that have a settled thinking mode; 3 requests, at most 7509 tokens. The first turn is shared with `causal/thinking-display`. The altered replay provokes a 400.
- **Calibration:** documented
- **Source:** https://platform.claude.com/docs/en/api/messages/create, https://platform.claude.com/docs/en/build-with-claude/context-windows, https://platform.claude.com/docs/en/api/errors (retrieved 2026-09-24)
- **Quote:** > The `signature` value of this thinking block, exactly as returned by the API in a previous response. Used to verify that the block was generated by Claude.
- **Quote:** > The API uses cryptographic signatures to verify thinking block authenticity. If you modify a thinking block, the API returns an error.
- **Quote:** > If the most recent assistant message contains `thinking` or `redacted_thinking` blocks that were edited, reordered, filtered out, or reconstructed before being sent back to the API, the request returns a 400 `invalid_request_error`.
- **Quote:** > `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.
- **Quote:** > On Claude Opus 4.5 and later Opus models, Claude Sonnet 4.6 and later Sonnet models, Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude Mythos 5, and Claude Mythos Preview, the API keeps previous thinking blocks by default, and they count toward the context window like any other input tokens.
- **Quote:** > On Claude Fable 5.1 and Claude Opus 5.5, the API accepts a replayed thinking block only while the `system` prompt, `tools`, and messages that preceded it are unchanged.
- **Quote:** > A block from a model the target model can't read is dropped rather than rejected.
- **Implies:**
  - An altered block that is accepted and counted was read by something that does not verify Anthropic's signatures. Only the signer can tell an altered signature from the original, so a layer copying the wire format cannot pass.
  - A refused altered block puts a verifier of Anthropic's signatures behind the endpoint.
- **Does not imply:**
  - A refused or uncounted unchanged replay is a layer that edited or removed the block, not a different model.
  - A refused altered block does not settle which Claude model answered, so `matches-claim` does not move.
  - An altered block accepted but not counted is Anthropic's documented drop and says nothing.
  - A layer that swapped a replayed block for its own stored copy would also read as `tamper-accepted`. No such layer over the Messages protocol is known to this project.

| Signal | translation | identity |
|---|---|---|
| `tamper-rejected` | - | different-vendor -0.5, not-a-live-model -0.5 |
| `tamper-accepted` | - | matches-claim -1, same-vendor-cheaper -0.5, different-vendor +0.5, not-a-live-model +0.2 |
| `tamper-dropped` | - | - |
| `replay-rejected`, `thinking-dropped` | translated +0.5 | - |

Vetoes: `tamper-accepted` vetoes `matches-claim` and `same-vendor-cheaper`. Every Anthropic model signs and verifies its blocks, and producing a signature that verifies needs Anthropic's signing key. Anthropic's one documented way to accept an unverifiable block is to drop it, and the kept gate rules that out: the altered replay is judged kept only when its thinking was counted as input.

### `causal/thinking-display`

- **Observes:** the first `thinking` block of the shared first turn, whose request sets no `thinking.display`: whether its `thinking` text is empty, and whether it carries a signature.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key; claimed models with a documented display default and a settled thinking mode; 1 request shared with `causal/thinking-signature`, at most 1585 tokens.
- **Calibration:** documented
- **Source:** https://platform.claude.com/docs/en/models/opus-5-5/migration-guide, https://platform.claude.com/docs/en/models/sonnet-5/migration-guide, https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1 (retrieved 2026-09-24)
- **Quote:** > `thinking.display` defaults to `"omitted"`, so `thinking` blocks arrive with an empty `thinking` field alongside their `signature`.
- **Quote:** > Thinking blocks still appear in the response stream on Claude Opus 4.7 and later models, but their `thinking` field is empty unless you explicitly opt in. This is a silent change from Claude Opus 4.6, where the default was to return summarized thinking text.
- **Quote:** > `thinking.display` defaults to `"omitted"` on Claude Sonnet 5 (it defaulted to `"summarized"` on Claude Sonnet 4.6), so thinking blocks arrive with an empty `thinking` field
- **Quote:** > `thinking.display` defaults to `"omitted"`. `"summarized"` is available, and the raw chain of thought is never returned.
- **Implies:** the default display is a property of the model. Text where the claimed model returns none, or a signed empty block where it returns text, is another model's default or a layer that set `display`. When a cheaper Anthropic model has the default that was seen, `same-vendor-cheaper` gains.
- **Does not imply:**
  - A different vendor: no signal moves `different-vendor`.
  - A matching default does not tell apart the models that share it, so it weighs little.
  - None of these is judged: an unsigned empty block where text was expected, a failure, or only redacted thinking.

| Signal | translation | identity |
|---|---|---|
| `documented-default` | - | matches-claim +0.1 |
| `text-by-default` | translated +0.4 | matches-claim -0.5; same-vendor-cheaper +0.3 if a cheaper model defaults to text |
| `empty-by-default` | translated +0.3 | matches-claim -0.5; same-vendor-cheaper +0.3 if a cheaper model defaults to empty |

Vetoes: none.

### `causal/cache-threshold`

- **Observes:** the reported prompt tokens, `cache_read_input_tokens` and `cache_creation_input_tokens` of two prompts marked with `cache_control`.
  - The upper prompt is sized well above the claimed model's minimum cacheable length. It must report at least 1.1 times the minimum and be cached before the second is sent.
  - The lower prompt is sized to 0.72 times the minimum at the upper prompt's bytes per token, and must report at most 0.9 times it.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key; claimed models with a documented cache minimum in `@verifai/fingerprints`; 2 requests, at most 61153 tokens. The upper prompt is shared with `causal/cache-invalidation`. Each cached prompt is a cache write, billed above the base input price.
- **Calibration:** documented, from the per-model minimum and the rules quoted here.
- **Source:** https://platform.claude.com/docs/en/build-with-claude/prompt-caching (retrieved 2026-09-24); the claimed model's minimum is quoted from the same page in its catalogue entry, e.g. "512 tokens for Claude Fable 5.1, Claude Mythos 5.1, Claude Opus 5.5, Claude Opus 5, Claude Fable 5, and Claude Mythos 5".
- **Quote:** > Shorter prompts cannot be cached, even if marked with `cache_control`. Any requests to cache fewer than this number of tokens will be processed without caching, and no error is returned.
- **Quote:** > if both `cache_creation_input_tokens` and `cache_read_input_tokens` are 0, the prompt was not cached (likely because it did not meet the minimum length requirement).
- **Quote:** > These minimums apply on every platform where each model is available.
- **Quote:** > 5-minute cache write tokens are 1.25 times the base input tokens price
- **Implies:**
  - The minimum differs between models, so where caching starts speaks on `identity`.
  - A cached prompt under the claimed minimum is not the claimed model's cache.
  - When caching starts between the two lengths, each cheaper Anthropic model whose minimum lies outside them is ruled out.
- **Does not imply:**
  - A different vendor: no signal moves `different-vendor`.
  - A long prompt left uncached is as consistent with a layer that removed `cache_control` as with a model with a higher minimum, so it is split with `translation`.
  - A layer that writes its own cache figures in front of the claimed model would read as `below-cached`.

| Signal | translation | identity |
|---|---|---|
| `threshold-matches` | - | matches-claim +0.2; same-vendor-cheaper -0.6 if no cheaper model starts caching between the two lengths, -0.3 if only some do |
| `below-cached` | - | matches-claim -1; same-vendor-cheaper +0.5 if a cheaper model caches a prompt that short |
| `above-not-cached` | translated +0.3 | matches-claim -0.3 |

Vetoes: none.

### `causal/cache-invalidation`

- **Observes:** the cached upper prompt of `causal/cache-threshold`, sent twice more.
  - First unchanged: it must read from the cache at least half of what the first send did not.
  - Then with its first character changed. That prompt counts as a hit when it reads at least half of what the unchanged repeat gained and writes less than half the minimum.
- **Applies to:** `anthropic-messages`; vendor `anthropic`; key; claimed models with a documented cache minimum; 3 requests (the first shared with `causal/cache-threshold`), at most 110832 tokens; cache writes are billed at 1.25 times the base input price.
- **Calibration:** documented
- **Source:** https://platform.claude.com/docs/en/build-with-claude/prompt-caching (retrieved 2026-09-24)
- **Quote:** > Cache hits require 100% identical prompt segments, including all text and images up to and including the block marked with cache control.
- **Implies:** cache reads after the first character changed were not written by a prefix cache. Something between you and the model is producing the usage figures, which is a finding on `translation` with a small move against the claim.
- **Does not imply:**
  - Which model answered: the figures come from whatever writes the usage.
  - A read of a prefix a layer injects and caches on its own is not a hit, because of the fresh-write guard. A genuine miss writes the changed prompt afresh, so a response that reads and also writes the whole prompt reads as a miss.
  - A miss moves nothing. Every endpoint that passes Anthropic's usage through unchanged shows one.

| Signal | translation | identity |
|---|---|---|
| `changed-prefix-hit` | translated +0.8 | matches-claim -0.5 |
| `changed-prefix-miss` | - | - |

Vetoes: none.

### `causal/structured-output`

- **Observes:** one generation that asks for a sentence about the sea, under a response schema that allows only an object `{"word", "count"}`. `word` must be one of two nonce-bearing words and `count` an integer, with no other keys. The probe checks whether the answer is exactly such an object; the words are compared without case.
- **Applies to:** a claim over the vendor's own protocol.
  - Over `anthropic-messages` (`output_config.format`): Claude models in the catalogue.
  - Over `openai-chat` (`response_format`, strict `json_schema`) and `openai-responses` (`text.format`, strict `json_schema`): OpenAI text models from the documented snapshots on (`gpt-4o` except 2024-05-13, `gpt-4o-mini`, `gpt-4.1`, `gpt-5`, `gpt-6`, `o1`, `o3`, `o4-mini`), excluding audio, realtime and search models.
  - Key; 1 request, at most 2957 tokens.
- **Calibration:** documented for Anthropic. Derived for OpenAI, whose model list is snapshots "and later".
- **Source:** https://platform.claude.com/docs/en/build-with-claude/structured-outputs, https://developers.openai.com/api/docs/guides/structured-outputs, https://developers.openai.com/api/reference/resources/chat (retrieved 2026-09-24)
- **Quote:** > **JSON outputs** (`output_config.format`): Get Claude's response in a specific JSON format
- **Quote:** > Structured outputs guarantee schema-compliant responses through constrained decoding:
- **Quote:** > While structured outputs guarantee schema compliance in most cases, there are scenarios where the output may not match your schema:
- **Quote:** > Structured outputs don't guarantee the capitalization of string `enum` and `const` values: Claude may return a value that differs from your schema only in capitalization, typically in the first letter of a word following a space.
- **Quote:** > Structured Outputs is a feature that ensures the model will always generate responses that adhere to your supplied JSON Schema, so you don't need to worry about the model omitting a required key, or hallucinating an invalid enum value.
- **Quote:** > Whether to enable strict schema adherence when generating the output. If set to true, the model will always follow the exact schema defined in the `schema` field.
- **Quote:** > Structured Outputs only supports generating specified keys / values, so we require developers to set `additionalProperties: false` to opt into Structured Outputs.
- **Quote:** > However, Structured Outputs with `response_format: {type: "json_schema", ...}` is only supported with the `gpt-4o-mini`, `gpt-4o-mini-2024-07-18`, and `gpt-4o-2024-08-06` model snapshots and later.
- **Quote:** > This can happen in the case of a refusal, if the model refuses to answer for safety reasons, or if for example you reach a max tokens limit and the response is incomplete.
- **Implies:**
  - Prose, or an object the schema does not allow, means the schema never reached a decoder that enforces it. That reads as `translation: translated`.
  - An object that conforms, holding a word only this run's schema names, was produced under the schema, which weighs against a canned or scripted responder.
- **Does not imply:** which model answered. Every current model of both vendors enforces schemas, and so can other vendors. Refusals, responses cut off by their limit, incomplete Responses answers, empty answers and failures are the documented exceptions or no answer, and are not judged.

| Signal | translation | identity |
|---|---|---|
| `schema-enforced` | - | matches-claim +0.1, not-a-live-model -0.5 |
| `schema-ignored` | translated +0.7 | - |

Vetoes: none.

### `causal/logit-bias`

- **Observes:** the answer to a 2-token generation with `logit_bias` of 100 on one token ID.
  - The ID is chosen by the run's nonce from IDs 1000 to 7999. The chosen ID must decode to a different lowercase word of at least four letters in each of the two encodings this build carries.
  - The answer is compared with the word the ID decodes to in each encoding.
- **Applies to:** `openai-chat`; vendor `openai`; key; non-reasoning text chat models with a local encoding in `@verifai/fingerprints` (`gpt-4o`, `gpt-4.1`, `gpt-4-turbo`, `gpt-3.5-turbo` and their variants); 1 request, at most 92 tokens.
- **Calibration:** derived. The bias is documented; which encoding a model uses comes from tiktoken's model table, which the catalogue records as derived.
- **Source:** https://developers.openai.com/api/reference/resources/chat (retrieved 2026-09-24); https://github.com/openai/tiktoken/blob/main/tiktoken/model.py (retrieved 2026-09-24)
- **Quote:** > Accepts a JSON object that maps tokens (specified by their token ID in the tokenizer) to an associated bias value from -100 to 100.
- **Quote:** > Mathematically, the bias is added to the logits generated by the model prior to sampling.
- **Quote:** > values like -100 or 100 should result in a ban or exclusive selection of the relevant token.
- **Quote:** > "gpt-4o": "o200k_base"
- **Implies:**
  - An ID names a different string in each encoding, so the word written under the bias shows which vocabulary the model samples from.
  - A proxy cannot keep the answer ready: the ID changes with every run.
  - The other encoding's word points to an OpenAI model on the other vocabulary.
- **Does not imply:** a different vendor when neither word comes back. A layer that drops `logit_bias` gives the same result, so that reads as `translation` only. An empty answer or a failure is not judged.

| Signal | translation | identity |
|---|---|---|
| `claimed-token` | - | matches-claim +0.2, different-vendor -0.7 |
| `other-encoding-token` | - | matches-claim -0.7, same-vendor-cheaper +0.3 |
| `bias-not-followed` | translated +0.4 | - |

Vetoes: none.

### `causal/logprobs-retokenize`

- **Observes:** the `logprobs.content` list of a generation that repeats a fixed sentence. The sentence's words split differently in `o200k_base` and `cl100k_base`.
  - Each entry must have a string `token`, a `logprob` of at most 0, and `bytes` that are null or are the token's UTF-8 bytes. Pieces of a character are exempt from the byte check.
  - The tokens must join into the answer.
  - Each word token must be a single token of the claimed model's encoding.
- **Applies to:** `openai-chat`; vendor `openai`; key; non-reasoning text chat models with a local encoding; 1 request, at most 287 tokens.
- **Calibration:**
  - Documented for the shape of the list and for a missing list.
  - Derived for membership of the claimed encoding, which comes from tiktoken's model table.
- **Source:** https://developers.openai.com/api/reference/resources/chat (retrieved 2026-09-24); https://github.com/openai/tiktoken/blob/main/tiktoken/model.py (retrieved 2026-09-24)
- **Quote:** > Whether to return log probabilities of the output tokens or not. If true, returns the log probabilities of each output token returned in the `content` of `message`.
- **Quote:** > A list of integers representing the UTF-8 bytes representation of the token. Useful in instances where characters are represented by multiple tokens and their byte representations must be combined to generate the correct text representation. Can be `null` if there is no bytes representation for the token.
- **Quote:** > The log probability of this token, if it is within the top 20 most likely tokens. Otherwise, the value `-9999.0` is used to signify that the token is very unlikely.
- **Quote:** > "gpt-4o": "o200k_base"
- **Implies:**
  - OpenAI publishes its encodings, so every reported token can be checked on this machine.
  - Two or more word tokens that are not single tokens of the claimed encoding were cut by another tokenizer. If all of them are tokens of OpenAI's other encoding, that is another OpenAI model. Otherwise it is a model of another vendor.
  - A list OpenAI would not write means the list was made up on the way.
- **Does not imply:**
  - A different vendor when the list is missing: a layer that drops `logprobs` gives the same result.
  - `claimed-tokens` is read only when a word that splits in the other encoding came back whole, so a sentence whose words both encodings share judges nothing.
  - A single stray token is not enough.

| Signal | translation | identity |
|---|---|---|
| `claimed-tokens` | - | matches-claim +0.2, different-vendor -0.3 |
| `foreign-tokens` (other OpenAI encoding) | - | matches-claim -0.7, same-vendor-cheaper +0.3 |
| `foreign-tokens` (neither encoding) | - | matches-claim -0.7, different-vendor +0.3 |
| `logprobs-missing` | translated +0.3 | - |
| `logprobs-malformed` | translated +0.5 | matches-claim -0.3 |

Vetoes: none.

### `conformance/openai/reasoning-matrix`

- **Observes:** which combinations of reasoning effort and sampling the endpoint refuses for the claimed model.
  - A control goes first: effort `low` alone, which the claimed model's page lists.
  - If the control is accepted, three cells follow: effort `none`; effort `none` with `temperature: 0.5`; effort `low` with `temperature: 0.5`.
  - Chat Completions gets the effort as `reasoning_effort`, the Responses API as `reasoning.effort`. Both ask for 16 output tokens, the Responses minimum.
  - Only the cells the docs settle for the claimed model are sent. They are compared with what OpenAI documents for the claimed model and for each cheaper GPT model (the per-model facts in `@verifai/fingerprints`).
- **Applies to:** `openai-chat`, `openai-responses`; vendor `openai`; key needed; only claimed models whose page lists effort `low` and whose docs settle at least one cell; up to 4 requests, at most 412 tokens.
- **Calibration:** documented for the comparison with the docs and for a refused control. Heuristic for the readings about a layer.
- **Source:** https://developers.openai.com/api/docs/guides/latest-model/gpt-5.2 (retrieved 2026-09-25); https://developers.openai.com/api/docs/guides/reasoning (retrieved 2026-09-25); the model pages under https://developers.openai.com/api/docs/models/ (retrieved 2026-09-25); https://developers.openai.com/api/docs/guides/error-codes (retrieved 2026-09-25)
- **Quote:** > The following parameters are **only supported** when using GPT-5.2 with reasoning effort set to `none`:
- **Quote:** > Requests to GPT-5.2 or GPT-5.1 with any other reasoning effort setting, or to older GPT-5 models—for example, `gpt-5`, `gpt-5-mini`, or `gpt-5-nano`—that include these fields will raise an error.
- **Quote:** > GPT-6 Astra does not support `none` reasoning effort. Setting `reasoning.effort` (Responses) or `reasoning_effort` (Chat Completions) to `none` returns HTTP 400.
- **Quote:** > Reasoning.effort supports: none (default), low, medium, high and xhigh.
- **Quote:** > The API returns the message "Invalid service_tier argument: The requested service tier is not allowed for this project." as an `invalid_request_error` with `error.param` set to `service_tier` when a request selects or resolves to a service tier that is not allowed for the project.
- **Implies:**
  - Whether the model refuses a combination is a property of the model, so the pattern speaks on `identity`.
    - Answers that match the docs for the claimed model, a refusal among them, count for `matches-claim`. A refusal where the docs say the model accepts counts against it.
    - An acceptance where the docs say refusal counts neither way: a layer that drops the fields accepts them whatever model is behind it, so it reads only as `translation`.
    - `same-vendor-cheaper` moves the same way. It counts against a substitute only when a refusal rules out every cheaper GPT model. A cheaper model the docs settle none of the sent cells for keeps the substitution open.
  - A layer that strips the fields also turns refusals into answers, so that case is additionally read as `translation: translated`.
  - So is a refusal outside OpenAI's envelope.
  - A refused control is read only as the layer: the claimed model's page lists the effort it sends.
- **Does not imply:** a different vendor. No signal moves `different-vendor`: a translating gateway can change which fields arrive. When the claimed model and a cheaper one share the same documented answers, the report says the answers do not tell them apart. GPT-5.2 and GPT-5.1 answer every cell alike, so this probe cannot tell them apart. The GPT-6 guide only advises removing sampling fields, so no GPT-6 model is scored on the sampling cells.

| Signal | platform | translation | identity |
|---|---|---|---|
| `documented-rejections` (as documented) | - | - | matches-claim +0.3 when a refusal is among the answers; same-vendor-cheaper +0.3 if a cheaper model answers alike, -0.4 if a refusal rules out every cheaper model, nothing while one of them is a model the docs settle none of the cells for or one that differs only by accepting |
| `documented-rejections` (refused where the docs say accepted) | - | - | matches-claim -0.4; same-vendor-cheaper as above |
| `documented-rejections` (differs only by accepting) | - | - | nothing for the claim; same-vendor-cheaper as above |
| `accepted-where-documented-rejected` (heuristic) | - | translated +0.2 | - |
| `foreign-rejection` (heuristic) | - | translated +0.2 | - |
| `control-rejected` | first-party -0.3 | translated +0.2 | - |

Vetoes: none. There is no `rejection-wording` signal: the guides document no message text for these refusals.

### `accounting/hidden-input`

- **Observes:** the input count the baseline generation reported (for Anthropic, `input_tokens` with cache reads and writes), against the baseline prompt counted locally with OpenAI's public `o200k_base`. The baseline is one user message with no system prompt and no tools.
- **Applies to:** `anthropic-messages`, `openai-chat`, `openai-responses`; vendors `anthropic`, `openai`; key; the shared baseline, no request of its own.
- **Calibration:** heuristic. The vendors define the input count but publish no bound on the message template, and Anthropic publishes no tokenizer. `o200k_base` is a yardstick here, not a claim about the model's tokenizer. The ratios below were measured on 2026-09-25 against Claude models behind a partner cloud, not with a first-party key. That is why the tier is not `measured`.
- **Source:** https://platform.claude.com/docs/en/api/messages/create, https://developers.openai.com/api/reference/resources/chat, https://developers.openai.com/api/reference/resources/responses/methods/create, retrieved 2026-09-24; this project's method, written 2026-09-25.
- **Quote:** > Total input tokens in a request is the summation of `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`.
  > Number of tokens in the prompt.
  > The number of input tokens.
  > The accounting baseline sends one user message and no system prompt or tools, so an input count above three times the prompt's `o200k_base` count plus 64 for the message template is read as input a layer added; Claude models behind a partner cloud reported 1.1 times that count (Opus 4.5 and 4.6) and 1.55 times (Opus 4.7 and later) for the same prompt, template included.
- **Implies:** `translation: translated`, and against `platform: first-party`. Something between the buyer and the model added input the buyer did not send, most often a hidden system prompt. A seller who bills by reported usage bills that input on every request. The report states this as a billing fact.
- **Does not imply:** a different model. A layer that adds its own instructions in front of the genuine model reports the same counts, so identity never moves. Neither does a count under the bound prove nothing was added. An addition smaller than about twice the prompt passes unnoticed.

| Signal | platform | translation | identity |
|---|---|---|---|
| `no-added-input` | - | - | - |
| `added-input` | first-party -0.3 | translated +0.3 | - |

Vetoes: none. An answer with no usage gives no signal here; `accounting/usage-arithmetic` reports it.
