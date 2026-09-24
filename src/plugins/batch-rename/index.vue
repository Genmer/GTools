<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PluginContext } from '@sdk/api'
import {
  RULE_TYPES,
  UNDO_STORAGE_KEY,
  baseNameOf,
  buildPreview,
  buildUndoOps,
  draftToRule,
  executeBatch,
  makeDraft,
  makeFileItems,
  normalizePlatform,
  planExecution,
  type ExecuteFailure,
  type FileItem,
  type RenameOp,
  type RuleDraft,
  type RuleType,
  type UndoLog
} from './logic/rename'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const items = ref<FileItem[]>([])
const rules = ref<RuleDraft[]>([])
const existing = ref<Map<string, Set<string>>>(new Map())
const dirListFailed = ref(false)
const busy = ref(false)
const error = ref('')
const undoLog = ref<UndoLog | null>(null)
const dragOver = ref(false)
const platform = normalizePlatform(props.ctx.host.app.platform)

interface RunReport {
  kind: '执行' | '撤销'
  executed: number
  failures: ExecuteFailure[]
}
const report = ref<RunReport | null>(null)

let uidSeq = 0
const addType = ref<RuleType>('replace')

const preview = computed(() => buildPreview(items.value, rules.value.map(draftToRule), existing.value, platform))
const executableCount = computed(
  () => preview.value.rows.filter((r) => r.changed && r.conflict === null && r.invalid === null).length
)
const multiDir = computed(() => new Set(items.value.map((i) => i.dir)).size > 1)

onMounted(async () => {
  // 跨会话撤销：重启后文件授权已失效，撤销可能报「未授权」，失败明细如实展示
  try {
    const log = await props.ctx.host.storage.get<UndoLog>(UNDO_STORAGE_KEY)
    if (log && Array.isArray(log.ops) && log.ops.length > 0) undoLog.value = log
  } catch {
    /* 撤销日志读失败不阻塞主流程 */
  }
})

async function refreshExisting(): Promise<void> {
  const dirs = [...new Set(items.value.map((f) => f.dir))]
  dirListFailed.value = false
  if (dirs.length === 0) {
    existing.value = new Map()
    return
  }
  // 授权所在目录以读取兄弟文件清单（与现存文件冲突检测；内置受信代码，等价 uTools 信任模型）
  try {
    await props.ctx.host.fs.grant(dirs)
  } catch {
    /* 授权失败降级为仅批内检测 */
  }
  const map = new Map<string, Set<string>>()
  for (const d of dirs) {
    try {
      const entries = await props.ctx.host.fs.list(d)
      map.set(d.toLowerCase(), new Set(entries.map((e) => e.name.toLowerCase())))
    } catch {
      dirListFailed.value = true
    }
  }
  existing.value = map
}

async function addPaths(rawPaths: string[]): Promise<void> {
  if (rawPaths.length === 0) return
  busy.value = true
  error.value = ''
  try {
    await props.ctx.host.fs.grant(rawPaths)
    const files: string[] = []
    for (const p of rawPaths) {
      const st = await props.ctx.host.fs.stat(p).catch(() => null)
      if (st?.exists && st.isFile) files.push(p)
    }
    if (files.length === 0) {
      error.value = '没有可重命名的文件（暂不支持目录）'
      return
    }
    items.value = [...items.value, ...makeFileItems(files, items.value)]
    await refreshExisting()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '添加文件失败'
  } finally {
    busy.value = false
  }
}

function onDrop(e: DragEvent): void {
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length === 0) return
  // pathForFile 必须在 drop 事件的同步上下文里取（webUtils 限制）
  void addPaths(files.map((f) => window.gtools.pathForFile(f)))
}

async function pickFiles(): Promise<void> {
  error.value = ''
  try {
    const paths = await props.ctx.host.dialog.openFile({ title: '选择要重命名的文件', multiple: true })
    await addPaths(paths)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '选择文件失败'
  }
}

function clearAll(): void {
  items.value = []
  existing.value = new Map()
  report.value = null
  error.value = ''
}

function removeItem(id: string): void {
  items.value = items.value.filter((i) => i.id !== id)
}

