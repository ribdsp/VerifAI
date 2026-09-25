# Threat model

VerifAI is a tool that accuses. That makes an honest account of its limits part of the
product, not an appendix to it. This document states what VerifAI can be defeated by, what
it will get wrong, and who can be hurt if it is wrong.

---

## 1. The published ceiling

Three results bound what any tool in this category can claim. They are cited here because
a reader deserves to see them before the feature list, not after.

**Software-only model verification is fundamentally unreliable**
([arXiv:2504.04715](https://arxiv.org/abs/2504.04715)). Not "hard" — unreliable as a
category. Anything short of a hardware root of trust or a trusted notary is inference from
behaviour, and behaviour can be arranged.

**Fingerprints are spoofable by fine-tuning**
([arXiv:2606.16100](https://arxiv.org/abs/2606.16100)). A cheap model can be
parameter-efficiently tuned to reproduce an expensive model's behavioural fingerprints. An
adversary with a modest budget and motivation can defeat the behavioural probes
specifically.

**The failure rate is already measured in the wild**
([arXiv:2603.01919](https://arxiv.org/abs/2603.01919)). Across 187 papers, 17 shadow APIs
were identified, and model-identity verification failed **45.83%** of fingerprint tests.
That is the empirical base rate for this problem, and it is the number to hold in mind when
reading any confident verdict.

What follows from this: VerifAI reports **signals plus documentation**, and its confidence
is capped by coverage and calibration provenance. A verdict is an argument with its
evidence attached, not a conclusion handed down.

---

## 2. Who gets hurt by a wrong answer

Two failure directions, with asymmetric consequences.

**False positive — an honest reseller flagged.** Someone's business is damaged by a tool
that sounded authoritative. Mitigations, in order of importance:

- `platform` and `translation` are **separate axes that never move the verdict**, not
  afterthoughts folded into identity. A gateway that rewrites the protocol, or access via
  Bedrock / Vertex / Foundry, produces different fingerprints while being entirely
  legitimate — and so does Anthropic's own OpenAI SDK compatibility layer, which is
  first-party and translated at once. Collapsing any of them into fraud is the single
  easiest way for this tool to defame an honest operator.
- Per-family caps stop correlated evidence from compounding. Many vendor error strings come
  from one shared validator, so twenty matching string probes are closer to one piece of
  evidence than twenty.
- Reports state facts and quote documentation. They do not allege intent.
- The adversarial fake-server matrix includes `thin-pass-through` and
  `legit-translation-gateway` precisely as false-positive tests, and their results are
  published.

**False negative — fraud passes.** A buyer is reassured and keeps paying. Mitigations:

- `identity: unknown` and `evidence: obstructed` render as **`caution`**, never as a pass.
  Resisting inspection is itself a signal.
- Group F exists because a binary verdict misses fractional routing, which is the most
  economically rational fraud available.
- Cross-model consistency testing (Group E) is **relative**, so it survives absolute
  calibration error.

Between the two, VerifAI is tuned to prefer `caution` over either a confident accusation or
a confident clearance, and the floor for `fail` sits above the floor for `pass` — see
[`scoring.md`](scoring.md#the-headline-verdict-is-derived-never-stored).

---

## 3. Adversaries, in increasing capability

### 3.1 Naive proxy

Forwards requests, rewrites the model name, echoes back whatever was asked for.
**Defeated by Group A alone, at zero cost**, often without an API key: it cannot reproduce
per-route serializer quirks, undocumented headers, exact validation strings, or the
vendor's parameter rejection matrix.

### 3.2 Careful proxy

Replicates observed response shapes from real captures. Defeated by **accounting
invariants** (Group B) and **tokenizer forensics** (Group C): fabricated usage numbers
violate arithmetic identities, and token counts computed locally against a real tokenizer
do not match a mismatched backend.

### 3.3 Real-but-cheaper backend (`identity: same-vendor-cheaper`)

A genuine vendor model, just not the advertised one. Response shapes are all authentic, so
Groups A and B mostly pass. Defeated by **model-class discriminators**: the prompt-cache
minimum-prefix staircase (512 / 1024 / 2048 / 4096 tokens, and non-monotonic across
releases, which is what makes it discriminative), tokenizer generation steps, context-window
behaviour, and the cross-model collapse test.

### 3.4 Fractional router (`consistency: fractional`)

Sends a share ε of traffic to a cheaper model and the rest to the real one. Every binary
verdict is defeated by this. Addressed by Group F: repeat one deterministic
identity-revealing probe whose answer does not depend on platform or translation, estimate
the share that disagrees with the claimed model, test against both p=0 and p=1, and when
both are rejected report `consistency: fractional` with `identity` naming the other share.
The estimate is a share of repetitions, not of requests: a repetition is two requests, so a
router that picks per request reads at about twice its true share when that share is small
([scoring §4](scoring.md#4-dispersion-clamp-for-fractional-consistency)). The mixture is
found either way; the printed interval is not a share of traffic.

**Honest limit:** this works fully against a *thin forwarder*, where a cheap probe actually
traverses the router. A gateway that answers the cheapest identity probes locally — a free
token count, say — or does not expose them at all, never lets them reach the backend. That
local answering is itself detectable, since the answers are too uniform to track any real
tokenizer, but in that case ε has to be measured with billed discriminators such as the
input-token count of a real generation, and the planner prices that up front.

**Second limit: pinning coarser than a connection.** Every Group F repetition travels on a
connection of its own, which defeats a router that picks a backend per connection. Two
coarser keys remain:

- **Per API key.** The buyer's own traffic is pinned the same way, so `uniform` is the
  correct reading for that key. But a seller can keep one key clean and hand it to known
  auditors, and a single report cannot tell that apart from genuine uniformity. Reports on
  distinct keys from distinct signers can, which is why the registry presents
  [N reports from M signers](registry.md#what-the-ui-shows) rather than any one of them.
- **Per time window.** A router that keeps a backend for a fixed interval hides a mixture
  from any run shorter than that interval: every repetition lands on one backend, and the
  run reads `uniform`. Spacing the repetitions out is the only counter, and it costs
  wall-clock time in proportion: `paranoid` spreads them at random over ten minutes, and
  `--spread` sets any span, which the report records next to the send time of every
  request. A run that does span a switch sees the mixture in its
  count, and the order of its outcomes shows the disagreements arriving in blocks (see
  [`scoring.md`](scoring.md#4-dispersion-clamp-for-fractional-consistency)). A run that
  spans none sees a single backend, and nothing it observes reveals the interval — so no
  spacing can be certified as long enough.

### 3.5 Probe-aware proxy

Special-cases VerifAI's requests. This is the arms race, and VerifAI does not win it
permanently. Mitigations raise cost without eliminating the attack: payloads generated from
templates with per-run random nonces rather than fixed strings, randomised probe ordering,
and `paranoid` mode. Being open source means an adversary can read every probe. The
alternative — security through obscurity — would also make the tool unauditable, which
would cost more than it saves.

The cheapest special case is the `User-Agent`. The CLI sends `verifai/<version>` on every
request, because some platforms, Snowflake Cortex among them, refuse a request that carries
none, and a UA that impersonated an official SDK would be a lie in a tool whose reports
state facts. A gateway can therefore tell VerifAI's requests from its customers' by that
header alone. Nothing in a probe depends on it, so it hides nothing that the payload shapes
and the probe order do not already give away; it only makes a probe-aware proxy cheaper to
write, and a report from such a proxy is no weaker than one from a proxy that reads payloads.

### 3.6 Fine-tuned imitator

Per [arXiv:2606.16100](https://arxiv.org/abs/2606.16100), defeats the **behavioural**
probes. It does not defeat **accounting** or **protocol** probes, because those are
properties of the serving infrastructure rather than the weights. This is a direct reason
why Group E carries the lowest weight and why the backbone is causal and accounting work.

### 3.7 Genuine vendor access with a different topology

Bedrock, Vertex, Foundry, Azure, and the vendors' own compatibility layers. **Not an
adversary.** Listed here because it produces adverse-looking signals and must not be scored
as fraud — hence `platform: partner-cloud` and `translation: translated`, neither of which
ever moves the verdict. Anthropic's OpenAI SDK compatibility layer, for one, silently
ignores `logit_bias`, `seed`, and several other OpenAI-only parameters, so accepting them is
not evidence against it (see [`methodology.md`](methodology.md#group-a--protocol-conformance-and-the-validation-layer)).

The same holds for an operator that load-balances one model across several of these. Every
request still reaches the model that was sold, so it reads `consistency: uniform`; the
platform dispersion is shown in the signal table and never counted as a mixture.

---

## 4. Threats against VerifAI itself

VerifAI runs a local daemon that accepts a user-supplied URL and holds third-party
credentials. That is a sensitive combination.

| Threat | Mitigation |
|---|---|
| **SSRF / internal reconnaissance** — a user-supplied endpoint pointed at internal infrastructure | `http:` and `https:` only; check **every resolved address**, not the hostname — a public name resolving to `169.254.169.254` is the standard bypass; refuse loopback, private, link-local, unique-local, CGNAT, multicast, unspecified, and cloud-metadata ranges, including IPv4-mapped IPv6 and NAT64; **pin the checked address to the socket** through the HTTP client's `lookup` hook, so a second resolution cannot move it (defeats rebinding); never follow redirects; **normalise the transport's own failures** — refused, timed out, TLS failure, blocked — to a fixed taxonomy before display, so their differences cannot be read as a port scan, while a response from a target that passed the guard is evidence and is never rewritten. A gateway on the buyer's own network is a legitimate target, so `--allow-private-targets` admits the private scope - loopback, RFC 1918, CGNAT shared space, benchmarking and unique-local - and nothing else: link-local, cloud metadata, unspecified, multicast, documentation and reserved space stay refused under every flag, because no gateway lives there and a metadata service is the whole prize of an SSRF. It is off by default and recorded in the report. It is also set per run and never read from a config file, because while it is on the daemon can time connections into the local network, and a persisted flag would outlive the run that justified it |
| **Key exfiltration** | Memory only. Never disk, never `localStorage`, never logs, never reports. Env var or prompt, never a CLI argument (shell history). Redacted from all rendered output including errors. A plain `http:` endpoint is tested behind a warning that the key crosses the network unencrypted — as it already does in the buyer's own use of that endpoint |
| **Local daemon reachable by other software** | Bind to loopback; per-process random session token; verify `Origin`; no CORS wildcard; server-side rebinding protection |
| **Malicious dependency** | `ignore-scripts=true` in `.npmrc` blocks every dependency lifecycle script locally; pnpm 10 additionally refuses dependency *build* scripts unless allowlisted in `pnpm-workspace.yaml`; CI installs with `--ignore-scripts` so the guarantee does not depend on `.npmrc` being read; utility dependencies only, each justified; lockfile committed and installed with `--frozen-lockfile`; third-party CI actions pinned to full commit SHAs, so a moved tag cannot change what runs; a unit test fails the build if an AGPL detection engine appears as a dependency, an `npm:` alias, or vendored source |
| **Malformed upstream response crashing the run** | Schema validation at every boundary; no silently swallowed errors; a probe that cannot run is reported as skipped with its reason, and lowers the confidence ceiling |
| **Report forgery** | Ed25519 over canonical JSON. Bounds stated plainly: integrity and non-repudiation, **not** proof the endpoint behaved that way |
| **Registry as a defamation vector** | Hashed endpoint identities by default (lookupable, not browsable); signature required; PR review; per-key rate limits; documented takedown in the registry repository's `POLICY.md`; UI shows signer counts, never a single report as truth |
| **Weaponised against honest sellers** | Facts and quotes, not accusations; false-positive results published; `caution`, not `fail`, whenever the evidence falls short of the higher accusation floor |

---

## 5. Things VerifAI deliberately refuses to do

- **Weigh a model's self-reported identity.** In either direction. Models routinely
  misreport which model they are ([arXiv:2411.10683](https://arxiv.org/abs/2411.10683)) —
  one open model answered "openai" / "chatgpt" on its own route roughly half the time.
  There is no path from self-identification into the score, enforced by unit test.
- **Send harmful-content probes.** Probes touch protocol surface and capability behaviour
  only. No jailbreak attempts, no policy-boundary testing, no content that could harm a
  third party or breach the endpoint's terms.
- **Judge writing style.** Stylometry is forgeable and cannot be calibrated honestly.
- **Assert anything it cannot cite.** An uncitable behaviour is at most a labelled
  `heuristic` signal with a low cap, or it is dropped.
- **Report a number more confident than its evidence.** Confidence is capped by coverage;
  skipped probes are listed with reasons.

---

## 6. Known decay

The fingerprint database goes stale on every vendor model release — during the research for
this project, the GPT catalogue moved a full generation ahead of the working assumption.
Structural mitigations: reference data is a separately versioned package with a JSON Schema
rather than constants in the engine; `verifai calibrate` lets a user with a first-party key
refresh their own baselines; community fixtures widen coverage; and reports pin both the
tool version and the database version, so an old report can be read in the context it was
produced in.
