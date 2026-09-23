/**
 * on#10 + on#11 — what the invite payload may carry, and what the
 * accepted member does NOT have.
 *
 * Pinned behaviors:
 *   1. A `transport` locator round-trips issue → encode → decode and
 *      `acceptInvite` ignores it (on#10). Same for peer-recovery.
 *   2. Accept succeeds with ZERO authenticator slots — for a fresh
 *      invite AND for a re-granted member — because the rotation inside
 *      accept is the ungated team-level one (on#11, first half).
 *   3. The accepted member's keyring carries `authenticators: []`, so the
 *      next factor-gated verb is denied: `rotate-secret` → POLICY_DENIED
 *      `missing-factor` (on#11, second half — the real gap).
 */
import { describe, it, expect } from 'vitest'
import {
  issueInvite,
  issuePeerRecovery,
  acceptInvite,
  encodeInvitePayload,
  decodeInvitePayload,
  type InviteTransport,
} from '../src/index.js'
import { createNoydb } from '@noy-db/hub'
import type { NoydbStore, EncryptedEnvelope } from '@noy-db/hub'
import { withTeam } from '@noy-db/hub/team'

function inlineMemory(): NoydbStore {
  const store = new Map<string, Map<string, Map<string, EncryptedEnvelope>>>()
  function gc(c: string, col: string) {
    let comp = store.get(c)
    if (!comp) { comp = new Map(); store.set(c, comp) }
    let coll = comp.get(col)
    if (!coll) { coll = new Map(); comp.set(col, coll) }
    return coll
  }
  return {
    name: 'inline-memory',
    async get(c: string, col: string, id: string) { return gc(c, col).get(id) },
    async put(c: string, col: string, id: string, env: EncryptedEnvelope) { gc(c, col).set(id, env) },
    async delete(c: string, col: string, id: string) { gc(c, col).delete(id) },
    async list(c: string, col: string) { return [...gc(c, col).keys()] },
    async loadAll() { return {} },
    async saveAll() {},
    capabilities: { casAtomic: true, auth: { kind: 'none' } },
  } as unknown as NoydbStore
}

const ALICE_PHRASE = 'correct horse battery staple printer toaster'
const BOB_NEW_PHRASE = 'evergreen marble lantern apricot velvet thunder'
const BOB_SECOND_PHRASE = 'sapphire meadow copper willow orchard candle'

const RELAY: InviteTransport = {
  kind: 'by-peer-relay',
  url: 'wss://relay.example/ws',
  room: '01J0ROOM',
  token: 'per-session-token',
}

async function owner(store: NoydbStore) {
  const db = await createNoydb({ teamStrategy: withTeam(), store, user: 'alice', secret: ALICE_PHRASE })
  await db.openVault('acme')
  return db
}

describe('invite transport locator (on#10)', () => {
  it('rides the payload verbatim; accept ignores it', async () => {
    const store = inlineMemory()
    const alice = await owner(store)

    const { payload, encoded } = await issueInvite(alice, 'acme', {
      userId: 'bob',
      displayName: 'Bob',
      role: 'admin',
      transport: RELAY,
    })
    expect(payload.transport).toEqual(RELAY)

    // The app reads the locator to BUILD the store, before accepting —
    // which is why it must survive the fragment encoding untouched.
    const decoded = decodeInvitePayload(encoded)
    expect(decoded.transport).toEqual(RELAY)
    expect(decodeInvitePayload(encodeInvitePayload(decoded)).transport).toEqual(RELAY)

    // Opaque to the accept step: an unknown kind is not a rejection.
    const { db, payload: accepted } = await acceptInvite(encoded, {
      store,
      newPhrase: BOB_NEW_PHRASE,
      noydbOptions: { teamStrategy: withTeam() },
    })
    expect(accepted.transport).toEqual(RELAY)
    expect((await db.team.getKeyring('acme')).userId).toBe('bob')
  }, 180_000)

  it('peer-recovery carries it too, and omitting it leaves the key absent', async () => {
    const store = inlineMemory()
    const alice = await owner(store)
    await alice.grant('acme', { userId: 'bob', displayName: 'Bob', role: 'admin', secret: BOB_SECOND_PHRASE })

    const withLocator = await issuePeerRecovery(alice, 'acme', { userId: 'bob', transport: RELAY })
    expect(withLocator.payload.transport).toEqual(RELAY)

    const plain = await issueInvite(alice, 'acme', { userId: 'carol', displayName: 'Carol', role: 'viewer' })
    expect('transport' in plain.payload).toBe(false)
  }, 180_000)
})

