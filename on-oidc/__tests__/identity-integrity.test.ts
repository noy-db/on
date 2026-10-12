/**
 * family#125 — the reconstructed keyring payload is authenticated.
 *
 * The key-connector receives the ID token as its Bearer credential, so it can
 * derive the transport AES-GCM key and re-encrypt any serverHalf it likes.
 * XOR is bit-malleable: flipping a serverHalf byte flips the same byte of the
 * reconstructed payload (`'ro'` → `'rw'` is a known-offset edit). The only
 * defence is a tag the connector cannot compute — HMAC under a key derived
 * from the device secret, which never leaves the partition.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { bufferToBase64, base64ToBuffer, type UnlockedKeyring } from '@noy-db/hub'
import {
  enrollOidc,
  unlockOidc,
  OidcEnrollmentIntegrityError,
  type OidcEnrollment,
  type OidcProviderConfig,
} from '../src/index.js'

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeIdToken(sub = 'integrity-user'): string {
  const now = Math.floor(Date.now() / 1000)
  return `${b64url({ alg: 'RS256' })}.${b64url({ sub, iss: 'https://test.example.com', aud: 'client-test', iat: now, exp: now + 3600 })}.sig`
}

async function makeKeyring(): Promise<UnlockedKeyring> {
  const dek = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  return {
    userId: 'alice',
    displayName: 'Alice',
    role: 'viewer',
    permissions: { invoices: 'ro' },
    authenticators: [],
    deks: new Map([['invoices', dek]]),
    kek: null,
    salt: new Uint8Array(32).fill(9),
  }
}

const CONFIG: OidcProviderConfig = {
  name: 'TestProvider',
  issuer: 'https://test.example.com',
  clientId: 'client-test',
  keyConnectorUrl: 'https://kc.example.com',
}

/** What a connector holding the Bearer token can do: the same HKDF the client uses. */
async function transportKey(idToken: string): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle
  const ikm = await subtle.importKey('raw', new TextEncoder().encode(idToken), 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('noydb-oidc-transport-encrypt-v1'),
      info: new TextEncoder().encode('key-connector-put'),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * A key-connector that, once `tamper` is set, decrypts the stored serverHalf
 * with the token, applies the edit, and re-encrypts before answering a GET —
 * a compromised connector, not a corrupted one: GCM verifies on the client.
 */
function makeConnector() {
  let stored: { encryptedServerHalf: string; iv: string } | null = null
  const state: { tamper: ((serverHalf: Uint8Array) => void) | null } = { tamper: null }
  const mockFetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'PUT') {
      stored = JSON.parse(init?.body as string)
      return new Response('{}', { status: 200 })
    }
    if (!stored) return new Response('Not found', { status: 404 })
    if (!state.tamper) return new Response(JSON.stringify(stored), { status: 200 })
    const token = (init?.headers as Record<string, string>).Authorization!.slice('Bearer '.length)
    const key = await transportKey(token)
    const serverHalf = new Uint8Array(await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBuffer(stored.iv) }, key, base64ToBuffer(stored.encryptedServerHalf),
    ))
    state.tamper(serverHalf)
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
    const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, serverHalf)
    return new Response(JSON.stringify({ encryptedServerHalf: bufferToBase64(ct), iv: bufferToBase64(iv) }), { status: 200 })
  })
  return { mockFetch, state }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('family#125 — reconstructed identity integrity', () => {
  it('positive control: an untampered fragment still unlocks', async () => {
    const { mockFetch } = makeConnector()
    vi.stubGlobal('fetch', mockFetch)
    const token = makeIdToken()
    const enrollment = await enrollOidc(await makeKeyring(), 'company-a', CONFIG, token)
    expect(typeof enrollment.integrityTag).toBe('string')

    const unlocked = await unlockOidc(enrollment, CONFIG, token)
    expect(unlocked.permissions).toEqual({ invoices: 'ro' })
    expect(unlocked.role).toBe('viewer')
  })

  it("a connector rewriting 'ro' → 'rw' by a known-offset XOR flip is refused, typed", async () => {
    const { mockFetch, state } = makeConnector()
    vi.stubGlobal('fetch', mockFetch)
    const token = makeIdToken()
    const keyring = await makeKeyring()
    const enrollment = await enrollOidc(keyring, 'company-a', CONFIG, token)

    // The field order is fixed, so the offset of `"ro"` in the payload is
    // computable without any key: o (0x6f) ⊕ w (0x77) = 0x18.
    const probe = JSON.stringify({ userId: 'alice', displayName: 'Alice', role: 'viewer', permissions: { invoices: 'ro' } })
    const offset = probe.indexOf('"ro"') + 2
    state.tamper = (serverHalf) => { serverHalf[offset]! ^= 0x18 }

    const failure = await unlockOidc(enrollment, CONFIG, token).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(OidcEnrollmentIntegrityError)
    expect((failure as OidcEnrollmentIntegrityError).reason).toBe('tampered')
  })

  it('a single flipped byte anywhere is refused, typed — never a raw SyntaxError', async () => {
    const { mockFetch, state } = makeConnector()
    vi.stubGlobal('fetch', mockFetch)
    const token = makeIdToken()
    const enrollment = await enrollOidc(await makeKeyring(), 'company-a', CONFIG, token)
    state.tamper = (serverHalf) => { serverHalf[0]! ^= 0x01 }

    await expect(unlockOidc(enrollment, CONFIG, token)).rejects.toBeInstanceOf(OidcEnrollmentIntegrityError)
  })

  it('an enrollment record without a tag (pre-#125) is refused, pointing at re-enrollment', async () => {
    const { mockFetch } = makeConnector()
    vi.stubGlobal('fetch', mockFetch)
    const token = makeIdToken()
    const enrollment = await enrollOidc(await makeKeyring(), 'company-a', CONFIG, token)
    const { integrityTag: _dropped, ...legacy } = enrollment

    const failure = await unlockOidc(legacy as OidcEnrollment, CONFIG, token).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(OidcEnrollmentIntegrityError)
    expect((failure as OidcEnrollmentIntegrityError).reason).toBe('legacy-enrollment')
    expect((failure as Error).message).toMatch(/re-invite/)
  })

  it("a tag minted for another vault does not verify (the vault is in the MAC key's info)", async () => {
    const { mockFetch } = makeConnector()
    vi.stubGlobal('fetch', mockFetch)
    const token = makeIdToken()
    const enrollment = await enrollOidc(await makeKeyring(), 'company-a', CONFIG, token)
    // Device material is stored per vault (family#126); copy company-a's
    // secret into company-b's slot so the unlock reaches the MAC check.
    const secret = localStorage.getItem('noydb:oidc:device-secret:TestProvider:integrity-user:company-a')!
    localStorage.setItem('noydb:oidc:device-secret:TestProvider:integrity-user:company-b', secret)

    await expect(
      unlockOidc({ ...enrollment, vault: 'company-b' }, CONFIG, token),
    ).rejects.toBeInstanceOf(OidcEnrollmentIntegrityError)
  })
})
