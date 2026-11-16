<script lang="ts">
  import { STATUS_LABEL, STATUS_TONE, type KnownStatus } from '#lib/software/model.ts';

  interface Props {
    status: KnownStatus;
    /** The wire value; shown as a tooltip when the pill does not read as
     * it. */
    raw?: string;
  }

  let { status, raw = '' }: Props = $props();
  let tone = $derived(STATUS_TONE[status]);
  let label = $derived(STATUS_LABEL[status]);
</script>

<span
  class="pill"
  class:pill-run={tone === 'accent'}
  class:success={tone === 'success'}
  class:warning={tone === 'warning'}
  class:danger={tone === 'danger'}
  class:muted={tone === 'muted'}
  title={raw && raw !== label ? raw : undefined}
>
  <span class="dot"></span>
  {label}
</span>
