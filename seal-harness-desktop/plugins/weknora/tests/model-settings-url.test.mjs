import assert from 'node:assert/strict'
import test from 'node:test'
import { apiKeySettingsUrl, modelSettingsUrl } from '../src/model-settings-url.js'

test('opens the WeKnora model settings on the configured origin', () => {
  assert.equal(modelSettingsUrl('https://kb.example.com/api/v1/'), 'https://kb.example.com/platform/settings?section=models')
  assert.equal(modelSettingsUrl('http://localhost:80'), 'http://localhost/platform/settings?section=models')
})

test('rejects unsafe or invalid service addresses', () => {
  assert.throws(() => modelSettingsUrl('javascript:alert(1)'), /http/)
  assert.throws(() => modelSettingsUrl('weknora.local'), /Invalid URL/)
})

test('opens WeKnora tenant API key management on the configured origin', () => {
  assert.equal(apiKeySettingsUrl('http://localhost'), 'http://localhost/platform/settings?section=integration-api')
})
