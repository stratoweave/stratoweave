import { getListEntryPath, restconfGetOrNull } from '$lib/core/restconf/client';
import {
  CAMPAIGN_LIST_ROOT,
  countersOf,
  parseCampaignEntry,
  parseStateNode,
  type CampaignConfig,
  type CampaignCounters,
  type StateParts
} from '$lib/software/model';

// The state node carries the plan and one row per member (~150 B each),
// so callers fetch it every tick only for campaigns up to this size and
// every slow tick beyond it. Counters are four leaf GETs and cost the same
// at any size.
export const FAST_ENTRY_LIMIT = 600;

function entryPath(name: string): string {
  return getListEntryPath(CAMPAIGN_LIST_ROOT, name);
}

function statePath(name: string): string {
  return `${entryPath(name)}/state`;
}

/** One campaign's entry, its state included unless `configOnly` (RFC 8040
 * content=config); null when there is no such campaign (404). */
export async function fetchCampaignEntry(
  name: string,
  configOnly: boolean,
  fetchFn: typeof fetch = fetch
): Promise<{ config: CampaignConfig; state: StateParts | null } | null> {
  const path = configOnly ? `${entryPath(name)}?content=config` : entryPath(name);
  return parseCampaignEntry(await restconfGetOrNull<unknown>(path, fetchFn));
}

/** One campaign's state node. Null (404) when it has published none yet,
 * or when there is no such campaign. */
export async function fetchCampaignState(name: string, fetchFn: typeof fetch = fetch): Promise<StateParts | null> {
  return parseStateNode(await restconfGetOrNull<unknown>(statePath(name), fetchFn));
}

/** One counter leaf, {"software:total": 1000}; null when absent. */
async function fetchLeaf(path: string, fetchFn: typeof fetch): Promise<number | null> {
  const json = await restconfGetOrNull<Record<string, unknown>>(path, fetchFn);
  const raw = json ? Object.values(json)[0] : null;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Fresh counters for one campaign from its four counter leaves; null when
 * it has no state yet or does not exist. */
export async function fetchCounters(
  name: string,
  fetchFn: typeof fetch = fetch
): Promise<CampaignCounters | null> {
  const base = statePath(name);
  const [total, inProgress, succeeded, failed] = await Promise.all(
    ['total', 'in-progress', 'succeeded', 'failed'].map((leaf) => fetchLeaf(`${base}/${leaf}`, fetchFn))
  );
  return total === null ? null : countersOf(total, inProgress ?? 0, succeeded ?? 0, failed ?? 0);
}

/** The plan's alarm lines for one campaign; empty when it has none or no
 * plan yet (both 404). */
export async function fetchPlanAlarms(name: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const json = await restconfGetOrNull<{ 'software:alarm'?: string[] }>(`${statePath(name)}/plan/alarm`, fetchFn);
  return json?.['software:alarm'] ?? [];
}
