# Changelog

All ten `@noy-db/on-*` packages share one version line and are released together.

This file is **hand-written**. There is no changeset tooling here, deliberately: this repo has
zero internal dependency edges, so there is no dependency closure to compute, and changesets'
pre-mode/`pre.json`/normalization machinery would be ceremony at full price for a problem this
repo does not have. See `scripts/version-set.mjs` for the mechanism that replaced it.

⚠️ **This changelog does not ship.** Every package's `files` array is
`["dist", "README.md", "LICENSE", "NOTICE"]`, verified — so unlike `@noy-db/hub`, whose changelog *is* in
its tarball and therefore immutable once published, a mistake here can simply be corrected in
place. Do not apply hub's correct-alongside-in-the-next-entry constraint to this file.

## 0.9.0-pre.0

- Exact dev pins on `@noy-db/hub` and `@noy-db/ports` move `0.9.0-pre.1` → `0.9.0-pre.2`.
  The `@noy-db/hub` peer range already carried `^0.9.0-pre.1` and needs no second append: for a
  0.x caret npm reads that as `>=0.9.0-pre.1 <0.10.0`, so it already admits `0.9.0` stable.
  `^0.9.0-pre.1` rather than `-pre.0` is deliberate — `pre.0` carries core#132 (last-writer-wins
  `_keyring` writes, `TamperedError` on a cold read) and nothing should resolve to it.
- No source change at the new pin: 20 test files / 259 tests, `typecheck` and every gate green.

## 0.8.0

First stable release of the ten-package line under Apache-2.0, published 2026-09-13
(`v0.8.0-pre.0..v0.8.0`). Everything in `0.8.0-pre.0` below ships here unchanged; the only
source change across the two tags is the envelope-body guard described first.

⚠️ **This is a BREAKING release for anyone already on `0.8.0-pre.0`** — not because of anything in
this repo, but because promoting hub `0.8.0-pre.0` → `0.8.0` carries hub's `EncryptedEnvelope` →
`Envelope` rename and the widening of `_iv`/`_data` to optional. `EncryptedEnvelope` survives as an
alias for the whole 0.8 line, so the rename is additive; **the optionality is not.**

### Fixed

- **`on-magic-link` and `on-password` now guard the optional envelope body.** Hub `0.8.0` widens
  `Envelope._data` to optional — an *exclave* capsule stores a plaintext row and writes no
  ciphertext body — so the two places that read `_data` and hand it to `JSON.parse` had to say what
  absence means. `readAuditDoc` treats a bodyless envelope as no audit doc and returns `undefined`;
  `verifyPasswordSlot` treats a bodyless `_keyring` record as unreadable and throws
  `PasswordInvalidError`, the domain error it already uses for every failure to obtain the keyring.
  Hub documents absence and `''` as the same thing, so both guards are a plain falsy check.
  ⛔ **Neither may become hub's `hasSealedBody`**, which tests `_iv`, not `_data`: `_keyring` and
  `_meta` are unencrypted collections whose records carry plaintext JSON in `_data` with `_iv: ''`,
  so it answers false for every valid record. The counter-argument is at both call sites.
  ⚠️ No behaviour changes for an enclave capsule — the guards fire only where there was never a
  body.

### Changed

- **Version only, for the other eight packages.** `0.8.0-pre.0 → 0.8.0` across all ten, with the
  `@noy-db/hub` dev pin and `@noy-db/shamir`'s dependency moving in lockstep. Peer ranges are
  **unchanged**: `^0.7.0 || ^0.7.1-pre.0 || ^0.8.0-pre.0` already admits `0.8.0`, and the floor
  still compiles — verified by the peer-floor gate at `1453dc3`, seven packages typechecked against
  the floor hub, the three that import hub nowhere skipped by name.
- `@noy-db/on-shamir` is published **from this repo** for the first time. `0.7.0` under that name
  was core-published, before the package moved here. Its `@noy-db/shamir` dependency — the family's
  only cross-repo hard `dependency`, and deliberately not a peer — resolves at `^0.8.0-pre.0`.

### Notes

- **Nothing was deprecated by this release** beyond the family-wide `-pre` sweep the root ran at the
  0.8.0 cut. `0.7.0` remains installable and MIT.
