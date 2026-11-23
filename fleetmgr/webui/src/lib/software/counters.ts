import { getListEntryPath, restconfGetOrNull } from '#lib/core/restconf/client.ts';
import {
  CAMPAIGN_LIST_ROOT,
  parseCampaignEntry,
  parseStateNode,
  type CampaignConfig,
  type CampaignCounters,
  type StateParts
} from '#lib/software/model.ts';

// The state node carries the plan and one row per member (~150 B each),
// so callers fetch it every tick only for campaigns up to this size and
// every slow tick beyond it. The counters are one GET of the state with
// the RFC 8040 fields parameter and cost the same at any size.
export const FAST_ENTRY_LIMIT = 600;

const COUNTER_FIELDS = 'total;in-progress;succeeded;up-to-date;failed;held';

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

/** Fresh counters for one campaign; null when it has no state yet or does
 * not exist. */
export async function fetchCounters(
  name: string,
  fetchFn: typeof fetch = fetch
): Promise<CampaignCounters | null> {
  const json = await restconfGetOrNull<unknown>(`${statePath(name)}?fields=${COUNTER_FIELDS}`, fetchFn);
  return parseStateNode(json)?.counters ?? null;
}

/** What the campaigns list shows of one campaign's state, in one GET: its
 * counters, when it first ran, which tells a paused campaign from one never
 * run, and all the alarm lines of its plan; null and none when it has no
 * state yet or does not exist. */
export async function fetchListState(
  name: string,
  fetchFn: typeof fetch = fetch
): Promise<{ counters: CampaignCounters | null; runSince: number | null; alarms: string[] }> {
  const state = parseStateNode(
    await restconfGetOrNull<unknown>(`${statePath(name)}?fields=${COUNTER_FIELDS};run-since;plan/alarm`, fetchFn)
  );
  return { counters: state?.counters ?? null, runSince: state?.runSince ?? null, alarms: state?.alarms ?? [] };
}
