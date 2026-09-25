# Registry

A public registry with no server.

The value of a shared registry is obvious: one buyer's verification helps the next buyer. So
is the danger: a searchable list of endpoints labelled fraudulent is a defamation engine, and
an operator with a grievance and a script can fill it. The design below tries to keep the
first property while making the second expensive.

---

## Shape

The registry is a **separate git repository** (`verifai-registry`), not a service. There is
nothing to run, nothing to pay for, and nothing that can quietly change what it said last
week.

- One **append-only JSONL** file per time period, each line a signed report summary.
- Submission is by **pull request**.
- `verifai registry sync` fetches a tarball of the current dataset.
- `verifai registry lookup <url>` computes the normalised endpoint identity hash and
  searches the local copy — **entirely offline**, after sync.

Consequences worth stating: history is public and immutable by construction, moderation is
ordinary code review, and there is no server to compromise, subpoena, or take down.

---

## Hashed identity: lookupable, not browsable

Entries store a **hash** of the normalised endpoint identity, not the endpoint itself.

This is the central asymmetry. If you already know an endpoint, you can hash it and find
reports about it. You cannot dump the registry and read off a list of accused resellers,
because you would need to guess each endpoint to check it.

Plaintext endpoints are stored **only** with explicit opt-in from the submitter, and the
renderer never encourages it.

Normalisation before hashing is part of the spec, or the same endpoint hashes differently for
every submitter: lowercase scheme and host, drop the default port, strip a trailing slash,
strip query and fragment, keep the meaningful path prefix, drop any credential in the URL.
The exact algorithm is versioned alongside the schema — changing it invalidates every
existing hash, so it changes only with a major version.

---

## Entry format

One line per report summary:

```jsonc
{
  "registryVersion": 1,
  "endpointHash": "sha256:…",
  "claimedVendor": "anthropic",
  "claimedModel": "claude-opus-5-5",
  "protocol": "anthropic-messages",
  "pairing": "native",
  "observedAt": "2026-09-24T08:15:00.000Z",
  "toolVersion": "0.1.0",
  "fingerprintsVersion": "0.1.0",
  "profile": "standard",
  "verdict": "caution",
  "assessment": {
    "identity": "same-vendor-cheaper",
    "consistency": "uniform",
    "platform": "first-party",
    "translation": "direct",
    "evidence": "budget-limited"
  },
  "confidence": 0.71,
  "confidenceCeiling": 0.80,
  "epsilon": null,
  "signalSummary": [
    { "family": "accounting", "signalId": "…", "direction": "adverse" }
  ],
  "reportDigest": "sha256:…",
  "signature": { "alg": "Ed25519", "publicKey": "…", "keyFingerprint": "…", "value": "…" }
}
```

A summary, deliberately — not the full report. It carries no prompt text, no response
bodies, and no key material. `reportDigest` lets a submitter later produce the full report
and prove it is the one summarised.

---

## What the UI shows

**"N independent reports from M distinct signers."** Never a single report presented as
truth, and never a bare label.

A lookup result shows the verdict distribution across reports, the time range, the tool and
database versions involved, and the signer count. One adverse report from one signer is
displayed as exactly that — one data point — and where verdicts disagree, the disagreement
is shown rather than resolved.

Confidence ceilings travel with the entries, so a cluster of `quick`-profile reports cannot
present itself as a thorough investigation.

---

## Moderation

| Mechanism | Purpose |
|---|---|
| Signature required | Every entry is bound to a key; unsigned submissions are rejected |
| Pull-request review | A human reads every entry before it lands |
| Per-key rate limits | One key cannot flood the registry |
| Schema validation in CI | Malformed or over-sharing entries never merge |
| Signer reputation over time | A key with a history of corroborated reports carries more weight than a fresh one — displayed, never used to silence |
| Documented takedown in the registry repository's `POLICY.md` | An operator who believes an entry is wrong has a named, reviewable process |

Because history is a git history, a takedown is a commit that removes an entry and says why.
Nothing is silently rewritten.

### Anti-abuse, stated plainly

The registry can be gamed. A reseller can submit favourable reports about themselves; a
competitor can submit unfavourable ones. Signer counts, ceilings, and verdict distributions
exist so that a reader can see thin evidence for what it is. None of it makes the registry
authoritative, and it is not presented as authoritative.

---

## Posture

Entries record **facts and documentation quotes**, never accusations. The registry is not a
blocklist, it is not a rating service, and it is not evidence of intent. It answers one
narrow question — *has anyone else measured this endpoint, and what did they measure* — and
leaves the conclusion to the reader.

`POLICY.md` in the registry repository carries the submission rules, the takedown process,
and the disclaimer in full.
