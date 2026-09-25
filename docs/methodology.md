# Methodology

What VerifAI measures, and why those measurements and not others.

For how measurements become a verdict, see [`scoring.md`](scoring.md). For where each
expected behaviour comes from, see [`PROVENANCE.md`](PROVENANCE.md). For what can defeat
all of it, see [`threat-model.md`](threat-model.md).

---

## The founding constraint: no stylometry

The obvious way to check whether an endpoint is serving Claude is to look at how it writes.
VerifAI does not do this, for two reasons:

1. **Style is cheap to forge.** A prompt prefix, a fine-tune, or a rewriting pass can move a
   cheap model's output style arbitrarily close to an expensive model's.
2. **Style cannot be calibrated honestly.** To say "this is 87% likely to be Claude" from
   prose, you need a measured false-positive rate against the real distribution of both
   models across all topics, lengths, and languages. Nobody has that, so any percentage
   attached to a style judgement is decoration.

So the backbone is behaviour that **only the real serving infrastructure can produce**:

- **Causal probes.** The endpoint must *do* something that requires the real backend — not
  merely describe it. If a response depends on state only the real model holds, forging it
  requires holding that state.
- **Accounting probes.** Numbers the vendor's infrastructure computes: token counts, cache
  hits, usage arithmetic. A proxy that fabricates these violates identities that the real
  one satisfies by construction.
- **Protocol-fidelity probes.** Exact behaviour of the vendor's validation layer, which sits
  *in front of* the model. Reproducing it means reproducing the vendor's request-handling
  topology, not just its prose.

A useful consequence: most of this is **free**. Validation errors are rejected before
inference and are not billed; one vendor's token-counting endpoint is explicitly free and
separately rate-limited; and several probes need no API key at all.

---

## Two properties, independent

An endpoint has a **wire protocol** and a **claimed vendor**, and resellers mix them freely.
VerifAI never infers one from the other.

|  | Anthropic model claimed | OpenAI model claimed |
|---|---|---|
| `anthropic-messages` | native — full catalogue | cross-protocol |
| `openai-chat` | cross-protocol | native — full catalogue |
| `openai-responses` | cross-protocol | native — full catalogue |

Cross-protocol pairings are verified under a lower confidence ceiling, because a translation
layer necessarily erases vendor-specific signals. They are not refused: a large share of the
real reseller market works this way, and refusing to look would be the wrong kind of purity.
Buyers with a choice are told to test the native route.

A cross-protocol pairing is `translation: translated` by definition, whoever runs the layer —
including the vendor itself, which is why [`scoring.md`](scoring.md) keeps `translation` and
`platform` as separate axes. The converse does not hold: a native pairing can still sit
behind a translation layer, so `direct` is measured, never assumed. Neither finding is ever
adverse. Translation lowers the ceiling, not the verdict.

---

## Probe groups

### Group A — Protocol conformance and the validation layer

*Tier 0. Roughly zero tokens. Several probes need no API key.*

The validation layer runs before the model, so its behaviour is a property of the vendor's
infrastructure rather than of any model. It is also unusually rich:

- **Per-route error serializer divergence.** A single vendor can serialise errors
  differently on different routes — different JSON indentation, different message text for
  the same condition, compact versus pretty. Reproducing that requires reproducing the
  internal routing topology, which a proxy has no reason to have done.
- **Undocumented infrastructure headers**, present on routed responses and absent on
  unrouted ones.
- **Exact validation strings**, including punctuation, quoting style, and how numbers are
  rendered. Assert against documented text only.
- **Parameter rejection matrices.** Where a vendor accepts exactly one value of a sampling
  parameter and rejects every other, the boundary is a precise, cheap discriminator — and a
  matrix, not a binary.
- **Foreign-field rejection.** Sending one vendor's parameter names to the other's route
  produces a validation error whose *phrasing and JSON path* identify the validating
  framework.
- **Cross-vendor leakage, measured by effect.** Does an OpenAI-only parameter sent to an
  endpoint claiming Claude actually *do* anything? Acceptance alone proves nothing — see
  below.
- **Permissive-validator probe.** A request that the vendor's native route must reject,
  answered with 200, means something other than the vendor's native validator handled it.
  That is a `translation` finding, not an `identity` one.
- **Error-envelope shape and request-identifier format** for both vendors.

**Acceptance is not evidence.** Anthropic runs its own
[OpenAI SDK compatibility layer](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)
at `https://api.anthropic.com/v1/`, and documents that "Most unsupported fields are silently
ignored rather than producing errors." `logit_bias`, `logprobs`, `top_logprobs`, `seed`, and
`response_format` are each listed as "Ignored". So an endpoint claiming Claude that accepts
OpenAI-only parameters, or answers in OpenAI's response shape, may be Anthropic itself.
What separates the cases is whether the parameter **takes effect**. The same page lists the
response `logprobs` field as "Always empty", and the native Messages API defines no logit
parameters at all, so a `logit_bias` that measurably steers the output (D7) or a populated
`logprobs` array (D8) behind a Claude claim is evidence on `identity`. A silently ignored
one is evidence of nothing.

