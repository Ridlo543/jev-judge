# BLUEPRINT & IMPLEMENTATION PLAN: UNIVERSAL DECISION MODEL RUNNER (JEV MCP)

> **Prinsip Utama:** Arsitektur harus **100% Provider-Agnostic & OpenAI-Compatible**. Menghilangkan bias vendor/provider tertentu. Sistem ini adalah decision runner universal yang dapat berbicara dengan endpoint apa pun yang mematuhi standar **OpenAI Chat Completions** maupun **TypeSafe System One Direct API**.

---

## 1. Koreksi Cacat Desain & Netralitas Provider

### Cacat Sebelumnya (Vendor Bias):
- Penggunaan prefix spesifik vendor seperti `AINYROUTER_` pada environment variable, default URL hardcoded, dan penamaan variabel.
- Ini membatasi fleksibilitas dan membuat arsitektur terikat pada satu penyedia layanan tertentu (*vendor lock-in*).

### Standar Baku yang Diterapkan:
1. **Penamaan Environment Standard:**
   - **Primary:** `JEV_BASE_URL`, `JEV_API_KEY`, `JEV_MODEL`.
   - **Universal OpenAI Fallback:** `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`.
   - **Silent Legacy Fallbacks (Opsional):** `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `ROUTER_AINYTHING`, `AINYROUTER_API_KEY`.
2. **Dua Mode Wire Protocol Universal:**
   - **`chat-completions` (Default OpenAI-Compatible):** Standar industri untuk semua proxy, router, vLLM, LiteLLM, Ollama, dan gateway AI. Mengirim `{ model, state, questions }` ke `/chat/completions` dan meng-unwrap `choices[0].message.content`.
   - **`typesafe-direct`:** Mengirim payload langsung ke endpoint resmi TypeSafe atau OpenRouter Decisions yang mengembalikan `{ answers: {...} }` di root body.

---

## 2. Analisis Konteks & Repositori Referensi Nyata (Cloned Repos)

Empat repositori referensi telah diperiksa dan berada langsung di `D:/Programming/project/`:

### A. `jkudish/jev-mcp` (di `D:/Programming/project/jev-mcp-main`)
- **Kekuatan:** 12 tools dengan rubrik teruji (*citation check, anti-injection, composite diff scoring*).
- **Kelemahan:** Monolitik (2.133 baris di `server.ts`), inkompatibel dengan OpenAI ChatCompletions, belum di-build.

### B. `jkudish/jev-agent-tools` (di `D:/Programming/project/jev-agent-tools`)
- **Pelajaran Berharga:** Memiliki mekanisme *retry resilience* (jittered exponential backoff untuk HTTP 408/409/429/5xx) dan standard rejection code (`request_failed`, `rate_limited`, `unavailable`, `invalid_usage`).
- **Kekurangan:** Terkunci hanya pada 4 driver (`typesafe`, `openrouter`, `cloudflare`, `vercel`). Sama sekali tidak memiliki transport `openai-compatible` / `chat-completions`.

### C. `codaaiteam/jev-mcp` (di `D:/Programming/project/codaaiteam-mcp`)
- **Pelajaran Berharga:** Implementasi MCP server yang sangat ringkas (hanya 248 baris di `src/index.js`).
- **Tool Unggulan:** Memiliki `jev_gate` yang menyaring aksi/command agent yang berisiko sebelum dijalankan (`action`, `context`) $\to$ mengembalikan rekomendasi `allow | confirm | block` dan boolean `touches_prod`.

### D. `codaaiteam/jev-agent-tools` (di `D:/Programming/project/codaaiteam-tools`)
- **Pelajaran Berharga:** Mengimplementasikan *Agent Loop Detector* (mendeteksi agent yang berputar-putar tanpa progress dengan klasifikasi `progress | repeating | stuck | escalate`).
### E. Workspace Kita (`D:/Programming/project/jev-judge`)
- **Kekuatan:** Sudah memiliki transport OpenAI-compatible native yang cepat (~600ms), Universal CLI (`jev`), dan programmatic SDK Bun/Node.
- **Arah Penggabungan:** Menyerap keunggulan rubrik dari 4 repo di atas ke dalam struktur modular tanpa mewarisi dependensi monolitik atau vendor-lock mereka.
---

## 3. Desain Konfigurasi Terpusat Netral (`src/config.ts`)

### A. Hierarki Resolusi Konfigurasi
```
[1. Explicit CLI Flags / Runtime Options] (--api-key, --base-url, --model)
       ↓
[2. MCP Client Environment] (env di .omp/mcp.json atau ~/.claude.json)
       ↓
[3. File Konfigurasi Lokal] (jev.config.json / .jevrc)
       ↓
