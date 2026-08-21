# Ngày 1 — Kết quả

**21/08/2026** · 0G Aristotle mainnet (chain 16661) · contract inference `0x47340d900bdFec2BD393c626E12ea0656F938d84`

Mục tiêu ngày 1 theo design doc: dựng repo, và trả lời câu hỏi **"kiểm chứng được tới mức nào"**.

---

## 1. Rủi ro TEE đã đóng — F7 làm được bản mạnh

Chuỗi kiểm chứng hoàn toàn công khai, bên thứ ba chạy được, không cần là client gốc:

| Bước | Cách làm |
|---|---|
| Lấy báo cáo attestation | `GET {providerURL}/v1/proxy/attestation/report` — không cần auth |
| Lấy chữ ký của một chat cũ | `GET {providerURL}/v1/proxy/signature/{chatID}?model={model}` — không cần auth |
| Kiểm chữ ký | `ethers.recoverAddress()` — chạy offline |

SDK phơi sẵn qua `InferenceVerifier.verifyRA`, `.fetchSignatureByChatID`, `.verifySignature` (đều là static).

**Hệ quả:** F7 giữ nguyên phạm vi bản mạnh. Không phải lùi về mức chỉ kiểm toàn vẹn transcript.

---

## 2. SDK trong skill chính chủ đã ngừng hỗ trợ

```
@0glabs/0g-serving-broker  →  DEPRECATED
"Package renamed to @0gfoundation/0g-compute-ts-sdk"
```

Cả `0g-compute-skills` lẫn `0g-agent-skills` (đều do 0G Foundation phát hành) vẫn hướng dẫn cài gói cũ.
Gói đúng: **`@0gfoundation/0g-compute-ts-sdk` v0.9.0**, có thêm `createZGComputeNetworkReadOnlyBroker`
— đọc sổ dịch vụ không cần ví, rất hợp cho prober.

*Đáng báo lại cho 0G DevRel.*

---

## 3. Phát hiện chính: `verifiability` on-chain nói quá mức đảm bảo

Trường `verifiability` trong `listService()` ghi **`TeeML`** cho **21/23** dịch vụ.
Nhưng chỉ **6** dịch vụ thực sự chạy model bên trong enclave.

**15 dịch vụ có nhãn on-chain cao hơn mức đảm bảo thật.**

Một lập trình viên đi đúng đường chính thống — gọi `broker.inference.listService()`, đọc `verifiability`,
thấy `TeeML` — sẽ kết luận model chạy trong enclave. Với 15 dịch vụ, kết luận đó sai.

### Phân biệt thật nằm ở đâu

Thông tin **có** trên chain, nhưng ở trường khác: `TargetSeparated` trong blob metadata.

```
TargetSeparated = false                        → model trong enclave       → TeeML
TargetSeparated = true  + TEEVerifier ≠ ""     → broker trong enclave      → TeeTLS
TargetSeparated = true  + TEEVerifier = ""     → không có TEE              → standard
```

Đối chiếu với phân loại của Router HTTP: **khớp 100% trên cả 20 dịch vụ so được**
(5 TeeML, 13 TeeTLS, 2 standard). Không có ngoại lệ.

Đã cài thành `deriveMode()` trong `src/sources/onchain.ts`.

> **Cách đọc cho đúng:** đây là vấn đề *đặt tên trường*, không phải nhà cung cấp khai gian.
> Trường `verifiability` gần như chắc chắn là cờ cũ mang nghĩa "có TEE", và Router về sau tách nhỏ ra.
> Nhưng đọc đúng nghĩa đen thì nó nói quá — và đường dẫn SDK chính thống lại là đường sai.

---

## 4. Hai nguồn, hai bức tranh khác nhau

| Nguồn | Số dịch vụ |
|---|---|
| Router HTTP `/v1/providers` | 42 |
| On-chain `listService()` | 23 |

**3 địa chỉ đăng ký on-chain nhưng không xuất hiện trong Router** — vô hình với mọi người dùng Router:

```
0x25f8f01c…  openai/gpt-5.4-mini   (TargetSeparated=false → TeeML thật)
0x8bd36fa1…  glm-5.2
0x91992374…  kimi-k3
```

Đáng chú ý: một trong ba là dịch vụ **TeeML thật** — mức đảm bảo cao nhất mạng lưới — mà Router không liệt kê.

Không địa chỉ nào có ở Router mà thiếu trên chain.

---

## 5. Ảnh hưởng tới thiết kế

1. **Bỏ phụ thuộc Router HTTP làm nguồn chính.** On-chain đủ dữ liệu để suy ra chế độ đúng. Router thành nguồn đối chiếu, và chênh lệch giữa hai nguồn tự nó là một số đo.
2. **Thêm một cột cho F5:** "nhãn on-chain" cạnh "chế độ thật", hiện rõ 15 dịch vụ lệch nhau.
3. **F7 giữ bản mạnh** — có đường kiểm chứng công khai đầy đủ.
4. **Ngày 2 cần ví có token** để gọi inference thật. Đến giờ toàn bộ chạy bằng read-only, chi phí bằng 0.

---

## Chạy lại

```bash
pnpm install
pnpm snapshot             # chụp cả hai nguồn, lưu data/snapshot-YYYY-MM-DD.json
pnpm compare              # đối chiếu số lượng và địa chỉ
pnpm diff-verifiability   # bảng lệch nhãn từng dịch vụ
pnpm inspect-meta         # metadata on-chain thô + tương quan TargetSeparated
```

Không cần `PRIVATE_KEY` cho bất kỳ lệnh nào ở trên.
