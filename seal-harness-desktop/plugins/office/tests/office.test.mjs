import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, linkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { OfficeService } from '../src/service.js'

const require = createRequire(import.meta.url)
const core = require('../lib/genoffice-core.cjs')
const desktopRequire = createRequire(new URL('../../../../dsh-plugin-desktop-beta/package.json', import.meta.url))
const JSZip = desktopRequire('genoffice-jszip')
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'seal-office-test-')); const listeners=new Set()
  let owner={accountId:'account-a',epoch:1}
  const identity={getSession:()=>owner,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)}}
  const service=new OfficeService({root:join(root,'seal','office'),identity})
  t.after(()=>{service.dispose();assert.ok(resolve(root).startsWith(resolve(tmpdir())));rmSync(root,{recursive:true,force:true})})
  return {root,identity,service,setOwner(next){owner=next;for(const f of listeners)f()}}
}
for(const kind of ['docx','xlsx','pptx'])test(`${kind}: real create/import/edit/export preserves original bytes and untouched content`,async t=>{
  const {service}=fixture(t)
  const content=kind==='xlsx'?'姓名,数量\n病房,12':kind==='pptx'?'医院交班\n第一张\n---\nUntouched slide':'医院交班\nUntouched content'
  const original=await service.create({kind,name:'round-trip',content})
  const exported=service.download({id:original.document.id})
  assert.equal(Buffer.from(exported.base64,'base64').subarray(0,2).toString(),'PK')
  const imported=await service.import({name:`imported.${kind}`,base64:exported.base64})
  assert.equal(service.download({id:imported.document.id}).base64,exported.base64)
  const target=imported.view.blocks.find(x=>x.editable)
  const updated=await service.edit({id:imported.document.id,hash:imported.document.hash,updates:[{id:target.id,text:'实际修改完成'}]})
  assert.notEqual(updated.document.id,imported.document.id);assert.equal(updated.document.revision,2)
  assert.equal(updated.document.parentId,imported.document.id)
  assert.equal(service.download({id:imported.document.id}).base64,exported.base64)
  const reopened=await service.import({name:`edited.${kind}`,base64:service.download({id:updated.document.id}).base64})
  assert.ok(reopened.view.blocks.some(b=>b.text.includes('实际修改完成')))
  if(kind==='docx')assert.ok(reopened.view.blocks.some(b=>b.text==='Untouched content'))
  if(kind==='xlsx')assert.ok(reopened.view.blocks.some(b=>b.text==='病房'))
  if(kind==='pptx')assert.ok(reopened.view.blocks.some(b=>b.text==='Untouched slide'))
})
test('DOCX larger than the old 8 MiB gate imports and exports unchanged', async t => {
  const {service}=fixture(t)
  const created=await service.create({kind:'docx',name:'large',content:'Large attachment'})
  const zip=await JSZip.loadAsync(Buffer.from(service.download({id:created.document.id}).base64,'base64'))
  zip.file('word/media/large.bin',require('node:crypto').randomBytes(9*1024*1024),{compression:'STORE'})
  const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
  assert.ok(bytes.length>8*1024*1024)
  const imported=await service.import({name:'large.docx',base64:bytes.toString('base64')})
  assert.equal(service.download({id:imported.document.id}).base64,bytes.toString('base64'))
})
test('XLSX formulas are stored, and never reported as locally recalculated',async t=>{
  const {service}=fixture(t),doc=await service.create({kind:'xlsx',name:'formula',content:'1,2'})
  const result=await service.edit({id:doc.document.id,hash:doc.document.hash,updates:[{id:JSON.stringify(['Sheet1','C1']),text:'=SUM(A1:B1)'}]})
  assert.ok(result.view.blocks.some(b=>b.label==='Sheet1!C1'&&b.text==='=SUM(A1:B1)'))
  assert.equal(service.snapshot({}).capabilities.formulaRecalculation,false)
})
test('brand/account isolation, path rejection and mutation detection',async t=>{
  const {service,root,identity,setOwner}=fixture(t)
  const doc=await service.create({kind:'docx',name:'private',content:'Only A'})
  const other=new OfficeService({root:join(root,'hospital','office'),identity});t.after(()=>other.dispose())
  assert.equal(other.snapshot({}).documents.length,0)
  setOwner({accountId:'account-b',epoch:2});assert.equal(service.snapshot({}).documents.length,0)
  assert.throws(()=>service.download({id:doc.document.id}),/不存在/)
  assert.throws(()=>service.download({id:'../../secret'}))
  await assert.rejects(service.create({kind:'docx',name:'../secret',content:'x'}))
  setOwner({accountId:'account-a',epoch:3})
  await assert.rejects(service.edit({id:doc.document.id,hash:'0'.repeat(64),updates:[{id:'0',text:'bad'}]}),/版本/)
  const folder=service.folder(service.account());writeFileSync(join(folder,`${doc.document.id}.docx`),'modified outside')
  assert.throws(()=>service.download({id:doc.document.id}),/其他程序修改/)
  setOwner(null);assert.throws(()=>service.snapshot({}),/登录/)
})
test('bad input and ZIP budgets fail closed without creating documents',async t=>{
  const {service}=fixture(t)
  await assert.rejects(service.import({name:'bad.docx',base64:Buffer.from('not a zip').toString('base64')}))
  await assert.rejects(service.import({name:'bad.docx',base64:'not canonical!'}))
  await assert.rejects(service.import({name:'macro.docm',base64:'AAAA'}))
  for(const forged of [false,true]){
    const zip=new JSZip();zip.file('word/document.xml',Buffer.alloc(17*1024*1024,0x41))
    const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
    if(forged){const central=bytes.indexOf(Buffer.from([0x50,0x4b,1,2]));assert.ok(central>0);bytes.writeUInt32LE(32,central+24);bytes.writeUInt32LE(32,22)}
    await assert.rejects(core.inspect('docx',bytes),/zip rejected|exceeds|declares|inflated/iu)
    await assert.rejects(service.import({name:'bomb.docx',base64:bytes.toString('base64')}),/无法处理/)
  }
  const many=new JSZip();for(let i=0;i<2501;i++)many.file(`part${i}.xml`,'x')
  await assert.rejects(service.import({name:'parts.xlsx',base64:(await many.generateAsync({type:'nodebuffer'})).toString('base64')}))
  assert.equal(service.snapshot({}).documents.length,0)
})
test('account change cancels worker and leaves no document behind',async t=>{
  const {service,setOwner}=fixture(t)
  const pending=service.create({kind:'docx',name:'cancel',content:'Pending'})
  setOwner({accountId:'account-b',epoch:2})
  await assert.rejects(pending,/取消|账号/)
  setOwner({accountId:'account-a',epoch:3});assert.equal(service.snapshot({}).documents.length,0)
})
test('core package contains audited notices and no ee, fonts, providers or Univer inputs',()=>{
  const record=JSON.parse(readFileSync(new URL('../lib/genoffice-build.json',import.meta.url)))
  assert.equal(record.commit,'e1f50e90d246f3ecc6427d2a0af90f04f37810ec')
  assert.ok(record.dependencies.length>0)
  for(const input of record.inputs)assert.doesNotMatch(input,/(?:^|\/)ee\/|@univerjs|ai-provider|\.(ttf|otf|woff2?)$/iu)
  const legal=new URL('../lib/third-party/genoffice/',import.meta.url)
  assert.match(readFileSync(new URL('LICENSE',legal),'utf8'),/Apache License/)
  assert.match(readFileSync(new URL('NOTICE',legal),'utf8'),/Mainfunc/)
  assert.ok(readdirSync(new URL('dependencies/',legal)).length>0)
})

