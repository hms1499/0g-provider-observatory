/**
 * Hand-written ABI fragments for the two Observatory contracts.
 *
 * Only the functions a reader needs. Kept narrow on purpose: the verification CLI and
 * the dashboard read from chain, they never write, and a reader that cannot write is
 * one less thing a verifier has to trust.
 */

export const PROVIDER_REGISTRY_ABI = [
  'function providerCount() view returns (uint16)',
  'function get(uint16 id) view returns (tuple(address addr, uint8 declaredMode, uint32 registeredAt, bytes32 modelHash))',
  'function idOf(address addr, string model) view returns (uint16)',
  'event ProviderRegistered(uint16 indexed id, address indexed addr, bytes32 indexed modelHash, string model, uint8 declaredMode)',
] as const;

export const MEASUREMENT_REGISTRY_ABI = [
  'function REGISTRY() view returns (address)',
  'function EPOCH_DURATION() view returns (uint32)',
  'function epochOf(uint64 timestamp) view returns (uint32)',
  'function currentEpoch() view returns (uint32)',
  'function isWritten(uint32 epoch, address prober) view returns (bool)',
  'function getHeader(uint32 epoch, address prober) view returns (tuple(address prober, uint64 writtenAt, uint16 count, bytes32 storageRoot))',
  'function getMeasurements(uint32 epoch, address prober) view returns (tuple(uint16 providerId, uint32 p50Ms, uint32 p95Ms, uint16 errorRateBps, uint16 divergenceBps, uint16 calls, uint8 observedMode)[])',
  'function epochsOf(address prober) view returns (uint32[])',
  'event EpochWritten(uint32 indexed epoch, address indexed prober, bytes32 storageRoot, uint16 count)',
] as const;
