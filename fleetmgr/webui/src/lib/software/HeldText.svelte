<script lang="ts">
  import { HOLDER_STATE, heldText, holderOf } from '#lib/software/device-state.ts';
  import { campaignDeviceHref } from '#lib/software/links.ts';
  import type { DeviceStatusRow } from '#lib/software/model.ts';

  interface Props {
    /** A held member's row. */
    row: DeviceStatusRow;
    /** The campaign that holds it, where the holder opens. */
    campaign: string;
  }

  let { row, campaign }: Props = $props();
  // A group member that holds it links to its page; a flotilla does not.
  let holder = $derived(holderOf(row));
</script>

{#if row.held !== null && holder}
  behind <a class="holder" href={campaignDeviceHref(campaign, holder)}>{holder}</a> ({HOLDER_STATE[row.held]})
{:else}
  {heldText(row)}
{/if}

<style>
  .holder {
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .holder:hover {
    color: var(--sw-accent);
    text-decoration: underline;
  }
</style>