test('protected Office documents stay read-only and original exports remain intact',async t=>{
  const {service}=fixture(t)
  for(const kind of ['docx','xlsx','pptx']){
    const original=await core.create(kind,'Protected text'),zip=await JSZip.loadAsync(original)
    if(kind==='docx')zip.file('word/settings.xml','<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>')
    else {
      const path=kind==='xlsx'?'xl/worksheets/sheet1.xml':'ppt/presentation.xml',xml=await zip.file(path).async('string')
      const end=kind==='xlsx'?'</worksheet>':'</p:presentation>',protection=kind==='xlsx'?'<sheetProtection sheet="1"/>':'<p:modifyVerifier/>'
      assert.ok(xml.includes(end));zip.file(path,xml.replace(end,protection+end))
    }
    const bytes=await zip.generateAsync({type:'nodebuffer'}),base64=bytes.toString('base64')
    const imported=await service.import({name:`protected.${kind}`,base64})
    assert.equal(imported.view.readOnly,true);assert.ok(imported.view.blocks.every(b=>!b.editable))
    await assert.rejects(service.edit({id:imported.document.id,hash:imported.document.hash,updates:[{id:imported.view.blocks[0].id,text:'Must not write'}]}),e=>e.code==='readOnlyDocument')
    assert.equal(service.download({id:imported.document.id}).base64,base64)
  }
})
test('ZIP original path traversal is rejected without extraction',async()=>{
  const zip=await JSZip.loadAsync(await core.create('docx','Valid document'))
  zip.file('../escape.xml','x');const bytes=await zip.generateAsync({type:'nodebuffer'})
  await assert.rejects(core.inspect('docx',bytes),/unsafe part path/)
})

test('creation rejects excessive slide counts without silently dropping content',async t=>{
  const {service}=fixture(t)
  await assert.rejects(service.create({kind:'pptx',name:'too-many',content:Array(51).fill('slide').join('\n---\n')}))
  assert.equal(service.snapshot({}).documents.length,0)
})
test('hard-linked document files are refused without changing either file',async t=>{
  const {service,root}=fixture(t),doc=await service.create({kind:'docx',name:'hardlink',content:'Keep bytes'})
  const path=join(service.folder(service.account()),`${doc.document.id}.docx`),bytes=readFileSync(path)
  linkSync(path,join(root,'linked-copy.docx'))
  assert.throws(()=>service.download({id:doc.document.id}),e=>e.code==='unsafeStorage')
  assert.deepEqual(readFileSync(path),bytes);assert.deepEqual(readFileSync(join(root,'linked-copy.docx')),bytes)
})


test('XLSX edits preserve long identifiers and overflowing numbers as text',async t=>{
  const {service}=fixture(t)
  const doc=await service.create({kind:'xlsx',name:'identifiers',content:'original'})
  const values=['123456789012345678','0'.repeat(2)+'123','9'.repeat(400)]
  const changed=await service.edit({id:doc.document.id,hash:doc.document.hash,updates:values.map((text,i)=>({id:JSON.stringify(['Sheet1',String.fromCharCode(65+i)+'1']),text}))})
  for(let i=0;i<values.length;i++)assert.equal(changed.view.blocks.find(b=>b.label==='Sheet1!'+String.fromCharCode(65+i)+'1').text,values[i])
  assert.equal(service.download({id:doc.document.id}).base64.includes('undefined'),false)
})
