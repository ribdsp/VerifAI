# Scoring

How measurements become a verdict, and why the confidence number is allowed to be believed.

The design constraint is the user's: *as accurate as possible, and where accuracy is not
achievable, weighted so the result approaches accuracy.* Concretely that means a report may
never sound more certain than its evidence, and the mechanism that enforces it has to be
visible.

---

## The five axes

An endpoint is scored on five independent axes, grouped into three questions. Each axis is
its own partition with its own posterior.

| Question | Axis | Asks |
|---|---|---|
| Who answers? | `identity` | Which model is actually answering? |
| | `consistency` | Does that hold for every request, or only some? |
| How does it get there? | `platform` | Whose infrastructure serves the model? |
| | `translation` | Is a protocol translation layer in the path? |
| What limited us? | `evidence` | How much did we establish, and what stopped us? |

An earlier draft used a single eight-member list (`genuine_translated`, `model_downgrade`,
`partial_routing`, `indeterminate`, …). One list is one partition, and a partition asserts
that its members are mutually exclusive — which for these facts is false. A translation
gateway can also fractionally route; a downgraded model can be reached through Bedrock; an
endpoint can block one probe family and answer the rest honestly. Under a flat list the
aggregator had to pick a winner between two things that were both true, and the report would
name one of them while silently dropping the other.

The same argument is why "how the request gets there" is two axes rather than one. Anthropic
serves its own [OpenAI SDK compatibility layer](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)
at `https://api.anthropic.com/v1/`: that route is first-party **and** translated at once, and
a single delivery axis with `first-party` and `translated` as rival members could not say so.

### `identity` — which model is actually answering

| Finding | Meaning |
|---|---|
| `matches-claim` | The backend behaves like the advertised model |
| `same-vendor-cheaper` | The advertised vendor, but a cheaper or older model than the one sold, or a reduced-precision build of it |
| `different-vendor` | Sold as Claude, served by GPT or an open-weight model — or the reverse |
| `not-a-live-model` | Canned, replayed, or mocked responses rather than any live model |
| `unknown` | The probes that ran do not separate the candidates |

The three middle findings are adverse. `unknown` is not — an unfinished measurement is not an
accusation — and `matches-claim` is the only clearing finding. Under `consistency: fractional`
this axis describes the share of traffic that does **not** reach the advertised model; see
below.

### `consistency` — does that hold for *every* request

| Finding | Meaning |
|---|---|
| `uniform` | Repeated identity probes agree |
| `fractional` | Repeated identity probes disagree beyond sampling noise: a mixture |
| `unknown` | Too few repetitions to distinguish the two |

Fractional routing — sending only part of the traffic to the advertised model — is the most
economically rational way to cheat, and a single match/mismatch verdict misses it entirely.

