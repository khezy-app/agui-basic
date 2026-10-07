<script setup lang="ts">
import { computed, ref } from 'vue'

import { config } from '@/config'
import { useCoworkStore } from '@/stores/cowork'
import type { RunPhase } from '@/stores/cowork'

import CoworkComposer from './CoworkComposer.vue'
import TranscriptView from './TranscriptView.vue'

const emit = defineEmits<{ close: [] }>()

const store = useCoworkStore()
const collapsed = ref(false)

/** The phase label is never colour alone (FE-13 §4.2). */
const PHASE: Record<RunPhase, { label: string; kind: string }> = {
  idle: { label: 'Idle', kind: 'idle' },
  starting: { label: 'Thinking…', kind: 'active' },
  streaming: { label: 'Thinking…', kind: 'active' },
  awaiting_approval: { label: 'Waiting for your approval', kind: 'waiting' },
  interrupted: { label: 'Waiting for your answer', kind: 'waiting' },
  stopped: { label: 'Stopped', kind: 'idle' },
  error: { label: 'Error', kind: 'error' },
}

const phase = computed(() => PHASE[store.phase])
</script>

<template>
  <aside v-if="store.enabled" class="cowork-panel" aria-label="AI Cowork">
    <header class="panel-head">
      <h2 class="panel-title">AI Cowork</h2>
      <div class="panel-actions">
        <button
          type="button"
          class="icon-btn"
          :aria-label="collapsed ? 'Expand panel' : 'Minimise panel'"
          @click="collapsed = !collapsed"
        >
          {{ collapsed ? '▴' : '▾' }}
        </button>
        <button type="button" class="icon-btn" aria-label="Close panel" @click="emit('close')">
          ✕
        </button>
      </div>
    </header>

    <div class="status-strip">
      <span class="phase-dot" :class="`phase-${phase.kind}`" aria-hidden="true"></span>
      <span class="phase-label">{{ phase.label }}</span>
      <span v-if="config.aguiModel" class="model-hint">{{ config.aguiModel }}</span>
    </div>
    <p v-if="store.needsResync" class="resync">resyncing state…</p>
    <p v-if="store.lastError" class="panel-error" role="alert">{{ store.lastError }}</p>

    <template v-if="!collapsed">
      <TranscriptView />
      <CoworkComposer />
    </template>
  </aside>
</template>

<style scoped>
.cowork-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border-left: 1px solid var(--border);
  background: var(--surface);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
}

.panel-title {
  font-size: 14px;
  margin: 0;
}

.panel-actions {
  display: flex;
  gap: var(--space-1);
}

.icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: var(--text-muted);
  padding: var(--space-1);
}

.status-strip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  font-size: 12px;
  color: var(--text-muted);
}

.phase-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.phase-active {
  background: var(--primary);
}

.phase-waiting {
  background: var(--warning);
}

.phase-error {
  background: var(--danger);
}

.phase-idle {
  background: var(--text-muted);
}

.model-hint {
  margin-left: auto;
  font-size: 11px;
}

.resync {
  margin: 0;
  padding: 0 var(--space-3);
  color: var(--text-muted);
  font-size: 11px;
  font-style: italic;
}

.panel-error {
  margin: 0;
  padding: 0 var(--space-3);
  color: var(--danger);
  font-size: 12px;
}
</style>
