<script lang="ts">
  import GroupEditor from '#lib/software/GroupEditor.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

<!-- Another group gets a fresh editor, not the edits made here. -->
{#key data.name}
  <GroupEditor
    name={data.name}
    members={data.members}
    otherGroups={data.otherGroups}
    campaignsOf={data.campaignsOf}
    separation={data.separation}
    hasEntry={data.hasEntry}
    deviceNames={data.deviceNames}
  />
{/key}
