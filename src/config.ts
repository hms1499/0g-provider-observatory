import 'dotenv/config';

export const RPC_URL = process.env.RPC_URL ?? 'https://evmrpc.0g.ai';
export const ROUTER_API = process.env.ROUTER_API ?? 'https://router-api.0g.ai/v1';

/** 0G Aristotle mainnet. Testnet (Galileo) là 16602. */
export const MAINNET_CHAIN_ID = 16661;
export const TESTNET_CHAIN_ID = 16602;

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? MAINNET_CHAIN_ID);
