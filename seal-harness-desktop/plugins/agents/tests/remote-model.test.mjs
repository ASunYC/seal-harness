import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { AutonomousRemoteService } from '../stratex/main/services/autonomous-remote-service.js'
import { WorkflowRemoteService } from '../stratex/main/services/workflow-remote-service.js'

test('both SSH deployment services pass keyless public and loopback model URLs while rejecting malformed URLs', async () => {
  for (const baseUrl of ['https://models.example/v1', 'http://localhost:8000/v1', 'http://127.0.0.1:8000/v1', 'http://[::1]:8000/v1', 'not a URL']) {
    const model = { model: 'public-model', baseUrl, protocol: 'chat-completions' }
    for (const Service of [AutonomousRemoteService, WorkflowRemoteService]) {
      let catalog = { records: [], credentials: {}, operation: null, history: [] }, deployedModel
      const service = new Service({
        store: {
          read: async () => catalog,
          write: async (_actor, next) => { catalog = next },
          update: async (_actor, update) => { catalog = update(catalog) },
          saveCredential: async () => 'ssh-credential',
        },
        resolveModel: async () => model,
        runtime: {
          check: async () => {},
          deploy: async (_input, _id, selectedModel) => { deployedModel = selectedModel; return { version: 'fixture', images: [] } },
        },
      })
      const creation = service.create('fixture-actor', { requestId: randomUUID(), name: '公开模型', host: 'remote.example', sshPort: 22, username: 'fixture', password: 'fixture', port: 3000, viewerPort: 3001, model: { connectionId: 'public', remoteModelId: 'public-model' } })
      if (baseUrl === 'not a URL') {
        await assert.rejects(creation)
        assert.equal(deployedModel, undefined)
        continue
      }
      await creation
      assert.deepEqual(deployedModel, model)
      assert.equal(catalog.records[0].installed, true)
    }
  }
})
