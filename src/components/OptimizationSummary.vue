<script setup lang="ts">
import type { CpSatOutcome } from '@/domain/cpSatClient'
import { STAGE_LABELS } from '@/domain/optimizationInsight'
defineProps<{ outcome: CpSatOutcome }>()
const round = (n: number) => Number(n.toFixed(3))
</script>
<template>
  <section aria-label="探索結果の判定" class="mb-4">
    <div class="d-flex flex-wrap ga-2 align-center mb-2">
      <v-chip :color="outcome.optimal ? 'success' : 'warning'">
        {{ outcome.optimal ? '設定した条件で最適性証明済み' : '制限時間内のベスト候補' }}
      </v-chip>
      <v-chip v-if="outcome.countOptimal || outcome.optimal" color="success" variant="outlined">人数の最大値は確定</v-chip>
      <span v-if="outcome.elapsedSeconds !== undefined" class="text-caption">計算 {{ outcome.elapsedSeconds }}秒</span>
    </div>
    <p class="text-body-2">
      目標達成 {{ outcome.achieved }} / {{ outcome.requested }}体
      <template v-if="outcome.upperBound != null"> ／ 人数の上限 {{ outcome.upperBound }}体</template>
    </p>
    <p v-if="!outcome.optimal" class="text-body-2 mt-2">
      <template v-if="outcome.countOptimal">人数はこれ以上増えません。優先度や効果の配分には改善の余地がある可能性があります。</template>
      <template v-else>人数・効果の配分は最適性未証明です。計算時間を長くすると、さらに良い候補が見つかる場合があります。</template>
    </p>
    <details v-if="outcome.stages?.length" class="mt-3">
      <summary>優先項目ごとの探索結果</summary>
      <v-table density="compact" class="mt-2"><thead><tr><th>評価する順序</th><th>探索結果</th><th>評価値</th></tr></thead>
        <tbody><tr v-for="stage in outcome.stages" :key="stage.id">
          <td>{{ STAGE_LABELS[stage.id] ?? stage.id }}</td>
          <td>{{ stage.status === 'OPTIMAL' ? 'この段階の最大値を確認' : '暫定値を維持して次へ' }}</td>
          <td>{{ round(stage.value) }}</td>
        </tr></tbody>
      </v-table>
      <p class="text-caption mt-2">各段階は、それまでに見つけた人数・評価値を保って探索します。前段階が暫定の場合、後段階だけ確定しても全体の最適性は未証明です。</p>
    </details>
  </section>
</template>
