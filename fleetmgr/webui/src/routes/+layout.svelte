<script lang="ts">
  import '../app.css';

  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';

  let { children }: { children?: Snippet } = $props();

  async function handleRefresh(): Promise<void> {
    window.dispatchEvent(new CustomEvent('global-refresh'));
    await invalidateAll();
  }

  const PAGE_LABELS: Record<string, string> = {
    '/devices': 'Devices',
    '/campaigns': 'Campaigns',
    '/campaigns/new': 'New campaign',
    '/images': 'Images & matrix'
  };

  let currentPathname = $derived(page.url.pathname);
  let campaignName = $derived(
    currentPathname.startsWith('/campaigns/') && PAGE_LABELS[currentPathname] === undefined
      ? decodeURIComponent(currentPathname.slice('/campaigns/'.length))
      : null
  );
  let currentLabel = $derived(campaignName ?? PAGE_LABELS[currentPathname] ?? 'Campaigns');
  let pageTitle = $derived(`${currentLabel} · fleetmgr`);
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="app-shell">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <a class="logo-link" href="/campaigns" aria-label="fleetmgr — go to campaigns">
        <img
          class="logo-img"
          src="/stratoweave-logo.png"
          alt="fleetmgr"
          width="286"
          height="53"
        />
      </a>
    </div>
    <nav class="sidebar-nav" aria-label="Primary navigation">
      <div class="nav-section">
        <div class="nav-section-label">Software</div>
        <a
          class="nav-item"
          class:active={currentPathname.startsWith('/campaigns')}
          href="/campaigns"
        >
          <span class="nav-icon">⬆</span>
          Campaigns
        </a>
        <a
          class="nav-item"
          class:active={currentPathname.startsWith('/images')}
          href="/images"
        >
          <span class="nav-icon">▤</span>
          Images &amp; matrix
        </a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Inventory</div>
        <a
          class="nav-item"
          class:active={currentPathname.startsWith('/devices')}
          href="/devices"
        >
          <span class="nav-icon">⬡</span>
          Devices
        </a>
      </div>
    </nav>
  </aside>

  <!-- Main area -->
  <div class="app-main-wrap">
    <header class="app-header">
      <nav class="yang-path" aria-label="Breadcrumb">
        {#if campaignName !== null}
          <a class="segment" href="/campaigns">Campaigns</a>
          <span class="separator">/</span>
        {/if}
        <span class="segment current" aria-current="page">{currentLabel}</span>
      </nav>

      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" type="button" onclick={handleRefresh}>
          ⟳ Refresh
        </button>
      </div>
    </header>

    <main class="app-content">
      {@render children?.()}
    </main>
  </div>
</div>
