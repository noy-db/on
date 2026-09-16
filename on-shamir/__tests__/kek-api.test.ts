import { describe, expect, it } from 'vitest'
import { combineKEK, splitKEK } from '../src/index.js'

async function freshKEK(extractable = true): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  )
}

async function assertSameKey(original: CryptoKey, candidate: CryptoKey): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode('shamir-equivalence-probe')
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    original,
    plaintext as BufferSource,
  )
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    candidate,
    ct,
  )
  expect(new TextDecoder().decode(pt)).toBe('shamir-equivalence-probe')
}

describe('splitKEK + combineKEK', () => {
  it('k=2 n=3 — any 2 shares reconstruct a functionally-equivalent KEK', async () => {
    const kek = await freshKEK()
    const shares = await splitKEK(kek, { k: 2, n: 3 })
    expect(shares).toHaveLength(3)

    // Any combination of 2 shares reconstructs
    for (const pair of [[0, 1], [0, 2], [1, 2]] as const) {
      const [i, j] = pair
      const reconstructed = await combineKEK([shares[i]!, shares[j]!])
      await assertSameKey(kek, reconstructed)
    }
  })

  it('k=3 n=5 — reconstructs from any 3', async () => {
    const kek = await freshKEK()
    const shares = await splitKEK(kek, { k: 3, n: 5 })
    const reconstructed = await combineKEK([shares[0]!, shares[2]!, shares[4]!])
    await assertSameKey(kek, reconstructed)
  })

  it('returns a non-extractable KEK', async () => {
    const kek = await freshKEK()
    const shares = await splitKEK(kek, { k: 2, n: 3 })
    const reconstructed = await combineKEK([shares[0]!, shares[1]!])
    // Attempting to export raw should fail — reconstructed key is non-extractable.
    await expect(crypto.subtle.exportKey('raw', reconstructed)).rejects.toThrow()
  })

  it('rejects insufficient shares at combine time', async () => {
    const kek = await freshKEK()
    const shares = await splitKEK(kek, { k: 3, n: 5 })
    await expect(combineKEK([shares[0]!, shares[1]!])).rejects.toThrow(/insufficient shares/)
  })
})

/**
 * ⛔ CHARACTERIZATION, NOT ASPIRATION (noy-db/family#29). A share carries
 * `v/x/k/n/y` and NOTHING identifying which secret it splits, so nothing in
 * this package can tell shares of one split from shares of another.
 * `combineSecret` validates non-empty, >= k, equal lengths and distinct x —
 * never common provenance. ⚠️ The guard that READS as covering this,
 * "share lengths disagree — incompatible enrollment", fires only when the
 * secret LENGTHS differ, so two 32-byte KEKs from different generations never
 * trip it.
 *
 * ⭐ A per-split random tag COULD close this, and its absence is a CHOICE:
 * such a tag is a linkability handle across holders who are deliberately
 * uncoordinated. So these tests pin the hazard rather than demand a fix — if
 * someone ever adds identity, they turn red and the linkability trade gets
 * made on purpose.
 */
describe('mixed-generation shares combine silently into a useless key', () => {
  it('K shares from one split return that split\'s KEK — the baseline', async () => {
    const kek = await freshKEK()
    const shares = await splitKEK(kek, { k: 2, n: 3 })
    await assertSameKey(kek, await combineKEK([shares[0]!, shares[1]!]))
  })

  it('shares from DIFFERENT splits do not throw — they import as a valid AES-GCM key', async () => {
    const kekA = await freshKEK()
    const kekB = await freshKEK()
    const a = await splitKEK(kekA, { k: 2, n: 3 })
    const b = await splitKEK(kekB, { k: 2, n: 3 })

    // No error. This is the whole hazard: a partial redistribution after a KEK
    // rotation hands the holder something that LOOKS like a recovered key.
    const frankenKey = await combineKEK([a[0]!, b[1]!])
    expect(frankenKey.type).toBe('secret')
    expect(frankenKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
  })

  it('…and that key decrypts nothing — it fails later, looking like data corruption', async () => {
    const kekA = await freshKEK()
    const kekB = await freshKEK()
    const a = await splitKEK(kekA, { k: 2, n: 3 })
    const b = await splitKEK(kekB, { k: 2, n: 3 })
    const frankenKey = await combineKEK([a[0]!, b[1]!])

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      kekA,
      new TextEncoder().encode('written under the old KEK') as BufferSource,
    )

    // The failure surfaces at USE, arbitrarily far from the recombination.
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, frankenKey, ct),
    ).rejects.toBeTruthy()
  })
})
