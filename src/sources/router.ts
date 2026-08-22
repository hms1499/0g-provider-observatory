import { ROUTER_API } from '../config.js';

/** One service as the HTTP Router describes it. These figures are the network's own claims. */
export interface RouterService {
  address: string;
  model_id: string;
  canonical_id: string;
  provider_name: string | null;
  service_type: string;
  verifiability?: 'TeeML' | 'TeeTLS';
  trust_mode?: 'private' | 'verified' | 'standard';
  tee_attested?: boolean;
  tee_type?: string;
  tee_verifier?: string;
  is_healthy: boolean;
  /** Self-reported by the Router. The prober does not trust this — it is what we check against. */
  latency: number | null;
  uptime: number | null;
  pricing_usd?: Record<string, string>;
}

export async function fetchRouterServices(): Promise<RouterService[]> {
  const res = await fetch(`${ROUTER_API}/providers`);
  if (!res.ok) throw new Error(`Router /providers returned ${res.status}`);
  const body = (await res.json()) as { data: RouterService[] };
  return body.data;
}

/** Guarantee mode, folding the two fields the Router uses inconsistently. */
export function guaranteeMode(s: RouterService): 'TeeML' | 'TeeTLS' | 'standard' {
  return s.verifiability ?? (s.trust_mode === 'standard' ? 'standard' : 'standard');
}
