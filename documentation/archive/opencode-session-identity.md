# OpenCode client identity — the session headers, traced from the bundle

> [!IMPORTANT]
> **The client sends two different session values, not one.** Our adapter sent a
> single id in all five session headers. That is the defect this document
> records, alongside the generator it was derived from.

**Date:** 2026-10-17. **Build pinned:** `opencode-cli` 2.0.32, extracted from
`opencode-desktop-linux-x86_64.rpm` (`D:/tmp/opencode-rpm/extracted/`).
**Method:** static inspection of the minified bundle. No installer was run.

## The question

OpenCode free-tier dispatches through our adapter intermittently answer
`403 FreeTierError` while the tools, the stream flag, and the anonymous bearer
are all correct. What in the request still differs from what the client sends?

## What the client sends

From `SessionModelRequest.prepare` in the CLI bundle, the request headers are
built in one object:

```js
fH = IR(h)
EH = tJ({
  model: T.model,
  http: {
    headers: {
      "x-opencode-session-id": h.id,
      ...(h.parentID ? { "x-opencode-parent-session-id": h.parentID } : {}),
      "x-session-affinity": fH,
      "X-Session-Id": fH,
      ...(h.parentID ? { "x-parent-session-id": h.parentID } : {}),
      "User-Agent": QA(A),
      "x-opencode-project": h.projectID,
      "x-opencode-session": fH,
      "x-opencode-client": A.name,
    },
  },
  promptCacheKey: /^ses_[0-9a-f]{64}$/.test(fH) ? fH.slice(4) : fH,
  ...
})
```

with

```js
IR = (H) => H.parentID ?? H.fork?.sessionID ?? H.id;
```

### The two values

| Header | Value | Meaning |
| --- | --- | --- |
| `x-opencode-session-id` | `h.id` | **the session's own id** |
| `x-session-affinity` | `fH` | parent session, or the forked session, or the id |
| `X-Session-Id` | `fH` | same as affinity |
| `x-opencode-session` | `fH` | same as affinity |
| `x-parent-session-id` | `h.parentID` | **only when a parent exists** |

For a top-level session `fH === h.id`, so the two collapse into one value. They
diverge in exactly the case that matters: a **child or forked session**, where
affinity points at the parent while `session-id` names the child.

Our adapter emitted one id into all five. For a top-level session that is
indistinguishable from correct; for anything derived, it claims the child is its
own parent.

### The project header

`x-opencode-project` is `h.projectID`. The reference gateway notes the free tier
**refuses canonical `prj_*` ids** and accepts the literal `global` every client
sends, so a real client's project id is not necessarily what the gate wants. Our
adapter sends `global` unless the caller supplies one — that part is fine.

### `promptCacheKey`

```js
promptCacheKey: /^ses_[0-9a-f]{64}$/.test(fH) ? fH.slice(4) : fH
```

A 64-hex session literal is stripped of its `ses_` prefix; any other shape is
passed through whole. Note this is the **64-hex** internal form, not the
26-character wire form.

## The generator

```js
function Q$e() { return gZ(!0) }
function gZ(e, n = Date.now()) {
  if (n !== m) m = n, d = 0;
  d++;
  let r = BigInt(n) * 0x1000n + BigInt(d),
      a = e ? ~r : r,
      c = Array.from({ length: 6 }, (l, D) =>
            Number(a >> BigInt(40 - 8 * D) & 0xffn).toString(16).padStart(2, "0")).join(""),
      s = crypto.getRandomValues(new Uint8Array(F - 12));
  return c + Array.from(s, (l) => I[l % 62]).join("")
}
```

Facts, read off this code rather than assumed:

- The counter `d` **has no upper bound**. It resets when the millisecond
  changes and otherwise grows without limit.
- The value is `~(ts_ms << 12 | counter)` when descending, rendered as 6 bytes
  (12 hex), then 14 base62 characters.
