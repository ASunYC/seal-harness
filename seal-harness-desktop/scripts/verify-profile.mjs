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
// 上游按数量选择单复数（'1 entry did not activate' / 'N entries did not activate'），
// 只匹配复数会漏掉恰好一个条目未激活的情况。必需条目的失败已由上面的退出码覆盖，
// 这里专门捕获可选条目未激活的警告。
assert.doesNotMatch(result.stdout + result.stderr, /did not activate/, '产品插件存在未激活条目')
