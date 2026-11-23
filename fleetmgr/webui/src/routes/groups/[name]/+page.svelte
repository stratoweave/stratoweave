<script lang="ts">
  import LoadError from '#lib/core/ui/LoadError.svelte';
  import GroupEditor from '#lib/software/GroupEditor.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#if data.loadError}
  <LoadError message={data.loadError} />
{:else}
  <!-- Another group gets a fresh editor, not the edits made here. -->
  {#key data.name}
    <GroupEditor
      name={data.name}
      members={data.members}
      otherGroups={data.otherGroups}
      campaignsOf={data.campaignsOf}
      policy={data.policy}
      hasEntry={data.hasEntry}
      deviceNames={data.deviceNames}
    />
  {/key}
{/if}
