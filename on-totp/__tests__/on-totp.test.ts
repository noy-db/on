import { describe, expect, it } from 'vitest'
import {
  encodeBase32,
  decodeBase32,
  generateTotpSecret,
  totpProvisioningUri,
  generateTotpCode,
  verifyTotp,
} from '../src/index.js'

describe('base32', () => {
  it('round-trips random bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const encoded = encodeBase32(bytes)
    const decoded = decodeBase32(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(bytes))
  })

  it('accepts whitespace + lowercase + padding on input', () => {
    const bytes = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])
    const encoded = encodeBase32(bytes).toLowerCase()
    const spaced = encoded.slice(0, 3) + ' ' + encoded.slice(3) + '=='
    expect(Array.from(decodeBase32(spaced))).toEqual(Array.from(bytes))
  })

  it('rejects invalid characters', () => {
    expect(() => decodeBase32('INVALID!')).toThrow(/Invalid Base32/)
  })
})

describe('generateTotpSecret', () => {
  it('produces a 32-character Base32 string (20 bytes)', () => {
    const secret = generateTotpSecret()
    expect(secret).toHaveLength(32)
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
  })

  it('produces unique secrets', () => {
    const set = new Set(Array.from({ length: 20 }, () => generateTotpSecret()))
    expect(set.size).toBe(20)
  })
})

describe('totpProvisioningUri', () => {
  it('builds a standard otpauth:// URI', () => {
    const uri = totpProvisioningUri('JBSWY3DPEHPK3PXP', {
      account: 'alice@example.com',
      issuer: 'Acme',
    })
    expect(uri).toMatch(/^otpauth:\/\/totp\/Acme:alice%40example\.com\?/)
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain('issuer=Acme')
    expect(uri).toContain('algorithm=SHA1')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })

  it('omits issuer when absent', () => {
    const uri = totpProvisioningUri('JBSWY3DPEHPK3PXP', { account: 'alice' })
    expect(uri).not.toContain('issuer=')
    expect(uri).toMatch(/^otpauth:\/\/totp\/alice\?/)
  })
})

/**
 * RFC 6238 Appendix B's SHA1 seed, verbatim: the ASCII string
 * "12345678901234567890". Module-scoped because the window test below needs
 * the same external vectors.
 */
const SECRET_SHA1 = encodeBase32(new TextEncoder().encode('12345678901234567890'))

describe('RFC 6238 test vectors', () => {

  it('vector @ T=59s matches 94287082 (SHA1, 8 digits)', async () => {
    const ok = await verifyTotp(SECRET_SHA1, '94287082', {
      digits: 8,
      timestamp: 59,
      window: 0,
    })
    expect(ok).toBe(true)
  })

  it('vector @ T=1111111109s matches 07081804 (SHA1, 8 digits)', async () => {
    const ok = await verifyTotp(SECRET_SHA1, '07081804', {
      digits: 8,
      timestamp: 1111111109,
      window: 0,
    })
    expect(ok).toBe(true)
  })

  /**
   * ⭐ THE REST OF RFC 6238 APPENDIX B (SHA1), noy-db/on#3. These vectors are
   * the only EXTERNAL-AUTHOR verification this package can have: the digits
   * come from the IETF, not from whoever wrote the implementation, so unlike
   * the rest of this suite they cannot share a blind spot with the code. Two
   * of the six were present; the other four are here because a partial vector
   * set looks exactly like a complete one.
   */
  it.each([
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('vector @ T=%is matches %s (SHA1, 8 digits)', async (timestamp, expected) => {
    const ok = await verifyTotp(SECRET_SHA1, expected, { digits: 8, timestamp, window: 0 })
    expect(ok).toBe(true)
  })
})

describe('verifyTotp', () => {
  it('accepts the current window code', async () => {
    const secret = generateTotpSecret()
    const code = await generateTotpCode(secret)
    expect(await verifyTotp(secret, code)).toBe(true)
  })

  it('rejects malformed codes of wrong length', async () => {
    const secret = generateTotpSecret()
    expect(await verifyTotp(secret, '12345')).toBe(false)
    expect(await verifyTotp(secret, '1234567')).toBe(false)
  })

  it('rejects wrong codes', async () => {
    const secret = generateTotpSecret()
    expect(await verifyTotp(secret, '000000')).toBe(false)
    expect(await verifyTotp(secret, '999999')).toBe(false)
  })

  /**
   * ⛔ THIS TEST USED TO ASSERT `expect(true).toBe(true)`. It built a `'dummy'`
   * promise, voided every value it computed, and its comment said the window
   * was "covered implicitly by RFC vectors" — which it was not: every vector
   * runs at `window: 0`. A vacuous test is worse than a missing one, because
   * the suite reports it as coverage.
   *
   * It was vacuous for a real reason: `generateTotpCode` takes `TotpOptions`,
   * which has NO `timestamp`, so a code cannot be generated at an arbitrary
   * step — only `verifyTotp` can override the clock. An RFC vector closes that
   * gap from the other side: 94287082 is the code for step 1 (T=59), so
   * verifying it at T=89 (step 2) exercises exactly the ±1 tolerance.
   */
  it('accepts a neighbouring step with the default ±1 window, and refuses it at window=0', async () => {
    // period 30 ⇒ T=59 is step 1, T=89 is step 2, T=29 is step 0.
    const oneStepLater = { digits: 8, timestamp: 89 } as const
    expect(await verifyTotp(SECRET_SHA1, '94287082', { ...oneStepLater, window: 1 })).toBe(true)
    expect(await verifyTotp(SECRET_SHA1, '94287082', { ...oneStepLater, window: 0 })).toBe(false)

    // …and symmetrically, one step early.
    const oneStepEarlier = { digits: 8, timestamp: 29 } as const
    expect(await verifyTotp(SECRET_SHA1, '94287082', { ...oneStepEarlier, window: 1 })).toBe(true)
    expect(await verifyTotp(SECRET_SHA1, '94287082', { ...oneStepEarlier, window: 0 })).toBe(false)
  })

  it('rejects codes outside window=0', async () => {
    const secret = encodeBase32(new TextEncoder().encode('12345678901234567890'))
    // RFC vector at T=59 is 287082. Verify at T=91 (different step) with window=0.
    const ok = await verifyTotp(secret, '287082', { digits: 8, timestamp: 91, window: 0 })
    expect(ok).toBe(false)
  })
})
