<script setup lang="ts">
import type { ProjectTestRoundSnapshot } from '@shared/protocol/project-testing.js';
import { TODO_STATUS_LABELS, TODO_PRIORITY_LABELS } from './project-format';
defineProps<{ snapshot: ProjectTestRoundSnapshot }>();
</script>

<template>
  <section class="round-snapshot" aria-label="提交时快照" data-testid="round-snapshot">
    <h3>提交时快照</h3>
    <p>以下内容保留提交时的记录。</p>
    <section aria-label="需求">
      <h4>需求</h4>
      <strong>{{ snapshot.requirement.title }}</strong>
      <p class="preserve">{{ snapshot.requirement.description || '无描述' }}</p>
      <dl>
        <dt>需求标识</dt>
        <dd>{{ snapshot.requirement.id }}</dd>
        <dt>状态</dt>
        <dd>{{ TODO_STATUS_LABELS[snapshot.requirement.status] }}</dd>
        <dt>优先级</dt>
        <dd>{{ TODO_PRIORITY_LABELS[snapshot.requirement.priority] }}</dd>
        <dt>约束</dt>
        <dd class="preserve">{{ snapshot.requirement.constraintsText || '无' }}</dd>
        <dt>标签</dt>
        <dd>{{ snapshot.requirement.labels.join('、') || '无' }}</dd>
      </dl>
    </section>
    <section aria-label="任务">
      <h4>任务 · {{ snapshot.tasks.length }}</h4>
      <ul>
        <li v-for="task in snapshot.tasks" :key="task.id">
          <strong>{{ task.title }}</strong> · {{ TODO_STATUS_LABELS[task.status] }}
          <p>标识：{{ task.id }} · 父项：{{ task.parentId || '无' }}</p>
        </li>
      </ul>
      <p v-if="!snapshot.tasks.length">无任务</p>
    </section>
    <section aria-label="完成标准">
      <h4>完成标准 · {{ snapshot.criteria.length }}</h4>
      <ol>
        <li v-for="criterion in snapshot.criteria" :key="criterion.ordinal">
          #{{ criterion.ordinal }} · {{ criterion.checked ? '已完成' : '未完成' }} ·
          {{ criterion.text }}
        </li>
      </ol>
      <p v-if="!snapshot.criteria.length">无完成标准</p>
    </section>
    <section aria-label="交付物版本">
      <h4>交付物版本 · {{ snapshot.attachments.length }}</h4>
      <ul>
        <li v-for="attachment in snapshot.attachments" :key="attachment.fileVersionId">
          <strong>{{ attachment.filename }}</strong> · 第 {{ attachment.versionNo }} 版
          <dl>
            <dt>版本标识</dt>
            <dd>{{ attachment.fileVersionId }}</dd>
            <dt>资产标识</dt>
            <dd>{{ attachment.assetId }}</dd>
            <dt>大小（字节）</dt>
            <dd>{{ attachment.byteSize }}</dd>
            <dt>内容摘要</dt>
            <dd>{{ attachment.contentSha256 }}</dd>
          </dl>
        </li>
      </ul>
      <p v-if="!snapshot.attachments.length">无交付物</p>
    </section>
    <section aria-label="提测门槛">
      <h4>提测门槛 · 第 {{ snapshot.gate.gateVersion }} 版</h4>
      <dl>
        <dt>至少一项任务</dt>
        <dd>{{ snapshot.gate.submissionGate.requireTasks ? '是' : '否' }}</dd>
        <dt>全部任务完成</dt>
        <dd>{{ snapshot.gate.submissionGate.requireAllTasksDone ? '是' : '否' }}</dd>
        <dt>具备完成标准</dt>
        <dd>{{ snapshot.gate.submissionGate.requireCriteria ? '是' : '否' }}</dd>
        <dt>交付物已就绪</dt>
        <dd>{{ snapshot.gate.submissionGate.requireReadyArtifacts ? '是' : '否' }}</dd>
        <dt>必过标准数量</dt>
        <dd>{{ snapshot.gate.requiredItemCount }}</dd>
        <dt>必过标准序号</dt>
        <dd>{{ snapshot.gate.requiredItemOrdinals.join('、') || '无' }}</dd>
      </dl>
    </section>
  </section>
</template>

<style scoped>
.round-snapshot {
  display: grid;
  gap: var(--px-12);
  overflow-wrap: anywhere;
}
h3,
h4,
p {
  margin: 0;
}
section section {
  padding: var(--px-12);
  border: var(--bw) solid var(--line);
  border-radius: var(--r-md);
}
dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
  gap: var(--px-4) var(--px-12);
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
}
.preserve {
  white-space: pre-wrap;
}
</style>