**This axis is about identity and nothing else.** An operator that load-balances the same
model across the first-party API and Bedrock is `uniform`: every request reaches the model
that was sold. That only holds if the measurement respects it, so ε is estimated exclusively
on deterministic identity-revealing probes whose answer does not depend on platform or
translation (see [the dispersion clamp](#4-dispersion-clamp-for-fractional-consistency)).
Dispersion in platform or translation signals is never counted as a mixture — counting it
would convict an honest load-balancer of fractional routing.

Two rules follow from that:

- **Under `fractional`, `identity` names the other share.** A 70/30 mixture of the claimed
  model and a cheaper one reads `identity: same-vendor-cheaper`, `consistency: fractional`.
  If the other share cannot be identified, `identity` is `unknown`. A three-way mixture names
  the most probable non-claimed component, with the rest in the signal table.
- **`fractional` with `matches-claim` is rejected as malformed**, at any confidence. It is
  what an aggregator produces when it pools the mixture's signals: the claimed model is then
  the most probable single identity, which is precisely the reading that hides the other 30%.
  `verdictFor` throws rather than returning a verdict for it.

`uniform` bounds the share that could be going elsewhere; it does not certify that share is
zero. With N usable repetitions and zero disagreements, the one-sided 95% upper bound on the
non-claimed share is c = 1 − 0.05^(1/N). The bound holds at the other end too: N repetitions
that all disagree with the claim still leave up to c of the traffic reaching the claimed
model, so "every request goes to the wrong model" is no more certifiable than "none does".

Between the two ends lies the window (c, 1 − c): mixtures that neither uniform reading is
consistent with, so a mixture inside it cannot pass for a uniform endpoint in either
direction.

| Usable repetitions | c — largest share still consistent with `uniform` | Window (c, 1 − c) |
|---|---|---|
| 5 | 45.1% | 45.1–54.9% |
| 10 | 25.9% | 25.9–74.1% |
| 12 | 22.1% | 22.1–77.9% |
| 30 | 9.5% | 9.5–90.5% |
| 120 | 2.5% | 2.5–97.5% |
| 200 | 1.5% | 1.5–98.5% |

Below five usable repetitions c exceeds 50% and the window is empty: a run in which every
repetition agrees with the claim cannot even rule out that most of the traffic goes
elsewhere. That is what "too few repetitions" means for `unknown` above, and such a run reads
`consistency: unknown` whatever its repetitions showed.

A usable repetition returned an answer the probe can read **and** was an independent draw.
Readable means parseable, not recognised: an answer that matches no model in the
fingerprint database still disagrees with the claim, and dropping it as unusable would hide
exactly the mixture whose other share nobody has catalogued yet. An answer that cannot be
parsed at all is a different case: it is *lost*, not a disagreement, and
[the clamp](#4-dispersion-clamp-for-fractional-consistency) says what a lost repetition
still costs. Repetitions that a router could have pinned to one backend together — sent
down a single connection, for instance — count as one, because a mixture routed per
connection shows nothing to a run that never left its first connection. Counting them
separately would shrink c for a run that tested less, which is the one error this table
exists to prevent. A repetition lost to an error is not a draw. It is re-run whole rather
than patched with a retried request, so every draw the report counts went out fresh from
start to finish — but the lost attempt is kept in the report, and widens the interval rather
than vanishing.

Independence is recorded, not assumed. Every request opens a connection of its own, and a
repetition adds a draw only when the transport shows that each of its requests — two, for
the differential count — went out on a fresh connection: a request that rode a reused
socket, or whose socket the transport cannot report on, costs its repetition the draw. A
pooled client shows why the rule is needed — its first request reports a fresh socket and
every later one a reused socket, so the batch is one draw however long it runs. That is why
Group F needs Node's own HTTP client, which reports per request whether the socket was
reused. `fetch` pools connections behind the caller's back and never says which requests
shared one, so on a runtime that only offers `fetch` a batch of any size is one draw. There
the mixture test is not offered, rather than run with an N it cannot back. The report
records, for every request, what the transport said and which repetition it belonged to,
and `verifai verify` rejects a report whose outcomes those records contradict — see
[`report-format.md`](report-format.md#field-rules-that-are-not-negotiable).

A fresh connection rules out pinning per connection and nothing coarser. A router that pins
per API key gives the buyer's own traffic the same backend the run saw, so `uniform` is the
right answer for that key; one that pins per time window can hide a mixture from any run
shorter than the window. [`threat-model.md`](threat-model.md#34-fractional-router-consistency-fractional)
covers both.

The report prints N and the bound next to the finding, taken from the stored interval rather
than recomputed from N — with draws lost the two differ, and recomputing would print the
tighter one. So "uniform on 12 requests" is never read as "no dilution", an `unknown` shows
how far short of a test the run fell, and a run without Group F says that it never looked.

### `platform` — whose infrastructure serves the model

| Finding | Meaning |
|---|---|
| `first-party` | The vendor's own API, or a pass-through thin enough to be indistinguishable |
| `partner-cloud` | The vendor's model hosted by a cloud partner — Bedrock / Vertex AI / Foundry / Azure OpenAI |
| `unknown` | Not established, or a mixture of platforms |

A platform mixture is reported as `unknown` rather than as a finding of its own: it is a
load-balancing choice, not something to hold against anyone. The per-request dispersion stays
visible in the signal table.

### `translation` — is a protocol translation layer in the path

| Finding | Meaning |
|---|---|
| `direct` | The model is reached over the protocol its vendor serves natively, unrewritten |
| `translated` | A layer rewrites between the buyer's protocol and the model's |
| `unknown` | Not established, or a mixture of translated and direct paths |

**Every member of `platform` and `translation` is legitimate**, and together they are the
fairness core of the whole tool. They exist to explain fingerprint differences that would
otherwise read as substitution: a Bedrock deployment and a translation gateway both fail
large parts of the first-party conformance catalogue while serving exactly the model they
advertise. Neither axis ever moves the verdict.

### `evidence` — what limited the measurement

| Finding | Meaning |
|---|---|
| `sufficient` | The planned probes ran and answered |
| `budget-limited` | Probes were skipped to stay inside the token/request budget |
| `obstructed` | The endpoint refused, stalled, or returned unusable data for probes it should answer |

The last two are separated deliberately. `budget-limited` is **our** choice and is never held
against the endpoint; `obstructed` is the endpoint's own behaviour and is evidence in its own
right. Collapsing them charges an honest seller twice for one fact — once through a lowered
ceiling, and again through a label that reads like an accusation.

`obstructed` has a threshold, so one busy moment does not become a finding about a business.
A request that fails transiently — a 429, a 5xx, a timeout, a dropped connection — is retried
once, after any `retry-after` it asked for, and a retry that succeeds costs the endpoint
nothing. A probe whose retry fails too, or which is refused with a 403 it was not designed to
provoke, is **lost**: it is listed in `skipped` with the reason `endpoint-error`, and lowers
the ceiling like any other gap. When lost probes exceed **10%** of the probes that applied,
the run reads `obstructed`. Group F keeps the same 10% over its own attempts, counted differently
because a lost repetition is re-run whole rather than retried — see
[§4](#4-dispersion-clamp-for-fractional-consistency).

Two failures are not findings at all. A 401, or a 404 for the claimed model, means the key or
the model name is wrong. The run stops and says which, and no report is issued: a `caution`
for a mistyped key would be a false statement about the seller.

### The headline verdict is derived, never stored

`pass` / `caution` / `fail` is computed from the five axes plus the confidence, so it cannot
contradict the axes it is meant to summarise:

- `consistency: fractional` with `identity: matches-claim` → rejected as malformed; no
  verdict is issued for it (see [`consistency`](#consistency--does-that-hold-for-every-request))
- adverse `identity`, or `consistency: fractional` → `fail` at confidence ≥ **0.90**,
  otherwise `caution`
- `evidence: obstructed` → never better than `caution`. An endpoint is not cleared by the
  probes it happened to permit
- `identity: matches-claim` **and** `consistency: uniform` → `pass` at confidence ≥ **0.80**,
  otherwise `caution`
- anything else → `caution`

`platform` and `translation` appear nowhere in those rules, by construction.

Only a run that includes Group F can read `pass`. Clearing needs `consistency: uniform`, and
`uniform` needs at least five independent draws of the mixture test; a run without them
reads `consistency: unknown` and tops out at `caution`, however clean the rest looks. That
is deliberate — an endpoint cannot be cleared of fractional routing without the one test
that looks for it — and it is why [the profiles](methodology.md#cost-control) state which
of them can clear.

The two floors differ on purpose. A `fail` is a publishable claim about a named business, and
the harm is asymmetric: a wrongly cautious report costs a buyer one more check, while a
wrongly failing report can cost an honest operator its customers.

`budget-limited` is deliberately absent from those rules. Coverage reaches the verdict only by
lowering `confidence`; reading it a second time here is the double-count the axis was
introduced to remove.

---

## Signals

A probe emits zero or more `Signal`s. Each carries, at minimum:

- `probeId` and `signalId`
- `family` — one of `protocol-conformance`, `accounting`, `tokenizer`, `causal-capability`,
  `behavioral`
- `llr` — a log₁₀ likelihood ratio **per axis finding** it bears on, e.g.
  `identity: { "matches-claim": -1.4, "same-vendor-cheaper": 0.9 }`
- `calibration` — `measured` | `documented` | `derived` | `heuristic`
- `citations` — URL plus verbatim quote, a paper reference, or a measurement date
- `plainLanguage` — what this means to someone who is not an engineer

Aggregation is additive in log-odds, subject to the four constraints below. Without them,
addition produces confident nonsense.

### 1. Per-family caps

Signals within a family are correlated, often strongly: many vendor error strings come from
a single shared validator, so twenty matching string assertions are closer to one piece of
evidence than to twenty. Each family's **total** contribution is capped.

| Family | Cap (log₁₀, either direction) |
|---|---|
| `protocol-conformance` | 1.5 |
| `accounting` | 1.5 |
| `tokenizer` | 2 |
| `causal-capability` | 3 |
| `behavioral` | 0.7 |

The cap applies per finding: a family's signals are summed for each finding they bear on,
and that sum is clamped to ± the family's cap. Causal evidence is worth the most because it
is the hardest to fake; behavioural evidence the least because it is the easiest.

Practical effect: a proxy that gets every error string right but fails the accounting
invariants cannot buy its way to `matches-claim` with volume, and a tool that only ran the free
error-path probes cannot reach a strong verdict on breadth alone. Every family at its cap
together moves a finding by 8.7, which is why a veto (below) sits at −6: past everything a
single family can undo, not past everything the run can.

### 2. Calibration-provenance weighting

| Tier | Cap per signal (log₁₀) | Basis |
|---|---|---|
| `measured` | 2 | Rate computed from recorded first-party ground truth |
| `documented` | 1 | The vendor states the behaviour; URL and verbatim quote both required |
| `derived` | 0.7 | A published method with a published baseline |
| `heuristic` | 0.3, always labelled | Plausible, neither measured nor documented |

Each signal is clamped to its tier's cap before it is added to its family. The `heuristic`
signals of one family are then clamped **together** to ±0.3, so a pile of plausible guesses
counts for no more than one. A `heuristic` signal can never outweigh a `measured` one. See
[`PROVENANCE.md`](PROVENANCE.md) for what qualifies as each.

A signal the aggregator cannot read exactly — a family or calibration not on these lists,
a finding that does not exist, a ratio that is not a finite number, an empty `citations` —
is a construction error and stops the run. Scoring it as zero would hide the bug inside a
posterior.

### 3. Veto by decisive probes

Some observations are causal rather than statistical, and a likelihood ratio understates
them. A signal can name the `identity` findings it vetoes, and each vetoed finding is held at
a log₁₀ ratio of **−6** or lower — a million to one against, whatever else was seen. A veto
never lifts a finding the sum had already put further down.

A veto on `matches-claim` also changes how the reading and the headline's confidence are
taken (see Priors, posteriors and confidence): once the claim is ruled out, nothing unresolved
is left for it. The `identity` reading is then the most probable adverse finding the vetoes
left standing, and `unknown` is not a candidate, however much weight it holds — what the
probes could not resolve is still not the claim. When the standing findings tie, the mildest
is named, in the order `same-vendor-cheaper`, `different-vendor`, `not-a-live-model`, so the
report accuses no further than the evidence reaches. Only vetoes that rule out every adverse
finding as well leave the reading `unknown`: they contradict each other, and a contradiction
is not a finding.

Example: a tampered extended-thinking signature that is **accepted** by the endpoint.
Anthropic documents the signature as "Used to verify that the block was generated by Claude",
and "The API uses cryptographic signatures to verify thinking block authenticity. If you
modify a thinking block, the API returns an error." A genuine Anthropic backend verifies the
signature before it continues, so accepting a corrupted one is not weak evidence against
`identity: matches-claim` for a Claude model — it is incompatible with it.

Vetoes are rare by construction, listed explicitly in each probe's provenance entry, and
each one needs a written argument for why the observation is causally impossible for the
finding it kills. A probe's veto can only act on `identity`. `consistency` is read from the
draws alone (§4), and nothing on `platform` or `translation` is ever an accusation, so there
is nothing there to kill.

One veto is structural rather than observed. A cross-protocol pairing reaches the model
through a translation layer by construction — the vendor does not serve that protocol — so
`translation: direct` is held at −6 on every cross-protocol run. That says nothing against
the seller: `translated` is legitimate.

### 4. Dispersion clamp for `fractional` consistency

Handled separately because it is the failure mode every binary verdict shares.

One deterministic, identity-revealing probe is repeated N times — the cheapest one whose
answer is **the same on every platform and through every translation layer** that serves the
claimed model. The input-token count of a fixed probe string, measured differentially, is
the model example: the same model tokenizes the same string identically wherever it is
hosted, while a different model generally does not. Probes that separate platforms rather
than models — error-string shapes, response headers, ID formats — are excluded, because they
would read an honest load-balancer as a mixture. Then:

- ε̂ = the share of repetitions whose answer is **not** the claimed model's — or, when no
  answer is known in advance, not the run's most common one — reported with a
  **Wilson interval**; when no repetition disagrees, or every one does, the exact
  (Clopper–Pearson) one-sided bound is reported instead, which with nothing lost is the c
  of the [`consistency`](#consistency--does-that-hold-for-every-request) table
- ε̂ counts **repetitions, not requests**. A differential-count repetition is two requests,
  and a router that picks a backend per request sends a repetition off the claimed model's
  answer whenever either request misses it: a true 10% of requests reads as about 19% of
  repetitions, 30% as about 51%. A router that picks per conversation reads one to one. The
  interval bounds the share of repetitions, which is what was measured, and the report says
  so rather than calling it a share of traffic. The benchmark
  ([`accuracy.test.ts`](../packages/core/test/accuracy.test.ts)) holds it to that
- Below five usable repetitions no test is run and `consistency` is `unknown`, for the
  reason given in that table
- Binomial tests against **p = 0** and **p = 1**. Both are exact: under p = 0 a single
  disagreement is impossible, so the tests reduce to 0 < d < q among the readable draws
- If **both** are rejected, the result is a mixture: `consistency` becomes `fractional`, and
  `identity` is re-read over the disagreeing share alone — `matches-claim` is excluded, and
  the most probable of the rest is named, or `unknown` when the signals cannot separate them
- **How far the reading is believed** is what keeps one noisy reading from becoming a
  `fail`. For `fractional`, with k = min(d, q − d) the minority count, the posterior is
  P(fractional) = 1 − 2⁻ᵏ: one stray draw is an even bet between a mixture and a glitch in
  the measurement, and each further one halves what is left of the glitch. So a single
  disagreement among 30 reads `fractional` at 0.5 — `caution` — and it takes four to cross
  the 0.90 `fail` floor. For `uniform`, the posterior is P(uniform) = 1 − s / 2, where s is
  the slack the bound leaves: the upper end of the interval when no draw disagrees, one
  minus the lower end when every draw does. Thirty clean draws hold 0.952; five hold 0.775,
  which is below the `pass` floor on its own
- **A lost repetition widens the interval.** A repetition that went out fresh and brought
  back no readable answer — an error status, a timeout, a body the probe cannot parse — is
  re-run, but re-running alone would bias ε̂ toward whichever backend fails less. If the
  other share fails a fraction f of its attempts, what survives is ε(1 − f) / (1 − εf): a
  true 30% reads as 25.5% at f = 0.2 and as 17.6% at f = 0.5, and the bias runs the other
  way when the claimed model is the one failing. So the interval is computed over all
  q + m attempts, q readable and m lost, with each end pushed as far out as the lost
  attempts allow: the lower end at d of q + m, counting them as agreements, and the upper
  end at d + m of q + m, counting them as disagreements. Which formula applies is decided
  by the readable draws, not by those counts. When 0 < d < q both ends are Wilson. When
  d = 0 the lower end is 0 and the upper end is the exact one-sided bound at m of q + m,
  so 30 agreeing draws with one lost print 14.4% beside `uniform` — not the table's 9.5%,
  and not Wilson's 16.2% either, because the printed bound has to reduce to c when nothing
  is lost. When d = q the mirror image holds. `consistency` itself is still read from the
  readable draws — one overloaded response does not stop a run from clearing, it only
  widens what the clearance certifies — and nothing lost is ever guessed into a
  disagreement. Lost repetitions are re-run until the planned N are readable, and a 429 is
  one of them, re-run after the `retry-after` it asked for. A run whose lost share
  m / (q + m) exceeds **10%** was obstructed, and reads `evidence: obstructed`. Re-running
  stops as soon as that is certain, at m > N / 9, so an endpoint that fails one request in
  three ends the group early instead of draining the budget. At N = 30 that allows three
  lost repetitions, whose worst case prints 21.9% beside `uniform`; the fourth ends
  Group F
- **The order of the outcomes is kept, not just their count.** Independent draws scatter
  their disagreements; a router that pins a backend for a stretch of time delivers them in
  blocks. Repetitions go out one at a time, so the order sent is the order the endpoint
  saw, and an exact one-sided runs test over the readable outcomes in that order tells the
  two apart. Three runs or fewer — what every disagreement arriving in one block looks
  like, at the start, the end, or in between — has probability n / C(n, d) among n draws
  with d disagreements under independence: about 2 × 10⁻⁶ at 30 draws with 9.
  Too few runs at the 5% level sets `clustered`, which marks the interval as resting on an
  independence the sequence contradicts. Too many runs is not flagged: a router that
  alternates on a schedule makes the interval conservative, not overconfident. The test
  only characterises a mixture the count has already found. When every draw agrees there
  is no sequence to read, so it cannot rescue a run that never left one backend — see
  [`threat-model.md`](threat-model.md#34-fractional-router-consistency-fractional)

The clamp is the point. "Genuine 70% of the time" is not genuine, and averaging would hide
exactly the thing being looked for — it is the **dispersion**, not the mean, that carries
the evidence. The report shows ε̂ and its interval, never a bare yes/no.

---

## Coverage ceiling

Confidence is capped by what actually ran. This is the direct answer to "where accuracy is
not achievable, weight it so the result approaches accuracy".

| Coverage achieved | Ceiling |
|---|---|
| Neither B nor C (Group A, with or without D) | **0.60** — enough to catch naive proxies, never enough to clear an endpoint |
| One of B and C | **0.75** |
| B and C, not D | **0.88** |
| B, C and D | **0.98** — never certainty |

A group counts as run when at least half of the probes in it that applied to this endpoint
finished. A probe that had nothing to measure here (`not-applicable`), that the profile left
out (`profile`), or that is opt-in and was not opted into (`opt-in`) is not counted either
way. Group F is not on the table: without it the confidence is not capped, `consistency` is
`unknown`, and the verdict tops out at `caution` regardless (see
[the headline verdict](#the-headline-verdict-is-derived-never-stored)).

Three reducers, applied after the table and in this order:

- **Cross-protocol pairing: −0.04.** Verifying a Claude model over an OpenAI-shaped route
  passes through a translation layer that necessarily erases vendor-specific signals. Such
  runs are verified, not refused, under a lower ceiling. The reduction is kept small enough
  that a fully covered cross-protocol run can still reach `fail` (0.94 ≥ 0.90): serving
  another vendor's model behind the claimed model's name over a translated route is the most
  common substitution, and a ceiling that could never fail it would hide it.
- **Skipped probes: −0.2 × the gap share.** Every probe that did not run is listed with its
  reason. The gap share is the fraction of applicable probes skipped for a reason that
  leaves a hole — no key, over budget, endpoint error, unsupported, blocked, aborted, or a
  probe error — so a run missing a tenth of its probes loses 0.02.
- **No measured signal: −0.02.** A run in which every signal rests on documentation or a
  paper, none on recorded ground truth, is held slightly lower. This is the reducer that
  Phase 7 calibration removes.

The result is rounded to nine decimal places, so 0.98 − 0.04 − 0.02 prints as 0.92 rather
than 0.9199999999999999.

---

## Priors, posteriors and confidence

Each axis starts from a fixed prior, with `unknown` ahead of any single concrete finding so
that a run which saw nothing reads `unknown`:

| Axis | Prior |
|---|---|
| `identity` | 0.175 for each of the four concrete findings, 0.30 for `unknown` |
| `platform` | 0.35 `first-party`, 0.35 `partner-cloud`, 0.30 `unknown` |
| `translation` | 0.35 `direct`, 0.35 `translated`, 0.30 `unknown` |

The posterior is a base-10 softmax of log₁₀(prior) + the capped, vetoed sum of ratios. The
reading on each axis is the single most probable finding; when two findings share the top
(within 10⁻⁹) the reading is `unknown`, because two candidates the probes could not separate
are not a reading of either. Two readings of `identity` narrow the candidates first: under
`fractional` consistency `matches-claim` is not one (§4), and once a probe vetoed
`matches-claim` only the adverse findings left standing are (§3).

`confidence` is the posterior of the claim the headline makes, then held under the ceiling:

| Assessment | Raw confidence |
|---|---|
| `consistency: fractional` | P(`fractional`) |
| adverse `identity` | P(`same-vendor-cheaper`) + P(`different-vendor`) + P(`not-a-live-model`); 1 − P(`matches-claim`) once a probe vetoed `matches-claim` |
| `identity: matches-claim` | P(`matches-claim`) × P(`uniform`) when `uniform`, P(`matches-claim`) otherwise |
| `identity: unknown` | P(`unknown`) |

confidence = min(raw confidence, ceiling). The verdict rules above then read it.

The adverse row leaves P(`unknown`) out because an unresolved reading may be hiding the
claimed model, and holding it against the endpoint would count what the probes could not see.
A veto on `matches-claim` (§3) changes that: the claim is then ruled out, so whatever is
unresolved is some other model, and all of it reads against the claim.

---

## Hard guards

Enforced by unit tests, not by convention, because a convention is one refactor away from
being gone.

1. **No self-identification.** A model's statement about its own identity has no path into
   the aggregator in either direction. Models routinely misreport this
   ([arXiv:2411.10683](https://arxiv.org/abs/2411.10683)). A test asserts that no signal
   derived from self-report reaches the log-odds sum.
2. **No style-based signal.** Stylometric similarity is not a signal family and cannot be
   registered as one.
3. **Unresolved is not cleared.** A test asserts that `identity: unknown`,
   `consistency: unknown`, and `evidence: obstructed` each render as `caution` — never
   `pass` — at any confidence.
4. **Platform and translation never move the verdict.** A test asserts that every
   `platform` × `translation` pairing, including first-party and translated at once, yields
   the same verdict as a first-party direct endpoint with the same identity reading. A
   legitimate translation gateway is therefore never scored as substitution.
5. **Every signal carries a citation.** A signal with an empty `citations` array is a
   construction error, not a low-confidence signal.

---

## Verdict rendering

Two layers, deliberately.

**Layer one — for the buyer.** A green / yellow / red verdict, a plain-language sentence
explaining it, ε̂ when relevant, and the confidence with its ceiling and the reason for the
ceiling. No jargon, no unexplained numbers.

**Layer two — for the engineer.** The full signal table: probe, observation, expectation,
family, calibration tier, LLR per axis finding, and the documentation quote that defines the
expectation. Plus the skipped-probe list with reasons, and the tool and database versions.

Both layers state facts. Neither alleges intent.
