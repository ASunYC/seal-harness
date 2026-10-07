import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { desktop } from './build.mjs'

// 上游允许可选插件未激活；产品组合中的业务插件必须全部激活。
const result = spawnSync(process.execPath, [join(desktop, 'scripts/verify-profile-boot.mjs')], { encoding: 'utf8', env: process.env })
if (result.error) throw result.error
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
assert.equal(result.status, 0, '产品 Profile 启动检查失败')
assert.doesNotMatch(result.stdout + result.stderr, /entries did not activate/, '产品插件存在未激活条目')
