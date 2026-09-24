<script setup lang="ts">
import { ref } from 'vue'
import { decodeJwt } from './logic/jwt'
import type { JwtDecoded } from './logic/jwt'

const token = ref(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFUZXN0IiwiaWF0IjoxNzAwMDAwMDAwfQ.signature-not-verified'
)
const result = ref<JwtDecoded | null>(null)

function run(): void {
  result.value = decodeJwt(token.value)
}
</script>

<template>
  <div class="tool">
    <div class="bar">
      <button class="btn primary" @click="run">解码</button>
      <span class="muted">仅解码，不验签</span>
    </div>
    <textarea v-model="token" rows="4" placeholder="粘贴 JWT token" spellcheck="false" />
    <p v-if="result && !result.ok" class="err">✗ {{ result.error }}</p>
    <template v-else-if="result?.ok">
      <div class="result">
        <pre>header:
{{ JSON.stringify(result.header, null, 2) }}

payload:
{{ JSON.stringify(result.payload, null, 2) }}</pre>
      </div>
      <p v-if="result.iatDate" class="muted">签发时间：{{ result.iatDate }}</p>
      <p v-if="result.expDate" :class="result.expired ? 'err' : 'ok'">
        过期时间：{{ result.expDate }}{{ result.expired ? '（已过期）' : '' }}
      </p>
    </template>
  </div>
</template>

<style scoped>
@import './tool.css';
</style>
