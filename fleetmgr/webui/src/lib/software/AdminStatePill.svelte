<script lang="ts">
  import { modeLabel, type AdminState } from '#lib/software/model.ts';

  let { state, runSince = null }: { state: AdminState; runSince?: number | null } = $props();
</script>

<span class="pill" class:pill-run={state === 'run'} class:muted={state === 'plan'} title={`admin-state ${state}`}>
  <span class="dot"></span>
  {modeLabel(state, runSince)}
</span>
