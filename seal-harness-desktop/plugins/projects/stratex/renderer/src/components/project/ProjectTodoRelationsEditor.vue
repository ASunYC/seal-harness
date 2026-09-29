<script setup lang="ts">
import { PROJECT_MAX_REFS } from '@shared/protocol/project-collab.js';
import ProjectRefChip from './ProjectRefChip.vue';
import type { ProjectRefSources, ProjectRefTarget } from './project-refs';
import TodoRefPicker from './TodoRefPicker.vue';
import type { TodoRefPickerOption } from './TodoRefPicker.vue';

defineProps<{
  refChips: readonly {
    readonly token: string;
    readonly kindLabel: string | null;
    readonly name: string;
  }[];
  refSources: ProjectRefSources;
  refOptions: readonly TodoRefPickerOption[];
  refCount: number;
  sessionRef: string | null;
  editing: boolean;
}>();
const emit = defineEmits<{
  attach: [string];
  remove: [string];
  unbind: [];
  openRef: [ProjectRefTarget];
}>();
</script>

<template>
  <section class="todo-editor__section" aria-labelledby="todo-relations-heading">
    <h4 id="todo-relations-heading" class="todo-editor__heading">关联信息</h4>
    <!-- 关联面（G-10）：材料可挂可摘；会话只读（客户端没有挑会话的入口，不假装有） -->
    <div class="todo-field" data-testid="todo-relations">
      <span class="todo-field__label">关联材料</span>
      <div v-if="refChips.length > 0" class="todo-refs">
        <span v-for="chip in refChips" :key="chip.token" class="todo-ref">
          <ProjectRefChip
            :token="chip.token"
            :sources="refSources"
            @open="emit('openRef', $event)"
          />
          <button
            class="todo-ref__drop"
            type="button"
            :aria-label="`移除关联 ${chip.name}`"
            data-testid="todo-ref-remove"
            @click="emit('remove', chip.token)"
          >
            ×
          </button>
        </span>
      </div>
      <!-- 原生 select 在无边框窗口里会被对话框裁切且滚不动（2026-09-08 现场），改走弹层选择器。 -->
      <TodoRefPicker
        :options="refOptions"
        :disabled="refCount >= PROJECT_MAX_REFS || refOptions.length === 0"
        :placeholder="refOptions.length === 0 ? '暂无可关联的资产或待办' : '挂上一份资产或待办…'"
        test-id="todo-ref-add"
        @select="emit('attach', $event)"
      />
    </div>

    <div class="todo-field" data-testid="todo-session-ref">
      <span class="todo-field__label">关联会话</span>
      <p v-if="sessionRef" class="todo-session">
        <b class="todo-session__id">{{ sessionRef }}</b>
        <button
          v-if="editing"
          class="todo-session__drop"
          type="button"
          data-testid="todo-session-unbind"
          @click="emit('unbind')"
        >
          解除关联
        </button>
      </p>
      <p v-else class="todo-session todo-session--empty">未关联执行会话</p>
    </div>
  </section>
</template>

<style scoped src="./ProjectTodoDialog.css"></style>
