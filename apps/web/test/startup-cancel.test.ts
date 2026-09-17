import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
const source=await readFile(resolve('apps/web/public/app.js'),'utf8');
const start=source.indexOf('async function cancelRun()');
const end=source.indexOf('\nasync function saveKey()',start);
const make=(state: unknown,api: unknown)=>new Function('state','api','setStatus',`${source.slice(start,end)};return cancelRun;`)(state,api,vi.fn());
it('aborts only the pending startup request before a run ID exists',async()=>{
  const controller=new AbortController(); const api=vi.fn();
  await make({runId:null,startupController:controller},api)();
  expect(controller.signal.aborted).toBe(true); expect(api).not.toHaveBeenCalled();
});
it('keeps the live stream open and uses the runtime abort endpoint after start',async()=>{
  const controller=new AbortController(); const api=vi.fn().mockResolvedValue({});
  await make({runId:'run one',startupController:controller},api)();
  expect(controller.signal.aborted).toBe(false);
  expect(api).toHaveBeenCalledWith('/api/runs/run%20one',{method:'DELETE'});
});
