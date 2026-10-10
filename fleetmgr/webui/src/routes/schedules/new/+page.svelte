<script lang="ts">
  import ScheduleEditor from '$lib/maintenance/ScheduleEditor.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

<ScheduleEditor
  schedule={null}
  existingNames={data.existingNames}
  usage={{ boundDevices: 0, defaultOf: [] }}
  now={Date.now() / 1000}
/>
