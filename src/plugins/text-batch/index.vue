<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { PluginContext } from '@sdk/api'
import { RULE_TYPE_OPTIONS, makeDraft, runBatch, toRule, type BatchRuleType, type RuleDraft } from './logic/batch'

// 渲染入口固定 props（AGENTS 规约）；本插件纯前端，不消费 ctx/query
defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const input = ref('')
const rules = ref<RuleDraft[]>([])
const addType = ref<BatchRuleType>('replace')
const copied = ref(false)
let uidSeq = 0
let copiedTimer: ReturnType<typeof setTimeout> | undefined

// 纯 JS 实时预览：input 或规则链任一变化即重算
const output = computed(() => runBatch(input.value, rules.value.map(toRule)))
const changed = computed(() => output.value !== input.value)

function addRule(): void {
  rules.value.push(makeDraft(++uidSeq, addType.value))
}

function removeRule(uid: number): void {
  rules.value = rules.value.filter((r) => r.uid !== uid)
}

function moveRule(uid: number, delta: -1 | 1): void {
  const i = rules.value.findIndex((r) => r.uid === uid)
  const j = i + delta
  if (i < 0 || j < 0 || j >= rules.value.length) return
  const next = rules.value.slice()
  const [moved] = next.splice(i, 1)
  next.splice(j, 0, moved)
  rules.value = next
}

function clearAll(): void {
  input.value = ''
  rules.value = []
}

async function copyResult(): Promise<void> {
  try {
    await navigator.clipboard.writeText(output.value)
    copied.value = true
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1500)
  } catch {
    // 剪贴板被占用等瞬态失败静默，不打断输入
  }
}

onBeforeUnmount(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="text-batch">
    <div class="toolbar">
      <select v-model="addType" class="inp">
        <option v-for="t in RULE_TYPE_OPTIONS" :key="t.type" :value="t.type">{{ t.label }}</option>
      </select>
      <button class="btn" @click="addRule">+ 添加规则</button>
      <button class="btn" :disabled="rules.length === 0 && input === ''" @click="clearAll">清空</button>
      <span class="summary">{{ rules.length }} 条规则 · {{ input === '' ? 0 : output.split('\n').length }} 行输出</span>
      <span class="spacer"></span>
      <span v-if="copied" class="copied">已复制</span>
      <button class="btn primary" :disabled="!changed" title="复制处理结果到剪贴板" @click="copyResult">复制结果</button>
    </div>

    <div class="rules">
      <div v-if="rules.length === 0" class="rules-empty">
        添加规则构建处理链：查找替换 / 正则替换 / 去重 / 排序 / 大小写 / trim / 前后缀 / 按行过滤，按顺序依次应用
      </div>
      <div v-for="(rule, i) in rules" :key="rule.uid" class="rule">
        <span class="rule-no">{{ i + 1 }}</span>
        <span class="rule-type">{{ RULE_TYPE_OPTIONS.find((t) => t.type === rule.type)?.label }}</span>
        <template v-if="rule.type === 'replace'">
          <input v-model="rule.find" class="inp grow" placeholder="查找" spellcheck="false" />
          <span class="arrow">→</span>
          <input v-model="rule.replaceWith" class="inp grow" placeholder="替换为" spellcheck="false" />
        </template>
        <template v-else-if="rule.type === 'regexReplace'">
          <input v-model="rule.regex" class="inp grow" placeholder="正则（如 \d+，非法则跳过）" spellcheck="false" />
          <span class="arrow">→</span>
          <input v-model="rule.replaceWith" class="inp grow" placeholder="替换为（可用 $1）" spellcheck="false" />
        </template>
        <template v-else-if="rule.type === 'sort'">
          <select v-model="rule.order" class="inp">
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select>
        </template>
        <template v-else-if="rule.type === 'case'">
          <select v-model="rule.caseMode" class="inp">
            <option value="upper">全部大写</option>
            <option value="lower">全部小写</option>
            <option value="title">首字母大写</option>
          </select>
        </template>
        <template v-else-if="rule.type === 'wrap'">
          <input v-model="rule.prefix" class="inp grow" placeholder="前缀" spellcheck="false" />
          <input v-model="rule.suffix" class="inp grow" placeholder="后缀" spellcheck="false" />
        </template>
        <template v-else-if="rule.type === 'filter'">
          <select v-model="rule.filterMode" class="inp">
            <option value="include">包含</option>
            <option value="exclude">不包含</option>
            <option value="regex">正则</option>
          </select>
          <input v-model="rule.filterValue" class="inp grow" placeholder="过滤值（留空=不过滤）" spellcheck="false" />
        </template>
        <span class="rule-ops">
          <button class="mini" :disabled="i === 0" @click="moveRule(rule.uid, -1)">↑</button>
          <button class="mini" :disabled="i === rules.length - 1" @click="moveRule(rule.uid, 1)">↓</button>
          <button class="mini" @click="removeRule(rule.uid)">✕</button>
        </span>
      </div>
    </div>

    <div class="panes">
      <textarea
        v-model="input"
        class="pane"
        placeholder="在此粘贴多行文本…"
        spellcheck="false"
      ></textarea>
      <textarea class="pane out" readonly :value="output" placeholder="处理结果实时预览…" spellcheck="false"></textarea>
    </div>
  </div>
</template>

<style scoped>
.text-batch {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  min-height: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn.primary {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
.summary {
  color: var(--fg-dim);
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.copied {
  color: var(--ok);
  font-size: 12px;
}
.rules {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 168px;
  overflow-y: auto;
  padding: 2px;
}
.rules-empty {
  color: var(--fg-dim);
  font-size: 12px;
}
.rule {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
}
.rule-no {
  color: var(--fg-dim);
  font-size: 12px;
  width: 14px;
  flex: none;
}
.rule-type {
  color: var(--accent);
  font-size: 12px;
  flex: none;
  white-space: nowrap;
}
.rule-ops {
  margin-left: auto;
  display: flex;
  gap: 2px;
  flex: none;
}
.arrow {
  color: var(--fg-dim);
}
.inp {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  outline: none;
  min-width: 0;
}
.inp.grow {
  flex: 1;
}
.mini {
  border: none;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 5px;
  border-radius: 4px;
}
.mini:hover:not(:disabled) {
  background: var(--accent-dim);
  color: var(--accent);
}
.mini:disabled {
  opacity: 0.4;
  cursor: default;
}
.panes {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 8px;
}
.pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  resize: none;
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
}
.pane::placeholder {
  color: var(--fg-dim);
}
.pane:focus {
  border-color: var(--accent);
}
.pane.out {
  background: var(--bg);
}
</style>
