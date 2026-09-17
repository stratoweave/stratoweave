<script lang="ts">
  import { page } from '$app/state';

  let title = $derived(page.status === 404 ? 'Page not found' : `Error ${page.status}`);
  let description = $derived(
    page.error?.message || (page.status === 404 ? 'Nothing lives at this address.' : 'Something went wrong.')
  );
</script>

<div class="page-header">
  <div>
    <h2>{title}</h2>
    <p>{description}</p>
  </div>
</div>

<section class="card">
  <div class="empty-state">
    <a class="btn btn-primary btn-sm" href="/campaigns">Back to campaigns</a>
  </div>
</section>

<style>
  .card {
    padding: 20px;
  }
</style>
