import { describe, expect, it } from 'vitest'
import {
  initialLockoutState,
  recordFailure,
  recordSuccess,
  isLocked,
  enrollDuress,
  checkDuress,
  enrollHoneypot,
  checkHoneypot,
} from '../src/index.js'

describe('lockout policy', () => {
  it('initial state is unlocked with no failures', () => {
    const s = initialLockoutState()
    expect(s.failures).toBe(0)
    expect(s.lockedUntil).toBeNull()
    expect(isLocked(s)).toBe(false)
  })

  it('accumulates failures up to threshold without locking', () => {
    const s = initialLockoutState()
    for (let i = 0; i < 4; i++) {
      const r = recordFailure(s, { threshold: 5 })
      expect(r.locked).toBe(false)
      expect(r.remainingAttempts).toBe(4 - i)
    }
  })

  it('locks on the threshold-th failure with unlockAt', () => {
    const s = initialLockoutState()
    for (let i = 0; i < 4; i++) recordFailure(s, { threshold: 5, cooldownMs: 1000 })
    const trip = recordFailure(s, { threshold: 5, cooldownMs: 1000 })
    expect(trip.locked).toBe(true)
    expect(trip.unlockAt).toBeTruthy()
    expect(s.strikes).toBe(1)
  })

  it('isLocked returns true during cooldown', () => {
    const s = initialLockoutState()
    for (let i = 0; i < 5; i++) recordFailure(s, { threshold: 5, cooldownMs: 10_000 })
    expect(isLocked(s)).toBe(true)
  })

  it('recordSuccess resets window + failures but latches strikes', () => {
    const s = initialLockoutState()
    for (let i = 0; i < 5; i++) recordFailure(s, { threshold: 5, cooldownMs: 1 })
    // Wait past the (1ms) cooldown
    s.lockedUntil = new Date(Date.now() - 1000).toISOString()
    recordSuccess(s)
    expect(s.failures).toBe(0)
    expect(s.lockedUntil).toBeNull()
    expect(s.strikes).toBe(1) // latched
  })

  it('tripping maxStrikes signals wipe', () => {
    const s = initialLockoutState()
    const cfg = { threshold: 2, cooldownMs: 1, maxStrikes: 2 }
    // First strike
    recordFailure(s, cfg); recordFailure(s, cfg)
    // Simulate cooldown expiry + second round
    s.lockedUntil = new Date(Date.now() - 1000).toISOString()
    recordFailure(s, cfg)
    const wipe = recordFailure(s, cfg)
    expect(wipe.wipe).toBe(true)
    expect(s.wiped).toBe(true)
    expect(isLocked(s)).toBe(true) // wiped implies locked forever
  })
})

describe('duress secret', () => {
  it('enroll returns distinct digest + salt', async () => {
    const a = await enrollDuress('help!')
    const b = await enrollDuress('help!')
    expect(a.digest).not.toBe(b.digest) // different salts → different digests
    expect(a.salt).not.toBe(b.salt)
    expect(a.digest).toHaveLength(64)
    expect(a.salt).toHaveLength(32)
  })

  it('check returns true for the enrolled secret', async () => {
    const { digest, salt } = await enrollDuress('help me please')
    expect(await checkDuress('help me please', digest, salt)).toBe(true)
  })

  it('check returns false for a different secret', async () => {
    const { digest, salt } = await enrollDuress('help me please')
    expect(await checkDuress('wrong', digest, salt)).toBe(false)
  })

  it('check is case-sensitive', async () => {
    const { digest, salt } = await enrollDuress('SecretPhrase')
    expect(await checkDuress('secretphrase', digest, salt)).toBe(false)
  })
})

describe('honeypot secret', () => {
  it('shares the same detection primitives as duress', async () => {
    expect(enrollHoneypot).toBe(enrollDuress)
    expect(checkHoneypot).toBe(checkDuress)
  })

  it('detects the honeypot secret correctly', async () => {
    const { digest, salt } = await enrollHoneypot('the decoy key')
    expect(await checkHoneypot('the decoy key', digest, salt)).toBe(true)
    expect(await checkHoneypot('something else', digest, salt)).toBe(false)
  })
})

