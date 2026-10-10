<script lang="ts">
  import ScheduleEditor from '$lib/maintenance/ScheduleEditor.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

{#if data.schedule === null}
  <section class="card">
    <div class="empty-state">
      No schedule named {data.name}. <a href="/schedules">Back to schedules</a>
    </div>
  </section>
{:else}
  {#key data.schedule.name}
    <ScheduleEditor
      schedule={data.schedule}
      existingNames={data.existingNames}
      usage={data.usage}
      now={Date.now() / 1000}
    />
  {/key}
{/if}
