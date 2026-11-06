<script lang="ts">
  import HealthPill from '#lib/software/HealthPill.svelte';
  import { errorText } from '#lib/core/errors.ts';
  import { formatClock } from '#lib/core/time.ts';
  import {
    CHECK_LABEL,
    fetchHealthDetails,
    interfaceStatus,
    ospfStateLabel,
    sessionLabel,
    type Health,
    type HealthDetails
  } from '#lib/software/health.ts';
  import { STEPS, type Stage } from '#lib/software/model.ts';

  interface Props {
    name: string;
    /** As /fleet/device/state relays it; a change reads the details again. */
    health: Health;
    /** The stage of the device's upgrade, null when no campaign is
     * upgrading it. From the pre-check stage on each check shows its
     * pre-check, from the post-check stage on its post-check too; before
     * that each check is one row. */
    stage: Stage | null;
  }

  let { name, health, stage }: Props = $props();

  /** Whether the upgrade has reached step: a rollback comes after both
   * checks. */
  function reached(step: 'precheck' | 'postcheck'): boolean {
    if (stage === null) return false;
    return stage === 'rollback' || STEPS.indexOf(stage) >= STEPS.indexOf(step);
  }
  let showPre = $derived(reached('precheck'));
  let showPost = $derived(reached('postcheck'));

  let details = $state<HealthDetails | null>(null);
  let readAt = $state(0);
  let loading = $state(false);
  let error = $state('');
  // Newest read wins when reads overlap.
  let sequence = 0;

  async function read(): Promise<void> {
    const mine = ++sequence;
    loading = true;
    try {
      const got = await fetchHealthDetails(name);
      if (mine !== sequence) return;
      details = got;
      readAt = Date.now() / 1000;
      error = '';
    } catch (readError) {
      if (mine !== sequence) return;
      error = errorText(readError, 'Failed to read the health details.');
    } finally {
      if (mine === sequence) loading = false;
    }
  }

  // Read when the page opens, and again when the relayed health changes.
  $effect(() => {
    void name;
    void health;
    read();
  });

  function label(check: string): string {
    return CHECK_LABEL[check] ?? check;
  }

  interface Row {
    key: string;
    label: string;
    health: Health;
    detail: string;
    /** The check whose current read the row holds; '' for none. */
    table: string;
  }

  /** Each check's pre-check once the upgrade has reached it, and its
   * post-check too once it has reached that; else one row per check, with
   * the detail of the rule that fails, or of the pre-check when both pass.
   * A check's current read goes in its last row. */
  let rows = $derived.by((): Row[] => {
    const checks = details?.checks ?? [];
    if (showPre) {
      return checks.flatMap((c) => {
        const pre = { key: `${c.name}-pre`, label: `${label(c.name)} pre-check`, ...c.precheck, table: '' };
        if (!showPost) return [{ ...pre, table: c.name }];
        return [pre, { key: `${c.name}-post`, label: `${label(c.name)} post-check`, ...c.postcheck, table: c.name }];
      });
    }
    return checks.map((c) => {
      const failing = c.precheck.health === 'unhealthy' ? c.precheck : c.postcheck.health === 'unhealthy' ? c.postcheck : null;
      return { key: c.name, label: label(c.name), health: c.health, detail: (failing ?? c.precheck).detail, table: c.name };
    });
  });

  function hasTable(check: string): boolean {
    if (!details) return false;
    if (check === 'bgp') return details.neighbors.length > 0;
    if (check === 'interfaces') return details.interfaces.length > 0;
    if (check === 'ospf') return details.ospf.length > 0;
    return false;
  }

  // What the user opened or closed; the rest is open while it fails.
  let toggled = $state<Record<string, boolean>>({});

  function isOpen(row: Row): boolean {
    return toggled[row.key] ?? row.health === 'unhealthy';
  }

  function toggle(row: Row): void {
    toggled[row.key] = !isOpen(row);
  }

  function at(text: string): string {
    const t = Date.parse(text);
    return Number.isNaN(t) ? '' : formatClock(t / 1000);
  }
</script>

