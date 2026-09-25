# Report format

`verifai check` writes `report.verifai.json`. This document describes the artifact, how it
is signed, and precisely what the signature is worth.

The format is versioned. `reportVersion` is bumped on any incompatible change, and every
report pins the tool version and the fingerprint-database version so an old report can be
read in the context that produced it.

---

## Shape

```jsonc
{
  "reportVersion": 1,
  "tool": { "name": "verifai", "version": "0.1.0" },
  "fingerprintsVersion": "0.1.0",

  "run": {
    "startedAt": "2026-09-24T08:15:00.000Z",
    "finishedAt": "2026-09-24T08:15:41.882Z",
    "profile": "standard",
    "spreadMs": 0,                 // span Group F was spread over; 0 = one after another
    "nonce": "3f2a…",              // per-run random; echoed inside probe payloads
    "probeOrderSeed": "9c14…",     // records the randomised order for reproducibility
    "privateTargetsAllowed": false // true only under --allow-private-targets
  },

  "target": {
    "endpointHash": "sha256:…",    // normalised endpoint identity, hashed
    "endpoint": null,              // plaintext only with explicit opt-in
    "protocol": "anthropic-messages",
    "claimedVendor": "anthropic",
    "claimedModel": "claude-opus-5-5",  // the vendor's documented name the checks compare against
    "requestedModel": "claude-opus-5-5", // the name as typed and sent, e.g. "reseller/claude-opus-4.6"
    "pairing": "native",
    "auth": "x-api-key"            // how the key was sent: "x-api-key" or "bearer"
  },

  "verdict": {
    "headline": "caution",         // derived from `assessment` + `confidence`; never set directly
    "assessment": {
      "identity": "same-vendor-cheaper",
      "consistency": "uniform",
      "platform": "first-party",
      "translation": "direct",
      "evidence": "budget-limited"
    },
    "confidence": 0.71,
    "confidenceCeiling": 0.84,   // 0.88 without D, -0.02 for a 10% gap, -0.02 documented-only
    "ceilingReasons": ["group-d-not-run", "probes-skipped", "calibration-documented-only"],
    "plainLanguage": "…",          // one sentence, no jargon
    "epsilon": null                // share of repetitions that disagree, e.g.
                                   // { "probeId": "…", "disagreements": 12, "trials": 40,
                                   //   "lost": 0, "estimate": 0.3, "interval": [0.18, 0.45],
                                   //   "clustered": false,
                                   //   "draws": [{ "draw": 1, "outcome": "agree" }, …] }
                                   // (interval rounded here; stored at full precision)
                                   // `draws` lists every Group F repetition in the order
                                   // sent; the counts, estimate, interval, `clustered`, and
                                   // the window printed beside `consistency` derive from it
  },

  "posteriors": {                  // one distribution per inferred axis, each summing to 1
    "identity": {
      "matches-claim": 0.12,
      "same-vendor-cheaper": 0.71,
      "different-vendor": 0.11,
      "not-a-live-model": 0.02,
      "unknown": 0.04
    },
    "consistency": { "uniform": 0.93, "fractional": 0.02, "unknown": 0.05 },
    "platform": { "first-party": 0.88, "partner-cloud": 0.07, "unknown": 0.05 },
    "translation": { "direct": 0.91, "translated": 0.06, "unknown": 0.03 }
    // no `evidence` entry: it is read off `skipped` and the probe outcomes, not inferred
  },

  "signals": [
    {
      "probeId": "…",
      "signalId": "…",
      "family": "accounting",
      "calibration": "documented",
      "observed": "…",
      "expected": "…",
      "llr": { "identity": { "matches-claim": -1.4, "same-vendor-cheaper": 0.9 } },
      "plainLanguage": "…",
      "citations": [
        { "url": "https://…", "quote": "…", "retrievedAt": "2026-09-24" }
      ]
    }
  ],

  "skipped": [
    { "probeId": "…", "reason": "budget-exceeded" }
  ],

  "evidence": [
    {
      "probeId": "…",
      "requestDigest": "sha256:…",   // digest, never the body
      "responseDigest": "sha256:…",
      "status": 400,
      "sentAtMs": 1520,              // when it went out, as an offset from `run.startedAt`
      "timing": { "ttftMs": 412, "totalMs": 980, "tokensPerSecond": null },
      "connection": "fresh",         // fresh | reused | unobserved, as the transport reported it
      "draw": 7                      // the Group F repetition this request belongs to;
                                     // absent on every other entry
    }
  ],

  "signature": {
    "alg": "Ed25519",
    "publicKey": "…",
    "keyFingerprint": "…",
    "value": "…"
  }
}
```

### Field rules that are not negotiable

- **No API key, anywhere.** Not in `target`, not in `evidence`, not inside a quoted error
  message. Keys are redacted before a value can reach the report, and a unit test asserts
  that a report built from a run carrying a known key string does not contain it.
- **Digests, not bodies.** `evidence` stores hashes of requests and responses. Response
  bodies can contain the buyer's own prompt text and the endpoint's internal details;
  neither belongs in a document meant to be shareable. The digests still make tampering
  detectable.
- **Endpoint identity hashed by default.** Plaintext requires explicit opt-in. A report
  should be shareable as evidence without publishing a blocklist entry as a side effect.
- **Every signal carries at least one citation.** An empty `citations` array is a
  construction error, not a low-confidence signal.
