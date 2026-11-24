<script lang="ts">
  import FieldText from '#lib/core/ui/FieldText.svelte';
  import { bandwidthText, type BetweenWindows } from './planning-form';

  // When the members of a campaign may prepare ahead, and the cap of the
  // bandwidth their prepares use together, as the new-campaign form and
  // the campaign page set them.

  interface Settings {
    first: boolean;
    between: BetweenWindows;
    during: boolean;
    /** Mbit/s as typed; '' for the image list's. */
    maxBandwidth: string;
  }

  interface Props {
    settings: Settings;
    error?: string;
    disabled?: boolean;
    /** Whether the members prepare between windows, as the plan has it
     * for a campaign that leaves it automatic; null before there is a
     * plan, or when the campaign sets it. */
    betweenNow?: boolean | null;
    /** The image list's cap that the plan keeps under, in bits/s; null
     * before there is a plan, or when the campaign has its own. */
    capNow?: number | null;
    onchange: (next: Settings) => void;
  }

  let { settings, error = '', disabled = false, betweenNow = null, capNow = null, onchange }: Props = $props();

  // Automatic shows what the plan decided, or neither when there is no
  // plan yet.
  let betweenChecked = $derived(
    settings.between === 'auto' ? betweenNow === true : settings.between === 'on'
  );
  let betweenUnknown = $derived(settings.between === 'auto' && betweenNow === null);
  let autoText = $derived(
    betweenNow === null ? 'automatic' : `automatic, ${betweenNow ? 'on' : 'off'} now`
  );

  function patch(partial: Partial<Settings>): void {
    onchange({ ...settings, ...partial });
  }
</script>

<div class="prepare">
  <span class="kick">Prepare</span>
  <label class="check" class:disabled title="Members prepare before the first window opens, the members of the earliest windows first.">
    <input
      type="checkbox"
      checked={settings.first}
      {disabled}
      onchange={(e) => patch({ first: e.currentTarget.checked })}
    />
    <span>Before the first window</span>
  </label>
  <div class="between">
    <label class="check" class:disabled title="A member that does not fit before the first window prepares between windows, before its own.">
      <input
        type="checkbox"
        checked={betweenChecked}
        indeterminate={betweenUnknown}
        {disabled}
        onchange={(e) => patch({ between: e.currentTarget.checked ? 'on' : 'off' })}
      />
      <span>Between windows</span>
    </label>
    {#if settings.between === 'auto'}
      <span class="auto">{autoText}</span>
    {:else}
      <button class="btn-link" type="button" {disabled} onclick={() => patch({ between: 'auto' })}>
        Automatic
      </button>
    {/if}
  </div>
  <label class="check" class:disabled title="Members may also prepare while a window is open, each still before its own.">
    <input
      type="checkbox"
      checked={settings.during}
      {disabled}
      onchange={(e) => patch({ during: e.currentTarget.checked })}
    />
    <span>During windows</span>
  </label>
  <div class="cap">
    <FieldText
      label="Max bandwidth (Mbit/s)"
      value={settings.maxBandwidth}
      {error}
      mono={true}
      {disabled}
      yangType="uint64, bits/second"
      placeholder={capNow === null ? 'image list' : `${bandwidthText(capNow)} (image list)`}
      tooltip="The most that the prepares of this campaign use together; empty takes the image list's."
      onchange={(v) => patch({ maxBandwidth: v })}
    />
  </div>
</div>

<style>
  .prepare {
    display: grid;
    gap: 8px;
    margin-top: 8px;
    padding-left: 26px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--sw-text-sm);
    cursor: pointer;
  }

  .check.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .between {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .auto {
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
  }

  .btn-link {
    padding: 0;
    border: none;
    background: none;
    font-size: var(--sw-text-xs);
    color: var(--sw-accent-bright);
    cursor: pointer;
  }

  .btn-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cap {
    max-width: 220px;
    margin-top: 4px;
  }
</style>
