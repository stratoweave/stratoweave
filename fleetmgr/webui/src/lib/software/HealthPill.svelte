<script lang="ts">
  import type { Health } from '#lib/software/health.ts';

  interface Props {
    health: Health;
  }

  let { health }: Props = $props();
</script>

<span
  class="pill"
  class:success={health === 'healthy'}
  class:danger={health === 'unhealthy'}
  class:muted={health === ''}
  title={health === '' ? 'Not read from the device yet' : undefined}
>
  <span class="dot"></span>
  {health || 'unknown'}
</span>
