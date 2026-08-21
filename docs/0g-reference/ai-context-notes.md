# 0G AI Context — trích phần dùng cho Observatory

> Nguồn: https://docs.0g.ai/ai-context · lưu ngày 21/08/2026
> Đây là nguồn SDK và địa chỉ contract chính xác nhất. Các skill package đang trỏ vào SDK đã deprecated.

## SDK đúng (đã kiểm chứng trên npm)

| Việc | Gói ĐÚNG | Gói skill đang dạy (DEPRECATED) |
|---|---|---|
| Compute | `@0gfoundation/0g-compute-ts-sdk` v0.9.0 | ~~`@0glabs/0g-serving-broker`~~ |
| Storage | `@0gfoundation/0g-storage-ts-sdk` v1.2.11 | ~~`@0glabs/0g-ts-sdk`~~ v0.3.3 |

## Mạng lưới

| | Testnet Galileo | Mainnet Aristotle |
|---|---|---|
| Chain ID | 16602 | 16661 |
| RPC | `https://evmrpc-testnet.0g.ai` | `https://evmrpc.0g.ai` |
| Explorer | `https://chainscan-galileo.0g.ai` | `https://chainscan.0g.ai` |
| Storage Indexer | `https://indexer-storage-testnet-turbo.0g.ai` | `https://indexer-storage-turbo.0g.ai` |
| Faucet | `https://faucet.0g.ai` (0.1 0G/ngày) | — |

## Contract cần dùng

| Contract | Testnet | Mainnet |
|---|---|---|
| Compute Inference | `0xa79F4c8311FF93C06b8CfB403690cc987c93F91E` | `0x47340d900bdFec2BD393c626E12ea0656F938d84` |
| Compute Ledger | `0xE70830508dAc0A97e6c087c75f402f9Be669E406` | `0x2dE54c845Cd948B72D2e32e39586fe89607074E3` |
| Flow (Storage) | `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296` | `0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526` |

Mainnet Compute Inference khớp với địa chỉ SDK tự báo → đã đối chiếu chéo hai nguồn.

## F1 — ghim provider qua Router header

Không cần nạp sub-account cho từng provider. Router nhận header:

```
X-0G-Provider-Address: 0x…      ghim đúng một provider
X-0G-Provider-Sort: latency|price
X-0G-Provider-Max-Price-Usd-Prompt / -Completion / -Image
```

Header sai định dạng → trả 400. Endpoint không cần auth: `GET /v1/models`.
Theo dõi chi tiêu: `GET /v1/account/balance`, `GET /v1/account/usage/{stats,history}`.

Lấy API key: pc.0g.ai → nối ví → nạp 0G → Dashboard → API Keys → quyền `inference` → key dạng `sk-…`.

## F4 — upload transcript lên Storage

```ts
import { ZgFile, Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(PRIVATE_KEY, provider);
const indexer  = new Indexer(INDEXER_URL);

const file = await ZgFile.fromFilePath(path);
const [tree] = await file.merkleTree();
const rootHash = tree?.rootHash();          // ← ghi vào attestation on-chain
const [tx] = await indexer.upload(file, RPC_URL, signer);
await file.close();
```

Flow contract do Indexer tự xử lý khi upload file — chỉ cần RPC URL.
KV mới cần địa chỉ flow contract.

## F7 — tải bằng chứng KHÔNG cần SDK, KHÔNG cần ví

Indexer có REST gateway:

```
GET /file?root=0x...              tải file theo merkle root
GET /file?txSeq=7                 tải theo số thứ tự giao dịch
GET /file/info/{cid}              tra thông tin file
```

Nghĩa là người kiểm chứng độc lập chỉ cần `curl` + băm lại. Không cài gì.
Kết hợp với hai endpoint TEE công khai đã tìm được ngày 1:

```
GET {providerURL}/v1/proxy/attestation/report
GET {providerURL}/v1/proxy/signature/{chatID}?model=...
```

→ Toàn bộ chuỗi kiểm chứng chạy được bằng công cụ dòng lệnh phổ thông.

## Starter kit tham khảo

- Storage TS: https://github.com/0gfoundation/0g-storage-ts-starter-kit — có sẵn `uploadFile`, `downloadFile`, `uploadData`, `batchUpload`
- Compute TS: https://github.com/0gfoundation/0g-compute-ts-starter-kit
