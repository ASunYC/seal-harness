import test from 'node:test'
import assert from 'node:assert/strict'
import { CapabilityBackend } from '../src/backend.js'

test('local session token is never sent to a configured remote registry', async () => {
  let calls = 0
  const backend = new CapabilityBackend({
    backendUrl: 'https://registry.example/',
    getIdentity: () => ({ getSession: () => ({ accountId: 'local-user', epoch: 1, accessToken: 'local-only-secret', local: true }) }),
    fetchImpl: async () => { calls++; throw new Error('network call must not occur') },
  })
  await assert.rejects(backend.exchange('assets'), error => error.code === 'remoteAuthenticationUnavailable')
  assert.equal(calls, 0)
})
