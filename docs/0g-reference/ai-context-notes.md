# 0G AI Context — the parts the Observatory needs

> Source: https://docs.0g.ai/ai-context · captured 2026-08-21
> This is the most accurate source for SDK names and contract addresses. The skill packages point at deprecated SDKs.

## Correct SDKs (verified on npm)

| Purpose | CORRECT package | What the skill teaches (DEPRECATED) |
|---|---|---|
| Compute | `@0gfoundation/0g-compute-ts-sdk` v0.9.0 | ~~`@0glabs/0g-serving-broker`~~ |
| Storage | `@0gfoundation/0g-storage-ts-sdk` v1.2.11 | ~~`@0glabs/0g-ts-sdk`~~ v0.3.3 |

## Networks

| | Testnet Galileo | Mainnet Aristotle |
|---|---|---|
| Chain ID | 16602 | 16661 |
| RPC | `https://evmrpc-testnet.0g.ai` | `https://evmrpc.0g.ai` |
| Explorer | `https://chainscan-galileo.0g.ai` | `https://chainscan.0g.ai` |
| Storage Indexer | `https://indexer-storage-testnet-turbo.0g.ai` | `https://indexer-storage-turbo.0g.ai` |
| Faucet | `https://faucet.0g.ai` (0.1 0G/day) | — |

## Contracts we use

| Contract | Testnet | Mainnet |
|---|---|---|
| Compute Inference | `0xa79F4c8311FF93C06b8CfB403690cc987c93F91E` | `0x47340d900bdFec2BD393c626E12ea0656F938d84` |
| Compute Ledger | `0xE70830508dAc0A97e6c087c75f402f9Be669E406` | `0x2dE54c845Cd948B72D2e32e39586fe89607074E3` |
| Flow (Storage) | `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296` | `0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526` |

The mainnet Compute Inference address matches what the SDK reports — cross-checked across both sources.

## F1 — pinning a provider via Router headers

No per-provider sub-account funding is needed. The Router accepts these headers:

```
X-0G-Provider-Address: 0x…      pin to exactly one provider
X-0G-Provider-Sort: latency|price
X-0G-Provider-Max-Price-Usd-Prompt / -Completion / -Image
```

A malformed header returns 400. No-auth endpoint: `GET /v1/models`.
Spend tracking: `GET /v1/account/balance`, `GET /v1/account/usage/{stats,history}`.

Getting an API key: pc.0g.ai -> connect wallet -> fund 0G -> Dashboard -> API Keys -> `inference` scope -> a key shaped `sk-…`.

## F4 — uploading transcripts to Storage

```ts
import { ZgFile, Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(PRIVATE_KEY, provider);
const indexer  = new Indexer(INDEXER_URL);

const file = await ZgFile.fromFilePath(path);
const [tree] = await file.merkleTree();
const rootHash = tree?.rootHash();          // <- written into the on-chain attestation
const [tx] = await indexer.upload(file, RPC_URL, signer);
await file.close();
```

The Indexer handles the Flow contract itself on file upload — only the RPC URL is needed.
Only KV requires the flow contract address.

## F7 — fetching proofs with NO SDK and NO wallet

The Indexer exposes a REST gateway:

```
GET /file?root=0x...              download a file by merkle root
GET /file?txSeq=7                 download by transaction sequence number
GET /file/info/{cid}              look up file info
```

So an independent verifier needs only `curl` plus a re-hash. Nothing to install.
Combined with the two public TEE endpoints already confirmed:

```
GET {providerURL}/v1/proxy/attestation/report
GET {providerURL}/v1/proxy/signature/{chatID}?model=...
```

-> The entire verification chain runs with ordinary command-line tools.

## Reference starter kits

- Storage TS: https://github.com/0gfoundation/0g-storage-ts-starter-kit — ships `uploadFile`, `downloadFile`, `uploadData`, `batchUpload`
- Compute TS: https://github.com/0gfoundation/0g-compute-ts-starter-kit
