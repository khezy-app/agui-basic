<script setup lang="ts">
import { computed } from 'vue'

import type { AssistantItem, ToolCallItem, TranscriptItem } from '@/agui/transcript'

import CardBoundary from './CardBoundary.vue'
import ReasoningBlock from './ReasoningBlock.vue'
import ToolCallItemView from './ToolCallItem.vue'
import ErrorCard from './cards/ErrorCard.vue'
import { classify, componentFor } from './cardRegistry'
import type { CardKind } from './cardRegistry'

const props = defineProps<{
  item: TranscriptItem
  /** Offered on `error` items only when the failed run can be retried. */
  retryable?: boolean
  /** Tool-call id → on-screen card anchor, for client tools that opened a card. */
  cardHrefs?: Record<string, string>
}>()

const emit = defineEmits<{ retry: [] }>()

type CallEntry = {
  call: ToolCallItem
  kind: CardKind | null
  component: ReturnType<typeof componentFor>
}

const assistant = computed(() =>
  props.item.kind === 'assistant' ? (props.item as AssistantItem) : null,
)

const calls = computed<CallEntry[]>(() =>
  (assistant.value?.toolCalls ?? []).map((call) => {
    // Only a settled result can be classified: while the call is running there is
    // nothing to render a card from (FR-AI-22).
    const kind = call.state === 'done' ? classify(call.name, call.resultContent) : null
    return { call, kind, component: componentFor(kind) }
  }),
)
</script>

<template>
  <div v-if="item.kind === 'user'" class="item user" :data-item-id="item.id">
    <div class="bubble">{{ item.content }}</div>
  </div>

  <div
    v-else-if="item.kind === 'assistant' && assistant"
    class="item assistant"
    :data-item-id="item.id"
  >
    <ReasoningBlock v-if="assistant.reasoning !== ''" :reasoning="assistant.reasoning" />
    <div v-if="assistant.content !== ''" class="answer" :class="{ streaming: assistant.streaming }">
      {{ assistant.content
      }}<span v-if="assistant.streaming" class="caret" aria-hidden="true">▍</span>
    </div>
    <div v-for="entry in calls" :key="entry.call.id" class="call-block">
      <ToolCallItemView
        :call="entry.call"
        :card-href="cardHrefs?.[entry.call.id] ?? null"
        :show-result="entry.kind === null"
      />
      <!-- Wrapped: CardBoundary renders a fragment (fallback vs. slot), so a class on it
           would not be inherited and Vue warns. -->
      <div v-if="entry.component" class="result-card">
        <CardBoundary :reset-key="`${entry.call.id}:${entry.call.resultMessageId ?? ''}`">
          <component
            :is="entry.component"
            :content="entry.call.resultContent"
            :args="entry.call.args"
          />
        </CardBoundary>
      </div>
    </div>
  </div>

  <div v-else-if="item.kind === 'error'" class="item error-item" :data-item-id="item.id">
    <CardBoundary :reset-key="item.id">
      <ErrorCard
        :message="item.message"
        :code="item.code ?? null"
        :retryable="retryable === true"
        @retry="emit('retry')"
      />
    </CardBoundary>
  </div>

  <div v-else-if="item.kind === 'notice'" class="item notice" :data-item-id="item.id">
    {{ item.text }}
  </div>

  <div v-else-if="item.kind === 'tool-result'" class="item tool-result" :data-item-id="item.id">
    <pre v-if="item.error === null" class="result-text">{{ item.content }}</pre>
    <p v-else class="result-error">{{ item.error }}</p>
  </div>
</template>

<style scoped>
.item {
  margin-bottom: var(--space-2);
}

.user {
  display: flex;
  justify-content: flex-end;
}

.bubble {
  background: var(--primary);
  color: #ffffff;
  border-radius: var(--radius);
  padding: var(--space-1) var(--space-3);
  max-width: 85%;
  white-space: pre-wrap;
}

.answer {
  white-space: pre-wrap;
  word-break: break-word;
}

.answer.streaming .caret {
  animation: blink 1s steps(2, start) infinite;
}

.call-block {
  margin-top: var(--space-1);
}

.result-card {
  display: block;
  margin-top: var(--space-1);
}

.notice {
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}

.result-text {
  margin: 0;
  padding: var(--space-1);
  background: var(--surface-alt);
  border-radius: var(--radius);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
}

.result-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
