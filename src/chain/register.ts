/**
 * Deciding what to register in ProviderRegistry, kept separate from doing it.
 *
 * Registration is permanent — the contract has no update and no delete — so the decisions
 * are worth testing on their own, without a wallet or a network in the way.
 */
import type { Mode } from './registry.js';

/** A mode the contract will accept. `Unknown` is id 0 and `register` reverts on it. */
export type DeclaredMode = Exclude<Mode, 'Unknown'>;

export interface RegistrationCandidate {
  address: string;
  modelId: string;
  /** What the Router reports for this pair. Always present — the Router is what lists it. */
  routerMode: DeclaredMode;
  /** What the compute contract says, or null when the chain has no entry for this pair. */
  onchainMode: DeclaredMode | null;
}

/** Which source the registered mode came from, so the record can say how it was decided. */
export type ModeSource = 'both' | 'onchain' | 'router';

/**
 * Pick the mode to register, and say where it came from.
 *
 * The chain wins where it speaks. `declaredMode` means "what the network claims about
 * itself", and the compute contract is the network claiming it directly rather than through
 * an HTTP service that could describe it differently.
 *
 * It usually does not speak. Measured on the 2026-08-24 snapshot: of 38 chatbot pairs the
 * chain covers 16, and on those 16 the two sources agree exactly — zero disagreements. The
 * other 22 have no on-chain entry at all, because each address registers a single model on
 * chain while serving many through the Router (0x1f444c8a declares claude-fable-5 and serves
 * nine). So the fallback is not a compromise, it is the only source those pairs have.
 */
export function resolveDeclaredMode(
  routerMode: DeclaredMode,
  onchainMode: DeclaredMode | null,
): { mode: DeclaredMode; source: ModeSource } {
  if (onchainMode === null) return { mode: routerMode, source: 'router' };
  if (onchainMode === routerMode) return { mode: onchainMode, source: 'both' };
  return { mode: onchainMode, source: 'onchain' };
}

/** A candidate with its mode decided, which is what the writer needs and all it needs. */
export interface ResolvedRegistration extends RegistrationCandidate {
  declaredMode: DeclaredMode;
  modeSource: ModeSource;
}

/**
 * Decide every candidate's mode, keeping both raw sources alongside the decision.
 *
 * The inputs are not discarded: the point of a dual-source project is that a reader can see
 * what each source said and how the tie was broken, rather than being handed a conclusion.
 */
export function resolveAll(
  candidates: readonly RegistrationCandidate[],
): ResolvedRegistration[] {
  return candidates.map((c) => {
    const { mode, source } = resolveDeclaredMode(c.routerMode, c.onchainMode);
    return { ...c, declaredMode: mode, modeSource: source };
  });
}

/** Generic over the candidate so a resolved candidate stays resolved through planning. */
export interface RegistrationPlan<T extends RegistrationCandidate = RegistrationCandidate> {
  toRegister: T[];
  /** Already on chain. Carries the existing id so the caller can report it. */
  skipped: (T & { id: number })[];
  /** Listed more than once in the input. Kept out of the batch, and reported. */
  duplicates: T[];
}

/** Identity is the pair, not the address — one address serves many models. */
const keyOf = (c: RegistrationCandidate) => `${c.address.toLowerCase()}|${c.modelId}`;

/**
 * Work out what still needs registering.
 *
 * Idempotent on purpose. `register` reverts with `AlreadyRegistered`, and because
 * `registerBatch` is one transaction, a single already-registered pair would take the whole
 * batch down with it. Re-running after a partial failure has to be safe.
 *
 * `existingId` returns 0 for a pair that is not registered: ids start at 1 precisely so
 * that 0 can mean "absent" without a separate lookup.
 */
export function planRegistrations<T extends RegistrationCandidate>(
  candidates: readonly T[],
  existingId: (address: string, modelId: string) => number,
): RegistrationPlan<T> {
  const plan: RegistrationPlan<T> = { toRegister: [], skipped: [], duplicates: [] };
  const seen = new Set<string>();

  for (const c of candidates) {
    const key = keyOf(c);
    if (seen.has(key)) {
      plan.duplicates.push(c);
      continue;
    }
    seen.add(key);

    const id = existingId(c.address, c.modelId);
    if (id > 0) plan.skipped.push({ ...c, id });
    else plan.toRegister.push(c);
  }
  return plan;
}