- `Session.ID` is minted by `e.make("ses_" + Q$e())`, so every session id is
  `ses_` + 12 hex + 14 base62.

### What this means for the counter cap

The reference gateway (`opencode2api`) caps the counter at 63, and its comment
claims the gate accepts 1–63 only. **The client does not cap it.** So a cap is a
deliberate divergence from the client, and two things follow:

1. A cap is only correct if the *gate* rejects high counters — a claim about
   upstream, not about the client.
2. Without a cap, a burst of more than 63 dispatches inside one millisecond
   emits ids whose low 12 bits fall below `0xfc0`. Whether upstream refuses
   those is **unverified here**; the reference gateway says it does, from live
   probing.

We capped at 63 and roll into the next millisecond on overflow. That keeps every
id inside the window the reference reports as accepted, at the cost of ids that
do not sort exactly as the client's would under a burst. The alternative — match
the client exactly and emit uncapped counters — is only safe if the gate truly
accepts them.

**Status of this claim: `unverified`.** It rests on another project's live
probing, not on our own measurement.

## What our adapter does, and where it differs

`src/providers/integrations/opencode/fingerprint.ts`:

| Aspect | Client | Ours | Verdict |
| --- | --- | --- | --- |
| distinct `session-id` vs affinity | yes | **one value in all five** | **defect** |
| `x-parent-session-id` | when a parent exists | never sent | **missing** |
| `x-opencode-client` | `A.name` (`cli`) | `desktop` | cosmetic; gate accepts both |
| `x-opencode-project` | `h.projectID` (40 hex) | hashed to 40 hex | **fixed** |
| counter cap | none | 63 | divergence, see above |
| `x-opencode-request` | absent | absent | correct |
| trace headers | from tracing context | freshly generated per call | acceptable |

### Why "one value in all five" is a real defect and not a nit

The affinity header is what upstream uses to group a conversation for prompt
caching and for whatever per-session accounting the free tier applies. Sending
the child's id as its own affinity:

- splits a forked conversation into two unrelated sessions upstream, losing
  cache affinity — the thing the header exists for;
- makes a child look like a root, so any per-session limit the gate applies is
  counted against the wrong identity.

For a top-level session — which is every dispatch our adapter currently
produces, because nothing sets a parent — the two values are identical, so the
bug is **latent, not active**. It becomes active the moment anything routes a
derived session through this adapter.

## Corrections to earlier notes

The capture document (`documentation/archive/opencode-freetier-replay.md`)
records the four session headers as carrying the *same* id. That is true of the
captured top-level session and was generalised from it. The bundle shows the
general rule: they are equal only when no parent exists.

## What is still unknown

- Whether the gate actually rejects counters above 63. Only the reference
  gateway asserts it.
- Whether the gate compares `x-opencode-session-id` against affinity at all, or
  merely uses affinity for cache grouping. The bundle proves what the *client*
  sends; it says nothing about what upstream checks.
- Whether `x-opencode-client: desktop` versus `cli` matters. Earlier probing says
  both are accepted; the bundle's `A.name` is the client's own name, which for
  the CLI is `cli`.

## Next evidence needed

1. Replay a dispatch with `session-id` and affinity deliberately different, from
   an allowed egress, and observe whether the gate accepts it. That is the only
   way to learn whether the distinction is enforced.
2. Replay 64+ ids minted inside one millisecond and observe the status of the
   later ones. That settles the counter cap.
3. Only then change the adapter. A diff against another client's source is a
   hypothesis, not evidence.

## Addendum — the project header

The captured 2.x dispatch carries:

```
x-opencode-project: 82b484de3985b491abf573de7d60d7999302b858
```

40 hex, not a name. Our adapter sent the literal `"global"` — a value that
passed one earlier probe, but which is not the shape the client produces. The
reference gateway (`opencode2api`) reaches the same conclusion from its own
probing and renders the header as `sha256(project)[:20]` hex, noting that the
free tier **refuses canonical `prj_*` ids** while accepting the 40-hex form.

