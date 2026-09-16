# @noy-db/on-shamir

<!-- prose-preamble
// Bindings the illustrative blocks below elide — all of them the READER's
// own values and transports, never this package's API. Typed on purpose: an
// `any` here would stop the blocks below checking anything.
import type { RawShare } from '@noy-db/on-shamir'
declare const currentKEK: CryptoKey
declare const secretBytes: ArrayBuffer
declare const shareStringFromCFO: string
declare const shareStringFromCOO: string
declare const shares: readonly RawShare[]
declare const ceoPasskey: unknown
// Your own storage / transport — this package ships none of these.
declare function persistShare(id: string, share: unknown): Promise<void>
declare function storeUnderPasskey(credential: unknown, share: unknown): Promise<void>
declare function emailAuditor(link: unknown, share: unknown): Promise<void>
-->

**k-of-n Shamir Secret Sharing** of the vault KEK for multi-party unlock. Any **K** of **N** enrolled shares recombines the KEK; fewer than K leaks zero bits.

The defining feature is **composability** — each share can itself be protected by any other `@noy-db/on-*` method. Share 1 behind a WebAuthn passkey, share 2 behind an OIDC login, share 3 printed on paper in a corporate safe. Fractional trust across different authentication modes.

Part of the `@noy-db/on-*` authentication family.

## Install

```bash
pnpm add @noy-db/on-shamir
```

## Use cases

- *"Any 2 of 3 admins must authorise unlocking the audit vault."*
- *"CFO + COO consent required to unlock the CEO vault during vacation."*
- *"3-of-5 board escrow — the vault survives any 2 resignations."*
- *"Executive key is split across a passkey + OIDC + paper backup — any 2 of 3 unlock."*

## Threat model

**Protects against:**
- Up to K-1 colluding share holders (mathematically — fewer than K shares reveals zero bits of the KEK)
- Loss of up to N-K shares (remaining K shares still reconstruct)

