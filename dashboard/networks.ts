/**
 * Where the dashboard reads from. Contract addresses are public constants and are bundled
 * at build time; the RPC and indexer are chosen at view time by the network toggle.
 *
 * Both networks are live. Mainnet was deployed 2026-08-24 — see
 * `deployments/aristotle-16661.json` — and holds no seeded values: every measurement there
 * comes from a real prober run, unlike testnet epoch 496497 which carries stand-ins.
 */
export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  indexerUrl: string;
  explorer: string;
  providerRegistry: string;
  measurementRegistry: string;
  prober: string;
}

export type NetworkKey = 'testnet' | 'mainnet';

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  testnet: {
    name: '0G Galileo testnet',
    chainId: 16602,
    rpcUrl: 'https://evmrpc-testnet.0g.ai',
    indexerUrl: 'https://indexer-storage-testnet-turbo.0g.ai',
    explorer: 'https://chainscan-galileo.0g.ai',
    providerRegistry: '0xCF9236a145FaE855B6894Eb7951cA9619D6613a8',
    measurementRegistry: '0x9bdeC5D5749270cf20DDa5d541770839E083CAc6',
    prober: '0xaBaCa14B88Ee1E392985e4dF315ae4e70CC734DB',
  },
  mainnet: {
    name: '0G Aristotle mainnet',
    chainId: 16661,
    rpcUrl: 'https://evmrpc.0g.ai',
    indexerUrl: 'https://indexer-storage-turbo.0g.ai',
    explorer: 'https://chainscan.0g.ai',
    providerRegistry: '0x25165feDACd1B78e103c3B49FcAF7CAeB118b9D6',
    measurementRegistry: '0xF2fC195A72Ed74e09530b31C568c1e0CBF6c0333',
    prober: '0x691Bb0Cc823A03f7dcaF272Dc62896668f81D2FD',
  },
};

export const isDeployed = (net: NetworkConfig): boolean => net.measurementRegistry !== '';

export const explorerTx = (net: NetworkConfig, hash: string): string =>
  `${net.explorer}/tx/${hash}`;

export const explorerAddress = (net: NetworkConfig, address: string): string =>
  `${net.explorer}/address/${address}`;

export const bundleUrl = (net: NetworkConfig, root: string): string =>
  `${net.indexerUrl.replace(/\/+$/, '')}/file?root=${root}`;