/**
 * ⛔ CHARACTERIZATION, AND THE ANSWER TO noy-db/on#5's FIRST CASE.
 *
 * Every bound this package enforces lives in the caller-held `LockoutState`
 * and is applied by MUTATING it, so an adversary holding a pristine copy is
 * bound by none of them — the same mechanism as `on-pin` (noy-db/on#2).
 *
 * ⚠️ BUT THE VERDICT IS NOT THE SAME, and that is the point of #5. For
 * `on-pin` the copy-holder already possesses the wrapped DEKs; reverting buys
 * them a session they could largely reach anyway, and tier 3 is documented as
 * a convenience. Here the state IS the enforcement mechanism, and the party
 * who can revert it is exactly the adversary the package exists to resist.
 * Reverting does not extend a convenience — it removes the control.
 *
 * ⭐ So these tests are NOT a demand for a trusted counter. `on-threat` is
 * pure logic and cannot have one. They pin the boundary so the DOCUMENTED
 * CUSTODY GUIDANCE cannot drift away from what the code can enforce, which is
 * the half that was wrong: the interface doc used to say "caller stores this
 * next to the keyring", i.e. exactly where the adversary is.
 */
describe('a pristine copy of LockoutState defeats every bound (#5)', () => {
  const tripThreshold = { threshold: 2, maxStrikes: 2 }

  it('reverting resets the failure counter, so brute-force lockout is undone', () => {
    const state = initialLockoutState()
    const captured = { ...state }

    recordFailure(state, tripThreshold)
    recordFailure(state, tripThreshold)
    expect(isLocked(state)).toBe(true)

    // The adversary restores their copy and the budget is back.
    expect(captured.failures).toBe(0)
    expect(isLocked(captured)).toBe(false)
  })

  it('reverting also undoes `strikes`, which recordSuccess deliberately preserves', () => {
    // `recordSuccess` keeps strikes on purpose — "a successful unlock doesn't
    // erase the history that the keyring was under attack". That history is
    // only as durable as the storage the adversary controls.
    const state = initialLockoutState()
    const captured = { ...state }
    recordFailure(state, tripThreshold)
    recordFailure(state, tripThreshold)
    recordSuccess(state)
    expect(state.strikes).toBeGreaterThan(0)
    expect(captured.strikes).toBe(0)
  })

  it('reverting clears the terminal `wiped` latch', () => {
    // `wiped` "latches to true until explicitly reset". A copy is a reset.
    const state = initialLockoutState()
    const captured = { ...state }
    for (let i = 0; i < 8; i++) recordFailure(state, { threshold: 1, maxStrikes: 1, cooldownMs: 0 })
    expect(state.wiped).toBe(true)
    expect(captured.wiped).toBe(false)
  })
})

/**
 * ⭐ THE HALF OF noy-db/on#5 THIS PACKAGE CAN OWN.
 *
 * `on-threat`'s stated goal is a plausible-deniability model, and the property
 * that matters is that an observer cannot tell WHICH secret was entered. Most
 * of that lives in the caller — this package only detects — but one part is
 * squarely here: `checkDuress` must take the same time whether it matches,
 * misses, or is handed a one-character input.
 *
 * Measured 2026-09-17: match 22.0ms, miss 22.4ms, 1-char miss 22.0ms. It holds
 * because PBKDF2-SHA256 at 200k iterations dominates and runs unconditionally,
 * and the comparison is `constantTimeEqual`.
 *
 * ⚠️ THE BOUND IS DELIBERATELY LOOSE (3x), and that is not laziness. A tight
 * bound turns runner noise into a flaky gate, which gets muted, which is worse
 * than no test. The regression actually worth catching is CATASTROPHIC, not
 * marginal: an early return placed BEFORE the KDF — a length pre-check, a
 * cheap `!==` guard — collapses one path to ~0ms and blows a 3x bound by an
 * order of magnitude. Marginal timing analysis is not what this test is for.
 */
describe('checkDuress does not leak the match by timing (#5)', () => {
  it('takes comparable time to match, to miss, and to reject a 1-char input', async () => {
    const { digest, salt } = await enrollDuress('the-duress-phrase')
    const time = async (input: string, n = 6): Promise<number> => {
      const t0 = performance.now()
      for (let i = 0; i < n; i++) await checkDuress(input, digest, salt)
      return (performance.now() - t0) / n
    }

    await time('warmup', 2)
    const match = await time('the-duress-phrase')
    const miss = await time('some-other-phrase')
    const shortMiss = await time('x')

    // A path that skipped the KDF would be ~0ms and fail these by 10x or more.
    expect(match).toBeGreaterThan(0)
    expect(miss / match).toBeLessThan(3)
    expect(match / miss).toBeLessThan(3)
    expect(shortMiss / match).toBeLessThan(3)
    expect(match / shortMiss).toBeLessThan(3)
  }, 60_000)
})

