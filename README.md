# VerifAI

**Check whether a third-party "Claude" or "GPT" API endpoint is actually serving the model it advertises.**

[![CI](https://github.com/ribdsp/VerifAI/actions/workflows/ci.yml/badge.svg)](https://github.com/ribdsp/VerifAI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> 🇮🇩 [Baca dalam Bahasa Indonesia](README.id.md)

Resellers sell cheap access to Claude and GPT models. Some of them are honest. Some
advertise an expensive model name and quietly serve something much cheaper — a smaller
model from the same vendor, a model from a different vendor entirely, or an open-weight
model wearing the name. A buyer looking at the reply text has no way to tell.

VerifAI takes **your own** endpoint, API key, and the model name you were sold, runs a
battery of probes against it, and gives you an evidence report: which behaviours matched
the real thing, which did not, and the official vendor documentation that defines what
should have happened.

It runs entirely on your machine. There is no hosted VerifAI service, and your API key is
never sent anywhere except the endpoint you are testing.

**Status: early development.** Phases 0–6 of 8 are done: the terminal check, the local web
UI, and probe groups A–D and F. Its expectations come from vendor documentation; none of them
has yet been checked against recordings from first-party keys, so treat a verdict as a
well-sourced lead rather than a settled answer. Not on npm yet. See [Roadmap](#roadmap).

---

## What It Does Not Claim

Read this before you read anything else.

- **VerifAI does not prove fraud.** It reports signals and cites documentation. A report is
  technical evidence you can act on as a customer — it is not a legal finding, and the
  report copy is deliberately written so it cannot be mistaken for one.
- **No software-only method can settle model identity.** This is a published result, not
  modesty ([arXiv:2504.04715](https://arxiv.org/abs/2504.04715)). Cheap models can be
  fine-tuned to imitate an expensive model's fingerprints
  ([arXiv:2606.16100](https://arxiv.org/abs/2606.16100)). VerifAI raises the cost of
  deception; it does not eliminate it.
- **A translation gateway is not fraud.** Serving a genuine Claude model over an
  OpenAI-shaped route is a legitimate business — Anthropic
  [runs one itself](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk).
  VerifAI records it on a separate `translation` axis that never moves the verdict. What it
  looks for is *model substitution* — and keeping those two apart is a requirement, not a
  nicety.
- **"Inconclusive" is not a clean bill of health.** If an endpoint blocks probes, zeroes its
  usage numbers, or answers too uniformly to analyse, the evidence is recorded as
  `obstructed` and the verdict can be no better than **caution**. An endpoint that resists
  inspection is more suspicious, not less.
- **A signed report proves integrity, not truth.** `verifai verify` confirms a report has
  not been altered since signing and is bound to the keyholder. It does **not** prove the
  endpoint behaved that way. Anyone can generate a key and sign a fabricated report. Real
  attestation needs a TEE or a notary, which is out of scope and stated as such.
- **The fingerprint database goes stale.** Every vendor model release moves the target.
  That is why reference data is a separately versioned package with a schema, plus
  `verifai calibrate` — not numbers hardcoded in the engine.

What can defeat VerifAI, what it will get wrong, and who is hurt when it does:
[`docs/threat-model.md`](docs/threat-model.md).
---

## How it decides

The thing that determines everything else: **VerifAI does not judge writing style.**
Style is easy to fake and impossible to calibrate honestly. The backbone is **causal** and
**accounting** probes — behaviour that can only be reproduced if the model behind the
endpoint really is the one being claimed.

| Group | What it measures | Cost |
|---|---|---|
| **A — Protocol conformance** | Error envelope shapes, per-route serializer quirks, exact documented error strings, parameter rejection matrices, header presence | ~0 tokens; some probes need **no API key at all** |
| **B — Accounting integrity** | Usage arithmetic invariants, ID formats, alias→snapshot echo, `system_fingerprint` nullability, SSE stream invariants | Cheap |
| **C — Tokenizer forensics** | Locally computed token counts versus reported counts; a differential protocol where no local tokenizer exists | Nearly free — Anthropic's `count_tokens` endpoint is not billed |
| **D — Causal capability** | Extended-thinking signature binding, prompt-cache threshold staircase, `logit_bias` token-ID proof, `logprobs` re-tokenisation | The decisive ones; billed |
| **E — Behaviour & cross-model consistency** | Answer-distribution divergence; a *model-collapse* test that runs the same battery against several advertised models on one endpoint | Billed, lowest weight |
| **F — Routing dilution (ε)** | Whether only a *fraction* of traffic reaches the advertised model | Opt-in |

Group F matters because every binary match/mismatch verdict misses the most economically
rational fraud there is: route 30% of requests to the real model and the rest somewhere
cheap. VerifAI repeats one deterministic identity-revealing probe N times — one whose answer
is the same on the vendor's own API, a partner cloud, or behind a translation layer — and a
disagreement rate strictly between 0 and 1 is evidence of a mixture. It reports ε̂ with a
confidence interval, and an established mixture fails the endpoint, because "genuine 70% of
the time" is not genuine. Spreading one genuine model across several platforms is not a
mixture, and is not read as one.

Every report answers three questions on five axes: **who answers** (`identity`,
`consistency`), **how the request gets there** (`platform`, `translation`), and **what
limited the measurement** (`evidence`). The green / yellow / red verdict is derived from
those axes, and `platform` and `translation` never move it.

Evidence is combined as **log-odds with per-family caps**: twenty correlated error-string
probes must not add up to false certainty, and many vendor error strings genuinely do come
from one shared validator. Confidence is additionally **capped by coverage** — if only the
free probes ran, the report says so and cannot sound more certain than its evidence.
What each probe group measures, and why, is in [`docs/methodology.md`](docs/methodology.md);
how the measurements become a verdict is in [`docs/scoring.md`](docs/scoring.md).

**A model's claim about its own identity carries zero weight, in either direction.** Models
routinely misreport which model they are ([arXiv:2411.10683](https://arxiv.org/abs/2411.10683)).
There is no path from self-identification into the score, enforced by a unit test rather
than by convention.

---

## Install

Not published yet. To run from source:

```bash
git clone https://github.com/ribdsp/VerifAI.git
cd VerifAI
pnpm install
pnpm run build
node packages/cli/dist/bin.js --version
```

Requires Node.js ≥ 20.12. `pnpm run build` builds every package in order and copies the web
UI next to the CLI; `verifai web` says so plainly if that copy is missing. The examples below
write `verifai` for `node packages/cli/dist/bin.js`.

## Usage

```bash
verifai          # at a terminal: choose between the terminal check and the web UI
verifai check    # check an endpoint from this terminal; anything left out is asked for
verifai web      # the same check in your browser, served from 127.0.0.1
verifai help check
```

### The API key

The key is read from `VERIFAI_API_KEY`, or asked for with hidden input when that is unset.
It is never taken as a flag: `--api-key` and its look-alikes are refused before anything is
sent, because a flag lands in your shell history and in the process list.

### `verifai check`

At a terminal, every question has a default and the estimate is shown before anything is
spent. For scripts, give `--endpoint`, `--model` and `--yes`:

```bash
export VERIFAI_API_KEY=...   # or leave unset to be asked
verifai check \
  --endpoint https://reseller.example.com/v1 \
  --model claude-opus-5-5 \
  --profile standard \
  --format json --out report.json --yes
```

| Flag | Meaning |
|---|---|
| `--endpoint <url>` | The base URL you were given, such as `https://gateway.example/v1` |
| `--model <name>` | The model you were sold, such as `claude-opus-5-5` |
| `--vendor <vendor>` | `auto` (default), `anthropic` or `openai` |
| `--protocol <protocol>` | `auto` (default), `anthropic-messages`, `openai-chat` or `openai-responses` |
| `--profile <profile>` | `quick`, `standard` (default), `deep` or `paranoid` — see [Cost profiles](#cost-profiles) |
| `--max-requests <n>` | Stop planning past this many requests (1–2000) |
| `--max-tokens <n>` | Stop planning past this many tokens (0–2,000,000) |
| `--spread <duration>` | Spread the Group F repetitions over, say, `90s` or `10m` (at most `60m`) |
| `--allow-private-targets` | Allow an endpoint on your own network, for this run only; the report records it |
| `--show-endpoint` | Print the endpoint's address in the report, not only its hash |
| `--format <format>` | `terminal` (default), `markdown` or `json` |
| `-o, --out <file>` | Write the report to a file instead of stdout |
| `-y, --yes` | Run without asking to confirm the estimate |

A plain `http://` endpoint is checked, with a warning in the report: the key crosses the
network unencrypted.

### Exit codes

Scripts can branch on the result without parsing the report.

| Code | Name | Meaning |
|---|---|---|
| `0` | pass | Behaves like the advertised model, with enough evidence to say so |
| `10` | caution | Something is unresolved — **not** reassurance |
| `11` | fail | An adverse finding |
| `2` | usage | The command line or the input was wrong; nothing was probed |
| `3` | stopped | The endpoint refused the key or the model, or could not be reached |
| `1` | internal | VerifAI itself failed; nothing was concluded |
| `130` | cancelled | Ctrl+C, or a declined confirmation |

When VerifAI fails internally it prints a fixed message, never the error's own text, which
could carry an endpoint's reply or a key. Set `VERIFAI_DEBUG=1` to add the error's name and
stack frames — still without its message — when reporting a bug.

### `verifai web`

```bash
verifai web                          # a free port, and your browser opens the link
verifai web --port 8080 --no-open    # print the link instead
```

The page does exactly what `verifai check` does, with the same probes and the same report,
downloadable as JSON or Markdown. Ctrl+C stops the server; every check it held, and every
key, goes with it.

The server is local and hardened as if the network were hostile:

- It listens on `127.0.0.1` only and answers only requests whose `Host` names that
  listener, which defeats DNS rebinding. It refuses cross-site browser requests.
- The link carries a session token drawn for this process, after the `#`, so it never reaches
  a server log, a `Referer` or your history. Every API call must present it; a new
  `verifai web` prints a new one. Failed attempts are rate-limited.
- One check runs at a time. A check that was estimated and never started is dropped, key
  and all, after 10 minutes. Nothing is written to disk.
- The page is served under a strict Content Security Policy, with no framing and no
  referrer, and the API sends no CORS headers at all.
- `--allow-private-targets` is off unless `verifai web` itself was started with it. A page
  cannot turn it on, and it is never read from a config file.

### Cost profiles

| Profile | Scope | Typical cost |
|---|---|---|
| `quick` | Group A only — cannot clear an endpoint, tops out at **caution** | ~0 tokens |
| `standard` (default) | Groups A–C + Group F (30 repetitions) | Near zero — `count_tokens` is free, malformed requests are rejected before inference |
| `deep` | + Group D (and Group E, once it lands in Phase 7) | Billed; estimated and confirmed before anything runs |
| `paranoid` | `deep`, in a shuffled order, with Group F spread over 10 minutes | Highest; hardest to special-case |

The planner prints a token and request estimate and asks for confirmation before spending
anything. `--spread <duration>` spreads Group F over a longer span on any profile that runs
it, at the cost of wall-clock time.

### Pair the protocol with the vendor when you can

An endpoint's wire protocol and the vendor of the model it claims are independent, and
resellers mix them freely. VerifAI verifies all four combinations, but:

| Vendor claimed | Recommended protocol | Why |
|---|---|---|
| Anthropic | `anthropic-messages` | Vendor-native. Full probe catalogue, highest confidence ceiling. |
| OpenAI | `openai-chat` or `openai-responses` | Same. |

Cross-protocol runs (Claude over `/v1/chat/completions`, GPT over `/v1/messages`) are
**supported, not refused** — but a translation layer necessarily erases vendor-specific
signals, so those runs get a lower confidence ceiling. If your reseller offers both routes,
test the native one.

---

## Reports, signing, and the registry

Today a report is rendered for the terminal, as Markdown, or as JSON; the JSON shape is
specified in [`docs/report-format.md`](docs/report-format.md). Signing and the registry are
Phase 8 and **not built yet**; this is what they will be.

`verifai check` will write `report.verifai.json`: a canonical JSON document (RFC 8785) hashed
with SHA-256 and signed with a locally generated Ed25519 key (`verifai keygen`, stored in
`~/.verifai/keys`). `verifai verify <file>` will check it **fully offline**.

The signature covers probe nonces, response **digests** (not bodies — that is a privacy
decision), timings, and the tool and database versions. Every field is specified in
[`docs/report-format.md`](docs/report-format.md). Re-read
[What It Does Not Claim](#what-it-does-not-claim) for what a signature is worth.

The public registry is a **git repository**, not a server: one signed JSONL summary per
report, contributed by pull request. `verifai registry sync` fetches a tarball;
`verifai registry lookup <url>` hashes the normalised endpoint identity and searches
**locally**. Endpoint identities are stored hashed by default, so the registry can be
*looked up* but not *browsed as a blocklist*. The UI shows "N independent reports from M
distinct signers" rather than treating any single report as truth. See
[`docs/registry.md`](docs/registry.md), and the registry repository's `POLICY.md` for
moderation and takedown.

## Your API key

- Held **in memory only**. Never written to disk, never to `localStorage`, never to a log,
  never into a report.
- Supplied by environment variable or interactive prompt. In the web UI it goes from the
  page to the local server over loopback, and lives there for that one check.
- Redacted from every rendered output, including error messages.
- Sent to exactly one place: the endpoint you asked VerifAI to test.

The local daemon pins resolved DNS to the socket (defeating rebinding), refuses private,
loopback, link-local, and cloud-metadata address ranges including IPv4-mapped IPv6 and
NAT64, disables redirect following, and normalises upstream errors to a fixed taxonomy
before display — so VerifAI cannot be turned into an internal port scanner. It binds to
loopback, requires a per-process session token, and verifies `Origin` with no CORS
wildcard.

VerifAI sends no harmful-content probes. Every probe touches protocol surface and
capability behaviour only.

---

## Provenance and licence

MIT, clean-room. No third-party detection code — not as a dependency, not as a reference.
Every probe's expected behaviour is derived from official vendor documentation (URL plus
verbatim quote), a published paper, or our own recorded measurement, and each one is
recorded in [`docs/PROVENANCE.md`](docs/PROVENANCE.md). A probe with no provenance entry
fails CI.

This is why VerifAI can be used by anyone, including vendors and commercial projects, and
why its claims can be audited rather than taken on trust.

## Accuracy, measured

An adversarial fake-server matrix is part of the test suite. Every fake is built from
documented vendor facts, never from a probe id or nonce, and the full probe catalogue runs
against it end to end at the `deep` profile. Reproduce it with
`pnpm exec vitest run packages/core/test/accuracy.test.ts`. The claimed model is
`claude-opus-5-5`, except in the two GPT rows, which claim `gpt-5.2-2025-12-11` over OpenAI
Chat Completions.

| Fake server | What it is | Headline | Confidence | What the report says | Target met |
|---|---|---|---|---|---|
| `thin-pass-through` | Genuine Claude, nothing in between | `pass` | 0.89 | `matches-claim`, `uniform`, `direct` | yes — the false-positive test |
| `legit-translation-gateway` | Genuine Claude behind OpenAI Chat Completions | `caution` | 0.30 | identity `unknown`, `translated` | **partly** — not accused, but not cleared either |
| `openai-translated` | GPT behind an Anthropic shape | `caution` | 0.69 | `different-vendor`, `translated` | caught, as `caution` rather than `fail` |
| `model-downgrade` | Haiku answering as Opus | `fail` | 0.95 | `same-vendor-cheaper`, `direct` | yes |
| `model-downgrade`, GPT | GPT-5 mini answering as GPT-5.2, every answer relabelled | `caution` | 0.52 | `same-vendor-cheaper`, `direct` | caught, as `caution` rather than `fail` |
| `signature-forger` | Never verifies a replayed thinking signature | `fail` | 0.96 | `different-vendor`, ruled out by D1 | yes |
| `fractional-router` ε = 0.1 | Sends 10% of requests to Haiku | `fail` | 0.96 | `fractional`, 5 of 30 checks, 7.3%–33.6% | yes — expected 19.0% |
| `fractional-router` ε = 0.3 | Sends 30% of requests to Haiku | `fail` | 0.96 | `fractional`, 14 of 30 checks, 30.2%–63.9% | yes — expected 51.0% |
| `fractional-router` ε = 0.7 | Sends 70% of requests to Haiku | `fail` | 0.96 | `fractional`, 17 of 30 checks, 39.2%–72.6% | yes — expected 51.0% |
| `evasive` | Usage zeroed, probes blocked | `caution` | 0.80 | `evidence: obstructed` | yes — never `pass` |
| `thin-pass-through`, GPT | Genuine GPT-5.2, nothing in between | `caution` | 0.45 | `matches-claim`, `uniform`, `direct` | **partly** — not accused, but not cleared either |

In counts: **8 of 8** adversarial runs are not passed (5 `fail`, 3 `caution`), and **0 of 3**
genuine backends are failed; 1 of the 3 is passed. These are counts over a fixed matrix of
deterministic fakes, not rates with statistical weight, and a fake is only as faithful as the
documentation it was built from. Calibrating against real endpoints is Phase 7.

What the table does not hide:

- **The legitimate gateway is not cleared.** Claude served over OpenAI Chat Completions has no
  measured tokenizer reference yet, so nothing decisive says who answered, and VerifAI says
  `unknown` rather than guess. Recording that reference is Phase 7.
- **Genuine GPT is not cleared.** OpenAI documents one set of refusals that tells its models
  apart: which combinations of reasoning effort and `temperature` each model refuses
  (`conformance/openai/reasoning-matrix`). GPT-5.1 is cheaper and answers every one of them
  exactly as GPT-5.2 does, so that evidence speaks as much for a cheaper model as for the
  claim. VerifAI reads the claim as the likelier answer without clearing it.
- **The GPT downgrade is `caution`, not `fail`.** The same matrix is the only evidence that
  sets GPT-5 mini apart from GPT-5.2: it refuses reasoning effort `none`, which OpenAI
  documents GPT-5.2 takes. One documented refusal counts against the claim and points at the
  older GPT-5 models, but it is not enough on its own to rule GPT-5.2 out.
- **`openai-translated` is `caution`, not `fail`.** The o200k_base counts point at another
  vendor, but that evidence is derived, not measured, and a translation layer that recounts
  tokens itself would show the same counts. Nothing rules the claim out, so what is still
  unresolved is not held against the seller.
- **ε̂ counts repetitions, not requests.** A Group F check is two requests, and it reads as
  the majority only when both reach the same model, so a router sending 10% of requests
  elsewhere shows about 19% of checks disagreeing. The "expected" column is that share,
  1 − max((1−ε)², ε²). See [`docs/scoring.md`](docs/scoring.md#4-dispersion-clamp-for-fractional-consistency).

## Roadmap

| Phase | Contents | State |
|---|---|---|
| 0 | Workspace, toolchain, licence, provenance harness, CI | done |
| 1 | Transport, SSRF guard, SSE parser, three protocol adapters | done |
| 2 | Group A — free probes. **VerifAI becomes useful here.** | done |
| 3 | Scoring engine and report renderers | done |
| 4 | Groups B and C | done |
| 5 | Group D | done |
| 6 | CLI launcher and embedded web UI | done |
| 7 | Group E, calibration of Group F, `verifai record`, `verifai calibrate` | next |
| 8 | Signing, registry, release | |

## Contributing

Contributions welcome, with two hard rules:

1. **Never read or copy another model-detection implementation.** Vendor documentation,
   official SDK type definitions, papers, and your own measurements are the allowed
   sources. See [`docs/PROVENANCE.md`](docs/PROVENANCE.md).
2. **Every probe cites its source.** URL plus verbatim quote, a paper, or a measurement
   date. CI enforces this.

Recorded fixtures from first-party keys are especially valuable — they move signals from
`documented` to `measured`, which is what makes the confidence numbers mean something.
Redact keys and personal data before submitting; `verifai record` does this for you.

## Licence

[MIT](LICENSE)
