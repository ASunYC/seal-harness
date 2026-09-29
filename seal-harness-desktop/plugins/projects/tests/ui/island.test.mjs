import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../../../..', import.meta.url))
const project = resolve(root, 'seal-harness-desktop/plugins/projects')
const dependencies = process.env.SEAL_HARNESS_UI_DEPS ?? root
const require = createRequire(resolve(dependencies, 'package.json'))
const desktopRequire = createRequire(resolve(dependencies, 'dsh-plugin-desktop-beta/package.json'))
const { build } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href)

test('真实项目列表与八页签、局部弹层、卸载与迟到响应隔离', async () => {
  const output = await mkdtemp(resolve(tmpdir(), 'seal-harness-project-ui-'))
  const window = new Window({ url: 'http://localhost' })
  for (const key of ['window', 'document', 'history', 'location', 'navigator', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'ShadowRoot', 'KeyboardEvent', 'localStorage', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : typeof window[key] === 'function' && /^[a-z]/.test(key) ? window[key].bind(window) : window[key], configurable: true })
  }
  let dispose
  try {
    await build({
      configFile: false, root: project, plugins: [vue()], logLevel: 'warn',
      resolve: { alias: {
        '@shared': process.env.SEAL_HARNESS_UI_SHARED ?? resolve(project, 'stratex/shared'),
        vue: require.resolve('vue/dist/vue.esm-bundler.js'),
        pinia: require.resolve('pinia'), 'vue-router': require.resolve('vue-router'), zod: desktopRequire.resolve('zod'),
        'markdown-it': require.resolve('markdown-it'), 'highlight.js/lib/common': require.resolve('highlight.js/lib/common'),
      } },
      define: { 'process.env.NODE_ENV': '"test"' },
      build: { outDir: output, minify: false, lib: { entry: resolve(project, 'src/ui/mount.ts'), formats: ['es'], cssFileName: 'island', fileName: () => 'island.mjs' } },
    })
    const { mountProjects } = await import(pathToFileURL(resolve(output, 'island.mjs')).href)
    const css = await readFile(resolve(output, 'island.css'), 'utf8')
    const outside = document.createElement('button')
    outside.className = 'btn'
    outside.textContent = 'DSH 外壳'
    const host = document.createElement('main')
    document.body.append(outside, host)
    let listeners = 0
    let resolveLate
    let calls = 0
    const navigation = { projectId: null }
    const sidebarStates = new Map()
    let requirementCalls = 0
    const eventCallbacks = new Set()
    let workspaceBound = false
    let workspaceId = 'default'
    let deferSessionCreate
    let deferConversationMount
    let failSessionCreate = false
    let sessionCreates = 0
    const sessions = []
    const mountedChats = []
    const api = {
      readProjectCollabAvailability: async () => ({ enabled: true, mySubject: 'account-a' }),
      listProjects: async () => {
        calls += 1
        if (calls === 2) return new Promise(resolve => { resolveLate = resolve })
        return { ok: true, projects: [
          { id: 'project-a', name: '地形研究', myRole: 'owner', memberCount: 1, createdAt: '2026-09-23T00:00:00Z', lastActivityAt: null, archivedAt: null, summary: '', memberPreview: [], unreadCount: 0 },
          { id: 'project-b', name: '遥感分析', myRole: 'editor', memberCount: 2, createdAt: '2026-09-23T00:00:00Z', lastActivityAt: null, archivedAt: null, summary: '', memberPreview: [], unreadCount: 0 },
        ] }
      },
      readProjectDetail: async ({ projectId }) => ({ ok: true, project: { id: projectId, name: '地形研究', instructionsText: '项目说明', myRole: 'owner', archivedAt: null, createdAt: '2026-09-23T00:00:00Z', members: [] } }),
      resolveProjectWorkspace: async ({ collabProjectId }) => ({ ok: true, snapshot: workspaceBound ? { status: 'bound', collabProjectId, localProjectId: workspaceId, displayName: workspaceId, binding: { bindingId: workspaceId, revision: 1 } } : { status: 'unbound', collabProjectId, localProjectId: null, displayName: null, binding: null } }),
      listProjectLocalWorkspaces: async () => ({ ok: true, workspaces: ['default', 'dsh-play', 'other'].map(localProjectId => ({ localProjectId, displayName: localProjectId })) }),
      listProjectLinkedDirectories: async () => ({ ok: true, directories: [] }),
      selectProjectLocalWorkspace: async ({ collabProjectId, localProjectId }) => {
        workspaceBound = true
        workspaceId = localProjectId
        return api.resolveProjectWorkspace({ collabProjectId })
      },
      selectProjectWorkspace: async () => ({ ok: false, error: { code: 'unavailable', referenceCode: 'project-workspace:selectionCancelled' } }),
      readProjectServiceCapabilities: async () => ({ ok: true, capabilities: { serviceVersion: 'test', capabilities: ['requirement.dictionaries', 'requirement.test_cases', 'requirement.test_mode', 'chat_idempotency', 'chat_search'] } }),
      listProjectRequirementPage: async ({ pageSize = 50 }) => { requirementCalls++; return { ok: true, items: [], total: 0, page: 1, pageSize, queryRevision: 'revision-1' } },
      listProjectDictionaries: async () => ({ ok: true, items: [], total: 0, page: 1, pageSize: 100 }),
      listProjectTodoDrafts: async () => ({ ok: true, batches: [] }),
      listProjectTodos: async () => ({ ok: true, todos: [], hasMore: false, nextCursor: null }),
      listProjectFeed: async () => ({ ok: true, entries: [] }),
      listProjectMilestones: async () => ({ ok: true, items: [], total: 0, page: 1, pageSize: 20 }),
      listProjectTestRounds: async () => ({ ok: true, items: [], total: 0, hasMore: false, nextCursor: null }),
      readProjectWorkOverview: async () => ({ ok: true, counts: { overdue: 0, dueToday: 0, incomplete: 0, participating: 0 }, total: 0, items: [], nextCursor: null }),
      readProjectChatHistory: async () => ({ ok: true, messages: [], readSeq: 0, latestSeq: 0 }),
      setProjectReadCursor: async () => ({ ok: true }),
      createProjectSession: async ({ projectId }) => {
        if (failSessionCreate) return { ok: false, message: '创建会话失败' }
        const sessionId = `native-${++sessionCreates}`
        sessions.push({ sessionId, title: projectId, cwd: `/workspace/${workspaceId}`, updatedAt: new Date().toISOString() })
        if (deferSessionCreate) await new Promise(resolve => { deferSessionCreate = resolve })
        return { ok: true, sessionId }
      },
      openProjectSession: async ({ sessionId }) => ({ ok: true, sessionId }),
      listProjectSessions: async () => ({ ok: true, sessions: [...sessions, { sessionId: 'dsh-session-1', title: '真实会话映射', updatedAt: '2026-09-23T00:00:00Z' }] }),
      listProjectFiles: async () => ({ ok: true, files: [] }),
      listProjectAssets: async () => ({ ok: true, assets: [] }),
      listProjectAssetTrash: async () => ({ ok: true, assets: [] }),
      onProjectEvent: callback => { eventCallbacks.add(callback); listeners += 1; return () => { eventCallbacks.delete(callback); listeners -= 1 } },
      onProjectAgentChanged: () => { listeners += 1; return () => { listeners -= 1 } },
      onProjectNotificationNavigate: () => { listeners += 1; return () => { listeners -= 1 } },
      onProjectJoinLink: () => { listeners += 1; return () => { listeners -= 1 } },
    }
    dispose = await mountProjects(host, { api, css, sidebarStates, navigation, returnToConversation: async () => {}, mountConversation: async () => { throw new Error("未绑定空间不得挂载对话") }, accountId: 'test-account-a' })
    await window.happyDOM.whenAsyncComplete()
    const shadow = host.shadowRoot
    assert.match(shadow.textContent, /地形研究/)
    assert.match(shadow.textContent, /遥感分析/)
    assert.equal(document.querySelector('.projects-page'), null)
    assert.equal(document.head.querySelector('style'), null)
    document.body.setAttribute('data-ds-dark-theme', '')
    await window.happyDOM.whenAsyncComplete()
    assert.equal(host.dataset.theme, 'dark')
    const search = shadow.querySelector('input[type="search"]')
    shadow.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    assert.equal(shadow.activeElement, search)
    search.value = '地形'
    search.dispatchEvent(new window.Event('input', { bubbles: true }))
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.querySelectorAll('.project-card').length || shadow.querySelectorAll('[data-testid^="project-card"]').length, 1)
    const create = [...shadow.querySelectorAll('button')].find(button => button.textContent.trim() === '新建项目')
    create.focus()
    create.click()
    await window.happyDOM.whenAsyncComplete()
    assert.ok(shadow.querySelector('[role="dialog"]'))
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.equal(shadow.querySelector('.projects-root').inert, true)
    shadow.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.querySelector('[role="dialog"]'), null)
    assert.equal(shadow.activeElement, create)
    shadow.querySelector('.project-card').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.querySelectorAll('.project-tab').length, 8)
    for (const name of ['pin', 'shield', 'session']) {
      const icon = shadow.querySelector(`.project-tab [data-icon-name="${name}"]`)
      assert.ok(icon?.querySelector('path'), `${name} 显示对应业务图形，不能退回占位圆圈`)
      assert.equal(icon.getAttribute('aria-hidden'), 'true')
    }
    for (const tab of ['feed', 'milestones', 'requirements', 'tasks', 'tests', 'chat', 'sessions', 'assets']) {
      shadow.querySelector(`[data-tab="${tab}"]`).click()
      await window.happyDOM.whenAsyncComplete()
      assert.equal(shadow.querySelector('.project-tab.is-on')?.getAttribute('data-tab'), tab)
      if (tab === 'sessions') assert.match(shadow.textContent, /真实会话映射/)
    }
    const back = shadow.querySelector('.project-detail__back')
    back.click()
    await window.happyDOM.whenAsyncComplete()
    shadow.querySelector('[data-testid="projects-archived-toggle"]').click()
    await Promise.resolve()
    dispose()
    assert.equal(listeners, 0)
    assert.equal(shadow.childNodes.length, 0)
    resolveLate({ ok: true, projects: [{ id: 'late', name: '旧账号秘密' }] })
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.childNodes.length, 0)
    assert.equal(outside.isConnected, true)
    const lifetime = new AbortController()
    const pending = mountProjects(host, { api, css, sidebarStates, navigation, returnToConversation: async () => {}, mountConversation: async () => { throw new Error("未绑定空间不得挂载对话") }, accountId: 'test-account-b', signal: lifetime.signal })
    lifetime.abort()
    await pending
    assert.equal(shadow.childNodes.length, 0)
    assert.equal(listeners, 0)
    const mountConversation = async (seat, sessionId, signal) => {
      const chat = { sessionId, cwd: sessions.find(row => row.sessionId === sessionId)?.cwd, disposed: false }
      mountedChats.push(chat)
      const dispose = () => { chat.disposed = true; content.remove() }
      signal.addEventListener('abort', dispose, { once: true })
      const content = document.createElement('div')
      content.textContent = `原生会话 ${sessionId}`
      seat.append(content)
      if (deferConversationMount) await new Promise(resolve => { deferConversationMount = resolve })
      return { dispose, prefill: text => { chat.draft = text } }
    }
    const options = { api, css, sidebarStates, navigation, returnToConversation: async () => {}, mountConversation, accountId: 'test-account-c', initialProjectId: 'project-a' }
    const queriesBeforeDirect = requirementCalls
    dispose = await mountProjects(host, options)
    await window.happyDOM.whenAsyncComplete()
    assert.equal(sessionCreates, 0, '未绑定时不创建会话')
    shadow.querySelector('.project-detail__sub button').click()
    await window.happyDOM.whenAsyncComplete()
    const chooseWorkspace = async id => {
      const select = shadow.querySelector('[role="dialog"] select')
      select.value = id
      select.dispatchEvent(new window.Event('change', { bubbles: true }))
      await window.happyDOM.whenAsyncComplete()
    }
    await chooseWorkspace('default')
    shadow.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await window.happyDOM.whenAsyncComplete()
    shadow.querySelector('[data-tab="requirements"]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.ok(requirementCalls > queriesBeforeDirect, '直接进入详情也必须初始化身份并发起需求查询')
    assert.equal(eventCallbacks.size, 2, '详情页分别订阅业务事件与连接恢复')
    const queriesBeforeReconnect = requirementCalls
    for (const state of ['degraded', 'online']) {
      for (const callback of eventCallbacks) callback({ kind: 'connection', payload: { state } })
      await window.happyDOM.whenAsyncComplete()
    }
    assert.ok(requirementCalls > queriesBeforeReconnect, '重同步和断线恢复补拉当前需求页')
    assert.equal(shadow.querySelectorAll('.project-tab').length, 8)
    for (const name of ['pin', 'shield', 'session']) {
      const icon = shadow.querySelector(`.project-tab [data-icon-name="${name}"]`)
      assert.ok(icon?.querySelector('path'), `${name} 显示对应业务图形，不能退回占位圆圈`)
      assert.equal(icon.getAttribute('aria-hidden'), 'true')
    }
    assert.equal(sessionCreates, 1)
    assert.equal(shadow.querySelector('.project-composer'), null)
    assert.match(shadow.textContent, /原生会话 native-1/)
    const panel = shadow.querySelector('.project-assistant')
    Object.defineProperty(panel.parentElement, 'clientWidth', { value: 1200 })
    const nativeSeat = shadow.querySelector('.project-conversation')
    assert.equal(shadow.querySelector('[data-testid=project-assistant-toggle]').getAttribute('aria-pressed'), 'true', '首次默认助理')
    assert.ok(shadow.querySelector('[data-testid="project-members"]'))
    assert.ok(shadow.querySelector('[data-testid="project-shared-materials"]'))
    const inputDraft = document.createElement('textarea')
    inputDraft.value = '切换侧栏内容保留草稿'
    nativeSeat.append(inputDraft)
    shadow.querySelector('[data-testid=project-overview-toggle]').click()
    shadow.querySelector('[data-testid="project-assistant-toggle"]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.querySelector('[data-testid=project-assistant-toggle]').getAttribute('aria-pressed'), 'true')
    shadow.querySelector('[data-testid=project-overview-toggle]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.querySelector('#project-chat-panel').style.display, 'none')
    shadow.querySelector('[data-testid=project-assistant-toggle]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.querySelector('[data-testid=project-assistant-toggle]').getAttribute('aria-pressed'), 'true')
    assert.equal(inputDraft.isConnected, true)
    assert.equal(inputDraft.value, '切换侧栏内容保留草稿')
    assert.equal(mountedChats.length, 1, '切换侧栏内容不重新挂载原生会话')

    shadow.querySelector('[data-testid="project-assistant-expand"]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(panel.classList.contains('is-expanded'), true)
    const separator = panel.querySelector('[role="separator"]')
    separator.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await window.happyDOM.whenAsyncComplete()
    assert.equal(separator.getAttribute('aria-valuenow'), '460')
    separator.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await window.happyDOM.whenAsyncComplete()
    assert.equal(separator.getAttribute('aria-valuenow'), '360')
    separator.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await window.happyDOM.whenAsyncComplete()
    assert.equal(separator.getAttribute('aria-valuenow'), '1200', '可拉满项目内容区，不受 720px 或 60% 限制')
    shadow.querySelector('[data-testid="project-assistant-collapse"]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(mountedChats[0].disposed, false, '收起不得销毁原生输入状态')
    assert.equal(panel.style.display, 'none')
    assert.equal(panel.classList.contains('is-expanded'), false)
    shadow.querySelector('[data-testid="project-assistant-toggle"]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(sessionCreates, 1)
    assert.equal(shadow.querySelector('.project-conversation'), nativeSeat, '布局切换保持同一个原生对话实例')
    shadow.querySelector('[data-testid=project-overview-toggle]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(sidebarStates.get('project-a').tab, 'overview')
    shadow.querySelector('[data-testid="project-assistant-collapse"]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.deepEqual(sidebarStates.get('project-a'), { tab: 'overview', open: false, width: 1200 })
    dispose()
    assert.equal(mountedChats[0].disposed, true)
    dispose = await mountProjects(host, { ...options, initialProjectId: undefined })
    await window.happyDOM.whenAsyncComplete()
    assert.equal(navigation.projectId, 'project-a', '返回功能时自动进入上次项目')
    assert.equal(shadow.querySelector('.project-assistant').style.display, 'none', '离开后恢复收起状态')
    assert.equal(shadow.querySelector('.project-assistant').style.getPropertyValue('--assistant-width'), '1200px', '恢复拖动宽度')
    shadow.querySelector('[data-testid=project-overview-toggle]').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.querySelector('[data-testid=project-overview-toggle]').getAttribute('aria-pressed'), 'true', '恢复概览')
    assert.equal(sessionCreates, 1, '返回项目恢复已选择会话')
    assert.equal(mountedChats.at(-1).sessionId, 'native-1')
    const newChat = [...shadow.querySelectorAll('button')].find(button => button.textContent === '新建对话')
    newChat.click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(sessionCreates, 2)
    assert.equal(mountedChats.at(-2).disposed, true)
    assert.equal(mountedChats.at(-1).sessionId, 'native-2')
    shadow.querySelector('.project-detail__sub button').click()
    await window.happyDOM.whenAsyncComplete()
    await chooseWorkspace('dsh-play')
    assert.equal(sessionCreates, 3, '切换工作空间自动创建对应空间的新会话')
    assert.equal(mountedChats.at(-1).cwd, '/workspace/dsh-play')
    assert.equal(mountedChats.at(-2).disposed, true)
    assert.equal(sessions.find(row => row.sessionId === 'native-2').cwd, '/workspace/default', '旧会话保留原目录')
    await chooseWorkspace('dsh-play')
    assert.equal(sessionCreates, 3, '重复选择同一空间不重建会话')
    const pickDirectory = [...shadow.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === '选择工作空间')
    pickDirectory.click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(sessionCreates, 3, '取消目录选择不重建会话')
    deferSessionCreate = true
    await chooseWorkspace('other')
    assert.equal(sessionCreates, 4)
    const resolveOldCreate = deferSessionCreate
    deferSessionCreate = undefined
    await chooseWorkspace('default')
    assert.equal(sessionCreates, 5)
    assert.equal(mountedChats.at(-1).cwd, '/workspace/default')
    resolveOldCreate()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(mountedChats.at(-1).sessionId, 'native-5', '旧创建响应不能替换最新空间的会话')
    assert.equal(localStorage.getItem('seal-harness.projects.test-account-c.conversation.project-a'), 'native-5')
    deferConversationMount = true
    await chooseWorkspace('other')
    const resolveOldMount = deferConversationMount
    deferConversationMount = undefined
    await chooseWorkspace('dsh-play')
    const latestChat = mountedChats.at(-1)
    resolveOldMount()
    await window.happyDOM.whenAsyncComplete()
    await chooseWorkspace('default')
    assert.equal(latestChat.disposed, true, '旧挂载返回不能覆盖当前会话引用，下一次切换必须释放当前会话')
    assert.equal(mountedChats.filter(chat => !chat.disposed).length, 1)
    failSessionCreate = true
    await chooseWorkspace('other')
    assert.match(shadow.querySelector('.project-conversation [role="alert"]').textContent, /创建会话失败/)
    assert.equal(localStorage.getItem('seal-harness.projects.test-account-c.conversation.project-a'), null, '创建失败不能保留旧空间的恢复指针')
    failSessionCreate = false
    shadow.querySelector('.project-conversation [role="alert"] button').click()
    await window.happyDOM.whenAsyncComplete()
    assert.equal(mountedChats.at(-1).cwd, '/workspace/other', '重试仍使用最新选择的空间')
    shadow.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await window.happyDOM.whenAsyncComplete()
    dispose()
    dispose = await mountProjects(host, { ...options, initialProjectId: 'project-b' })
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.querySelector('[data-testid=project-assistant-toggle]').getAttribute('aria-pressed'), 'true', '其他项目首次仍默认助理')
    assert.equal(sidebarStates.get('project-a').tab, 'overview', '其他项目不覆盖已记住的选择')
    assert.equal(shadow.querySelector('.project-assistant').style.getPropertyValue('--assistant-width'), '440px', '新项目不继承其他项目宽度')
    dispose()
    sidebarStates.clear()
    dispose = await mountProjects(host, options)
    await window.happyDOM.whenAsyncComplete()
    assert.equal(shadow.querySelector('[data-testid=project-assistant-toggle]').getAttribute('aria-pressed'), 'true', '清空运行期记忆后恢复默认助理')
    dispose()
    const unavailableApi = { ...api, readProjectDetail: async () => ({ ok: false, code: 'forbidden' }) }
    dispose = await mountProjects(host, { ...options, api: unavailableApi, initialProjectId: undefined })
    await window.happyDOM.whenAsyncComplete()
    assert.equal(navigation.projectId, null, '不可访问的记忆项目被清除')
    assert.equal(shadow.querySelector('.project-detail'), null)
    assert.ok(shadow.querySelector('.projects-page'), '不可访问时回项目列表')
  } finally {
    dispose?.()
    await window.happyDOM.close()
    await rm(output, { recursive: true, force: true })
  }
})