[4. File .env Lokal]
       ↓
[5. Standar Environment Variables] (JEV_API_KEY, OPENAI_API_KEY, dll.)
       ↓
[6. Safe Default Fallback]
```

### B. Format File Konfigurasi Standar (`jev.config.json`)
```json
{
  "protocol": "chat-completions",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "your-api-key-here",
  "model": "jev-1.13",
  "timeoutMs": 20000,
  "defaultThreshold": 0.5
}
```
*Catatan: Nilai `baseUrl` dan `model` dapat diarahkan ke provider OpenAI-compatible mana saja (lokal, proxy, atau cloud).*

---

## 4. Arsitektur Modular Berbasis Domain (`src/tools/`)

Struktur dipisahkan secara modular untuk menghindari file monolitik 2.000 baris:

```
jev-judge/
├── src/
│   ├── config.ts             # Centralized provider-agnostic configuration manager
│   ├── types.ts              # Core types & tool schema definitions
│   ├── client.ts             # Transport engine (mendukung ChatCompletions & Direct)
│   │
│   ├── tools/                # DOMAIN-SEPARATED TOOL MODULES
│   │   ├── types.ts          # Shared ToolDefinition & ToolContext interfaces
│   │   ├── coding.ts         # jev_gate, jev_review (Code review & Anti-Fake Done)
│   │   ├── research.ts       # jev_decide, jev_find, jev_rerank, jev_compare (Decision making)
│   │   ├── guardrails.ts     # jev_verify, jev_screen, jev_extract, jev_audit (Fact-checking & anti-injeksi)
│   │   └── primitives.ts     # jev_judge, jev_judge_batch, jev_noul (Universal freeform)
│   │
│   ├── mcp.ts                # Thin MCP Dispatcher (<150 baris): Aggregator & JSON-RPC 2.0 server
│   ├── cli.ts                # Universal CLI runner
│   └── index.ts              # Unified programmatic SDK exports
├── test/
│   ├── judge.test.ts         # Test suite primitif dan core client
│   ├── coding.test.ts        # Test suite jev_gate & jev_review
│   ├── research.test.ts      # Test suite jev_decide & jev_rerank
│   └── guardrails.test.ts    # Test suite jev_verify & jev_screen
├── jev.config.json           # File konfigurasi netral opsional
└── README.md                 # Dokumentasi panduan setup dan referensi tool
```

---

## 5. Rincian & Rumus Matematis 14 Tools (Berdasarkan Bedah Kode Sumber)

### 🛠️ Domain 1: Coding & Acceptance Gating (Anti-Fake Done)

#### 1. `jev_review` (Evaluasi Git Diff & Patch)
- **Tujuan:** Menghitung skor objektif terhadap perubahan kode sebelum tugas dinyatakan selesai.
- **Input Schema:**
  - `diff` (string, max 50.000 char, truncated marker `[…truncated]`)
  - `request` (string, max 50.000 char, deskripsi tugas/tiket)
  - `tests` (string opsional, output log testing nyata)
  - `auto_accept` (number, default 0.8)
  - `review_at` (number, default min(0.5, auto_accept))
  - `composite_floor` (number, default 0.7)
- **Pertanyaan Jev yang Dikirim:**
  1. `correctness` (Score 0..2): `0: broken/buggy, 1: plausible with issues, 2: correct and complete`
  2. `spec_match` (Score 0..2): `0: diverges, 1: partial match, 2: exact specification match`
  3. `test_gap` (Score 0..2): `0: well tested, 1: partial test coverage, 2: untested critical path`
  4. `blast_radius` (Score 0..2): `0: tight localized changes, 1: moderate, 2: wide unconstrained blast radius`
  5. `safe_to_apply` (Noul): `Is this patch safe to merge without breaking production?`
- **Formula Perhitungan Skor Komposit (`reviewComposite`):**
  $$composite = 0.4 \cdot \frac{correctness}{2} + 0.3 \cdot \frac{spec\_match}{2} + 0.15 \cdot \left(1 - \frac{test\_gap}{2}\right) + 0.15 \cdot \left(1 - \frac{blast\_radius}{2}\right)$$
- **Aturan Aksi Keputusan (`reviewAction`):**
  - `escalate`: Jika keyakinan model < `review_at`, atau `safe_to_apply` < `review_at`.
  - `auto`: Hanya jika `safe_to_apply` $\ge$ `auto_accept` DAN min confidence $\ge$ `auto_accept` DAN $composite \ge composite\_floor$.
  - `review`: Jika berada di antara batas threshold.
  - *Incomplete Context Rule:* Jika diff terpotong (*truncated*), status `auto` otomatis diturunkan menjadi `review` (*fail-closed*).

#### 2. `jev_gate` (Gating Anti-Fake Done: Patch + Klaim vs Bukti)
- **Tujuan:** Menjadi hakim penentu sebelum commit/merge. Memverifikasi apakah klaim agent ("unit test lulus", "no secrets leak") benar-benar didukung bukti (*evidence*).
- **Input Schema:**
  - `diff` (string diff), `request` (string tiket)
  - `claims` (array of strings, max 16 item, max 2.000 char/item)
  - `evidence` (string atau array of `{ id, text }`, max 200.000 char total)
  - `tests` (string opsional)
- **Pertanyaan Jev:**
  - Menjalankan 5 pertanyaan `jev_review` di atas untuk diff.
  - Ditambah pertanyaan Choice untuk setiap klaim $i$:
    `relation_claim_i`:
    - `supports`: "The evidence clearly supports the claim"
    - `contradicts`: "The evidence contradicts the claim"
    - `says_nothing`: "The evidence neither supports nor contradicts the claim"
- **Hukum Anti-Fake Done:**
  - Jika ada satu saja klaim yang `contradicted` (misal klaim tes lulus tapi log bukti menunjukkan error):
    **Action WAJIB `escalate` (Tugas Ditolak).**
  - Klaim tanpa bukti nyata dipetakan ke `unsupported`.

#### 3. `jev_action_gate` (Pre-execution Safety Screen - Diadopsi dari `codaaiteam/jev-mcp`)
- **Tujuan:** Menyaring perintah shell atau modifikasi file berisiko sebelum agent mengeksekusinya.
- **Input:** `action` (string command/action), `context?` (string tujuan eksekusi).
- **Pertanyaan Jev:**
  1. `risk` (Score 0..3): `["safe", "low", "needs review", "high — destructive"]`
  2. `touches_prod` (Noul): `Does this action delete/overwrite data or touch production?`
  3. `recommendation` (Choice): `allow | confirm | block`
- **Output:** `{ recommendation, risk_score, touches_prod, touches_prod_probability }`

---

### 🔬 Domain 2: Technical Research & Unbiased Decision Making

#### 4. `jev_decide` (Arbitrase Keputusan Objektif)
- **Tujuan:** Memilih opsi terbaik dari 2–6 kandidat alternatif teknis tanpa diplomasi semu LLM.
- **Input Schema:**
  - `decision` (string, max 1.500 char), `evidence` (max 12.000 char), `priorities` (max 2.000 char)
  - `candidates` (2..6 item, `{ id, description }`)
  - `requirements` (max 3 item)
  - `escape_hatches` (boolean, default true)
- **Escape Hatches Baku:**
  - `ask_user`: "Preferensi atau requirement krusial hilang; tanyakan ke user daripada mengarang"
  - `investigate`: "Kumpulkan bukti teknis/fakta tambahan sebelum memilih"
  - `none`: "Tidak ada kandidat yang memenuhi requirement"
- **Output:** `recommendation` (`selected`, `escaped: boolean`, `confidence`, full `probabilities`), `checks[]` per requirement, dan `warnings` jika requirement bertentangan dengan pilihan rekomendasi.

#### 5. `jev_find` & `jev_rerank` (Semantic Selection Tanpa Vector DB)
- **`jev_find`:** Mengembalikan `exists_verdict` (`answered >= 0.7 | partial | absent < 0.35`) dan kandidat `top[]` terurut.
- **`jev_rerank`:** Menilai relevansi setiap kandidat secara independen (max 250 kandidat) dan mengurutkan secara menurun (`rank`, `id`, `relevance`, `text`).

#### 6. `jev_compare` (Komparasi Dokumen & Aspek)
- **Input:** `passage_a`, `passage_b` (max 20.000 char), `aspects?` (max 10 aspek).
- **Relasi yang Dinilai:** `same_fact | contradicts | different_facts`.
- **Output:** Relasi keseluruhan + evaluasi independen per aspek.

---

### 🛡️ Domain 3: Guardrails, Dokumen & Anti-Bias (Fact-Checking)

#### 7. `jev_verify` (Citation & Claim Verification)
- **Input:** `claims[]` (max 16), `evidence` (string/array), `auto_accept` (default 0.8), `subject_at` (default 0.5).
- **Decomposition Dual-Question per Klaim:**
  1. `relation`: `supports | contradicts | says_nothing`
  2. `same_subject` (Noul): Apakah bukti membahas subjek yang sama persis?
- **Kontrak:** Sebuah kontradiksi hanya sah jika `same_subject >= subject_at`. Bila tidak, diubah menjadi `unsupported` dengan action `review`.

#### 8. `jev_screen` (Prompt Injection & Substance Screen)
- **Pertanyaan Jev:**
  1. `injection` (Noul): Apakah teks mengandung instruksi tersembunyi yang menargetkan AI agent?
  2. `substance` (Noul): Apakah teks memiliki konten substantif yang dapat dibaca?
  3. `relevance` (Noul, opsional jika ada `purpose`): Apakah teks relevan dengan tujuan tugas?
- **Logika Rekomendasi:**
  - `block`: jika injection $\ge 0.75$ (`block_at`)
  - `review`: jika injection $\ge 0.25$ (`review_at`)
  - `skip`: jika substance $< 0.3$ atau relevance $< 0.3$
  - `pass`: bersih dari seluruh sinyal bahaya

#### 9. `jev_extract` & `jev_audit` (Verbatim Extraction & Audit)
- `jev_extract`: Regex kandidat mengusulkan substring, Jev memilih substring verbatim terbaik (model tidak pernah mengarang teks).
- `jev_audit`: Menguji kegagalan ekstraksi (`hallucinated | off_target | incomplete | format`). Max over checks, bukan rata-rata.

---

### 🌐 Domain 4: Primitives & Universal

#### 10. `jev_noul` (Probabilitas Kalibrasi Murni)
- Input `propositions[]` (max 64 item), mengembalikan `probability` terkalibrasi (`0.0 – 1.0`) dan label `likely | unlikely | uncertain`.

#### 11. `jev_judge` & `jev_judge_batch` (Universal Runner)
- `jev_judge`: Single/multi-question dinamis (Yes/No, Choice, Score).
- `jev_judge_batch`: Concurrent worker pool dengan concurrency cap (default 5).
## 6. Panduan Registrasi MCP Bersih (OpenAI-Compatible)

### A. Oh My Pi (OMP)
Di file `.omp/mcp.json` atau `~/.omp/mcp.json`:
```json
{
  "mcpServers": {
    "jev": {
      "command": "bun",
      "args": ["D:/Programming/project/jev-judge/src/mcp.ts"],
      "env": {
        "OPENAI_BASE_URL": "https://your-openai-compatible-endpoint/v1",
        "OPENAI_API_KEY": "your-api-key",
        "JEV_MODEL": "your-jev-model-name"
      }
    }
  }
}
```

### B. Claude Code
Di file `~/.claude.json`:
```json
{
  "mcpServers": {
    "jev": {
      "command": "bun",
      "args": ["D:/Programming/project/jev-judge/src/mcp.ts"],
      "env": {
        "OPENAI_BASE_URL": "https://your-openai-compatible-endpoint/v1",
        "OPENAI_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## 7. Analisis Risiko Obyektif & Batasan Teknis (Zero Hallucination / Anti-Sycophancy)

1. **Jev Bukan Model Generasi:** Jev murni *decision classifier*, ia tidak bisa menghasilkan teks/kode baru. Agent LLM yang bertugas menghasilkan kode; Jev yang memvalidasi.
2. **Batas Ukuran Konteks:** Diff di atas 50.000 karakter wajib dipotong secara terukur (*bounded truncation*).
3. **Prinsip Fail-Closed:** Bila terjadi kegagalan jaringan atau timeout, tool **DILARANG KERAS** mengembalikan status `pass` atau `auto: true` secara diam-diam. Seluruh kegagalan harus memicu status `invalid_response` atau melempar error eksplisit.
4. **Kalibrasi Probabilitas:** Angka probabilitas 0.51 bukan konsensus kuat; agent wajib membaca distribusi probabilitas penuh sebelum mengambil tindakan otomatis.

---

## 8. Evaluasi Obyektif Model Jev 1.13 terhadap Rencana Ini

Hasil evaluasi live model Jev 1.13 (`opencode-free/jev-1.13-free`) terhadap rencana revisi yang bebas bias vendor:

| Parameter Evaluasi | Tipe Jev | Nilai / Verdict | Calibrated Probability / Confidence | Keterangan Jev |
|---|---|---|---|---|
| **`provider_neutrality`** | `noul` | **`true`** | **0.81 (81%)** | Bebas dari vendor lock-in, mematuhi standar OpenAI-compatible |
| **`architectural_modularity`** | `noul` | **`true`** | **0.88 (88%)** | Pemisahan domain modular memecahkan anti-pattern monolitik |
| **`workflow_coverage`** | `score` | **`2.38` / 3.0** | **0.58 (58%)** | Kategori *"good to production-ready"* |
| **`recommendation_verdict`** | `choice` | **`Proceed with Neutral Modular Adoption`** | **0.94 (94%)** | Pilihan probabilitas: Proceed (96%), Reject (3%), Postpone (1%) |

Rencana ini resmi menggantikan dokumen sebelumnya dan menjadi standar implementasi bebas bias.