The same page makes Anthropic's layer checkable in its own right — `n` "Must be exactly 1",
the response `system_fingerprint` is "Always empty", and the `openai-version` and
`openai-processing-ms` headers are "Always `2020-10-01`" and "Always empty". Deviating from
those shows only that the route is *not Anthropic's own layer*, which is a `platform` /
`translation` finding: third-party gateways legitimately translate differently. It never
moves `identity` by itself. Error text is excluded outright, because the page also states:
"The compatibility layer maintains consistent error formats with the OpenAI API. However,
the detailed error messages will not be equivalent."

**This is where VerifAI first becomes useful** — the highest signal per unit cost in the
whole catalogue, and enough on its own to defeat a naive proxy.

### Group B — Accounting and identity integrity

*Tier 1. Cheap.*

- **Usage arithmetic invariants.** Components must sum to totals, and sub-counts must not
  exceed their parents. A proxy inventing usage numbers tends to violate at least one.
- **Hard output bounds.** Asking for exactly one output token must produce exactly one, with
  the matching stop reason.
- **Identifier format and correlation.** Strict prefixes and lengths, and — more
  interesting — *correlations between* identifiers in one response. A proxy generating each
  identifier independently will not reproduce a shared prefix between a parent object and
  its children.
- **Alias resolution.** Where a vendor resolves a friendly model name to a dated snapshot,
  the echoed value is causal: a proxy almost always echoes the string it was given.
  Exceptions exist and must be encoded, or they become false positives.
- **Per-family field nullability.** A field that is populated on one model generation and
  `null` on another is a free discriminator in both directions.
- **Stream invariants.** Per-chunk padding designed as a side-channel mitigation, constancy
  of certain fields across all chunks of one response, and the exact shape of the final
  chunk. Practically no proxy implements these.
- **Independent token-count cross-check.** Compare a vendor's own token-counting endpoint
  against the usage reported for an identical payload.

### Group C — Tokenizer forensics

*Tier 1. Nearly free.*

An asymmetry between the two vendors shapes this group entirely:

**OpenAI side — computable locally.** The tokenizer encodings are public, and the
model→encoding mapping is published. So: compute counts locally over an adversarial battery
(CJK, ZWJ emoji sequences, Cyrillic and Arabic, long whitespace runs, base64, source code,
Indonesian text) and compare with the reported counts. Tokenizer attribution becomes "which
encoding best explains the observed numbers", reported with a margin.

**Anthropic side — no public tokenizer exists, in any language.** So expected numbers must
be **measured empirically** into the reference bank, never derived from documentation. Two
techniques carry this group:

- **The differential protocol.** The per-request chat-template overhead is unknown, which
  breaks any absolute comparison. Send `BASE` and `BASE + probe`, subtract the reported
  counts, and the unknown constant cancels — what remains is the tokenizer's count for the
  probe string alone. Free, via the free counting endpoint.
- **Generational steps.** A documented jump in token count for identical text between model
  generations is a free generation discriminator.

**The strongest cross-vendor test falls out of this.** For an endpoint *claiming Claude*,
compute OpenAI's encoding locally and compare against the reported input counts across the
battery. An exact match across the whole battery is very hard to explain with an Anthropic
backend. Cost: zero.

### Group D — Causal capability probes

*Tier 2–3. The decisive ones.*

- **D1 — Extended-thinking signature binding.** Anthropic documents the signature on a
  reasoning block as "Used to verify that the block was generated by Claude", and states that
  "The API uses cryptographic signatures to verify thinking block authenticity." It is bound
  to both the model and the conversation prefix, and the failure modes are *distinguishable*
  — a valid signature, a tampered one, an empty one, a valid one replayed under a different
  conversation, and an intact signature over edited text each produce a different,
  documented outcome. That is a five-cell truth table an imitator has to reproduce without
  Anthropic's signing key. Assert only the character set and substantial length, never a
  fixed length or prefix.
- **D2 — Prompt-cache threshold staircase.** The minimum cacheable prefix differs by model
  and is **not monotonic across releases**, which is exactly what makes it discriminative.
  Combine with a cache-hit count above zero on a second identical call and the expected
  drop in time-to-first-token.
- **D3 — Cache invalidation semantics.** A single-byte change in the cached prefix must
  miss.
- **D4 — Reasoning-visibility default.** Where the default omits reasoning text while still
  returning its signature, the probe works even with no visible reasoning.
- **D5 — Context-window boundary.** Newer generations accept an over-long request and stop
  with a specific stop reason; older ones return a validation error. A clean generational
  discriminator.
