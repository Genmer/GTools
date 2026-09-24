<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { VaultError } from './logic/crypto'
import type { VaultKey } from './logic/crypto'
import { generatePassword, normalizeGeneratorOptions } from './logic/generator'
import type { GeneratorOptions } from './logic/generator'
import { scheduleClipboardClear } from './logic/clipboard-clear'
import { AUTO_LOCK_CHOICES, IdleLockTimer } from './logic/idle-lock'
import { DEFAULT_PREFS, PREFS_STORAGE_KEY, normalizePrefs } from './logic/prefs'
import type { VaultPrefs } from './logic/prefs'
import {
  VAULT_STORAGE_KEY,
  createVaultFile,
  filterEntries,
  openVaultFile,
  parseVaultFile,
  removeEntry,
  saveVaultFile,
  upsertEntry
} from './logic/vault'
import type { VaultEntry, VaultFile } from './logic/vault'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

type Phase = 'loading' | 'setup' | 'locked' | 'unlocked'
type Panel = 'none' | 'editor' | 'generator' | 'master'

const MIN_MASTER_LEN = 6

const host = props.ctx.host
const phase = ref<Phase>('loading')
const loadError = ref('')
const panel = ref<Panel>('none')
const status = ref('')
const statusKind = ref<'ok' | 'err'>('ok')
const busy = ref(false)

// 密钥与库信封刻意不进响应式系统；明文条目只在解锁期间存在于内存
let vaultFile: VaultFile | null = null
let vaultKey: VaultKey | null = null
const entries = ref<VaultEntry[]>([])

const prefs = ref<VaultPrefs>({ ...DEFAULT_PREFS, gen: { ...DEFAULT_PREFS.gen } })
const masterInput = ref('')
const masterConfirmInput = ref('')
const masterInputRef = ref<HTMLInputElement | null>(null)

const editingId = ref<string | null>(null)
const form = ref({ site: '', username: '', password: '', notes: '' })
const showFormPassword = ref(false)

const genOut = ref('')
const changeMasterOld = ref('')
const changeMasterNew = ref('')
const changeMasterConfirm = ref('')
const confirmDeleteId = ref<string | null>(null)

const idleTimer = new IdleLockTimer(
  () => prefs.value.autoLockMin * 60_000,
  () => lock('已闲置，自动上锁')
)

const filtered = computed(() => filterEntries(entries.value, props.query))

let statusTimer: ReturnType<typeof setTimeout> | undefined
function say(msg: string, kind: 'ok' | 'err' = 'ok'): void {
  status.value = msg
  statusKind.value = kind
  if (statusTimer !== undefined) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => (status.value = ''), 3500)
}

// 唤起时直达生成器（command: generate）；未解锁则解锁后自动展开
let pendingGenerator = false

onMounted(() => void load())

onBeforeUnmount(() => {
  idleTimer.disarm()
  if (statusTimer !== undefined) clearTimeout(statusTimer)
  // 组件销毁即弃密钥（宿主隐藏窗口会卸载视图）；剪贴板清空任务留在模块作用域继续执行
  vaultKey = null
  entries.value = []
})

