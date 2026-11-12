<script lang="ts">
  import { HOLDER_STATE, heldText, holderOf } from '#lib/software/device-state.ts';
  import type { DeviceStatusRow } from '#lib/software/model.ts';

  interface Props {
    /** A held member's row. */
    row: DeviceStatusRow;
  }

  let { row }: Props = $props();
  // A group member that holds it links to its page; a flotilla does not.
  let holder = $derived(holderOf(row));
</script>

{#if row.held !== null && holder}
  behind <a class="holder" href={`/devices/${encodeURIComponent(holder)}`}>{holder}</a> ({HOLDER_STATE[row.held]})
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
