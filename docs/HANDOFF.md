# Bàn giao phiên — tiếp tục từ đây

**Cập nhật:** 21/08/2026 · kết thúc ngày 1/9

---

## Đang làm gì

**0G Provider Observatory** — lớp đo độc lập cho mạng inference của 0G.
Dự thi **0G Bridge by AKINDO, Wave 3**. Hạn nộp **30/08/2026 22:00** (còn 9 ngày).

Design doc (v3, đã chốt): https://claude.ai/code/artifact/d4f6a199-c73f-470d-bc63-e90a22cdd02c
Nguồn file: `docs/provider-observatory.html` — sửa file rồi publish lại là cùng URL.

## Định vị — ĐỌC TRƯỚC KHI VIẾT BẤT KỲ THỨ GÌ

**Đây là thiết bị đo, KHÔNG phải cáo trạng.**

Nhà vận hành trên mạng là **0G Foundation, Alibaba Cloud, Tencent, ByteDance, MiniMax, OpenRouter**
— tức chính ban tổ chức và các tập đoàn lớn. Định vị ban đầu ("88% mạng lưới không chứng minh được
model nào đã chạy") đã bị **loại bỏ** vì nó đọc thành lời tố cáo nhắm vào chủ nhà.

Định vị hiện tại: *lập trình viên chọn provider dựa trên chỉ số mà mạng lưới tự báo về chính mình —
chưa ai đo lại, và không có gì lưu theo thời gian.*

Bốn nguyên tắc (mục 08 của design doc): thiết bị đo không phải cáo trạng · giải thích trước khi
xếp hạng · mọi con số dẫn về nguồn · nói rõ cái mình không biết.

Riêng chế độ `standard` phải hiện kèm **lý do kỹ thuật**, không chấm điểm thấp — không ai nhét được
API đóng của Anthropic vào enclave TDX của mình.

---

## Ngày 1 đã xong

Chi tiết: `docs/day-1-findings.md`

1. **Rủi ro TEE đã đóng** — chuỗi kiểm chứng công khai, bên thứ ba chạy được. F7 giữ bản mạnh.
2. **Phát hiện chính** — `verifiability` on-chain ghi `TeeML` cho 21/23 dịch vụ nhưng chỉ 6 thực sự
   chạy model trong enclave. Phân biệt thật nằm ở `TargetSeparated`. Đã cài thành `deriveMode()`
   trong `src/sources/onchain.ts`, khớp 100% với Router trên 20 dịch vụ so được.
3. **Hai nguồn lệch nhau** — Router 42 dịch vụ, on-chain 23. Ba địa chỉ on-chain vô hình với Router,
   một trong đó là dịch vụ TeeML thật.
4. **Cả hai SDK trong skill chính chủ đã deprecated** — đã chuyển sang gói đúng.

Snapshot mốc: `data/snapshot-2026-08-21.json`

## Lệnh chạy được (không cần private key, chi phí 0)

```bash
pnpm install
pnpm snapshot             # chụp cả hai nguồn
pnpm compare              # đối chiếu số lượng, địa chỉ
pnpm diff-verifiability   # bảng lệch nhãn từng dịch vụ
pnpm inspect-meta         # metadata on-chain thô
npx tsx src/scripts/cost-model.ts   # chi phí một vòng đo
```

---

## VIỆC TIẾP THEO — ngày 2

### Chặn ở người dùng (chỉ anh Huy làm được)

Vào **pc.0g.ai** → nối ví → nạp một ít 0G → Dashboard → API Keys → tạo key quyền `inference`
(dạng `sk-…`) → điền vào `.env`. Đây là thứ duy nhất Claude không tự làm được.

Bắt đầu bằng **testnet** (faucet https://faucet.0g.ai, 0.1 0G/ngày). Chuyển mainnet ở ngày 6.

### Làm được ngay, không cần chờ

- Viết bộ 15 probe (prompt xác định, temperature 0)
- Lớp gọi Router có ghim provider bằng header `X-0G-Provider-Address`
- Chạy khô trên `data/snapshot-2026-08-21.json`

### Quyết định kỹ thuật đã chốt cho ngày 2

**Ghim provider bằng header Router, KHÔNG nạp sub-account từng provider.**
Tránh được 20 sub-account và khóa rút 24 giờ.

```
X-0G-Provider-Address: 0x…                      ghim đúng một provider
X-0G-Provider-Max-Price-Usd-Completion: …       van an toàn chống đốt tiền
```

Chi tiết SDK, contract, endpoint: `docs/0g-reference/ai-context-notes.md`

---

## Chi phí

| | |
|---|---|
| Một vòng đo (15 probe × 19 dịch vụ chatbot = 285 lời gọi) | **$0,39** |
| Inference cả chương trình (1 vòng/ngày × 8 ngày) | ~$3 |
| Gas deploy mainnet | $5–10 |
| **Tổng** | **$10–15** |

Hai dịch vụ đắt nhất (`claude-fable-5`, `claude-opus-5`) chiếm gần 1/3 chi phí mỗi vòng.

---

## Còn mở

- **Trùng lặp với VeriAgent** (Wave 3) — họ chấm điểm tin cậy cho *agent* của người dùng,
  mình đo *hạ tầng* của mạng lưới. Phải nói rõ trong mô tả một dòng và video demo.
- **Nên báo lại 0G DevRel** hai việc: skill trỏ vào SDK deprecated, và `verifiability` on-chain
  nói quá mức đảm bảo. Cả hai đều là đóng góp thật, ghi điểm Traction & Communication.

## Lịch còn lại

| Ngày | Việc |
|---|---|
| 2–3 | Prober + bộ probe + đo tính nhất quán, hiệu chuẩn cặp `glm-5.2` TeeML/TeeTLS |
| 3–4 | Contract Registry + Measurement, test testnet |
| 5 | Nối 0G Storage, transcript lên và rootHash về |
| 6–7 | Dashboard, quét toàn mạng, gom theo 20 địa chỉ vận hành |
| 8 | CLI kiểm chứng, deploy mainnet, chạy vài epoch thật |
| 9 | README, video 3 phút, post X (`#0GBridge #BuildOn0G` tag `@0G_labs @0G_Builders @AKINDO_io`), nộp |

**Ngày 9 không viết code.** Yêu cầu nộp bài đầy đủ: `HACKATHON-RULES.md`