async function load(): Promise<void> {
  phase.value = 'loading'
  loadError.value = ''
  try {
    const [rawPrefs, rawVault] = await Promise.all([
      host.storage.get(PREFS_STORAGE_KEY),
      host.storage.get(VAULT_STORAGE_KEY)
    ])
    prefs.value = normalizePrefs(rawPrefs)
    if (rawVault === null || rawVault === undefined) {
      phase.value = 'setup'
    } else {
      const file = parseVaultFile(rawVault)
      if (file === null) {
        loadError.value = '库文件已损坏，无法解锁（可在设置的插件管理里禁用再启用以重置数据）'
        phase.value = 'locked'
      } else {
        vaultFile = file
        phase.value = 'locked'
      }
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '读取本地数据失败'
    phase.value = 'locked'
  }
  if (props.initialCommand === 'generate') {
    if (phase.value === 'setup' || phase.value === 'locked') pendingGenerator = true
    else panel.value = 'generator'
  }
  await nextTick()
  masterInputRef.value?.focus()
}

// 外壳搜索框输入（关键词后追加内容）也计入用户活动，避免搜索中途被上锁
watch(
  () => props.query,
  () => idleTimer.touch()
)

watch(prefs, () => void host.storage.set(PREFS_STORAGE_KEY, prefs.value), { deep: true })

async function createVault(): Promise<void> {
  if (busy.value) return
  const pw = masterInput.value
  if (pw.length < MIN_MASTER_LEN) {
    say(`主密码至少 ${MIN_MASTER_LEN} 位`, 'err')
    return
  }
  if (pw !== masterConfirmInput.value) {
    say('两次输入不一致', 'err')
    return
  }
  busy.value = true
  try {
    const { file, key } = await createVaultFile(pw, [])
    await host.storage.set(VAULT_STORAGE_KEY, file)
    vaultFile = file
    vaultKey = key
    entries.value = []
    enterUnlocked()
    say('已创建密码库；主密码只在本机派生密钥，忘记后数据无法找回')
  } catch (err) {
    say(err instanceof Error ? err.message : '创建失败', 'err')
  } finally {
    busy.value = false
  }
}

async function unlock(): Promise<void> {
  if (busy.value || vaultFile === null) return
  const pw = masterInput.value
  if (pw === '') return
  busy.value = true
  try {
    const { key, entries: loaded } = await openVaultFile(pw, vaultFile)
    vaultKey = key
    entries.value = loaded
    enterUnlocked()
  } catch (err) {
    say(err instanceof VaultError ? err.message : '解锁失败', 'err')
  } finally {
    busy.value = false
  }
}

function enterUnlocked(): void {
  masterInput.value = ''
  masterConfirmInput.value = ''
  phase.value = 'unlocked'
  idleTimer.arm()
  if (pendingGenerator) {
    pendingGenerator = false
    openGenerator()
  }
}

function lock(reason = '已锁定'): void {
  if (phase.value !== 'unlocked') return
  idleTimer.disarm()
  vaultKey = null
  entries.value = []
  panel.value = 'none'
  editingId.value = null
  confirmDeleteId.value = null
  form.value = { site: '', username: '', password: '', notes: '' }
  changeMasterOld.value = ''
  changeMasterNew.value = ''
  changeMasterConfirm.value = ''
  genOut.value = ''
  masterInput.value = ''
  phase.value = 'locked'
  say(reason)
  void nextTick(() => masterInputRef.value?.focus())
}

async function persistVault(): Promise<void> {
  if (vaultKey === null || vaultFile === null) return
  const next = await saveVaultFile(vaultKey, vaultFile, entries.value)
  await host.storage.set(VAULT_STORAGE_KEY, next)
  vaultFile = next
}

function startCreateEntry(): void {
  editingId.value = null
  form.value = { site: '', username: '', password: '', notes: '' }
  showFormPassword.value = false
  panel.value = 'editor'
}

function editEntry(e: VaultEntry): void {
  editingId.value = e.id
  form.value = { site: e.site, username: e.username, password: e.password, notes: e.notes }
  showFormPassword.value = false
  panel.value = 'editor'
}

async function saveEntry(): Promise<void> {
  if (busy.value) return
  const next = upsertEntry(entries.value, form.value, editingId.value, Date.now())
  if (next === null) {
    say('站点与用户名至少填一项', 'err')
    return
  }
  busy.value = true
  try {
    entries.value = next
    await persistVault()
    panel.value = 'none'
    say('已保存（AES-GCM 加密落盘）')
  } catch (err) {
    say(err instanceof Error ? err.message : '保存失败', 'err')
  } finally {
    busy.value = false
  }
}

function onDelete(e: VaultEntry): void {
  if (confirmDeleteId.value !== e.id) {
    confirmDeleteId.value = e.id
    return
  }
  confirmDeleteId.value = null
  entries.value = removeEntry(entries.value, e.id)
  if (editingId.value === e.id) panel.value = 'none'
  void persistVault().catch((err) => say(err instanceof Error ? err.message : '删除落盘失败', 'err'))
}

async function copyPassword(e: VaultEntry): Promise<void> {
  if (e.password === '') {
    say('该条目没有存密码', 'err')
    return
  }
  try {
    await host.clipboard.writeText(e.password)
    scheduleClipboardClear(host, e.password)
    say(`已复制${e.site || e.username}的密码，30 秒后自动清空剪贴板`)
  } catch (err) {
    say(err instanceof Error ? err.message : '复制失败', 'err')
  }
}

async function copyUsername(e: VaultEntry): Promise<void> {
  if (e.username === '') return
  try {
    await host.clipboard.writeText(e.username)
    say(`已复制用户名 ${e.username}`)
  } catch (err) {
    say(err instanceof Error ? err.message : '复制失败', 'err')
  }
}

function openGenerator(): void {
  regenPassword()
  panel.value = 'generator'
}

function toggleGenerator(): void {
  if (panel.value === 'generator') panel.value = 'none'
  else openGenerator()
}

function regenPassword(): void {
  genOut.value = generatePassword(prefs.value.gen)
}

function updateGenOptions(patch: Partial<GeneratorOptions>): void {
  prefs.value.gen = normalizeGeneratorOptions({ ...prefs.value.gen, ...patch })
  regenPassword()
}

function applyGenToForm(): void {
  if (panel.value !== 'editor') startCreateEntry()
  form.value.password = genOut.value
}

async function copyGen(): Promise<void> {
  if (genOut.value === '') return
  try {
    await host.clipboard.writeText(genOut.value)
    say('已复制生成的密码（尚未入库）')
  } catch (err) {
    say(err instanceof Error ? err.message : '复制失败', 'err')
  }
}

async function changeMaster(): Promise<void> {
  if (busy.value || vaultFile === null) return
  const oldPw = changeMasterOld.value
  const newPw = changeMasterNew.value
  if (newPw.length < MIN_MASTER_LEN) {
    say(`新主密码至少 ${MIN_MASTER_LEN} 位`, 'err')
    return
  }
  if (newPw !== changeMasterConfirm.value) {
    say('两次新密码不一致', 'err')
    return
  }
  busy.value = true
  try {
    // 先用旧密码完整解锁一次验证正确性，再以新盐新密钥整库重加密
    const { entries: loaded } = await openVaultFile(oldPw, vaultFile)
    const { file, key } = await createVaultFile(newPw, loaded)
    await host.storage.set(VAULT_STORAGE_KEY, file)
    vaultFile = file
    vaultKey = key
    entries.value = loaded
    changeMasterOld.value = ''
    changeMasterNew.value = ''
    changeMasterConfirm.value = ''
    panel.value = 'none'
    say('主密码已修改')
  } catch (err) {
    say(err instanceof VaultError ? '旧主密码错误' : '修改失败', 'err')
  } finally {
    busy.value = false
  }
}

function onMasterKeydown(e: KeyboardEvent): void {
  if (e.isComposing || e.shiftKey) return
  if (e.key === 'Enter') {
    e.preventDefault()
    void (phase.value === 'setup' ? createVault() : unlock())
  }
}
</script>

<template>
  <div class="pv" @pointerdown.capture="idleTimer.touch()" @keydown.capture="idleTimer.touch()">
    <p v-if="phase === 'loading'" class="muted center">读取中…</p>

    <div v-else-if="phase === 'setup'" class="gate">
      <h2>🔐 设置主密码</h2>
      <p class="muted">主密码用于派生密钥加密全部账号数据，只存在本机，忘记后数据无法找回。</p>
      <input
        ref="masterInputRef"
        v-model="masterInput"
        type="password"
        placeholder="主密码（至少 6 位）"
        autocomplete="new-password"
        spellcheck="false"
        @keydown="onMasterKeydown"
      />
      <input
        v-model="masterConfirmInput"
        type="password"
        placeholder="再输入一次"
        autocomplete="new-password"
        spellcheck="false"
        @keydown="onMasterKeydown"
      />
      <button class="btn primary" :disabled="busy" @click="createVault">创建密码库</button>
    </div>

    <div v-else-if="phase === 'locked'" class="gate">
      <h2>🔒 密码库已锁定</h2>
      <p v-if="loadError !== ''" class="err">{{ loadError }}</p>
      <template v-else>
        <input
          ref="masterInputRef"
          v-model="masterInput"
          type="password"
          placeholder="输入主密码解锁"
          autocomplete="current-password"
          spellcheck="false"
          @keydown="onMasterKeydown"
        />
        <button class="btn primary" :disabled="busy" @click="unlock">解锁</button>
      </template>
      <button v-if="loadError !== ''" class="btn" @click="load">重试读取</button>
    </div>

    <template v-else>
      <div class="bar">
        <button class="btn primary" @click="startCreateEntry">+ 新增</button>
        <button class="btn" :class="{ active: panel === 'generator' }" @click="toggleGenerator">生成器</button>
        <button class="btn" :class="{ active: panel === 'master' }" @click="panel = panel === 'master' ? 'none' : 'master'">
          改主密码
        </button>
        <span class="spacer"></span>
        <label class="locksel">
          自动上锁
          <select
            :value="prefs.autoLockMin"
            @change="
              prefs.autoLockMin = Number(($event.target as HTMLSelectElement).value) as (typeof AUTO_LOCK_CHOICES)[number];
              idleTimer.arm()
            "
          >
            <option v-for="m in AUTO_LOCK_CHOICES" :key="m" :value="m">{{ m === 0 ? '不自动' : `${m} 分钟` }}</option>
          </select>
        </label>
        <button class="btn" @click="lock()">锁定</button>
      </div>

      <div v-if="panel === 'editor'" class="panel">
        <div class="grid">
          <label>站点 / 名称<input v-model="form.site" placeholder="如 github.com" spellcheck="false" /></label>
          <label>用户名<input v-model="form.username" spellcheck="false" autocomplete="off" /></label>
        </div>
        <label>
          密码
          <span class="pwline">
            <input
              v-model="form.password"
              :type="showFormPassword ? 'text' : 'password'"
              spellcheck="false"
              autocomplete="off"
            />
            <button class="btn" @click="showFormPassword = !showFormPassword">{{ showFormPassword ? '隐藏' : '显示' }}</button>
            <button class="btn" title="按生成器当前选项随机生成" @click="form.password = generatePassword(prefs.gen)">随机</button>
          </span>
        </label>
        <label>备注<textarea v-model="form.notes" rows="2" spellcheck="false"></textarea></label>
        <div class="row-end">
          <button class="btn" @click="panel = 'none'">取消</button>
          <button class="btn primary" :disabled="busy" @click="saveEntry">保存</button>
        </div>
      </div>

      <div v-else-if="panel === 'generator'" class="panel">
        <div class="gen-opts">
          <label class="len">
            长度 <b>{{ prefs.gen.length }}</b>
            <input
              type="range"
              min="4"
              max="64"
              :value="prefs.gen.length"
              @input="updateGenOptions({ length: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <label class="chk"><input type="checkbox" :checked="prefs.gen.lowercase" @change="updateGenOptions({ lowercase: ($event.target as HTMLInputElement).checked })" />小写 a-z</label>
          <label class="chk"><input type="checkbox" :checked="prefs.gen.uppercase" @change="updateGenOptions({ uppercase: ($event.target as HTMLInputElement).checked })" />大写 A-Z</label>
          <label class="chk"><input type="checkbox" :checked="prefs.gen.digits" @change="updateGenOptions({ digits: ($event.target as HTMLInputElement).checked })" />数字 0-9</label>
          <label class="chk"><input type="checkbox" :checked="prefs.gen.symbols" @change="updateGenOptions({ symbols: ($event.target as HTMLInputElement).checked })" />符号</label>
        </div>
        <div class="gen-out">
          <code>{{ genOut }}</code>
          <button class="btn" @click="regenPassword">重新生成</button>
          <button class="btn" @click="copyGen">复制</button>
          <button class="btn primary" @click="applyGenToForm">填入表单</button>
        </div>
      </div>

      <div v-else-if="panel === 'master'" class="panel">
        <div class="grid">
          <label>旧主密码<input v-model="changeMasterOld" type="password" autocomplete="current-password" spellcheck="false" /></label>
          <label>新主密码<input v-model="changeMasterNew" type="password" autocomplete="new-password" spellcheck="false" /></label>
        </div>
        <label>确认新主密码<input v-model="changeMasterConfirm" type="password" autocomplete="new-password" spellcheck="false" @keydown.enter.prevent="changeMaster" /></label>
        <div class="row-end">
          <button class="btn" @click="panel = 'none'">取消</button>
          <button class="btn primary" :disabled="busy" @click="changeMaster">确认修改</button>
        </div>
      </div>

      <div class="list">
        <p v-if="filtered.length === 0" class="muted center">
          {{ entries.length === 0 ? '还没有条目，点「+ 新增」添加' : '没有匹配的条目' }}
        </p>
        <div
          v-for="e in filtered"
          :key="e.id"
          class="entry"
          :title="e.notes !== '' ? `备注：${e.notes}` : '点击复制密码'"
          @click="copyPassword(e)"
        >
          <div class="meta">
            <span class="site">{{ e.site !== '' ? e.site : '(未命名站点)' }}</span>
            <span class="user">{{ e.username }}</span>
          </div>
          <div class="acts">
            <button class="btn" title="复制用户名" @click.stop="copyUsername(e)">用户名</button>
            <button class="btn" title="编辑" @click.stop="editEntry(e)">编辑</button>
            <button
              class="btn"
              :class="{ danger: confirmDeleteId === e.id }"
              title="删除"
              @click.stop="onDelete(e)"
            >
              {{ confirmDeleteId === e.id ? '确认' : '删除' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <p v-if="status !== ''" class="status" :class="statusKind">{{ status }}</p>
  </div>
</template>

<style scoped>
.pv {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  min-height: 0;
  padding: 2px 2px 0;
}
.center {
  text-align: center;
}
.muted {
  color: var(--fg-dim);
}
.err {
  color: var(--danger);
  margin: 0;
}
.gate {
  max-width: 340px;
  margin: 24px auto 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gate h2 {
  margin: 0;
  font-size: 15px;
  color: var(--fg);
}
.gate input {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--fg);
  font-size: 13px;
  outline: none;
}
.gate input:focus {
  border-color: var(--accent);
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.spacer {
  flex: 1;
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
.btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
.btn.danger {
  border-color: var(--danger);
  color: var(--danger);
}
.btn.primary {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.locksel {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-dim);
  font-size: 12px;
}
.locksel select {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  padding: 2px 4px;
  outline: none;
}
.panel {
  flex: none;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.panel label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--fg-dim);
  font-size: 12px;
}
.panel input:not([type='range']):not([type='checkbox']),
.panel textarea {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--fg);
  font-size: 13px;
  outline: none;
}
.panel input:focus,
.panel textarea:focus {
  border-color: var(--accent);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.pwline {
  display: flex;
  gap: 6px;
}
.pwline input {
  flex: 1;
  min-width: 0;
}
.row-end {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.gen-opts {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.gen-opts label {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.gen-opts input[type='range'] {
  accent-color: var(--accent);
}
.chk input {
  accent-color: var(--accent);
}
.gen-out {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gen-out code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 14px;
  color: var(--accent);
  user-select: text;
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.entry {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.entry:hover {
  border-color: var(--accent);
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}
.site {
  color: var(--fg);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user {
  color: var(--fg-dim);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acts {
  flex: none;
  display: flex;
  gap: 6px;
}
.status {
  margin: 0;
  flex: none;
  font-size: 12px;
  color: var(--fg-dim);
}
.status.ok {
  color: var(--accent);
}
.status.err {
  color: var(--danger);
}
</style>
