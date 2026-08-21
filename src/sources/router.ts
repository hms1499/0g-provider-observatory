import { ROUTER_API } from '../config.js';

/** Một dịch vụ như Router HTTP mô tả. Chỉ số ở đây do mạng lưới tự báo. */
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
  /** Router tự báo. Prober không tin số này — nó là thứ chúng ta đối chiếu. */
  latency: number | null;
  uptime: number | null;
  pricing_usd?: Record<string, string>;
}

export async function fetchRouterServices(): Promise<RouterService[]> {
  const res = await fetch(`${ROUTER_API}/providers`);
  if (!res.ok) throw new Error(`Router /providers trả về ${res.status}`);
  const body = (await res.json()) as { data: RouterService[] };
  return body.data;
}

/** Chế độ đảm bảo, gộp hai trường mà Router dùng không nhất quán. */
export function guaranteeMode(s: RouterService): 'TeeML' | 'TeeTLS' | 'standard' {
  return s.verifiability ?? (s.trust_mode === 'standard' ? 'standard' : 'standard');
}
