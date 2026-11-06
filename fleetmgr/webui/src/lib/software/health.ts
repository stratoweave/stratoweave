// Device health: the pre-check and post-check rules of the bgp, interfaces
// and ospf checks, which the device's flotilla applies to every read.
// /fleet/device/state/health relays only healthy or unhealthy; the details
// stay on the flotilla, and GET /device-health/<name> has the top read them
// when a page asks.

/** '' until the flotilla has read the device. */
export type Health = 'healthy' | 'unhealthy' | '';

export function parseHealth(value: unknown): Health {
  return value === 'healthy' || value === 'unhealthy' ? value : '';
}

export interface Verdict {
  health: Health;
  detail: string;
}

/** One check, bgp, interfaces or ospf, with its pre-check and post-check
 * rule applied to its last read. */
export interface HealthCheck {
  name: string;
  health: Health;
  precheck: Verdict;
  postcheck: Verdict;
}

export interface HealthNeighbor {
  address: string;
  sessionState: string;
  advertised: number;
  received: number;
}

export interface HealthInterface {
  name: string;
  adminStatus: string;
  operStatus: string;
}

export interface HealthOspfNeighbor {
  neighborId: string;
  interface: string;
  address: string;
  state: string;
}

export interface HealthDetails {
  flotilla: string;
  health: Health;
  /** yang:date-and-time of the last health change; '' when unknown. */
  since: string;
  checks: HealthCheck[];
  bgpBaseline: { established: number; advertised: number } | null;
  neighbors: HealthNeighbor[];
  interfaces: HealthInterface[];
  ospf: HealthOspfNeighbor[];
}

export const CHECK_LABEL: Record<string, string> = { bgp: 'BGP', interfaces: 'Interfaces', ospf: 'OSPF' };

interface VerdictJson {
  health?: string;
  detail?: string;
}

interface CheckJson {
  name?: string;
  health?: string;
  precheck?: VerdictJson;
  postcheck?: VerdictJson;
  'baseline-at'?: string;
}

interface NeighborJson {
  address?: string;
  'session-state'?: string;
  advertised?: number;
  received?: number;
}

interface InterfaceJson {
  name?: string;
  'admin-status'?: string;
  'oper-status'?: string;
  'up-at-baseline'?: boolean;
}

interface OspfNeighborJson {
  'neighbor-id'?: string;
  interface?: string;
  address?: string;
  state?: string;
  'state-at-baseline'?: string;
}

interface DetailsJson {
  flotilla?: string;
  health?: string;
  since?: string;
  checks?: CheckJson[];
  bgp?: { baseline?: { established?: number; advertised?: number }; neighbors?: NeighborJson[] };
  interfaces?: InterfaceJson[];
  ospf?: OspfNeighborJson[];
  error?: string;
}

function parseVerdict(v: VerdictJson | undefined): Verdict {
  return { health: parseHealth(v?.health), detail: v?.detail ?? '' };
}

export function parseHealthDetails(json: unknown): HealthDetails {
  const d = (json ?? {}) as DetailsJson;
  const b = d.bgp?.baseline;
  return {
    flotilla: d.flotilla ?? '',
    health: parseHealth(d.health),
    since: d.since ?? '',
    checks: (d.checks ?? []).map((c) => ({
      name: c.name ?? '',
      health: parseHealth(c.health),
      precheck: parseVerdict(c.precheck),
      postcheck: parseVerdict(c.postcheck)
    })),
    bgpBaseline: b ? { established: b.established ?? 0, advertised: b.advertised ?? 0 } : null,
    neighbors: (d.bgp?.neighbors ?? []).map((n) => ({
      address: n.address ?? '',
      sessionState: n['session-state'] ?? '',
      advertised: n.advertised ?? 0,
      received: n.received ?? 0
    })),
    // The flotilla also lists what only the baseline had; this is the
    // current read alone, the post-check names what is missing.
    interfaces: (d.interfaces ?? [])
      .filter((i) => i['admin-status'] || i['oper-status'])
      .map((i) => ({
        name: i.name ?? '',
        adminStatus: i['admin-status'] ?? '',
        operStatus: i['oper-status'] ?? ''
      })),
    ospf: (d.ospf ?? [])
      .filter((n) => n.state)
      .map((n) => ({
        neighborId: n['neighbor-id'] ?? '',
        interface: n.interface ?? '',
        address: n.address ?? '',
        state: n.state ?? ''
      }))
  };
}

/** Read the device's health details from its flotilla, through the top. */
export async function fetchHealthDetails(name: string, fetchFn: typeof fetch = fetch): Promise<HealthDetails> {
  const response = await fetchFn(`/device-health/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json' }
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: the reply text is the error.
  }
  if (!response.ok) {
    const error = (json as DetailsJson | null)?.error;
    throw new Error(error || text || `HTTP ${response.status}`);
  }
  return parseHealthDetails(json);
}

/** fsm-established -> established */
export function sessionLabel(state: string): string {
  return state.startsWith('fsm-') ? state.slice(4) : state;
}

/** up/up as `show interfaces` puts it. */
export function interfaceStatus(i: HealthInterface): 'up/up' | 'down' | 'admin down' {
  if (i.adminStatus === 'if-state-down') return 'admin down';
  return i.adminStatus === 'if-state-up' && i.operStatus === 'if-oper-state-ready' ? 'up/up' : 'down';
}

/** ospf-nbr-full -> full */
export function ospfStateLabel(state: string): string {
  return state.startsWith('ospf-nbr-') ? state.slice(9) : state;
}