**Does NOT protect against:**
- K colluding share holders (by design — that's the threshold contract)
- Device compromise of the combining machine during reconstruction (the KEK is briefly in memory; if that machine is malicious, no library-level hedge helps)
- Side-channel attacks on the Lagrange interpolation (not constant-time by design — the threat model assumes a trusted combine-device)

## ⛔ Rotating the KEK invalidates every outstanding share

Splitting is information-theoretic, not wrapping — the shares **are** the KEK's
bytes, split — so there is no re-wrap path and no ceremony that can migrate a
share set. After a KEK rotation, existing shares still combine successfully and
hand back the **old** KEK, which no longer opens the vault. Nothing here detects
this; the holder discovers it at recovery time, which for a last-resort unlock
path is the worst possible moment.

The remedy is redistribution: `splitKEK(newKek)`, then get the fresh shares to
all N holders again. ⚠️ Holders are safes, printouts and other `on-*` methods, so
this is an out-of-band, people-shaped operation — put it in the runbook that
owns your rotation, because this package cannot automate or detect it.

## Math

Shamir Secret Sharing over GF(2^8), byte-wise. For each byte of the KEK:

1. Construct a random polynomial of degree k-1 whose constant term is the KEK byte.
2. Each share is the polynomial evaluated at a distinct x-coordinate (1..255; x=0 reserved because it would reveal the byte).
3. Lagrange interpolation at x=0 given any K points recovers the byte.

Implemented in ~120 LoC of pure TypeScript (`gf256.ts` + `shamir.ts`). Zero cryptographic dependencies — just Web Crypto's `getRandomValues` for randomness and `subtle.importKey` to rehydrate the reconstructed KEK.

Reduction polynomial: x^8 + x^4 + x^3 + x + 1 (0x11b, same as AES).

## Usage

### Enroll — after primary unlock

```ts
import { splitKEK, encodeShareBase32 } from '@noy-db/on-shamir'

const shares = await splitKEK(currentKEK, { k: 2, n: 3 })

// Each share is now a RawShare structure. Serialise for distribution:
const shareStrings = shares.map(encodeShareBase32)
// Example: 'SHAMIR_S1_K2N3__AKHT-P4L7-...'

// Distribute via any on-* method:
//   shareStrings[0] → store under a WebAuthn-protected keyring entry
//   shareStrings[1] → store under an OIDC-protected keyring entry
//   shareStrings[2] → print on paper, put in the corporate safe
```

### Unlock — collect K shares and combine

```ts
import { combineKEK, decodeShareBase32 } from '@noy-db/on-shamir'

// Unlock each share via its own on-* method (not shown — uses whichever
// on-webauthn / on-oidc / on-recovery / on-magic-link the holder chose).
const shareA = decodeShareBase32(shareStringFromCFO)
const shareB = decodeShareBase32(shareStringFromCOO)

// Combine — returns a non-extractable KEK ready to use
const kek = await combineKEK([shareA, shareB])
```

### Low-level — for custom integrations

```ts
import { splitSecret, combineSecret } from '@noy-db/on-shamir'

const [shareA, shareB] = splitSecret(new Uint8Array(secretBytes), 2, 3)
if (!shareA || !shareB) throw new Error('splitSecret returns n shares')
const recovered = combineSecret([shareA, shareB])
// recovered is a Uint8Array — you handle its lifecycle
```

JSON form — store shares inside other on-* keyring entries:

```ts
import { encodeShareJSON, decodeShareJSON } from '@noy-db/on-shamir'

const [firstShare] = shares
if (!firstShare) throw new Error('splitSecret returns n shares')
const json = encodeShareJSON(firstShare)
// { v: 1, x: 1, k: 2, n: 3, y: '<base64>' }
// Persist it however that on-* method keeps its material — this package
// ships no storage helper, and `UnlockedKeyring` has no `put`.
await persistShare('_recovery_share_1', json)
```

## API

```text
// High-level — wraps a CryptoKey
async function splitKEK(kek: CryptoKey, options: { k: number; n: number }): Promise<RawShare[]>
async function combineKEK(shares: readonly RawShare[]): Promise<CryptoKey>

// Low-level — operates on raw bytes
function splitSecret(
  secret: Uint8Array,
  k: number,
  n: number,
  randomBytes?: (count: number) => Uint8Array,  // Injectable for tests
): RawShare[]
function combineSecret(shares: readonly RawShare[]): Uint8Array

// Serialisation
function encodeShareBytes(share: RawShare): Uint8Array
function decodeShareBytes(bytes: Uint8Array): RawShare

function encodeShareBase32(share: RawShare): string
function decodeShareBase32(input: string): RawShare

function encodeShareJSON(share: RawShare): ShareJSON
function decodeShareJSON(json: ShareJSON): RawShare

interface RawShare {
  x: number          // 1..255
  y: Uint8Array      // One byte per secret byte
  k: number          // Threshold
  n: number          // Total
}

// GF(2^8) arithmetic — exported for composition / auditing
function gfAdd(a: number, b: number): number
function gfMul(a: number, b: number): number
function gfInv(a: number): number
function gfDiv(a: number, b: number): number
function gfPolyEval(coeffs: readonly number[], x: number): number
function lagrangeInterpolateAtZero(points: readonly [number, number][]): number
```

## Share format

Binary (6-byte header + y-bytes):

```
offset  size  field
0       1     version (= 1)
1       1     x-coordinate (1..255)
2       1     k (threshold)
3       1     n (total)
4       2     byteLength (big-endian uint16)
6+      L     y-bytes (L = byteLength)
```

For a 32-byte KEK: 38 bytes total per share.

Base32 form includes a human-readable prefix (`SHAMIR_S{x}_K{k}N{n}__`) followed by the payload in groups of 4:

```
SHAMIR_S2_K2N3__AKHT-P4L7-KDFG-H3JX-M8E...
```

The prefix is stripped by the decoder — metadata is recovered from the binary header. Consumer tools can show the prefix to the user for at-a-glance share identification without trusting it.

## Composability recipe — Shamir + any on-* method

```ts
import { splitKEK, encodeShareJSON, encodeShareBase32 } from '@noy-db/on-shamir'
import { createMagicLinkToken } from '@noy-db/on-magic-link'
// Plus whichever other on-* packages you use

const [ceoShare, auditorShare, paperShare] = await splitKEK(currentKEK, { k: 2, n: 3 })
if (!ceoShare || !auditorShare || !paperShare) throw new Error('splitKEK returns n shares')

// Share 1 — passkey. `storeUnderPasskey` is YOUR code: no on-* package
// takes a payload at enrollment.
await storeUnderPasskey(ceoPasskey, encodeShareJSON(ceoShare))

// Share 2 — magic link to an auditor's email
const link = createMagicLinkToken('escrow-vault', { ttlMs: 30 * 24 * 60 * 60 * 1000 })
await emailAuditor(link, encodeShareJSON(auditorShare))

// Share 3 — paper backup
console.log('Corporate-safe backup:', encodeShareBase32(paperShare))
```

## Performance

GF(2^8) operations are table-lookup O(1) — all micro-operations run in nanoseconds. Splitting a 32-byte KEK into 3 shares takes sub-millisecond. Combining likewise. Web Crypto's `importKey` on the reconstructed KEK is the dominant cost (~1ms).

## License

Apache-2.0 © vLannaAi
