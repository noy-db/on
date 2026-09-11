# @noy-db/on-password

[![npm](https://img.shields.io/npm/v/%40noy-db/on-password.svg)](https://www.npmjs.com/package/@noy-db/on-password)

> Tier-2 password authenticator slot for noy-db

Part of [**`@noy-db/hub`**](https://www.npmjs.com/package/@noy-db/hub) — the zero-knowledge, offline-first, encrypted document store.

## Install

```bash
pnpm add @noy-db/hub @noy-db/on-password
```

## What it is

A password is enrolled as its own keyring slot: PBKDF2-SHA256 at 600,000 iterations derives a wrapping key from the password, and that key wraps the vault's DEK set into the slot — so unlocking is a slot unwrap, never a re-derivation of the tier-1 phrase. It sits at tier 2 deliberately, beside the rarely-typed tier-1 secret rather than replacing it; pair it with [`@noy-db/on-email-otp`](https://www.npmjs.com/package/@noy-db/on-email-otp) or [`@noy-db/on-totp`](https://www.npmjs.com/package/@noy-db/on-totp) for the familiar SaaS second factor.

## Status

**Pre-release.** API may change before `1.0`.

## Documentation

See the [main repository](https://github.com/noy-db/on#readme) for setup and the full unlock-primitive catalog.

- Source — [`on-password`](https://github.com/noy-db/on/tree/main/on-password)
- Issues — [github.com/noy-db/on/issues](https://github.com/noy-db/on/issues)

## License

[Apache-2.0](./LICENSE) © vLannaAi
