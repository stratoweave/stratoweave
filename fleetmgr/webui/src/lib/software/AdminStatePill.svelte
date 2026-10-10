<script lang="ts">
  import type { AdminState } from '$lib/software/model';

  let { state }: { state: AdminState } = $props();
</script>

<span class="pill" class:pill-run={state === 'run'} class:muted={state === 'plan'}>
  <span class="dot"></span>
  {state}
</span>
