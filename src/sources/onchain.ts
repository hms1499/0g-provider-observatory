import { createZGComputeNetworkReadOnlyBroker } from '@0gfoundation/0g-compute-ts-sdk';
import { CHAIN_ID, RPC_URL } from '../config.js';

/** The guarantee a service actually provides. */
export type GuaranteeMode = 'TeeML' | 'TeeTLS' | 'standard';

export interface OnchainService {
  provider: string;
  serviceType: string;
  url: string;
  inputPrice: bigint;
  outputPrice: bigint;
  updatedAt: bigint;
  model: string;
  /** Raw on-chain field. WARNING: reads 'TeeML' even for services running the model
   *  outside the enclave. */
  rawVerifiability: string;
  meta: OnchainMeta;
  /** The correctly derived mode. Use this, not rawVerifiability. */
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
 * Derive the real guarantee mode from on-chain metadata.
 *
 * The on-chain `verifiability` field reads 'TeeML' for EVERY service that has a TEE,
 * including those running the model outside the enclave. The real distinction lives
 * in `TargetSeparated`:
 *
 *   TargetSeparated = false                     -> model runs inside the enclave  -> TeeML
 *   TargetSeparated = true  + TEEVerifier set   -> broker in enclave, model out   -> TeeTLS
 *   TargetSeparated = true  + TEEVerifier empty -> no TEE                         -> standard
 *
 * Verified 2026-08-21: matches the HTTP Router's classification on all 20 comparable
 * services (5 TeeML, 13 TeeTLS, 2 standard), with no exceptions.
 */
export function deriveMode(raw: string, meta: OnchainMeta): GuaranteeMode {
  if (!meta.TEEVerifier) return 'standard';
  return meta.TargetSeparated === true ? 'TeeTLS' : 'TeeML';
}

function parseMeta(v: unknown): OnchainMeta {
  try { return JSON.parse(String(v ?? '{}')); } catch { return {}; }
}

/**
 * Read the service registry straight from the inference contract on 0G Chain.
 * No wallet, no gas — this is the source of truth, independent of the HTTP Router.
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