- **D6 — Structured-output conformance** under strict mode.
- **D7 — `logit_bias` token-ID proof.** Bias maps *token IDs in the backend's tokenizer*.
  Choose an ID that decodes to different strings under two candidate encodings, apply
  maximum bias, and read which string appears. This proves the backend's token-ID space, not
  merely its API surface — an imitator needs a real tokenizer *and* real logit access.
- **D8 — `logprobs` re-tokenisation.** Returned token boundaries must reproduce exactly when
  the concatenated string is re-tokenised locally; byte arrays must equal the UTF-8 of their
  tokens; out-of-range entries must use the documented sentinel value.

### Group E — Behaviour and cross-model consistency

*Tier 2. Lowest weight, by design — this is the group a fine-tuned imitator defeats.*

- **Answer-distribution fingerprinting** via Jensen–Shannon divergence over single-token
  answer distributions, implemented from [arXiv:2607.10252](https://arxiv.org/abs/2607.10252).
  Used *instead of* ad-hoc stylometry for one reason: it has a published calibration
  baseline (EER 7.3%), so its error rate is a citable number rather than an assertion.
- **Latency and throughput profile** — time-to-first-token and tokens per second against
  expectations for the claimed model class. Weak alone; useful as corroboration.
- **Cross-model collapse test.** Run an identical battery against *several* models the same
  endpoint advertises. If a small cheap model and a large expensive one are not
  statistically distinguishable, one backend is wearing several labels. Because this is
  **relative**, it is immune to absolute calibration error — which makes it one of the most
  valuable tests available for exactly the fraud pattern this project was built for.

### Group F — Routing dilution

*Every profile except `quick`. See [`scoring.md`](scoring.md) for the statistics and the
clamp.*

The gap every binary verdict shares. Repeat one deterministic identity-revealing probe N
times — one whose answer is the same on every platform and through every translation layer
that serves the claimed model. A disagreement rate strictly between 0 and 1 is evidence of a
mixture. Report ε̂ with a Wilson interval, test against both p=0 and p=1, and when both are
rejected set `consistency: fractional` and re-read `identity` over the disagreeing share.
Below five usable repetitions no mixture can be told apart from a uniform endpoint, so the
run reads `consistency: unknown`; [`scoring.md`](scoring.md) has the window each N buys.
Each repetition travels on a connection of its own, so Group F runs only where the transport
can show that — Node's own HTTP client can — and is not offered on runtimes that only offer
`fetch`. Repetitions go out one at a time rather than concurrently, so their outcomes form a
single sequence that can be read for clustering.

Probes that separate platforms rather than models are excluded from this group on purpose.
An operator load-balancing the same model across the first-party API and a partner cloud is
not diluting anything, and must not read as though it were.

---

## Cost control

The planner builds a schedule under `--max-tokens` and `--max-requests`, prints a
pre-flight estimate, and asks for confirmation.

| Profile | Groups | Group F |
|---|---|---|
| `quick` | A, ~0 tokens | not run |
| `standard` (default) | A–C, near zero | 30 repetitions, one after another |
| `deep` | A–E | 30 repetitions, one after another |
| `paranoid` | A–E, randomised payloads and probe order | 30 repetitions, spread over 10 minutes |

Only a run that includes Group F can say `pass` — see
[`scoring.md`](scoring.md#the-headline-verdict-is-derived-never-stored) — so `quick` tops
out at `caution`. It is the cheap first look, not a clearance. Thirty agreeing repetitions
certify that less than 9.5% of requests reach another model; that is the ceiling printed
beside `uniform`, and it is the reason for the number.

**Spread.** `paranoid` sends its repetitions at random moments across ten minutes rather
than back to back, so a router that keeps one backend for a few minutes at a time is more
likely to be caught switching. `--spread <duration>` sets that span on any profile that runs
Group F, and the report records it. The moments are drawn fresh each run, so the gaps are
neither fixed nor predictable from the source. No span is certified as long enough — see
[`threat-model.md`](threat-model.md#34-fractional-router-consistency-fractional).

**Failures.** The planner honours `retry-after`, limits concurrency outside Group F, and
retries a transient failure once. Failures that persist are counted, not hidden, and past a
threshold they make the run `obstructed` — see
[`scoring.md`](scoring.md#evidence--what-limited-the-measurement). Two answers stop the run
before any verdict: a 401, and a 404 for the claimed model. Both mean the key or the model
name is wrong, and reading either as a finding about the seller would be false.

## Evasion awareness

A sophisticated proxy can special-case VerifAI's probes. Payloads are generated from
templates with per-run random nonces rather than fixed strings, probe order is randomised,
and `paranoid` mode exists. This raises the cost of evasion; it does not remove it, and
[`threat-model.md`](threat-model.md) says so without hedging.