- ⚠️ **This section was written on 2026-09-16, three days after the release**, because the rail's
  CHANGELOG gate had no end anchor and `## 0.8.0-pre.0` satisfied its `0.8.0` check
  (`noy-db/family#30`, gate fixed in `noy-db/.github#16`). It is reconstructed from the tag range,
  not from memory.

## 0.8.0-pre.0

Relicensed from MIT to Apache-2.0 from this version on. Earlier versions remain MIT.

### Changed

- **Licence: MIT → Apache-2.0**, for all ten packages. `LICENSE` is now the canonical Apache-2.0
  text with the appendix copyright line completed (`Copyright 2026 vLannaAi`), and each package
  gains a `NOTICE` (`noy-db — Copyright 2026 vLannaAi`) listed in `files`, so both ship in the
  tarball. ⚠️ **A licence change is a version event, never a retro-edit** — `0.7.0`, `0.7.1-pre.0`
  and everything before them stay MIT, and nothing already published is altered. The `LICENSE` link
  in each README moves with the file; the ten `dist/` surfaces are untouched.
- The seven hub-binding packages widen their `@noy-db/hub` peer from
  `^0.7.0 || ^0.7.1-pre.0` to `^0.7.0 || ^0.7.1-pre.0 || ^0.8.0-pre.0` — **appended, never
  replaced**, so consumers still resolving against the 0.7 line are not cut off. (Seven, not six:
  `on-shamir` joined the hub-binding set when it moved here in `0.7.1-pre.0`.)
- Exact dev pins move as a unit to the `0.8.0-pre.0` line: `@noy-db/hub` (×7) and
  `@noy-db/test-ceremony-conformance` (×2).
- `on-shamir`'s `@noy-db/shamir` dependency `^0.7.1-pre.0` → `^0.8.0-pre.0`. ⛔ **The old floor is a
  burned number** — `@noy-db/shamir@0.7.1-pre.0` was unpublished on 2026-09-07 and the name's first
  surviving public version is `0.8.0-pre.0`, so the previous range floored on something npm no
  longer serves.

### Added

