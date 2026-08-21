import { createZGComputeNetworkReadOnlyBroker } from '@0gfoundation/0g-compute-ts-sdk';
import { CHAIN_ID, RPC_URL } from '../config.js';

/** Chế độ đảm bảo thật sự của một dịch vụ. */
export type GuaranteeMode = 'TeeML' | 'TeeTLS' | 'standard';

export interface OnchainService {
  provider: string;
  serviceType: string;
  url: string;
  inputPrice: bigint;
  outputPrice: bigint;
  updatedAt: bigint;
  model: string;
  /** Trường thô on-chain. CẢNH BÁO: ghi 'TeeML' cho cả dịch vụ chạy model ngoài enclave. */
  rawVerifiability: string;
  meta: OnchainMeta;
  /** Chế độ suy ra đúng — dùng cái này, không dùng rawVerifiability. */
  mode: GuaranteeMode;
}

interface OnchainMeta {
  TargetSeparated?: boolean;
  ProviderType?: string;
  TEEVerifier?: string;
  ProviderIdentity?: string;
  ImageDigest?: string;
  VerifierURL?: string;
  [k: string]: unknown;
}

/**
 * Suy ra chế độ đảm bảo thật từ metadata on-chain.
 *
 * Trường `verifiability` on-chain ghi 'TeeML' cho MỌI dịch vụ có TEE, kể cả
 * khi model chạy ngoài enclave. Phân biệt thật nằm ở `TargetSeparated`:
 *
 *   TargetSeparated = false  → model chạy trong enclave        → TeeML
 *   TargetSeparated = true  + TEEVerifier khác rỗng → broker trong enclave, model ngoài → TeeTLS
 *   TargetSeparated = true  + TEEVerifier rỗng      → không có TEE                      → standard
 *
 * Kiểm chứng 21/08/2026: khớp 100% với phân loại của Router HTTP trên cả 20
 * dịch vụ đối chiếu được (5 TeeML, 13 TeeTLS, 2 standard).
 */
export function deriveMode(raw: string, meta: OnchainMeta): GuaranteeMode {
  if (!meta.TEEVerifier) return 'standard';
  return meta.TargetSeparated === true ? 'TeeTLS' : 'TeeML';
}

function parseMeta(v: unknown): OnchainMeta {
  try { return JSON.parse(String(v ?? '{}')); } catch { return {}; }
}

/**
 * Đọc sổ dịch vụ thẳng từ contract inference trên 0G Chain.
 * Không cần ví, không tốn gas — đây là nguồn sự thật gốc, độc lập với Router HTTP.
 */
export async function fetchOnchainServices(): Promise<OnchainService[]> {
  const broker = await createZGComputeNetworkReadOnlyBroker(RPC_URL, CHAIN_ID);
  const raw = (await broker.inference.listService()) as any[];

  return raw.map((s) => {
    const meta = parseMeta(s[8]);
    const rawVerifiability = String(s[7] ?? '');
    return {
      provider: String(s[0]),
      serviceType: String(s[1]),
      url: String(s[2]),
      inputPrice: BigInt(s[3] ?? 0),
      outputPrice: BigInt(s[4] ?? 0),
      updatedAt: BigInt(s[5] ?? 0),
      model: String(s[6]),
      rawVerifiability,
      meta,
      mode: deriveMode(rawVerifiability, meta),
    };
  });
}
