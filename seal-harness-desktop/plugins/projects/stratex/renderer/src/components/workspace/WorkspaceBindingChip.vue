<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { projectRuntime } from '../../../../../src/ui/runtime'
import { useProjectWorkspaceStore } from '../../stores/projectWorkspace'
import ProjectDialogShell from '../project/ProjectDialogShell.vue'

const props = defineProps<{ projectId: string; variant?: 'chip' | 'inline'; disabled?: boolean }>()
const store = useProjectWorkspaceStore()
const runtime = projectRuntime()
const open = ref(false)
const recent = ref<Array<{ localProjectId: string; displayName: string }>>([])
const recentError = ref('')
let generation = 0
watch(() => props.projectId, id => { generation++; open.value = false; recent.value = []; void store.ensureProject(id) }, { immediate: true })
onBeforeUnmount(() => { generation++ })

async function show() {
  open.value = true
  recentError.value = ''
  const current = generation
  void store.refreshDirectories(props.projectId)
  try {
    const result = await runtime.api.listProjectLocalWorkspaces({ collabProjectId: props.projectId })
    if (current !== generation) return
    if (result.ok) recent.value = result.workspaces
    else recentError.value = '最近工作空间读取失败。'
  } catch { if (current === generation) recentError.value = '最近工作空间读取失败。' }
}
</script>

<template>
  <button class="btn btn--secondary" type="button" :disabled="disabled" @click="show">{{ store.displayName ?? '选择工作空间' }}</button>
  <ProjectDialogShell v-if="open" title="本地空间与关联目录" @close="open = false">
    <p>工作空间：{{ store.displayName ?? '尚未选择' }}</p>
    <button class="btn btn--secondary" type="button" :disabled="store.status === 'loading'" @click="store.selectProject(projectId)">{{ store.status === 'loading' ? '正在选择…' : '选择工作空间' }}</button>
    <p v-if="store.status === 'error'" role="alert">工作空间操作失败，请重试。</p>
    <label v-if="recent.length">最近工作空间<select :value="store.snapshot?.localProjectId ?? ''" :disabled="store.status === 'loading'" @change="store.selectLocalProject(projectId, ($event.target as HTMLSelectElement).value)"><option value="" disabled>选择已有工作空间</option><option v-for="item in recent" :key="item.localProjectId" :value="item.localProjectId">{{ item.displayName }}</option></select></label>
    <p v-if="recentError" role="alert">{{ recentError }}</p>
    <h4>只读关联目录</h4>
    <p>助理可读取这些目录作为参考，写入仍在工作空间中进行。</p>
    <ul v-if="store.directories.length" class="linked-directories">
      <li v-for="directory in store.directories" :key="directory.refId"><span>{{ directory.displayName }} · {{ directory.availability === 'offline' ? '离线' : '只读' }}</span><button class="btn btn--ghost" type="button" :disabled="store.directoryBusy" @click="store.removeDirectory(projectId, directory.refId)">移除</button></li>
    </ul>
    <p v-else-if="!store.directoryBusy && !store.directoryNotice">尚未关联其他目录。</p>
    <p v-if="store.directoryNotice" :role="store.directoryNotice.tone === 'error' ? 'alert' : 'status'">{{ store.directoryNotice.text }}</p>
    <div><button class="btn btn--secondary" type="button" :disabled="store.directoryBusy" @click="store.addDirectory(projectId)">添加关联目录</button><button class="btn btn--ghost" type="button" :disabled="store.directoryBusy" @click="store.refreshDirectories(projectId)">刷新</button></div>
  </ProjectDialogShell>
</template>
<style scoped>.linked-directories{list-style:none;margin:0;padding:0}.linked-directories li{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3)}</style>
