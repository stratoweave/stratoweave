<script lang="ts">
  import LoadError from '#lib/core/ui/LoadError.svelte';
  import ScheduleEditor from '#lib/maintenance/ScheduleEditor.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<!-- Without the names a create cannot tell a new name from a taken one,
     and would merge into the schedule that has it. -->
{#if data.loadError}
  <LoadError message={data.loadError} />
{:else}
  <ScheduleEditor
    schedule={null}
    existingNames={data.existingNames}
    usage={{ boundDevices: 0, defaultOf: [] }}
    now={Date.now() / 1000}
  />
{/if}
