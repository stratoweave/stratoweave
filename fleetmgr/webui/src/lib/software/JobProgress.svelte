<script lang="ts">
  interface Props {
    /** Percent done, 0 to 100. */
    value: number;
    /** What progresses, for screen readers. */
    label: string;
  }

  let { value, label }: Props = $props();
</script>

<span class="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
  <span class="done" style:width={`${value}%`}></span>
</span>

<style>
  .bar {
    display: block;
    height: 6px;
    border-radius: var(--sw-radius-sm);
    overflow: hidden;
    background: var(--sw-bar-rest);
  }

  .done {
    display: block;
    height: 100%;
    background: var(--sw-accent);
    transition: width 0.4s var(--sw-ease);
  }
</style>
