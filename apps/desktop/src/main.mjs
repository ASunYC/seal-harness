import { app, BrowserWindow, dialog, shell, nativeTheme } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { externalUrl, isLocalNavigation, startBackend } from "./host.mjs";

const source = dirname(fileURLToPath(import.meta.url));
const smoke = process.argv.includes("--smoke-test") && process.env.SEAL_DESKTOP_SMOKE === "1" && !!process.env.SEAL_DESKTOP_DATA_HOME;
if (smoke && ["light", "dark"].includes(process.env.SEAL_DESKTOP_SMOKE_THEME)) nativeTheme.themeSource = process.env.SEAL_DESKTOP_SMOKE_THEME;
const dataHome = smoke ? process.env.SEAL_DESKTOP_DATA_HOME : join(homedir(), ".seal-harness");
app.setPath("userData", join(dataHome, "desktop"));
let backend;
let window;
let quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", event => {
    if (quitting || !backend) return;
    event.preventDefault(); quitting = true;
    void backend.stop().finally(() => app.quit());
  });
  void app.whenReady().then(async () => {
  try {
    await mkdir(dataHome, { recursive: true });
    const resource = join(process.resourcesPath, "backend");
    backend = startBackend({
      execPath: app.isPackaged ? join(resource, "runtime", process.platform === "win32" ? "node.exe" : "node") : process.env.SEAL_DESKTOP_NODE,
      entry: app.isPackaged ? join(resource, "app", "backend.mjs") : join(source, "backend.mjs"),
      cwd: smoke || !app.isPackaged ? (process.env.SEAL_DESKTOP_WORKSPACE || homedir()) : homedir(), dataHome,
    });
    const launchUrl = await backend.ready;
    const origin = new URL(launchUrl).origin;
    window = new BrowserWindow({ width: 1320, height: 900, minWidth: 800, minHeight: 560, show: false,
      title: "Seal Harness", backgroundColor: "#141414", autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false, offscreen: smoke, backgroundThrottling: !smoke },
    });
    const openExternal = async value => {
      const url = externalUrl(value); if (!url) return;
      const choice = await dialog.showMessageBox(window, { type: "question", title: "打开外部链接", message: "在默认浏览器中打开此链接？", detail: url, buttons: ["取消", "打开"], defaultId: 0, cancelId: 0 });
      if (choice.response === 1) await shell.openExternal(url);
    };
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: "deny" }; });
    window.webContents.on("will-navigate", (event, url) => { if (!isLocalNavigation(url, origin)) { event.preventDefault(); void openExternal(url); } });
    window.webContents.on("will-redirect", (event, url) => { if (!isLocalNavigation(url, origin)) event.preventDefault(); });
    backend.child.once("exit", () => { if (!quitting) { dialog.showErrorBox("Seal Harness", "后台服务已退出，请重新启动应用。"); app.quit(); } });
    // The existing 303 auth exchange sets an HttpOnly cookie and removes the token.
    await window.loadURL(launchUrl);
    if (smoke) {
      await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          if (document.documentElement.dataset.dshClientBoot === 'ready' && document.documentElement.dataset.sealBoot === 'ready' && document.querySelectorAll('#model option').length > 0) return resolve();
          if (Date.now() - started > 20000) return reject(new Error('Desktop UI bootstrap did not complete'));
          setTimeout(check, 100);
        }; check();
      })`);
      if (["light", "dark"].includes(process.env.SEAL_DESKTOP_SMOKE_THEME)) {
        const actualScheme = await window.webContents.executeJavaScript("getComputedStyle(document.documentElement).colorScheme");
        if (actualScheme !== process.env.SEAL_DESKTOP_SMOKE_THEME) throw new Error(`Unexpected UI theme: ${actualScheme}`);
      }
      if (process.env.SEAL_DESKTOP_SMOKE_TOOLS === "1") {
        await window.webContents.executeJavaScript(`(async () => {
          const { createToolCard } = await import('/tool-card.js');
          document.querySelector('#welcome')?.remove();
          for (const [name, args, result] of [
            ['shell', {command: 'pnpm test'}, {details: {stdout: '5 tests passed', stderr: '', exitCode: 0}, content: []}],
            ['replace_text', {path: 'src/app.ts', oldText: 'const enabled = false;', newText: 'const enabled = true;'}, {content: [{type: 'text', text: 'Updated src/app.ts'}]}],
            ['search_text', {query: 'createSession', path: 'src'}, {details: {count: 2}, content: [{type: 'text', text: 'src/app.ts:12:createSession()\\nsrc/ui.ts:34:createSession()'}]}]
          ]) { const card = createToolCard({name, arguments: args}, 'zh-CN'); card.update(result); card.root.open = true; document.querySelector('#transcript').append(card.root); }
          if (document.querySelectorAll('.search-match-file').length !== 2 || document.querySelectorAll('.search-match-line').length !== 2) throw new Error('Search match groups did not render');
          document.querySelector('.search-match-file').closest('.semantic-tool').scrollIntoView({block:'center'});
        })()`);
      }
      if (process.env.SEAL_DESKTOP_SMOKE_HISTORY === "1") {
        await window.webContents.executeJavaScript(`(async () => {
          let step = 'session list';
          const until = async check => { const start = Date.now(); while (!check()) { if (Date.now()-start > 12000) throw new Error('History UI wait timed out: '+step+'; messages='+document.querySelectorAll('#transcript .message').length); await new Promise(r=>setTimeout(r,50)); } };
          await until(()=>document.querySelector('[title="desktop-history-fixture"].session-row-time'));
          document.querySelector('[title="desktop-history-fixture"].session-row-time').closest('.session-row').querySelector('button').click();
          const count = () => document.querySelectorAll('#transcript .message').length;
          step = 'open session';
          await until(()=>count() >= 40);
          await new Promise(r=>setTimeout(r,800));
          const transcript = document.querySelector('#transcript');
          transcript.scrollTop = 0; transcript.dispatchEvent(new Event('scroll'));
          await new Promise(r=>setTimeout(r,600));
          const initial = count();
          const anchor = transcript.querySelector('[data-chat-anchor-key]');
          const anchorTop = anchor.getBoundingClientRect().top;
          step = 'load older';
          document.querySelector('#load-earlier').click();
          await until(()=>count() > initial);
          await new Promise(r=>setTimeout(r,600));
          if (Math.abs(anchor.getBoundingClientRect().top-anchorTop) > 8) throw new Error('Loading history moved reading anchor');
          const expanded = count();
          step = 'trim latest';
          document.querySelector('#back-to-bottom').click();
          await until(()=>count() < expanded);
          if (count() > 65) throw new Error('History did not release old message DOM');
          const originalFetch = window.fetch; let requests = 0;
          window.fetch = (...args) => { if (String(args[0]).includes('/messages?')) requests++; return originalFetch(...args); };
          try {
            step = 'restore cached';
            transcript.scrollTop = 0; transcript.dispatchEvent(new Event('scroll'));
            await new Promise(r=>setTimeout(r,600));
            document.querySelector('#load-earlier').click();
            await until(()=>count() === expanded);
            if (requests !== 0) throw new Error('Cached history fetched again');
          } finally { window.fetch = originalFetch; }
          if (!document.querySelector('#transcript .content strong')) throw new Error('History markdown missing');
          step = 'jump oldest turn';
          document.querySelector('#turn-navigator button').click();
          await until(()=>transcript.querySelector('[data-turn-id="turn-0"]'));
          await until(()=>!document.querySelector('#turn-navigator [aria-busy="true"]'));
          document.querySelector('#back-to-bottom').click();
          await until(()=>count() <= 65);
          // Exercise the real search button/open/history/focus path. Only the
          // search-index response is controlled; messages use the real store.
          step = 'search older reasoning';
          const searchFetch = window.fetch;
          window.fetch = (...args) => String(args[0]).includes('/api/sessions/search?')
            ? Promise.resolve(new Response(JSON.stringify({items:[{sessionId:'desktop-history-fixture',snippet:'定位验证 跨节点 内容'}],hasMore:false}),{headers:{'Content-Type':'application/json'}}))
            : searchFetch(...args);
          try {
            document.querySelector('#session-search-open').click();
            const input=document.querySelector('#session-search-input');
            input.value='定位验证 跨节点'; input.dispatchEvent(new Event('input',{bubbles:true}));
            await until(()=>document.querySelector('.search-result'));
            document.querySelector('.search-result').click();
            await until(()=>document.querySelector('#status').textContent.includes('已定位匹配内容'));
            const content=document.activeElement;
            if(!content.classList.contains('reasoning-content') || !content.textContent.includes('定位验证')) throw new Error('Search did not focus the matched reasoning');
            for(let parent=content.parentElement;parent&&parent!==transcript;parent=parent.parentElement) if(parent.tagName==='DETAILS'&&!parent.open) throw new Error('Search target remains folded');
            const bounds=content.getBoundingClientRect(), viewport=transcript.getBoundingClientRect();
            if(bounds.bottom<=viewport.top || bounds.top>=viewport.bottom) throw new Error('Search target is outside the transcript viewport');
            const highlight=CSS.highlights.get('seal-search');
            if(!highlight || [...highlight][0].toString()!=='定位验证 跨节点') throw new Error('Search highlight range missing');
            const canvas=document.createElement('canvas'); canvas.width=canvas.height=1;
            const ctx=canvas.getContext('2d');
            const brightness=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
            const dark=matchMedia('(prefers-color-scheme: dark)').matches;
            for(const selector of ['.message.user','.state-card','.session-search.expanded']) {
              const node=document.querySelector(selector), style=getComputedStyle(node);
              const bg=brightness(style.backgroundColor);
              if(dark ? bg>.12 : bg<.7) throw new Error('Incorrect theme surface: '+selector+' '+style.backgroundColor);
              const fg=brightness(getComputedStyle(selector.includes('search')?node.querySelector('input'):node).color);
              if((Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)<4.5) throw new Error('Insufficient primary text contrast: '+selector);
            }
          } finally { window.fetch=searchFetch; }
        })()`);
      }
      if (process.env.SEAL_DESKTOP_SMOKE_STREAM === "1") {
        await window.webContents.executeJavaScript(`(async () => {
          const until = async (check, step='stream') => { const start=Date.now(); while(!check()) { if(Date.now()-start>15000) throw new Error('PI stream UI timed out ('+step+'): '+document.querySelector('#status')?.textContent); await new Promise(r=>setTimeout(r,50)); } };
          const provider = document.querySelector('#provider'); provider.value='scripted'; provider.dispatchEvent(new Event('change'));
          await until(()=>[...document.querySelector('#model').options].some(o=>o.value==='desktop-stream'));
          document.querySelector('#model').value='desktop-stream';
          document.querySelector('#cwd').value=${JSON.stringify(process.env.SEAL_DESKTOP_WORKSPACE)};
          const workspaceResponse=await fetch('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:${JSON.stringify(process.env.SEAL_DESKTOP_WORKSPACE)}})});
          if(!workspaceResponse.ok) throw new Error('Stream fixture workspace registration failed');
          const signature = () => JSON.stringify([...document.querySelectorAll('#transcript .message.assistant, #transcript .semantic-tool')].map(node=>({
            kind:node.classList.contains('semantic-tool')?'tool':'assistant',
            turn:node.closest('[data-turn-id]')?.dataset.turnId,
            process:node.closest('.turn-process')?.dataset.turnId || null,
            text:node.classList.contains('semantic-tool')?null:node.querySelector('.content')?.textContent.trim()
          })));
          let liveSignature;
          const observer=new MutationObserver(()=>{
            const groups=[...document.querySelectorAll('#transcript > .turn-process')];
            if(groups.length===2 && groups.every(node=>node.dataset.completed==='true')) {
              liveSignature=signature(); observer.disconnect();
            }
          });
          observer.observe(document.querySelector('#transcript'),{childList:true,subtree:true,attributes:true});
          const prompt=document.querySelector('#prompt'); prompt.value='写入测试文件'; prompt.dispatchEvent(new Event('input',{bubbles:true}));
          if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_STARTUP_CANCEL === "1")}) {
            const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
            const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
            const transfer=new DataTransfer();transfer.items.add(new File([blob],'startup-fixture.png',{type:'image/png'}));
            const input=document.querySelector('#attachment-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
            await until(()=>document.querySelector('#attachment-chips img')?.naturalWidth>0,'startup image uploaded');
          }
          document.querySelector('#composer').requestSubmit();
          if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_STARTUP_CANCEL === "1")}) {
            observer.disconnect();
            await until(()=>document.querySelector('#status').textContent.includes('正在压缩上下文'),'startup compaction');
            const stop=document.querySelector('#submit-run').dataset.action==='stop'?document.querySelector('#submit-run'):document.querySelector('#cancel');
            if(stop.hidden || stop.disabled) throw new Error('Startup stop action unavailable');
            stop.click();
            await until(()=>document.querySelector('#status').textContent.includes('已停止启动'),'startup cancellation');
            await until(()=>document.querySelector('#submit-run').dataset.action==='submit','composer restored');
            if(prompt.value!=='写入测试文件') throw new Error('Cancelled startup lost original input');
            if(document.querySelectorAll('#attachment-chips img').length!==1 || !document.querySelector('#attachment-chips img').naturalWidth) throw new Error('Cancelled startup lost its uploaded image');
            if(document.querySelector('#transcript [data-startup-activity]') || document.querySelector('#transcript .message')) throw new Error('Cancelled startup left provisional messages');
            return;
          }
          if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_MULTI === "1")}) {
            observer.disconnect();
            if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_MULTI_LIVE === "1")}) {
              await until(()=>document.querySelectorAll('.subagent-tree .subagent-status[data-status="running"]').length===2,'live children roster');
              const child=document.querySelector('.subagent-tree details[data-subagent-id]');child.open=true;
              const open=[...child.querySelectorAll('button')].find(button=>button.textContent==='查看会话'||button.textContent==='Open session');
              await open.onclick();
              await until(()=>document.querySelector('.subagent-inspector')?.textContent.includes('阶段进展 desktop-child-'),'live child partial text');
              const inspector=document.querySelector('.subagent-inspector');
              if(!inspector.textContent.includes('正在处理 desktop-child-') || inspector.textContent.includes('完成 desktop-child-')) throw new Error('Child details did not show in-progress thinking and text');
              if(!inspector.querySelector('.child-live-status') || !inspector.querySelector('.reasoning')?.open) throw new Error('Live child status or expanded thinking missing');
              const diagnostic=inspector.querySelector('.child-diagnostic');
              if(!diagnostic || diagnostic.open) throw new Error('System prompt should be available but collapsed');
              diagnostic.open=true;
              [...inspector.querySelectorAll('button')].find(button=>button.textContent==='刷新'||button.textContent==='Refresh').click();
              await until(()=>!diagnostic.isConnected,'child diagnostic refresh');
              if(!inspector.querySelector('.child-diagnostic')?.open) throw new Error('Refresh lost diagnostic disclosure state');
              if(document.querySelector('#submit-run').dataset.action!=='stop') throw new Error('Inspecting child interrupted or replaced parent run');
              [...inspector.querySelectorAll('button')].find(button=>button.textContent==='关闭'||button.textContent==='Close').click();
            }
            await until(()=>document.querySelector('#transcript').textContent.includes('子任务协调完成'),'multi parent answer');
            await until(()=>document.querySelector('#submit-run').dataset.action==='submit','multi settled');
            await until(()=>document.querySelectorAll('.subagent-tree details[data-subagent-id]').length===2,'multi tree');
            const children=[...document.querySelectorAll('.subagent-tree details[data-subagent-id]')];
            for(const node of children) {
              node.open=true;
              if(node.querySelector('.subagent-status').dataset.status!=='completed') throw new Error('Child did not complete through PI: '+node.textContent);
              const label=node.querySelector('summary strong').textContent;
              if(node.querySelector('.subagent-task pre')?.textContent!=='desktop-child-'+label) throw new Error('Original delegated task missing');
              if(!node.textContent.includes('完成 desktop-child-'+label)) throw new Error('Child result missing');
            }
            const first=children[0], label=first.querySelector('summary strong').textContent;
            const open=[...first.querySelectorAll('button')].find(button=>button.textContent==='查看会话'||button.textContent==='Open session');
            if(!open) throw new Error('Child session action missing');
            await open.onclick();
            await until(()=>document.querySelector('#transcript').textContent.includes('完成 desktop-child-'+label),'real child transcript');
            if(!document.querySelector('#transcript .reasoning')?.textContent.includes('正在处理 desktop-child-'+label)) throw new Error('Real child reasoning missing');
            return;
          }
          if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_QUEUE === "1")}) {
            observer.disconnect();
            await until(()=>document.querySelector('#transcript').textContent.includes('第一轮仍在执行'),'queue first output');
            document.querySelector('#delivery-mode').value=${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_STEER === "1" ? "steer" : "followUp")};
            const imageFixture=${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_QUEUE_IMAGE === "1")};
            if(imageFixture) {
              const canvas=document.createElement('canvas');canvas.width=24;canvas.height=16;canvas.getContext('2d').fillRect(0,0,24,16);
              const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
              const transfer=new DataTransfer();transfer.items.add(new File([blob],'queue-fixture.png',{type:'image/png'}));
              const input=document.querySelector('#attachment-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
              await until(()=>document.querySelector('#attachment-chips img')?.naturalWidth>0,'queue image uploaded');
            }
            prompt.value='追加任务验证';prompt.dispatchEvent(new Event('input',{bubbles:true}));
            const queueFetch=window.fetch, queueErrors=[];
            window.fetch=async(...args)=>{const response=await queueFetch(...args);if(!response.ok)queueErrors.push(response.status+': '+(await response.clone().text()).slice(0,1500));return response;};
            document.querySelector('#composer').requestSubmit();
            try { await until(()=>prompt.value==='' && document.querySelector('#queue-dock').textContent.includes('追加任务验证'),'queue admission'); }
            catch(error) { throw new Error(error.message+'; requests='+JSON.stringify(queueErrors)+'; draft='+prompt.value+'; queue='+document.querySelector('#queue-dock').textContent); }
            finally { window.fetch=queueFetch; }
            if(document.querySelector('#transcript').textContent.includes('追加任务验证')) throw new Error('Pending queue message inserted into transcript too early');
            if(imageFixture) {
              const preview=document.querySelector('#queue-dock').outerHTML;
              try { await until(()=>document.querySelector('#queue-dock img')?.naturalWidth>0,'queued image preview'); }
              catch(error) { throw new Error(error.message+'; preview='+preview); }
              const other=await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cwd:${JSON.stringify(process.env.SEAL_DESKTOP_WORKSPACE)},sessionId:'attachment-other'})});
              if(!other.ok) throw new Error('Could not create attachment isolation fixture');
              const foreign=new URL(document.querySelector('#queue-dock img').src);const parts=foreign.pathname.split('/');parts[3]='attachment-other';foreign.pathname=parts.join('/');
              if((await fetch(foreign,{cache:'no-store'})).status!==404) throw new Error('Queued attachment readable from another session');
            }
            const rows=()=>[...document.querySelectorAll('#transcript .message.user, #transcript .message.assistant')].map(node=>{const content=node.querySelector('.content').cloneNode(true);content.querySelectorAll('.message-image-gallery').forEach(n=>n.remove());return {role:node.classList.contains('user')?'user':'assistant',text:content.textContent.trim()};});
            if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_QUEUE_REMOVE === "1")}) {
              const queuedImageUrl=imageFixture ? document.querySelector('#queue-dock img').src : null;
              await until(()=>document.querySelectorAll('#queue-dock .queue-actions button').length>=2,'queue removal controls');
              document.querySelectorAll('#queue-dock .queue-actions button')[1].click();
              await until(()=>document.querySelector('#queue-dock').hidden,'queue removed');
              if(queuedImageUrl && (await fetch(queuedImageUrl,{cache:'no-store'})).status!==404) throw new Error('Removed attachment remains reachable through the session');
              await until(()=>document.querySelector('#submit-run').dataset.action==='submit','removed queue settled');
              const expected=JSON.stringify([{role:'user',text:'写入测试文件'},{role:'assistant',text:'第一轮仍在执行'}]);
              if(JSON.stringify(rows())!==expected || document.querySelector('#transcript .notice.error')) throw new Error('Removed queue was consumed');
              const selected=()=>[...document.querySelectorAll('.session-row button')].find(button=>button.textContent.includes('写入测试文件'));
              await until(selected,'removed queue session');
              const current=document.querySelector('#transcript .message.assistant');
              selected().click();
              await until(()=>!current.isConnected,'removed queue reopen');
              if(JSON.stringify(rows())!==expected) throw new Error('Removed queue appeared in history');
              if(queuedImageUrl && (await fetch(queuedImageUrl,{cache:'no-store'})).status!==404) throw new Error('Reopened session restored removed attachment access');
              return;
            }
            let consumedSnapshot;
            const watch=new MutationObserver(()=>{if(document.querySelector('#transcript').textContent.includes('追加任务已完成')){consumedSnapshot=JSON.stringify(rows());watch.disconnect();}});
            watch.observe(document.querySelector('#transcript'),{childList:true,subtree:true,characterData:true});
            await until(()=>document.querySelector('#transcript').textContent.includes('追加任务已完成'),'queued answer');
            await until(()=>document.querySelector('#submit-run').dataset.action==='submit','queue run settled');
            const expected=JSON.stringify([{role:'user',text:'写入测试文件'},{role:'assistant',text:'第一轮仍在执行'},{role:'user',text:'追加任务验证'},{role:'assistant',text:'追加任务已完成'}]);
            if(consumedSnapshot!==expected) throw new Error('Consumed queue timeline differs: '+consumedSnapshot);
            let imageSource;
            if(imageFixture) {
              await until(()=>document.querySelector('#transcript .message.user img')?.naturalWidth>0,'consumed image');
              imageSource=document.querySelector('#transcript .message.user img').src;
              if(!imageSource.includes('/attachment-content/')) throw new Error('Consumed image did not use its durable session reference');
            }
            const selected=()=>[...document.querySelectorAll('.session-row button')].find(button=>button.textContent.includes('写入测试文件'));
            await until(selected,'queued session');
            const current=document.querySelector('#transcript .message.assistant');
            selected().click();
            await until(()=>!current.isConnected,'queued reopen');
            if(JSON.stringify(rows())!==expected) throw new Error('Reopened queue timeline differs: '+JSON.stringify(rows()));
            if(imageFixture) {
              await until(()=>document.querySelector('#transcript .message.user img')?.naturalWidth>0,'reopened image');
              if(document.querySelector('#transcript .message.user img').src!==imageSource) throw new Error('Reopened image reference changed');
            }
            return;
          }
          if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_TOOL_PROGRESS === "1" || process.env.SEAL_DESKTOP_SMOKE_TOOL_CANCEL === "1")}) {
            observer.disconnect();
            await until(()=>document.querySelector('.tool-progress pre')?.textContent.includes('live-shell-first'),'shell live output');
            const preview=document.querySelector('.tool-progress');const card=preview.closest('.semantic-tool');
            if(card.dataset.phase!=='running') throw new Error('Partial tool output marked complete');
            const activity=card.closest('.turn-process');
            if(!activity?.querySelector('.turn-activity-preview')?.textContent.includes('正在执行')) throw new Error('Running tool activity summary missing');
            activity.open=false;
            if(!activity.querySelector('.turn-activity-preview').textContent.includes('live-shell-first')) throw new Error('Collapsed activity does not identify command');
            card.open=true;
            if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_TOOL_CANCEL === "1")}) {
              document.querySelector('#submit-run').click();
              await until(()=>document.querySelector('#submit-run').dataset.action==='submit','shell cancel settled');
              await until(()=>document.querySelector('.session-row button'),'shell cancel session');
              const current=document.querySelector('.semantic-tool');
              document.querySelector('.session-row button').click();
              await until(()=>!current.isConnected,'shell cancel reopen');
              const result=document.querySelector('.semantic-tool');
              if(result?.dataset.phase!=='error' || !result.querySelector('.semantic-tool-block.error pre')?.textContent.includes('live-shell-first')) throw new Error('Cancelled tool history lost partial output or failure state');
              return;
            }
            await until(()=>document.querySelector('.turn-process[data-activity="waiting"]'),'waiting for model after tool');
            await until(()=>document.querySelector('#transcript').textContent.includes('工具进度验证完成'),'shell completed');
            await until(()=>document.querySelector('#submit-run').dataset.action==='submit','shell settled');
            const final=document.querySelector('.semantic-tool');
            if(final.dataset.phase!=='completed' || final.querySelector('.tool-progress') || !final.textContent.includes('live-shell-last')) throw new Error('Final shell result did not replace progress');
            if(document.querySelector('.turn-process[data-completed="true"] .turn-activity-preview')) throw new Error('Completed activity still labelled running');
            return;
          }
          if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_FAILURE === "1")}) {
            observer.disconnect();
            await until(()=>document.querySelector('#transcript').textContent.includes('失败前的部分正文'), 'failure partial output');
            await until(()=>document.querySelector('#submit-run').dataset.action==='submit', 'failure settled');
            if(!document.querySelector('#transcript').textContent.includes('Fixture provider failure')) throw new Error('Provider failure not visible');
            await until(()=>document.querySelector('.session-row button'),'failure session');
            const current=document.querySelector('#transcript .message.assistant');
            document.querySelector('.session-row button').click();
            await until(()=>!current.isConnected,'failure reopen');
            const before=document.querySelector('#transcript').textContent;
            if(!before.includes('失败前的思考') || !before.includes('失败前的部分正文') || !before.includes('Fixture provider failure')) throw new Error('Failed transcript lost content or error');
            prompt.value='继续恢复';prompt.dispatchEvent(new Event('input',{bubbles:true}));
            document.querySelector('#composer').requestSubmit();
            await until(()=>document.querySelector('#transcript').textContent.includes('恢复请求成功'),'recovery reply');
            await until(()=>document.querySelector('#submit-run').dataset.action==='submit','recovery settled');
            if(!document.querySelector('#transcript').textContent.includes('Fixture provider failure')) throw new Error('Recovery erased the prior error');
            return;
          }
          if (${JSON.stringify(process.env.SEAL_DESKTOP_SMOKE_CANCEL === "1")}) {
            observer.disconnect();
            await until(()=>document.querySelector('#transcript').textContent.includes('取消前已生成的内容'), 'cancel partial output');
            document.querySelector('#submit-run').click();
            await until(()=>document.querySelector('#submit-run').dataset.action==='submit', 'cancel settled');
            if(!document.querySelector('#transcript').textContent.includes('已停止')) throw new Error('Cancellation not distinguished from success');
            await until(()=>document.querySelector('.session-row button'), 'cancel session');
            const current=document.querySelector('#transcript .message.assistant');
            document.querySelector('.session-row button').click();
            await until(()=>!current.isConnected,'cancel reopen');
            const content=document.querySelector('#transcript').textContent;
            if(!content.includes('取消前已生成的内容') || !content.includes('取消测试思考') || !content.includes('已停止')) throw new Error('Cancelled history lost partial content or stop marker');
            return;
          }
          await until(()=>document.querySelector('#transcript .semantic-tool[data-phase="completed"]') && document.querySelector('#transcript').textContent.includes('已完成'));
          await until(()=>document.querySelector('#submit-run').dataset.action==='submit', 'run settled');
          await until(()=>document.querySelector('#transcript .message.assistant[data-chat-anchor-key]'), 'persisted refresh');
          const rows=[...document.querySelectorAll('#transcript .message.assistant, #transcript .semantic-tool')];
          if(rows.length!==3 || !rows[1].classList.contains('semantic-tool') || !rows[2].textContent.includes('文件写入')) throw new Error('PI stream order is wrong');
          if(!rows[0].textContent.includes('正在写入') || !rows[2].querySelector('.content strong')) throw new Error('PI streamed text/markdown missing');
          if(rows[0].querySelector('.content').textContent.includes('已完成')) throw new Error('Final answer merged into initial bubble');
          const processes=[...document.querySelectorAll('#transcript > .turn-process')];
          if(processes.length!==2 || processes.some(node=>node.open || !node.dataset.turnId)) throw new Error('Completed PI processes did not fold with durable identities');
          if(rows[2].closest('.turn-process')) throw new Error('Final PI answer is hidden in its process');
          if(!liveSignature) throw new Error('Live PI transcript was not observed before reload');
          const user = document.querySelector('#transcript .message.user .content');
          const canvas = document.createElement('canvas'); canvas.width=1;canvas.height=1;
          const context = canvas.getContext('2d'); context.fillStyle='white';context.fillRect(0,0,1,1);
          const ancestors=[];for(let node=user;node;node=node.parentElement) ancestors.unshift(node);
          for(const node of ancestors){context.fillStyle=getComputedStyle(node).backgroundColor;context.fillRect(0,0,1,1);}
          const luminance = pixel => { const rgb=[...pixel].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722; };
          const bg=luminance(context.getImageData(0,0,1,1).data);
          context.fillStyle=getComputedStyle(user).color;context.fillRect(0,0,1,1);
          const fg=luminance(context.getImageData(0,0,1,1).data);
          const contrast=(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);
          if(contrast<4.5) throw new Error('User message text contrast too low: '+contrast);
          rows[1].closest('.turn-process').open=true;
          rows[1].open=true;
          await rows[1].querySelector('button').onclick();
          if(!rows[1].querySelector('.review-line.added')) throw new Error('Real PI review evidence missing');
          if(!rows[1].querySelector('.review-diff').textContent.includes('desktop stream verified')) throw new Error('PI did not record expected write');
          await until(()=>document.querySelector('#cancel').hidden);
          const actions = rows[1].querySelector('.review-actions');
          actions.querySelector('button').click();
          const confirmBox = actions.querySelector('.review-confirmation');
          if(!confirmBox || !confirmBox.contains(document.activeElement)) throw new Error('Rollback confirmation focus missing');
          confirmBox.querySelector('button').click();
          if(actions.querySelector('.review-confirmation')) throw new Error('Rollback cancel failed');
          actions.querySelector('button').click();
          await actions.querySelector('.review-confirmation button:last-of-type').onclick();
          if(!actions.querySelector('[role="status"]')) throw new Error('Rollback failed: '+actions.textContent);
          actions.scrollIntoView({block:'center'});
          await until(()=>document.querySelector('.session-row button'), 'sidebar session');
          const selected=document.querySelector('.session-row button');
          const originalFetch=window.fetch; const requests=[];
          const failure=event=>requests.push(String(event.reason?.stack || event.reason));
          window.addEventListener('unhandledrejection',failure);
          window.fetch=async (...args)=>{const response=await originalFetch(...args); if(String(args[0]).includes('/messages') || String(args[0]).includes('/feedback')) requests.push(String(args[0])+':'+response.status);return response;};
          try { selected.click(); await until(()=>!rows[0].isConnected, 'reopen session '+selected.outerHTML); }
          catch(error){throw new Error(String(error)+' requests='+JSON.stringify(requests));}
          finally{window.fetch=originalFetch;window.removeEventListener('unhandledrejection',failure);}
          if(signature()!==liveSignature) throw new Error('Reloaded PI transcript differs from live: '+liveSignature+' => '+signature());
        })()`);
      }
      if (process.env.SEAL_DESKTOP_SMOKE_CHILD === "1") {
        await window.webContents.executeJavaScript(`(async () => {
          const { renderChildTranscript } = await import('/child-transcript.js');
          const { renderMarkdown } = await import('/markdown.js');
          const dialog = document.createElement('dialog'); dialog.className = 'onboarding-dialog subagent-inspector';
          const title = document.createElement('h2'); title.textContent = '子任务会话';
          const note = document.createElement('p'); note.textContent = '只读查看子任务；主任务继续运行。';
          const content = document.createElement('div');
          content.append(renderChildTranscript([
            {role:'user',content:[{type:'text',text:'检查项目的测试结果'}]},
            {role:'assistant',content:[{type:'reasoning',text:'先检查测试输出，再汇总失败原因。'},{type:'text',text:'### 检查进度\\n已完成 **单元测试**。'},{type:'tool_call',id:'c',name:'shell',arguments:{command:'pnpm test'}}]},
            {role:'tool',callId:'c',content:[],toolMeta:{stdout:'595 tests passed',exitCode:0}},
            {role:'assistant',content:[{type:'tool_call',id:'custom',name:'inspect_report',arguments:{path:'report.json'}}]},
            {role:'tool',callId:'custom',isError:true,toolError:{message:'报告校验失败：缺少字段'},content:[{type:'text',text:'已检查 3 个字段'}]}
          ],{markdown:renderMarkdown,sessionId:'smoke'}));
          dialog.append(title,note,content); document.body.append(dialog); dialog.showModal();
          for (const detail of dialog.querySelectorAll('details')) detail.open = true;
          if (!dialog.querySelector('.content strong') || dialog.querySelectorAll('.semantic-tool').length !== 1) throw new Error('Child transcript fixture failed');
          if(dialog.querySelector('.child-tool')?.dataset.phase!=='error' || !dialog.querySelector('.child-tool').textContent.includes('缺少字段') || dialog.querySelectorAll('.child-message').length!==3) throw new Error('Generic child call and result were not reconciled');
          content.scrollTop=content.scrollHeight;
        })()`);
      }
      if (process.env.SEAL_DESKTOP_SMOKE_REVIEW === "1") {
        await window.webContents.executeJavaScript(`(async () => {
          const { createToolCard } = await import('/tool-card.js');
          document.querySelector('#welcome')?.remove();
          const card = createToolCard({name:'replace_text',arguments:{path:'src/settings.ts',oldText:'false',newText:'true'}},'zh-CN',document,{
            loadReview: async () => ({path:'src/settings.ts',status:'applied',before:'export const settings = {\\n  enabled: false,\\n};',after:'export const settings = {\\n  enabled: true,\\n};'})
          });
          card.update({content:[{type:'text',text:'Updated src/settings.ts'}],details:{review:{available:true,snapshotId:'fixture'}}});
          card.root.open = true; document.querySelector('#transcript').append(card.root);
          await card.root.querySelector('button').onclick();
          if (!card.root.querySelector('.review-line.added') || !card.root.querySelector('.review-line.removed')) throw new Error('Review fixture did not render');
        })()`);
      }
      const state = await window.webContents.executeJavaScript(`({ title: document.title, token: location.search.includes('token='), root: !!document.querySelector('#root'), node: typeof window.require, cards: document.querySelectorAll('.semantic-tool').length })`);
      if (state.token || state.node !== "undefined" || !state.root) throw new Error(`Desktop smoke failed: ${JSON.stringify(state)}`);
      if (process.env.SEAL_DESKTOP_SMOKE_TOOLS === "1" && state.cards !== 3) throw new Error("Tool card fixture did not render");
      await window.webContents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 250))`);
      if (process.env.SEAL_DESKTOP_SCREENSHOT) await writeFile(process.env.SEAL_DESKTOP_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      if (process.env.SEAL_DESKTOP_SMOKE_RESULT) await writeFile(process.env.SEAL_DESKTOP_SMOKE_RESULT, JSON.stringify(state));
      process.stdout.write(`SEAL_DESKTOP_SMOKE_OK ${JSON.stringify(state)}\n`);
      app.quit();
    } else window.show();
  } catch (error) {
    if (smoke) { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; }
    else dialog.showErrorBox("Seal Harness 启动失败", error instanceof Error ? error.message : String(error));
    app.quit();
  }
  });
}
