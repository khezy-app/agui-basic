<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ToolCallItem as ToolCall } from '@/agui/transcript'

/**
 * One tool call, always visible (FR-AI-08) — never hidden behind a hover, because the
 * demo's point is watching the agent work.
 */
const props = defineProps<{
  call: ToolCall
  /** Anchor of the card this call opened, when one is on screen ("view confirmation"). */
  cardHref?: string | null
  /**
   * Render the plain result text. Suppressed when a card renders the same result, so the
   * raw JSON does not appear twice (FE-13 §4.4).
   */
  showResult?: boolean
}>()

const showResult = computed(
  () =>
    props.showResult !== false &&
    props.call.resultContent !== null &&
    props.call.resultContent !== '',
)

const expanded = ref(false)

const argsJson = computed(() =>
  props.call.args === undefined ? null : JSON.stringify(props.call.args, null, 2),
)

/** Raw text is only shown while the arguments are still arriving or unparseable (FR-AI-27). */
const rawArgs = computed(() => (argsJson.value === null ? props.call.argsText : null))

const badge = computed(() => {
  if (props.call.interruptId !== null) return { label: 'awaiting approval', kind: 'approval' }
  if (props.call.state === 'done') return { label: 'done', kind: 'done' }
  if (props.call.state === 'error') return { label: 'failed', kind: 'failed' }
  return { label: 'running…', kind: 'running' }
})
</script>

<template>
  <div class="tool-call" :data-tool-call-id="call.id">
    <div class="head">
      <button
        type="button"
        class="toggle"
        :aria-expanded="expanded"
        :aria-label="`Toggle arguments for ${call.name}`"
        @click="expanded = !expanded"
      >
        {{ expanded ? '▾' : '▸' }}
      </button>
      <code class="name">{{ call.name }}</code>
      <span class="badge" :class="`badge-${badge.kind}`">{{ badge.label }}</span>
      <a v-if="cardHref" class="card-link" :href="cardHref">view confirmation</a>
    </div>
    <div v-if="expanded" class="detail">
      <pre v-if="argsJson !== null" class="args">{{ argsJson }}</pre>
      <template v-else>
        <span class="receiving">receiving arguments…</span>
        <pre v-if="rawArgs !== null && rawArgs !== ''" class="args">{{ rawArgs }}</pre>
      </template>
    </div>
    <p v-if="call.resultError !== null" class="result-error">{{ call.resultError }}</p>
    <pre v-else-if="showResult" class="result">{{ call.resultContent }}</pre>
  </div>
</template>

<style scoped>
.tool-call {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-alt);
  padding: var(--space-1) var(--space-2);
  font-size: 12px;
  margin-bottom: var(--space-1);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  padding: 0;
  color: var(--text-muted);
}

.name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 600;
}

.badge {
  border-radius: 999px;
  padding: 0 var(--space-2);
  font-size: 11px;
}

.badge-running {
  background: var(--status-in-review-bg);
  color: var(--status-in-review-fg);
}

.badge-done {
  background: var(--status-done-bg);
  color: var(--status-done-fg);
}

.badge-failed {
  background: var(--status-blocked-bg);
  color: var(--status-blocked-fg);
}

.badge-approval {
  background: var(--status-in-review-bg);
  color: var(--status-in-review-fg);
}

.card-link {
  margin-left: auto;
  font-size: 11px;
}

.detail {
  margin-top: var(--space-1);
}

.receiving {
  color: var(--text-muted);
  font-style: italic;
}

.args {
  margin: var(--space-1) 0 0;
  padding: var(--space-1);
  background: var(--surface);
  border-radius: var(--radius);
  white-space: pre-wrap;
  word-break: break-word;
}

.result-error {
  margin: var(--space-1) 0 0;
  color: var(--danger);
}

.result {
  margin: var(--space-1) 0 0;
  padding: var(--space-1) var(--space-2);
  background: var(--surface);
  border-radius: var(--radius);
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