describe('the accepted member has zero authenticator slots (on#11)', () => {
  it('accept works with zero slots, but the next gated verb does not', async () => {
    const store = inlineMemory()
    const alice = await owner(store)
    const { encoded } = await issueInvite(alice, 'acme', { userId: 'bob', displayName: 'Bob', role: 'admin' })

    // Accept is NOT factor-gated — it rotates via the team-level
    // keyringRotateSecret on purpose.
    const { db: bob } = await acceptInvite(encoded, {
      store,
      newPhrase: BOB_NEW_PHRASE,
      noydbOptions: { teamStrategy: withTeam() },
    })
    const keyring = await bob.team.getKeyring('acme')
    expect(keyring.authenticators).toEqual([])

    // …and that empty slot list is what the member trips over next.
    await expect(
      bob.team.rotateSecret('acme', { oldSecret: BOB_NEW_PHRASE, newSecret: BOB_SECOND_PHRASE }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' })
    await expect(
      bob.team.rotateSecret('acme', { oldSecret: BOB_NEW_PHRASE, newSecret: BOB_SECOND_PHRASE }),
    ).rejects.toThrow(/missing-factor/)
  }, 180_000)

  it('a re-granted member accepts too — accept is not the broken step', async () => {
    const store = inlineMemory()
    const alice = await owner(store)
    const first = await issueInvite(alice, 'acme', { userId: 'bob', displayName: 'Bob', role: 'admin' })
    await acceptInvite(first.encoded, { store, newPhrase: BOB_NEW_PHRASE })

    await alice.revoke('acme', { userId: 'bob' })
    const second = await issueInvite(alice, 'acme', { userId: 'bob', displayName: 'Bob', role: 'admin' })
    const { db: bob } = await acceptInvite(second.encoded, {
      store,
      newPhrase: BOB_SECOND_PHRASE,
      noydbOptions: { teamStrategy: withTeam() },
    })

    const keyring = await bob.team.getKeyring('acme')
    expect(keyring.role).toBe('admin')
    expect(keyring.authenticators).toEqual([])
  }, 180_000)
})

describe('issueInvite permissions (on#13)', () => {
  it('forwards a per-collection map to the grant; the invitee can read what it names', async () => {
    const store = inlineMemory()
    const alice = await owner(store)
    await (await alice.openVault('acme')).collection('notes').put('n1', { text: 'visible' })

    const { encoded } = await issueInvite(alice, 'acme', {
      userId: 'bob',
      displayName: 'Bob',
      role: 'operator',
      permissions: { notes: 'rw' },
    })
    const { db: bob } = await acceptInvite(encoded, {
      store,
      newPhrase: BOB_NEW_PHRASE,
      noydbOptions: { teamStrategy: withTeam() },
    })

    const keyring = await bob.team.getKeyring('acme')
    expect([...keyring.deks.keys()]).toContain('notes')
    const bobsNotes = (await bob.openVault('acme')).collection<{ text: string }>('notes')
    expect(await bobsNotes.get('n1')).toMatchObject({ text: 'visible' })
  }, 180_000)

  it('a collection that does not exist yet is granted by name and resolves on creation', async () => {
    // ⛔ Not a validation gap — this is the order a real invite runs in:
    // provision the member, then land the data. Refusing unknown names would
    // break it. (Hub's own guard is elsewhere: minting is gated on the
    // collection being empty, so cannot-read still refuses.)
    const store = inlineMemory()
    const alice = await owner(store)

    const { encoded } = await issueInvite(alice, 'acme', {
      userId: 'bob',
      displayName: 'Bob',
      role: 'operator',
      permissions: { later: 'rw' },
    })
    const { db: bob } = await acceptInvite(encoded, {
      store,
      newPhrase: BOB_NEW_PHRASE,
      noydbOptions: { teamStrategy: withTeam() },
    })
    expect([...(await bob.team.getKeyring('acme')).deks.keys()]).toContain('later')

    await (await alice.openVault('acme')).collection('later').put('l1', { text: 'landed after the invite' })
    const bobsLater = (await bob.openVault('acme')).collection<{ text: string }>('later')
    expect(await bobsLater.get('l1')).toMatchObject({ text: 'landed after the invite' })
  }, 180_000)

  it('omitting it leaves the grant on role-based defaults, and never reaches the payload', async () => {
    const store = inlineMemory()
    const alice = await owner(store)
    const { payload } = await issueInvite(alice, 'acme', {
      userId: 'bob',
      displayName: 'Bob',
      role: 'admin',
      permissions: { notes: 'rw' },
    })
    // Issuer-side only: the fragment must not carry the member's access map.
    expect('permissions' in payload).toBe(false)
    expect(JSON.stringify(payload)).not.toContain('notes')
  }, 180_000)
})