{#snippet bgpTable(d: HealthDetails)}
  <table class="dense">
    <thead>
      <tr>
        <th>BGP neighbor</th>
        <th>Session</th>
        <th class="num">Advertised</th>
        <th class="num">Received</th>
      </tr>
    </thead>
    <tbody>
      {#each d.neighbors as n (n.address)}
        <tr>
          <td class="mono">{n.address}</td>
          <td>
            <span
              class="pill"
              class:success={n.sessionState === 'fsm-established'}
              class:warning={n.sessionState !== 'fsm-established'}
            >
              {sessionLabel(n.sessionState)}
            </span>
          </td>
          <td class="num mono">{n.advertised}</td>
          <td class="num mono">{n.received}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet interfacesTable(d: HealthDetails)}
  <table class="dense">
    <thead>
      <tr>
        <th>Interface</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {#each d.interfaces as i (i.name)}
        {@const status = interfaceStatus(i)}
        <tr>
          <td class="mono">{i.name}</td>
          <td>
            <span
              class="pill"
              class:success={status === 'up/up'}
              class:warning={status === 'down'}
              class:muted={status === 'admin down'}
            >
              {status}
            </span>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet ospfTable(d: HealthDetails)}
  <table class="dense">
    <thead>
      <tr>
        <th>OSPF neighbor</th>
        <th>Interface</th>
        <th>State</th>
      </tr>
    </thead>
    <tbody>
      {#each d.ospf as n (`${n.neighborId} ${n.interface}`)}
        <tr>
          <td class="mono" title={n.address ? `address ${n.address}` : undefined}>{n.neighborId}</td>
          <td class="mono">{n.interface}</td>
          <td>
            <span
              class="pill"
              class:success={n.state === 'ospf-nbr-full'}
              class:muted={n.state === 'ospf-nbr-two-way'}
              class:warning={n.state !== 'ospf-nbr-full' && n.state !== 'ospf-nbr-two-way'}
            >
              {ospfStateLabel(n.state)}
            </span>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<section class="card" id="health">
  <div class="head">
    <h2 class="panel-title">Health</h2>
    <HealthPill health={details?.health ?? health} />
    {#if details?.since}
      <span class="since">since {at(details.since)}</span>
    {/if}
    <button class="btn btn-ghost btn-sm refresh" type="button" disabled={loading} onclick={read}>
      {loading ? 'Reading…' : 'Refresh'}
    </button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if details}
    {@const d = details}
    {#if rows.length === 0}
      <p class="none">No reading of the device yet.</p>
    {:else}
      {#each rows as row (row.key)}
        {@const expandable = hasTable(row.table)}
        {@const open = expandable && isOpen(row)}
        <div class="check" class:pass={row.health === 'healthy'} class:fail={row.health === 'unhealthy'}>
          {#if expandable}
            <button class="check-head" type="button" aria-expanded={open} onclick={() => toggle(row)}>
              <span class="check-name">{row.label}</span>
              <HealthPill health={row.health} />
              <span class="check-detail mono">{row.detail}</span>
              <span class="chevron" class:open aria-hidden="true">›</span>
            </button>
          {:else}
            <div class="check-head">
              <span class="check-name">{row.label}</span>
              <HealthPill health={row.health} />
              <span class="check-detail mono">{row.detail}</span>
            </div>
          {/if}
          {#if open}
            <div class="check-body table-wrap">
              {#if row.table === 'bgp'}
                {@render bgpTable(d)}
              {:else if row.table === 'interfaces'}
                {@render interfacesTable(d)}
              {:else if row.table === 'ospf'}
                {@render ospfTable(d)}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}

    <p class="foot">Read from {details.flotilla} at {formatClock(readAt)}.</p>
  {/if}
</section>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  .head .panel-title {
    margin: 0;
  }

  .since {
    font-size: 13px;
    color: var(--sw-text-muted);
  }

  .refresh {
    margin-left: auto;
  }

  .error {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--sw-danger-text);
  }

  .none {
    margin: 0;
    color: var(--sw-text-muted);
  }

  .check {
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-deep);
  }

  .check + .check {
    margin-top: 10px;
  }

  .check.pass {
    border-color: rgb(var(--sw-success-rgb) / 0.3);
  }

  .check.fail {
    border-color: rgb(var(--sw-danger-rgb) / 0.3);
  }

  .check-head {
    display: grid;
    grid-template-columns: 170px 110px minmax(0, 1fr) 16px;
    align-items: center;
    gap: 16px;
    width: 100%;
    padding: 12px 20px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }

  button.check-head {
    cursor: pointer;
  }

  button.check-head:hover .chevron {
    color: var(--sw-text-primary);
  }

  .check-name {
    font-size: var(--sw-text-md);
    font-weight: 600;
  }

  .check-head :global(.pill) {
    justify-self: start;
  }

  .check-detail {
    font-size: 13px;
    color: var(--sw-text-primary);
  }

  .chevron {
    justify-self: end;
    font-size: 18px;
    line-height: 1;
    color: var(--sw-text-muted);
    transition: transform 0.15s;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .check-body {
    margin: 0 20px 14px;
  }

  .num {
    text-align: right;
  }

  .foot {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--sw-text-muted);
  }

  @media (max-width: 720px) {
    .check-head {
      grid-template-columns: auto 1fr 16px;
    }

    .check-detail {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>
