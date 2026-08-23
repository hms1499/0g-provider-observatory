import 'dotenv/config';

export const RPC_URL = process.env.RPC_URL ?? 'https://evmrpc.0g.ai';
export const ROUTER_API = process.env.ROUTER_API ?? 'https://router-api.0g.ai/v1';

/** 0G Aristotle mainnet. Testnet (Galileo) is 16602. */
export const MAINNET_CHAIN_ID = 16661;
export const TESTNET_CHAIN_ID = 16602;

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? MAINNET_CHAIN_ID);

/**
 * 0G Storage indexer. The indexer, not the storage RPC — it locates which nodes hold a
 * file and handles the Flow contract on upload, so only a chain RPC URL is needed
 * alongside it. Its REST gateway is also what makes F7 possible without an SDK:
 * `GET /file?root=0x…` returns the bytes to anyone holding the root.
 */
export const STORAGE_INDEXER =
  process.env.STORAGE_INDEXER ??
  (CHAIN_ID === TESTNET_CHAIN_ID
    ? 'https://indexer-storage-testnet-turbo.0g.ai'
    : 'https://indexer-storage-turbo.0g.ai');