function addRule(): void {
  rules.value.push({ ...makeDraft(addType.value), uid: ++uidSeq })
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

function applyExecuted(ops: readonly RenameOp[]): void {
  if (ops.length === 0) return
  const byId = new Map(ops.map((op) => [op.id, op]))
  items.value = items.value.map((it) => {
    const op = byId.get(it.id)
    return op ? { ...it, path: op.to, name: baseNameOf(op.to) } : it
  })
}

async function execute(): Promise<void> {
  if (busy.value || !preview.value.ok || items.value.length === 0) return
  error.value = ''
  if (dirListFailed.value) {
    // POSIX rename 会静默覆盖同名文件，目录清单拿不到时绝不执行
    error.value = '目录清单不可用，无法安全执行（可能覆盖同名文件）；请重新添加文件'
    return
  }
  await refreshExisting()
  const ops = planExecution(preview.value.rows)
  if (ops.length === 0) {
    error.value = '没有可执行的重命名（检查冲突 / 非法名 / 无变化）'
    return
  }
  busy.value = true
  try {
    const rep = await executeBatch(ops, (from, to) => props.ctx.host.fs.rename(from, to))
    applyExecuted(rep.executed)
    report.value = { kind: '执行', executed: rep.executed.length, failures: rep.failures }
    if (rep.executed.length > 0) {
      undoLog.value = { executedAt: Date.now(), ops: rep.executed }
      await props.ctx.host.storage.set(UNDO_STORAGE_KEY, undoLog.value)
    }
    await refreshExisting()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '执行失败'
  } finally {
    busy.value = false
  }
}

async function undo(): Promise<void> {
  const log = undoLog.value
  if (!log || log.ops.length === 0 || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const rep = await executeBatch(buildUndoOps(log.ops), (from, to) => props.ctx.host.fs.rename(from, to))
    applyExecuted(rep.executed)
    report.value = { kind: '撤销', executed: rep.executed.length, failures: rep.failures }
    undoLog.value = null
    await props.ctx.host.storage.remove(UNDO_STORAGE_KEY)
    await refreshExisting()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '撤销失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    class="batch-rename"
    :class="{ dragging: dragOver }"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <div class="toolbar">
      <button class="btn" :disabled="busy" @click="pickFiles">添加文件</button>
      <button class="btn" :disabled="busy || items.length === 0" @click="clearAll">清空</button>
      <span class="summary">
        {{ items.length }} 个文件 · {{ preview.changedCount }} 待改
        <template v-if="preview.conflictCount > 0"> · <b class="bad">{{ preview.conflictCount }} 冲突</b></template>
        <template v-if="preview.invalidCount > 0"> · <b class="bad">{{ preview.invalidCount }} 非法</b></template>
      </span>
      <span class="spacer"></span>
      <button class="btn" :disabled="busy || !undoLog || undoLog.ops.length === 0" title="撤销上一次执行" @click="undo">
        撤销上次
      </button>
      <button
        class="btn primary"
        :disabled="busy || !preview.ok || executableCount === 0"
        title="按预览执行重命名（冲突/非法行跳过）"
        @click="execute"
      >
        {{ busy ? '处理中…' : `执行重命名${executableCount > 0 ? `(${executableCount})` : ''}` }}
      </button>
    </div>

    <p v-if="error !== ''" class="error">{{ error }}</p>
    <p v-else-if="!preview.ok" class="error">{{ preview.message }}</p>
    <p v-else-if="dirListFailed" class="warn">
      部分目录清单读取失败：仅做批内重名检测，暂不执行（避免覆盖同名文件）
    </p>

    <div class="rules">
      <div v-if="rules.length === 0" class="rules-empty">添加规则构建重命名链：替换 / 插入 / 删除 / 序号 / 大小写 / 扩展名，按顺序依次应用</div>
      <div v-for="(rule, i) in rules" :key="rule.uid" class="rule">
        <span class="rule-no">{{ i + 1 }}</span>
        <template v-if="rule.type === 'replace'">
          <input v-model="rule.find" class="inp grow" placeholder="查找" spellcheck="false" />
          <span class="arrow">→</span>
          <input v-model="rule.replaceWith" class="inp grow" placeholder="替换为（正则可用 $1）" spellcheck="false" />
          <label class="chk"><input v-model="rule.useRegex" type="checkbox" />正则</label>
          <label class="chk"><input v-model="rule.caseSensitive" type="checkbox" />区分大小写</label>
          <select v-model="rule.scope" class="inp">
            <option value="name">主名</option>
            <option value="full">全名</option>
          </select>
        </template>
        <template v-else-if="rule.type === 'insert'">
          <input v-model="rule.text" class="inp grow" placeholder="插入文本" spellcheck="false" />
          <select v-model="rule.atMode" class="inp">
            <option value="start">开头</option>
            <option value="end">末尾</option>
            <option value="index">指定位置</option>
          </select>
          <input v-if="rule.atMode === 'index'" v-model.number="rule.at" class="inp num" type="number" title="负数=从末尾数" />
        </template>
        <template v-else-if="rule.type === 'delete'">
          <select v-model="rule.atMode" class="inp">
            <option value="start">开头</option>
            <option value="end">末尾</option>
            <option value="index">指定位置</option>
          </select>
          <input v-if="rule.atMode === 'index'" v-model.number="rule.at" class="inp num" type="number" title="负数=从末尾数" />
          <span class="lbl">删</span>
          <input v-model.number="rule.count" class="inp num" type="number" min="0" />
          <span class="lbl">个字符</span>
        </template>
        <template v-else-if="rule.type === 'sequence'">
          <span class="lbl">起始</span>
          <input v-model.number="rule.start" class="inp num" type="number" />
          <span class="lbl">步长</span>
          <input v-model.number="rule.step" class="inp num" type="number" />
          <span class="lbl">位数</span>
          <input v-model.number="rule.digits" class="inp num" type="number" min="0" max="10" />
          <select v-model="rule.seqMode" class="inp">
            <option value="prefix">前缀</option>
            <option value="suffix">后缀</option>
            <option value="index">指定位置</option>
          </select>
          <input v-if="rule.seqMode === 'index'" v-model.number="rule.at" class="inp num" type="number" title="负数=从末尾数" />
        </template>
        <template v-else-if="rule.type === 'case'">
          <select v-model="rule.caseMode" class="inp">
            <option value="upper">全部大写</option>
            <option value="lower">全部小写</option>
            <option value="title">首字母大写</option>
          </select>
        </template>
        <template v-else>
          <span class="lbl">扩展名改为</span>
          <input v-model="rule.extValue" class="inp grow" placeholder="如 jpg；留空=去掉扩展名" spellcheck="false" />
        </template>
        <span class="rule-ops">
          <button class="mini" :disabled="i === 0" @click="moveRule(rule.uid, -1)">↑</button>
          <button class="mini" :disabled="i === rules.length - 1" @click="moveRule(rule.uid, 1)">↓</button>
          <button class="mini" @click="removeRule(rule.uid)">✕</button>
        </span>
      </div>
      <div class="rules-add">
        <select v-model="addType" class="inp">
          <option v-for="t in RULE_TYPES" :key="t.type" :value="t.type">{{ t.label }}</option>
        </select>
        <button class="btn" @click="addRule">+ 添加规则</button>
      </div>
    </div>

    <div class="table-wrap">
      <div v-if="items.length === 0" class="empty">
        拖入文件到此处，或点「添加文件」<br />
        <span class="dim">本地操作 · 不上传 · 执行前可见全部新旧名对照</span>
      </div>
      <table v-else>
        <thead>
          <tr>
            <th class="c-i">#</th>
            <th class="c-old">原文件名</th>
            <th class="c-new">新文件名</th>
            <th class="c-st">状态</th>
            <th class="c-op"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in preview.rows"
            :key="row.id"
            :class="{ bad: row.conflict !== null || row.invalid !== null, dim: !row.changed }"
          >
            <td class="c-i">{{ i + 1 }}</td>
            <td class="c-old" :title="multiDir ? row.path : row.oldName">
              <span v-if="multiDir" class="dir">{{ row.dir }}/</span>{{ row.oldName }}
            </td>
            <td class="c-new" :title="row.dir + '/' + row.newName">{{ row.newName }}</td>
            <td class="c-st">
              <span v-if="row.invalid !== null" class="bad">{{ row.invalid }}</span>
              <span v-else-if="row.conflict !== null" class="bad">{{ row.conflict }}</span>
              <span v-else-if="!row.changed">无变化</span>
              <span v-else>✓</span>
            </td>
            <td class="c-op"><button class="mini" title="移出列表" @click="removeItem(row.id)">✕</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="report !== null" class="report">
      <b>{{ report.kind }}完成：成功 {{ report.executed }} 个<template v-if="report.failures.length > 0">，失败 {{ report.failures.length }} 个</template></b>
      <ul v-if="report.failures.length > 0">
        <li v-for="(f, i) in report.failures" :key="i" class="bad">{{ baseNameOf(f.op.from) }} — {{ f.message }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.batch-rename {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  min-height: 0;
  border: 1px dashed transparent;
  border-radius: 8px;
}
.batch-rename.dragging {
  border-color: var(--accent);
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
.summary .bad {
  color: var(--danger);
}
.spacer {
  flex: 1;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
  flex: none;
}
.warn {
  margin: 0;
  color: var(--fg-dim);
  font-size: 12px;
  flex: none;
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
.rule-ops {
  margin-left: auto;
  display: flex;
  gap: 2px;
  flex: none;
}
.rules-add {
  display: flex;
  align-items: center;
  gap: 6px;
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
.inp.num {
  width: 64px;
}
.inp.grow {
  flex: 1;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--fg-dim);
  font-size: 12px;
  white-space: nowrap;
}
.lbl {
  color: var(--fg-dim);
  font-size: 12px;
  white-space: nowrap;
}
.arrow {
  color: var(--fg-dim);
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
.table-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--fg-dim);
}
.dim {
  color: var(--fg-dim);
}
.dir {
  color: var(--fg-dim);
  font-size: 11px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
thead th {
  position: sticky;
  top: 0;
  background: var(--bg-raised);
  color: var(--fg-dim);
  font-weight: normal;
  font-size: 12px;
  text-align: left;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
}
tbody td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 0;
}
tbody tr:last-child td {
  border-bottom: none;
}
tr.bad td {
  color: var(--danger);
}
tr.dim td {
  color: var(--fg-dim);
}
.c-i {
  width: 28px;
  flex: none;
}
.c-old,
.c-new {
  width: 40%;
}
.c-st {
  width: 150px;
}
.c-op {
  width: 30px;
}
.bad {
  color: var(--danger);
}
.report {
  flex: none;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  max-height: 96px;
  overflow-y: auto;
}
.report ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
.report li {
  color: var(--danger);
}
</style>