- **`skipped` is mandatory.** A probe that did not run must be listed with its reason, and
  it lowers `confidenceCeiling`. A report that omits its gaps is a dishonest report.
- **`headline` is derived, and checked.** `verifai verify` recomputes it from `assessment`
  and `confidence` and rejects a report where the two disagree, so a hand-edited headline
  cannot survive even under a valid signature from the editor's own key.
- **`evidence` is in send order.** Each entry records when its request went out, as
  `sentAtMs` from `run.startedAt`, and `verifai verify` rejects a report in which it
  decreases. The gaps are what a reader needs to judge how long a Group F run spanned —
  a router that pins a backend for longer than that would not have been seen switching —
  so they are kept rather than summarised. They scope the `consistency` finding and are
  never converted into a coverage number: nothing the run observes shows how long a
  router's window is, so no span can be certified as long enough (see
  [`threat-model.md`](threat-model.md#34-fractional-router-consistency-fractional)).
- **`epsilon` is derived, and checked.** Group F repetitions go out one at a time, numbered
  from 1 in the order sent, and `evidence` records requests in that order, so `draw` never
  decreases along it. `epsilon.draws` lists every repetition in that same order, with one
  outcome:
  - `excluded` — some request of it is recorded as `reused` or `unobserved`, so it was
    never an independent draw;
  - `agree` or `disagree` — it carries exactly as many requests as the probe sends per
    repetition, and every one went out `fresh`, answered 2xx, and could be read;
  - `lost` — every request recorded went out `fresh`, but not all of them came back 2xx
    and readable: an error status, a timeout after sending, a body the probe cannot parse.

  `verifai verify` rejects a report in which `draw` decreases along `evidence`, `draws`
  departs from that order or skips a number, omits a `draw` value that `evidence` holds
  for `epsilon.probeId` or lists one it does not, a repetition carries more requests than
  the probe sends, or an outcome contradicts those entries — including `excluded` for a
  repetition whose every request was `fresh`, which would otherwise let a disagreement be
  dropped quietly. The request count per repetition comes from the probe catalogue, not
  from the report. `draw` is read as present or absent: an entry without it belongs to no
  repetition and is never defaulted into one, so neither a two-request draw nor a retry
  can count twice. From the outcomes `verify` recomputes `trials` (`agree` plus
  `disagree`), `disagreements`, `lost`, `estimate`, `interval`, `clustered`, and
  `consistency` by the rules in
  [`scoring.md`](scoring.md#4-dispersion-clamp-for-fractional-consistency), and rejects a
  mismatch; floating-point values are compared to within 1e-9, because `Math.pow` is not
  correctly rounded on every engine. What `verify` cannot check is the reading itself — the
  report holds digests, not bodies — so these rules buy auditability, not integrity:
  whoever holds the signing key can write any outcomes they like, and the signature only
  makes them attributable.
- **A fractional reading names the other share.** `consistency: "fractional"` together with
  `identity: "matches-claim"` is a malformed report, not a weak one — see
  [`scoring.md`](scoring.md#consistency--does-that-hold-for-every-request).

---

## Signing

1. Serialise the report **without** the `signature` field.
2. Canonicalise with RFC 8785 (JSON Canonicalization Scheme).
3. SHA-256.
4. Sign with Ed25519 using a locally generated key (`verifai keygen`, stored under
   `~/.verifai/keys`).
5. Attach `signature`.

`verifai verify <file>` reverses this **fully offline**: strip `signature`, canonicalise,
hash, verify against the embedded `publicKey`, and confirm `keyFingerprint` matches that
key. A report altered by even one byte fails, and a test asserts that deliberately
corrupted reports do.

Ed25519 comes from Node's built-in `node:crypto`; JCS canonicalisation is implemented in
this repository. RFC 8785 is unusually well-suited to JavaScript — `JSON.stringify` already
emits the required number format, and the default string sort already orders by UTF-16 code
unit — so the implementation is small enough to audit, which matters more here than saving
thirty lines.

### What the signature proves

**It proves:** the report has not been modified since signing, and it is bound to the holder
of that key. Tamper-evidence and non-repudiation.

**It does not prove:** that the endpoint actually behaved this way. Anyone can generate a
key and sign a fabricated report. This is stated in the README, in this document, and in the
`verifai verify` output itself, because a signature that looks like proof and is not is
worse than no signature.

Three things raise the bar without overclaiming:

- **Per-run nonces echoed in model output** — evidence the run really happened at some
  point in time.
- **Optional digest publication** to the registry's append-only log — evidence of existence
  before a given time.
- **Multi-signer corroboration** — N independent reports from M distinct signers, which is
  how the registry presents results.

Full attestation needs a TEE or a trusted notary. That is out of scope, and saying so is
part of the format.

---

## Other renderers

The JSON document is canonical. The others are views of it, and none may show a conclusion
the JSON does not contain. Nor may one recompute a number the JSON already holds: the bound
printed beside `consistency` is the stored `epsilon.interval`, never re-derived from
`trials`, which would drop the widening that lost repetitions bought. Three views ship:

- **Terminal** (default) — the buyer's verdict, then the signal table, colour-coded, with
  citations as footnotes.
- **Markdown** — the same content, pasteable into a support ticket or a dispute.
- **Web UI** — a green/yellow/red verdict with a plain-language sentence, expandable into
  the full evidence table with the documentation quote behind every flag.

Every renderer states facts and quotes documentation. None of them alleges intent.
