<script lang="ts">
  import { goto } from '$app/navigation';

  import { errorText } from '#lib/core/errors.ts';
  import { leaveNotice } from '#lib/core/notice.ts';
  import { restconfPatchJson } from '#lib/core/restconf/client.ts';
  import FieldText from '#lib/core/ui/FieldText.svelte';
  import { focusFirstError } from '#lib/core/ui/focus.ts';
  import SegmentedControl from '#lib/core/ui/SegmentedControl.svelte';
  import TokenSelect from '#lib/core/ui/TokenSelect.svelte';
  import { groupCreatePatch, parseSeparation, suggestNames, validateNewGroup } from '#lib/software/groups.ts';
  import { DATA_ROOT, type SeparationPolicy } from '#lib/software/model.ts';
  import type { PageProps } from './$types';

  const POLICIES: { value: SeparationPolicy; label: string }[] = [
    { value: 'spread', label: 'spread' },
    { value: 'pack', label: 'pack' }
  ];

  let { data }: PageProps = $props();

  const uid = $props.id();
  let name = $state('');
  let members = $state<string[]>([]);
  let memberDraft = $state('');
  let policy = $state<SeparationPolicy>('spread');
  let minSeparation = $state('');
  let touched = $state(false);
  let saving = $state(false);
  let statusMessage = $state('');
  let form: HTMLElement | null = $state(null);

  let deviceSet = $derived(new Set(data.deviceNames));
  let groupSet = $derived(new Set(data.groupNames));
  let memberOptions = $derived(
    suggestNames(data.deviceNames, memberDraft, new Set(members)).map((value) => ({ value }))
  );
  // A name typed but not added yet counts.
  let allMembers = $derived.by(() => {
    const typed = memberDraft.trim();
    return typed && !members.includes(typed) ? [...members, typed] : members;
  });
  let validation = $derived(
    validateNewGroup({ name, members: allMembers, policy, minSeparation }, groupSet, deviceSet)
  );
  let errors = $derived(touched ? validation.errors : ({} as Record<string, string>));

  async function create(): Promise<void> {
    touched = true;
    if (!validation.ok) {
      await focusFirstError(form);
      return;
    }
    const group = { name: name.trim(), policy, minSeparation: parseSeparation(minSeparation) ?? 0 };
    try {
      saving = true;
      statusMessage = '';
      await restconfPatchJson(DATA_ROOT, groupCreatePatch(group, allMembers));
      leaveNotice(`Created group ${group.name}.`);
      // Not a preload made before the write.
      await goto(`/groups/${encodeURIComponent(group.name)}`, { refreshAll: true });
    } catch (saveError) {
      statusMessage = errorText(saveError, 'Failed to create the group.');
    } finally {
      saving = false;
    }
  }
</script>

<div class="page-header">
  <div>
    <h1>New group</h1>
  </div>
  <div class="page-actions">
    <a class="btn btn-secondary" href="/groups">Cancel</a>
    <button class="btn btn-primary" type="button" disabled={saving} onclick={create}>
      {saving ? 'Creating…' : 'Create group'}
    </button>
  </div>
</div>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

{#if statusMessage}
  <div class="error-state status" role="alert">{statusMessage}</div>
{/if}

<section bind:this={form} class="card form">
  <FieldText
    label="Name"
    required={true}
    value={name}
    error={errors['name']}
    mono={true}
    placeholder="e.g. site-0042"
    onchange={(v) => (name = v)}
    ontouch={() => (touched = true)}
  />
  <div class="field">
    <label class="field__label" for={`${uid}-members`}>
      Members <span class="field__required" aria-hidden="true">*</span>
    </label>
    <TokenSelect
      id={`${uid}-members`}
      options={memberOptions}
      selected={members}
      label="Members"
      placeholder="add device"
      suggest={true}
      required={true}
      invalid={!!errors['members']}
      describedby={`${uid}-members-meta`}
      bind:draft={memberDraft}
      onchange={(next) => (members = next)}
    />
    <small id={`${uid}-members-meta`} class="field__meta" class:field__meta--error={!!errors['members']}>
      {errors['members'] || ' '}
    </small>
  </div>
  <div class="grid">
    <div class="field">
      <span class="field__label">Separation</span>
      <div class="policy">
        <SegmentedControl
          options={POLICIES}
          value={policy}
          ariaLabel="Separation policy"
          onchange={(next) => (policy = next)}
        />
      </div>
      <small class="field__meta"> </small>
    </div>
    <FieldText
      label="Min separation"
      value={minSeparation}
      error={errors['min-separation']}
      mono={true}
      placeholder="e.g. 30m"
      onchange={(v) => (minSeparation = v)}
      ontouch={() => (touched = true)}
    />
  </div>
</section>

<style>
  .form {
    max-width: 820px;
    display: grid;
    gap: 6px;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }

  /* The control keeps its own width, as the field next to it is a row of
     the same height. */
  .policy {
    display: flex;
  }
</style>
