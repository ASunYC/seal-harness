import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

// 复用 DSH 凭据存储保存加密密钥；部署服务仍使用来源的原子目录写入。
export async function createEncryption(credentials) {
  const key = credentialKey('seal-harness-agents', 'deployment-storage')
  await credentials.modifyRecord(key, current => current ?? { kind: 'api-key', key: randomBytes(32).toString('base64') })
  const record = await credentials.readRecord(key)
  if (record?.kind !== 'api-key' || !record.key) throw new Error('智能体部署凭据不可用。')
  const secret = Buffer.from(record.key, 'base64')
  if (secret.length !== 32) throw new Error('智能体部署存储密钥无效。')
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, nonce)
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes])
    },
    decryptString(value) {
      const cipher = createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
}
