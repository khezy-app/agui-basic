<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import { useCoworkStore } from '@/stores/cowork'
import { formatRelativeTime } from '@/utils/dates'

import ApprovalCard from './cards/ApprovalCard.vue'
import QuestionCard from './cards/QuestionCard.vue'
import StatusChangeCard from './cards/StatusChangeCard.vue'
import MessageItem from './MessageItem.vue'

/**
 * The transcript: the ordered conversation plus the cards the calls produced.
 *
 * Cards that come from a tool's *result* render inside the assistant turn
 * (`MessageItem`); the client-tool cards the store still holds open render at the end,
 * anchored so `ToolCallItem` can link to them (FR-AI-22).
 */
const store = useCoworkStore()

const scroller = ref<HTMLElement | null>(null)
const atBottom = ref(true)
const showJump = ref(false)

const retryable = computed(() => store.phase === 'error')

/** Anchor for each client tool call whose card is currently on screen. */
const cardHrefs = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  if (store.pendingQuestion === null && store.pendingStatusChange === null) return map
  for (const item of store.items) {
    if (item.kind !== 'assistant') continue
    for (const call of item.toolCalls) {
      if (call.name === 'ask_user' && store.pendingQuestion !== null)
        map[call.id] = '#card-question'
      if (call.name === 'update_task_status' && store.pendingStatusChange !== null) {
        map[call.id] = '#card-status-change'
      }
    }
  }
  return map
})

const BOTTOM_THRESHOLD = 40

function updateAtBottom(): void {
  const element = scroller.value
  if (element === null) return
  atBottom.value =
    element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD
}

/** Autoscroll only when the user is already at the bottom; otherwise offer the jump button. */
async function follow(): Promise<void> {
  await nextTick()
  const element = scroller.value
  if (element === null) return
  if (atBottom.value) {
    element.scrollTop = element.scrollHeight
    showJump.value = false
    return
  }
  showJump.value = true
}

function jumpToLatest(): void {
  const element = scroller.value
  if (element === null) return
  element.scrollTop = element.scrollHeight
  atBottom.value = true
  showJump.value = false
}

onMounted(follow)
watch(() => store.items, follow)
</script>

<template>
  <div class="transcript-wrap">
    <div ref="scroller" class="transcript" role="log" aria-live="polite" @scroll="updateAtBottom">
      <template v-for="turn in store.turns" :key="turn.id">
        <div class="turn-divider">
          <span>{{ turn.id }}</span>
          <span v-if="turn.items[0]">{{
            formatRelativeTime(new Date(turn.items[0].createdAt).toISOString())
          }}</span>
        </div>
        <MessageItem
          v-for="item in turn.items"
          :key="item.id"
          :item="item"
          :retryable="retryable"
          :card-hrefs="cardHrefs"
          @retry="store.retry()"
        />
      </template>

      <div v-if="store.pendingApproval" id="card-approval" class="pending">
        <ApprovalCard
          :approval="store.pendingApproval"
          :description="store.approvalDescription"
          :in-flight="store.approvalInFlight"
          @approve="store.approve"
          @reject="store.reject"
          @dismiss="store.dismiss"
        />
      </div>

      <div v-if="store.pendingQuestion" id="card-question" class="pending">
        <QuestionCard
          :question="store.pendingQuestion"
          @answer="store.settlePendingQuestion"
          @dismiss="store.settlePendingQuestion('')"
        />
      </div>

      <div v-if="store.pendingStatusChange" id="card-status-change" class="pending">
        <StatusChangeCard
          :change="store.pendingStatusChange"
          @approve="store.approveStatusChange"
          @cancel="store.rejectStatusChange"
        />
      </div>
    </div>
    <button v-if="showJump" type="button" class="jump" @click="jumpToLatest">Jump to latest</button>
  </div>
</template>

<style scoped>
.transcript-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}

.transcript {
  height: 100%;
  overflow-y: auto;
  padding: var(--space-3) var(--space-3) 0;
}

.turn-divider {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: 11px;
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--space-2);
  padding-bottom: 2px;
}

.pending {
  margin-bottom: var(--space-2);
}

.jump {
  position: absolute;
  bottom: var(--space-2);
  left: 50%;
  transform: translateX(-50%);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
</style>
