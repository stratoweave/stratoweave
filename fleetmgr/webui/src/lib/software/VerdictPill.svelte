<script lang="ts">
  import type { CheckResult } from '$lib/software/model';
  import { formatClock } from '$lib/software/time';

  interface Props {
    check: CheckResult;
  }

  let { check }: Props = $props();
  let title = $derived(
    [check.detail, check.at !== null ? formatClock(check.at) : ''].filter((s) => s).join(' · ')
  );
</script>

{#if check.verdict === 'not-run'}
  —
{:else}
  <span
    class="pill"
    class:success={check.verdict === 'pass'}
    class:danger={check.verdict === 'fail'}
    title={title || undefined}
  >
    <span class="dot"></span>
    {check.verdict}
  </span>
{/if}