- **`on-password` gains a `README.md`.** It was the one package whose `files` listed a README that
  existed on disk nowhere; `@noy-db/on-password@0.7.0` shipped none. (noy-db/on#1)
  ⭐ **On licence text, the tree and the last tarball disagreed, and only the tree was wrong.**
  Nine of ten packages listed `LICENSE` in `files` with no such file in this repo — yet
  `npm pack @noy-db/on-pin@0.7.0 --dry-run` lists a 1.1 kB `LICENSE`, because `0.7.0` was
  published from the monorepo, whose tree had them. The defect was therefore latent: the first
  release cut *from this repo* would have shipped ten tarballs with no licence text at all. It is
  closed here on disk, and `check-license` is what keeps it closed.
- `family.config.json` runs the `check-license` gate, which asserts the `LICENSE`/`NOTICE`/`license`
  triple stays consistent, and `.github/workflows/release.yml` is the release caller: it fires only
  on a GitHub Release a human publishes, so the version is the tag and there is no path to an
  accidental publish.

### Unchanged, deliberately

- **No code change.** No `src/` file is touched in this release; the ten built surfaces are
  identical to `0.7.1-pre.0`.
- **No internal dependency edges were created.** This repo still has none — `version-set.mjs`
  reported `0 internal range(s) updated`, which is why the cut-time deadlock that bit sibling
  repos (a sibling devDep rewritten to a version this very release has yet to publish) cannot
  arise here.

## 0.7.1-pre.0

⭐ **This section is not housekeeping — it is the release payload's only prose.** Under the
doc-sync source contract this repo emits a top-level `changelog` read from the `## <version>`
section here, because it has no per-package `CHANGELOG.md` and a release-scoped narrative cannot
be split across ten packages truthfully. An unwritten section means a payload with no prose at
all, so this is written *before* the cut, never with it.

### Added

- **`@noy-db/on-shamir` moves here from `noy-db`** (ruling lanna-db#10). `shamirRecoveryProvider()`,
  `splitKEK`, `combineKEK` and the `on-*` framing land in this repo; the GF(2^8) math and the share
  codecs became `@noy-db/shamir`, a zero-dependency primitive with no hub contract, published from
  core. This package takes a plain caret dependency on it and re-exports its whole surface, so
  `on-shamir@0.7.0`'s published surface is unchanged — code naming `splitSecret` or
  `encodeShareBase32` keeps compiling.
  - ⭐ **The structural mirror of hub's `NoydbShamir` is deleted, not copied.** It existed because
    hub devDepended on this package for six recovery tests, making a peer edge a turbo build cycle.
    Hub's tests now build a four-line adapter over `@noy-db/shamir` and import this package nowhere,
    so the cycle is gone. `NoydbShamir` is imported as a type from `@noy-db/hub/on`; hub is its sole
    declaration.
  - ⚠️ Its npm name is **not new** — core published it from `0.1.0-pre.3` through `0.7.0`. Only the
    publisher changed, which is why the release payload reports it as `version-only` rather than
    `added`.

### Changed

- The six hub-binding packages, and now `on-shamir`, widen their `@noy-db/hub` peer from `^0.7.0`
  to `^0.7.0 || ^0.7.1-pre.0` — appended, never replaced. `^0.7.0` admits no prerelease of any
  version, so without this the seven cannot resolve against the `0.7.1` pre line at all.

### Added

- **The rewrap ceremonies now document their role in revocation** (#6, noy-db#1445/#1446).
  `passwordSlotRewrapCeremony` and `webAuthnSlotRewrapCeremony` are required INPUTS to hub's
  `revokeAuthenticator` — `removeAuthenticator`, then `rotateKeys` (the step that revokes), then
  `rotateSecret` with a ceremony per REMAINING slot. A remaining slot handed no ceremony is
  **dropped**, and its holder must re-enrol, so revoking one credential means supplying a ceremony
  for every slot you keep — each requiring that credential present. ⚠️ Noted in both blocks:
  `revokeAuthenticator` is in **no published hub** — it landed after `@noy-db/hub@0.7.1-pre.0` was
  cut, so it is in neither `@latest` nor `@next`.

### Fixed

- **Two slot-rewrap TSDoc blocks said `rotateSecret` staled the old DEKs.** It does not: it rewraps
  the SAME DEK values under a freshly-derived KEK, and only `rotateKeys` re-mints values (verified
  against hub's own `rotateSecret` / `RotateKeysOptions` docs). Records are encrypted with DEKs, so
  the sentence read as though a phrase rotation invalidated a captured `wrapped_deks` /
  `wrappedPayload` blob — the opposite of true, and directly misleading next to #6, where the
  captured blob is the whole problem. Corrected in `passwordSlotRewrapCeremony` and
  `webAuthnSlotRewrapCeremony`, with the wrong sentence quoted and marked rather than deleted.
  `unlockWebAuthn`'s "stale DEKs" note now names `rotateKeys` explicitly — the same word doing two
  jobs is what produced the error eighty lines below it.
- **A removed password slot still unlocked** (#6, transferred from noy-db#1427).
  `verifyPasswordSlot` authenticated the slot blob it was handed and never asserted the slot was
  still in the keyring it read three lines later, so a captured blob kept returning a full live DEK
  set after removal. It now refuses an unenrolled slot. ⚠️ **That is hardening, not revocation, and
  the issue stays open for the real fix:** `unwrapDeksWithPassword` is exported, so a blob holder
  reaches the DEKs one call earlier without touching the assertion, and removal rotates nothing, so
  keys already unwrapped stay valid forever. Rotate-on-removal lives in `@noy-db/hub` and is not
  this repo's to land. The TSDoc now states the bearer-credential property plainly.
  ⭐ Two existing tests only passed because the check was absent — they verified a slot no keyring
  had ever heard of. Both now enrol the slot first; the `#1096` roster-forgery row in particular was
  measuring less than its name claimed.
- **CI never ran on stacked PRs** (lanna-db#12). `pull_request: branches: [main]` filters the *base*
  branch, so a PR stacked on another branch matched nothing and no workflow ran — GitHub then
  reports "no checks reported", which renders as pending rather than as an error.
- **Three ported-text defects in `check-architecture.mjs`** (lanna-db#13), all inherited from the
  noy-db-to port and all invisible to a green run, because a gate's failure message is code that
  executes only on failure. The `no-runtime-store-import` message printed a literal `\n  // ` into
  its own text; the `Rule 2` header asserted the `to-only` rule that the note beneath it exists to
  deny; and `no-crypto-deps` explained itself with the wrong threat model ("stores see ciphertext
  only" — an `on-*` package is not a store and legitimately handles key material; it may not take a
  crypto dependency because `@noy-db/hub` owns the primitives). Both wrong reasons are kept and
  marked false rather than deleted.
- Both workflow headers called these packages "storage adapters", inverting the family's prefix
  grammar in the two files a newcomer opens first.

## Unreleased

### Added

- `pnpm version:set <version>` — puts every package on one version in a single act. It does not
  order or compare versions; ordering is npm's job, asked via `check:not-already-published`.
- `pnpm check:versions-uniform` — the guard against a **partial bump**. Asserts one version across
  all nine packages, uniform lockstep `@noy-db/*` ranges, every internal range admitting the common
  version, and every exact dev pin admitted by the peer range declared beside it. Takes
  `--expect <version>` for the release gate. All five assertions are mutation-checked.
- `pnpm check:not-already-published` — asks npm whether the version in the manifests already
  exists. **Fails closed**: exit 0 free, 1 already published, 2 could not determine. A registry
  timeout is never rendered as "the version is free".

### Fixed

- **The release version gate could never pass.** `release.yml` compared the release tag against
  `require('./package.json').version` from the *root* manifest — the lockstep canonical in
  noy-db-to, whose root carries a version. This root is `private` and versionless, so the
  expression yielded the string `"undefined"` and the comparison failed for every possible tag.
  Found before the workflow had ever run. It now asserts the property that matters: every package
  equals the tag.
- **`release.yml` named another repo's packages** in seven places — six `@noy-db/to-aws-s3` and one
  `@noy-db/to-x`, a verbatim paste from noy-db-to. Three were live `GITHUB_STEP_SUMMARY` writes, so
  a release run printed install instructions for a package in a different repo and pointed
  provenance verification at the wrong npm page.
- **An expired justification** on the pre-release routing guard, kept as a record rather than a
  reason. It claimed `@latest` was broken across "all 17 `on-*@0.5.0` versions". Measured: there
  are nine packages here, not 17 (17 is a `to-*` count); `@latest` is `0.7.0`, a stable, on all
  nine; the packument's `deprecated` field is null. The guard stays — it is right for the general
  reason, not the expired one.

## 0.7.0

**Published from `noy-db`, not from this repo.** noy-db cut `0.7.0` for all 57 packages on
2026-09-01 (`1ef894f6`) and removed the `on-*` family immediately afterwards (`22fecc8c`), so these
nine packages shipped at `0.7.0` from core and this repo — extracted at `0.7.0-pre.17` — never
recorded it. npm's registry entries still carry `repository.directory: packages/<pkg>` against
`vLannaAi/noy-db`. A clean handover, not a lost release.

**No code changed.** The published `dist/` is byte-identical across `0.7.0-pre.17`, `0.7.0-pre.18`
and `0.7.0` for all nine packages, and no `src/` file has changed in this repo since extraction.
Only the manifests were behind.

### Changed

- The six hub-binding packages (`on-magic-link`, `on-oidc`, `on-password`, `on-pin`, `on-recovery`,
  `on-webauthn`) narrow their `@noy-db/hub` peer from `^0.7.0-pre.17` to `^0.7.0`, matching what
  published `0.7.0` declares. A prerelease caret is the **wider** range — it reaches forward into
  its stable *and* admits the whole pre line — so keeping it would silently re-widen what `0.7.0`
  narrowed.
- ⚠️ **Do not mix stable and prerelease satellites.** Caret ranges are directional across the
  prerelease boundary: `^0.7.0-pre.18` admits `0.7.0`, but `^0.7.0` excludes `0.7.0-pre.18`. On the
  stable line, use stable satellites throughout.

### Unchanged, deliberately

- `on-email-otp`, `on-threat` and `on-totp` import `@noy-db/hub` nowhere and declare **no hub
  peer**. `check:architecture`'s `hub-peer-range` rule demands a peer only from packages that
  actually import hub, and `check:peer-floor` reports these three as skipped. Forcing a peer a
  package never uses would declare a dependency that is not real — do not let a version sweep
  "helpfully" add one.
