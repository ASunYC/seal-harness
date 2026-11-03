import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'tsdown'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { apply as applyHost } from '../src/index.js'

test('actual Office panel creates, edits, imports and exports through authenticated local RPC',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'seal-office-ui-'));t.after(()=>rm(temp,{recursive:true,force:true}))
  await build({config:false,cwd:fileURLToPath(new URL('..',import.meta.url)),entry:{client:'src/client.jsx'},outDir:join(temp,'ui'),format:'cjs',platform:'browser',target:'es2022',dts:false,deps:{neverBundle:[/^react(?:-dom)?(?:\/|$)/]},define:{'process.env.NODE_ENV':JSON.stringify('production')},outputOptions:{entryFileNames:'client.cjs'}})
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>',{url:'http://localhost'})
  const oldWindow=globalThis.window,oldDocument=globalThis.document
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const root=createRoot(document.getElementById('app')),disposers=[],listeners=new Set(),routes=new Map(),provided=new Map(),panels=[]
  let status={accountId:'account-a',epoch:1},downloaded=''
  const identity={getSession:()=>status,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)}}
  const context={connection:{fetch:{register:route=>routes.set(route.path,route)}},sealHarnessIdentity:identity,sealHarnessDatabase:{path:join(temp,'home','seal.sqlite')},provide:(name,value)=>provided.set(name,value),effect:f=>disposers.push(f())}
  applyHost(context);const service=provided.get('sealHarnessOffice');assert.match(service.root,/office-documents[\\/](?:seal-harness|ae-hospital)$/u)
  t.after(async()=>{await act(async()=>root.unmount());disposers.forEach(f=>f?.());dom.window.close();globalThis.window=oldWindow;globalThis.document=oldDocument;delete globalThis.IS_REACT_ACT_ENVIRONMENT})
  const calls=[]
  const rpc=async(channel,method,payload,signal)=>{
    calls.push(method);assert.equal(channel,'/api');assert.ok(method.startsWith('seal-harness-office/'))
    const response=await routes.get('/api/'+method).fetch(new Request('http://localhost/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method,payload}),signal}))
    assert.equal(response.status,200);return (await response.json()).result
  }
  const module={exports:{}}
  dom.window.HTMLAnchorElement.prototype.click=function(){downloaded=this.download}
  runInNewContext(await readFile(join(temp,'ui/client.cjs'),'utf8'),{module,exports:module.exports,require:createRequire(import.meta.url),document:dom.window.document,AbortController,Blob,Uint8Array,atob,btoa,setTimeout,URL:{createObjectURL:()=> 'blob:local-office-test',revokeObjectURL(){}}})
  module.exports.apply({connection:{rpc:{call:rpc}},sealHarnessAuthClient:{subscribe:identity.subscribe,getStatus:()=>status},sealHarnessNavigation:{register:meta=>{panels.push(meta);return()=>{}}},effect:f=>disposers.push(f()),layout:{},slots:{}})
  assert.equal(panels[0].id,'office-documents')
  await act(async()=>root.render(React.createElement(panels[0].Panel)))
  async function waitFor(check){const until=Date.now()+10000;while(Date.now()<until){await act(async()=>await new Promise(r=>setTimeout(r,20)));if(check())return}throw new Error('UI condition timed out')}
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
  await waitFor(()=>calls.includes('seal-harness-office/snapshot'))
  assert.match(document.body.textContent,/办公文档/);assert.match(document.body.textContent,/不重算公式/)
  assert.equal(document.querySelector('[aria-label="新文档名称"]'),null)
  assert.ok(document.querySelector('.office-file-input'))
  await act(async()=>button('新建文档').click())
  assert.ok(document.querySelector('[aria-label="新文档名称"]'))
  await act(async()=>button('取消').click())
  assert.equal(document.querySelector('[aria-label="新文档名称"]'),null)
  assert.equal(service.snapshot({}).documents.length,0)
  await act(async()=>button('新建文档').click())
  await act(async()=>button('新建').click())
  await waitFor(()=>document.querySelector('[aria-label="文档编辑器"]'))
  const original=service.snapshot({}).documents[0],originalBytes=service.download({id:original.id}).base64
  const editor=document.querySelector('[aria-label="文档编辑器"] textarea')
  await act(async()=>Simulate.change(editor,{target:{value:'Edited from real UI'}}))
  assert.equal(button('保存为新版本').disabled,false)
  await act(async()=>button('保存为新版本').click())
  await waitFor(()=>service.snapshot({}).documents.length===2&&!button('导出文件').disabled)
  assert.equal(service.download({id:original.id}).base64,originalBytes)
  const latest=service.snapshot({}).documents.find(d=>d.revision===2)
  assert.ok((await service.inspect({id:latest.id})).view.blocks.some(b=>b.text==='Edited from real UI'))
  await act(async()=>button('导出文件').click())
  await waitFor(()=>downloaded.endsWith('.docx'))
  const source=await service.create({kind:'xlsx',name:'import-source',content:'A,B\n1,2'}),bytes=Buffer.from(service.download({id:source.document.id}).base64,'base64')
  const input=document.querySelector('input[type=file]')
  Object.defineProperty(input,'files',{configurable:true,value:[{name:'from-user.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]})
  await act(async()=>Simulate.change(input,{target:input}))
  await waitFor(()=>document.querySelector('[aria-label="文档编辑器"] h3')?.textContent==='from-user.xlsx')
  assert.ok(calls.includes('seal-harness-office/import'));assert.ok(calls.includes('seal-harness-office/edit'));assert.ok(calls.includes('seal-harness-office/download'))
  await act(async()=>{status={accountId:'account-b',epoch:2};for(const f of listeners)f()})
  await waitFor(()=>!document.querySelector('[aria-label="文档编辑器"]'))
  assert.equal(service.snapshot({}).documents.length,0)
  const mismatched=await routes.get('/api/seal-harness-office/snapshot').fetch(new Request('http://localhost/api/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method:'seal-harness-office/download',payload:{}})}))
  assert.equal(mismatched.status,400)
})
