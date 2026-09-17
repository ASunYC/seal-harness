import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import type { StoredSessionEvent } from '@seal-harness/core';
const { createCompactionActivity } = await import(pathToFileURL(resolve('apps/web/public/compaction-activity.js')).href);
const marker=(sequence:number,type:string,id='a'): StoredSessionEvent=>({sequence,timestamp:new Date().toISOString(),event:{type:'dsh.imported',payload:{type,data:{compactionId:id}}}});
it('pairs overlapping compactions and ignores duplicate, unrelated and late endings',()=>{
  const state=createCompactionActivity(); const send=(...events:unknown[])=>state.consume({sessionId:'s',events},'s');
  expect(send(marker(1,'compaction/start'))).toBe(true);
  expect(send(marker(2,'compaction/start','b'))).toBe(true);
  expect(send(marker(3,'compaction/end'))).toBe(true);
  expect(send(marker(2,'compaction/start'))).toBeUndefined();
  expect(send(marker(4,'compaction/end','unknown'))).toBeUndefined();
  expect(send(marker(5,'compaction/end','b'))).toBe(false);
  expect(send(marker(5,'compaction/end','b'))).toBeUndefined();
});
it('isolates session state and clears unfinished markers at terminal boundaries',()=>{
  const state=createCompactionActivity();
  expect(state.consume({sessionId:'other',events:[marker(1,'compaction/start')]},'s')).toBeUndefined();
  expect(state.consume({sessionId:'s',events:[marker(1,'compaction/start')]},'s')).toBe(true);
  expect(state.consume({sessionId:'s',events:[marker(2,'turn/error')]},'s')).toBe('failed');
  expect(state.consume({sessionId:'next',events:[marker(1,'compaction/end')]},'next')).toBeUndefined();
});
