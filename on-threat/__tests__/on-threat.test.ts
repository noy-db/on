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

