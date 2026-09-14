<script lang="ts">
  import { STATUS_TONE, type KnownStatus } from '$lib/software/model';

  interface Props {
    status: KnownStatus;
    /** The wire value; shown as a tooltip when it is not a known status. */
    raw?: string;
  }

  let { status, raw = '' }: Props = $props();
  let tone = $derived(STATUS_TONE[status]);
</script>

<span
  class="pill"
  class:success={tone === 'success'}
  class:warning={tone === 'warning'}
  class:danger={tone === 'danger'}
  class:muted={tone === 'muted'}
  title={raw && raw !== status ? raw : undefined}
>
  <span class="dot"></span>
  {status}
</span>
