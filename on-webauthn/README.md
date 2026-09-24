# @noy-db/on-webauthn

<!-- prose-preamble
// Bindings the illustrative blocks below elide — the reader's own storage and
// store choice. Typed on purpose: an `any` here would stop the blocks below
// checking anything.
import type { NoydbStore, UnlockedKeyring } from '@noy-db/hub'
import type { WebAuthnEnrollment } from '@noy-db/on-webauthn'
declare const store: NoydbStore
declare const keyring: UnlockedKeyring
declare function loadEnrollmentFromIDB(): Promise<WebAuthnEnrollment>
-->

[![npm](https://img.shields.io/npm/v/%40noy-db/on-webauthn.svg)](https://www.npmjs.com/package/@noy-db/on-webauthn)

> WebAuthn hardware-key keyrings for noy-db

Part of [**`@noy-db/hub`**](https://www.npmjs.com/package/@noy-db/hub) — the zero-knowledge, offline-first, encrypted document store. Enrollment via PRF-capable authenticators maintains this zero-knowledge guarantee; non-PRF enrollments are a presence gate, not confidentiality (refused by default).

## Install

```bash
pnpm add @noy-db/hub @noy-db/on-webauthn
```

## What it is

WebAuthn hardware-key keyrings for noy-db — Touch ID, Face ID, Windows Hello, YubiKey, FIDO2 passkeys

## Plumbing into `createNoydb`

`unlockWebAuthn(enrollment)` returns an `UnlockedKeyring`. As of `@noy-db/hub@0.1.0-pre.4` ([issue #5](https://github.com/noy-db/core/issues/5)), pass it directly to `createNoydb` via the `getKeyring` callback — no secret bridge required:

```ts
import { createNoydb } from '@noy-db/hub'
import { unlockWebAuthn } from '@noy-db/on-webauthn'

const enrollment = await loadEnrollmentFromIDB()  // your storage of choice

const db = await createNoydb({
  store,
  user: 'alice',
  getKeyring: (vault) => unlockWebAuthn(enrollment),
})
```

The callback is invoked lazily on the first `openVault(name)` per vault and the keyring is cached for the lifetime of the instance. `secret` and `getKeyring` are mutually exclusive — provide exactly one.

**Note:** `unlockWebAuthn` is back-compatible with existing non-PRF enrollments (created before this version or via explicit `allowNonPrfInsecure: true`); unlocking such records works normally, but the confidentiality guarantee depends on the enrollment's `prfUsed` flag. New enrollments require PRF or explicit opt-in for documented non-zero-knowledge presence gates.

For first-time bootstrap (no enrollment exists yet), open the vault with a secret, enroll WebAuthn from the unlocked keyring (`enrollWebAuthn(keyring, ...)`), persist the enrollment, then swap to `getKeyring` on subsequent sessions.

## One credential across subdomains — the RP ID

A WebAuthn credential belongs to a **relying party ID**, and the browser
defaults that to the page's own hostname. Enrol on `app.example.com` and the
credential is invisible to `console.example.com`. To share one tap across
subdomains, enrol under the **registrable domain**:

```ts
import { enrollWebAuthn, unlockWebAuthn } from '@noy-db/on-webauthn'

// Enrol once, under the parent domain — valid from any of its subdomains.
const enrollment = await enrollWebAuthn(keyring, 'company-a', {
  rp: { id: 'example.com', name: 'Example' },
})

// The RP ID is recorded on the enrollment, so the assertion reuses it.
// No second place to keep in sync.
const unlocked = await unlockWebAuthn(enrollment)
```

The RP ID must be a registrable suffix of the enrolling page's origin: from
`app.example.com` you may pass `example.com`, but not `example.org` and not
`com`. The browser rejects anything else with a `SecurityError`.

⚠️ **Records enrolled before `0.9.0` carry no `rpId`**, and for those the
assertion sends none — preserving the old behaviour, where the browser
defaults it to the asserting page. That is correct for a single-hostname
deployment and wrong for a cross-subdomain one, so pass it explicitly when
upgrading such a record:

```ts
import { unlockWebAuthn } from '@noy-db/on-webauthn'

const legacy = await loadEnrollmentFromIDB()
const unlocked = await unlockWebAuthn(legacy, { rpId: 'example.com' })
```

The same `rpId` option is accepted by `webAuthnSlotRewrapCeremony`, whose slot
`meta` is written by hub and does not carry an RP ID today — so for the
ceremony path the option is currently the only route.

## Status

**Pre-release** (`0.1.0-pre.1`). API may change before `1.0`.

## Documentation

See the [main repository](https://github.com/noy-db/core#readme) for setup, examples, and the full subsystem catalog.

- Source — [`packages/on-webauthn`](https://github.com/noy-db/core/tree/main/packages/on-webauthn)
- Issues — [github.com/noy-db/core/issues](https://github.com/noy-db/core/issues)
- Spec — [`SPEC.md`](https://github.com/noy-db/docs/blob/main/SPEC.md)

## License

[Apache-2.0](./LICENSE) © vLannaAi