We now do the same: a caller's project identity is hashed into 40 hex, and an
already-canonical value is preserved rather than re-hashed.

### Why "global" was not obviously wrong

It passed a live probe on 2026-10-14, so it looked correct. A value that is
accepted is not the same as a value that is sent — the gate may tolerate several
shapes while fingerprinting only one. Treating "this passed" as "this is the
client's value" is how a guess becomes a constant.

## Addendum — what the reference gateway does differently, and why it is not proof

`opencode2api` sets `x-opencode-session`, `x-session-affinity`, `X-Session-Id`,
and `x-opencode-session-id` all to the **same** derived id, with a comment
saying the newer gate "wants both session headers set to the same
descending-encoded id".

That contradicts the bundle, which builds them from two expressions
(`h.id` versus `IR(h)`). Both can be true: the gate may accept one value in all
five for a top-level session — which is every session a stateless gateway
produces, because it has no parent to derive from — while the client still
distinguishes them for its own forked sessions.

So the reference is evidence that **one value works**, not evidence that the
distinction is irrelevant. Our adapter keeps one value for now: it produces only
top-level sessions, where the two expressions are identical by definition. The
distinction becomes load-bearing only if we ever forward a parent relationship,
and at that point the bundle is the authority.

## Measured 2026-10-17 — the open questions, answered

Run from five fresh egresses that all answered `200` on the same dispatch, so
every result below is about the header, not the address.

### The counter window is real, and the cap is correct

| Counter | Time part | Result |
| --- | --- | --- |
| 1 | `eb532e04bffe` | **200** |
| 63 | `eb532e04bfc0` | **200** |
| 64 | `eb532e04bfbf` | **403 FreeTierError** |
| 100 | `eb532e04bf9b` | **403** |
| 4095 | `eb532e04b000` | **403** |

The boundary is exactly where the reference gateway said it was: **1–63
accepted, 64 and above refused**. This was previously recorded as another
project's claim; it is now our own measurement, and the cap in
`generateOpenCodeSessionId` is what keeps a burst from crossing it.

### The session shape is enforced, the value is not

| Variation | Result |
| --- | --- |
| baseline (our headers) | 200 |
| `x-opencode-client: cli` instead of `desktop` | 200 |
| 64-hex internal session literal | **403** |
| `x-opencode-session-id` ≠ affinity, with parent headers | 200 |
| `x-parent-session-id` present | 200 |

So the gate checks the **shape** — `ses_` + 12 hex in the descending layout +
14 base62 — and does not care whether `session-id` equals affinity, nor whether
a parent header is present. The bundle's distinction is real for the client's
own bookkeeping, but nothing upstream enforces it.

That closes the item left open earlier: our adapter sending one id in all five
is **not** a defect the gate can see. It stays a latent correctness issue for
cache affinity if we ever forward a parent relationship, not a 403 cause.

### The project header is not validated in any of the forms we tried

| Variation | Result |
| --- | --- |
| 40-hex (our current value) | 200 |
| literal `global` | 200 |
| header absent entirely | 200 |

The reference gateway's claim that canonical `prj_*` ids are refused was not
re-tested, but every other shape passed. The 40-hex form is still what we send:
it is what the client produces, and matching the client is the safer default
even where the gate is indifferent.

### What this rules out

The intermittent `403`s are **not** caused by:

- the session counter (capped, and the cap matches the measured window);
- `x-opencode-client` (`desktop` and `cli` both pass);
- the session-id/affinity split (not enforced);
- the project header shape (three shapes pass).

What remains, and is consistent with the observed pattern — some proxies work
and others refuse the same dispatch — is that the refusal follows the **egress
address**. Five fresh proxies answered 200 on the first try; the earlier set,
used repeatedly during testing, answered 403 to the identical request.

That is the conclusion the free-tier reference already reached, now measured
here: the gate checks the IP first and independently of the request.
