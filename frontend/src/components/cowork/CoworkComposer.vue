<script setup lang="ts">
import { computed, ref } from 'vue'

import { useCoworkStore } from '@/stores/cowork'

import StopButton from './StopButton.vue'

/** The demo's reliable one-tap starters; they fill the box and never auto-send. */
const SUGGESTIONS = [
  "What's overdue and blocked?",
  'Create a high priority task called Fix login redirect due friday, tags bug and auth',
  'Show me the tasks in review',
]

const store = useCoworkStore()

const text = ref('')

/** A card (approval/question/status change) is open, so a new run cannot be sent yet. */
const blocked = computed(() => !store.canSend && !store.isRunning)
const canSubmit = computed(() => text.value.trim() !== '')

function submit(): void {
  const value = text.value.trim()
  if (value === '') return
  if (store.isRunning) {
    // FR-AI-25: a second Enter queues; it never starts a second request.
    store.send(value)
  } else if (store.canSend) {
    store.send(value)
  } else {
    return
  }
  text.value = ''
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submit()
}

function useSuggestion(suggestion: string): void {
  text.value = suggestion
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <p v-if="blocked" class="hint">Answer the question above to continue</p>
    <p v-else-if="store.queuedMessage" class="hint">Queued: {{ store.queuedMessage }}</p>
    <div v-if="store.items.length === 0" class="suggestions">
      <button
        v-for="suggestion in SUGGESTIONS"
        :key="suggestion"
        type="button"
        class="suggestion"
        @click="useSuggestion(suggestion)"
      >
        {{ suggestion }}
      </button>
    </div>
    <textarea
      v-model="text"
      class="input"
      rows="2"
      :disabled="blocked"
      placeholder="Ask about your tasks…"
      aria-label="Message the assistant"
      @keydown="onKeydown"
    />
    <div class="actions">
      <StopButton v-if="store.isRunning" @stop="store.stop()" />
      <button v-else type="submit" class="send" :disabled="!canSubmit">Send</button>
    </div>
  </form>
</template>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border);
  background: var(--surface-alt);
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.suggestions {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.suggestion {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
  font: inherit;
  text-align: left;
  color: var(--text-muted);
}

.input {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-1) var(--space-2);
  font: inherit;
  resize: vertical;
}

.input:disabled {
  background: var(--surface-alt);
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.send {
  border: 1px solid var(--primary);
  border-radius: var(--radius);
  background: var(--primary);
  color: #ffffff;
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  font: inherit;
}

.send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
