<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { projectRuntime, projectStorage, type ProjectConversation } from '../../../../../src/ui/runtime'
import WorkspaceBindingChip from '../workspace/WorkspaceBindingChip.vue'
import { useProjectWorkspaceStore } from '../../stores/projectWorkspace'

const props = defineProps<{ projectId: string }>()
const runtime = projectRuntime()
const workspace = useProjectWorkspaceStore()
const host = ref<HTMLElement | null>(null)
const busy = ref(false)
const error = ref('')
const ready = ref(false)
const storage = projectStorage()
const storageKey = `conversation.${props.projectId}`
let controller = new AbortController()
let conversation: ProjectConversation | undefined
let pending: Promise<void> | undefined
let pendingText = ''
let localProjectId: string | undefined

async function connect(sessionId?: string, fresh = false): Promise<void> {
  controller.abort()
  controller = new AbortController()
  const { signal } = controller
  conversation?.dispose()
  conversation = undefined
  ready.value = false
  busy.value = true
  error.value = ''
  try {
    const binding = await workspace.ensureProject(props.projectId)
    signal.throwIfAborted()
    if (binding?.status !== 'bound') {
      if (workspace.status === 'error' || workspace.status === 'unavailable') throw new Error('工作空间无法读取，请重新选择。')
      return
    }
    if (!sessionId && !fresh) {
      const selected = storage.getItem(storageKey)
      if (selected) {
        const result = await runtime.api.listProjectSessions({ projectId: props.projectId })
        signal.throwIfAborted()
        if (!result.ok) throw new Error(result.message)
        sessionId = result.sessions.find(row => row.sessionId === selected)?.sessionId
      }
    }
    const result = sessionId
      ? await runtime.api.openProjectSession({ projectId: props.projectId, sessionId })
      : await runtime.api.createProjectSession({ projectId: props.projectId })
    signal.throwIfAborted()
    if (!result.ok) throw new Error(result.message)
    if (!host.value) return
    const mounted = await runtime.mountConversation(host.value, result.sessionId, signal)
    signal.throwIfAborted()
    conversation = mounted
    storage.setItem(storageKey, result.sessionId)
    ready.value = true
    if (pendingText) conversation.prefill(pendingText)
    pendingText = ''
  } catch (failure) {
    if (!signal.aborted) error.value = failure instanceof Error ? failure.message : '会话无法打开，请重试。'
  } finally {
    if (!signal.aborted) busy.value = false
  }
}

function open(sessionId?: string, fresh = false): Promise<void> {
  const operation = connect(sessionId, fresh)
  pending = operation
  void operation.finally(() => { if (pending === operation) pending = undefined })
  return operation
}

async function prefill(text: string) {
  if (conversation) {
    try { conversation.prefill(text); error.value = '' }
    catch (failure) { error.value = failure instanceof Error ? failure.message : '拆解文字填入失败，请重试。' }
    return
  }
  if (text) pendingText = pendingText ? `${pendingText}\n\n${text}` : text
  await (pending ?? open())
}

onMounted(() => { void open() })
watch(() => workspace.snapshot, snapshot => {
  if (snapshot?.status !== 'bound' || snapshot.collabProjectId !== props.projectId) return
  // 选择期间快照会清空，只比较前后成功绑定的空间，取消或重选同一空间不重建会话。
  const changed = localProjectId !== undefined && localProjectId !== snapshot.localProjectId
  localProjectId = snapshot.localProjectId
  if (changed) {
    storage.removeItem(storageKey)
    void open(undefined, true)
  } else if (!pending && !ready.value && host.value) void open()
}, { immediate: true })
onBeforeUnmount(() => { controller.abort(); conversation?.dispose() })
defineExpose({ prefill, open })
</script>

<template>
  <section class="project-conversation" aria-label="项目 AI 对话">
    <div class="project-conversation__toolbar">
      <WorkspaceBindingChip v-if="!ready" :project-id="projectId" :disabled="busy" />
      <span v-else class="project-conversation__hint">新对话使用项目页所选工作空间</span>
      <button class="btn btn--ghost" type="button" :disabled="busy || workspace.status !== 'bound'" @click="open(undefined, true)">新建对话</button>
    </div>
    <p v-if="busy" role="status">正在打开项目对话…</p>
    <p v-else-if="error" role="alert">{{ error }} <button class="btn btn--secondary" type="button" @click="open()">重试</button></p>
    <p v-else-if="!ready" role="status">选择项目工作空间后即可开始对话。</p>
    <div ref="host" class="project-conversation__content" />
  </section>
</template>

<style scoped>
.project-conversation{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.project-conversation__toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);padding:var(--sp-2) var(--sp-4)}
.project-conversation__content{display:flex;flex:1;min-width:0;min-height:0}
p{margin:var(--sp-3) var(--sp-4)}
[role=alert]{color:var(--danger-text)}
</style>
