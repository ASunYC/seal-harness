const { createRequire } = require('node:module')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const desktop = process.argv[2]
const fromDesktop = createRequire(join(desktop, 'package.json'))
const appBoot = fromDesktop.resolve('@deepseek-ai/dsh-app-boot')

import(pathToFileURL(appBoot).href).then(({ readPluginMeta }) => {
  const parentURL = pathToFileURL(join(desktop, 'package.json')).href
  const metadata = readPluginMeta('@deepseek-ai/dsh-experimental-agent-team-profile', parentURL)
  if (metadata?.error || metadata?.title === undefined || metadata.icon === undefined) {
    throw new Error(metadata?.error ?? 'Experimental plugin metadata is incomplete')
  }
  console.log('resolver-ready')
}).catch(error => { console.error(error); process.exitCode = 1 })
