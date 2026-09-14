import { getListEntryPath, restconfGetJson } from '$lib/core/restconf/client';
import { CAMPAIGN_LIST_ROOT, parseCampaignEntry, type CampaignCounters } from '$lib/software/model';

// Paths into a campaign's oper state (state/total etc.) currently fail
// upstream with "Child 'state' not found": the transform-published oper is
// merged into whole-entry reads but not into deeper path extraction. Until
// that is fixed, fresh counters cost a full entry GET (~120 B per member),
// so callers only fast-poll campaigns up to this size and rely on the slow
// snapshot beyond it.
export const FAST_ENTRY_LIMIT = 600;

/** Fetch fresh counters for one campaign via its entry. Returns null when
 * the campaign has no state yet or does not exist (404). */
export async function fetchCounters(
  name: string,
  fetchFn: typeof fetch = fetch
): Promise<CampaignCounters | null> {
  try {
    const json = await restconfGetJson<unknown>(
      getListEntryPath(CAMPAIGN_LIST_ROOT, name),
      fetchFn
    );
    return parseCampaignEntry(json)?.counters ?? null;
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}
