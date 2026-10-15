# Jev (Universal TypeSafe Decision Model Runner & MCP Server)

Fast, calibrated decision model runner for **Claude Code**, **Oh My Pi (OMP)**, **Cursor**, **Windsurf**, **Cline**, CI/CD pipelines, CLI terminal, and TypeScript/Node/Bun projects. Powered by **TypeSafe Jev (System One Decision Model)** with **100% Provider-Agnostic & OpenAI-Compatible Architecture**.

---

## 💡 Mengapa Decision Model, Bukan LLM Chat Biasa?

Model bahasa percakapan (LLM seperti Claude atau GPT) dirancang untuk memprediksi token teks berikutnya (prose). Menggunakan LLM chat untuk evaluasi biner (*"apakah ini aman?"*), audit kode, atau pengambilan keputusan arsitektur sering memicu:
- **Confirmation Bias & Sycophancy:** LLM cenderung membenarkan pekerjaannya sendiri (*"yes, this looks good"*).
- **Format Halucination:** Teks markdown pengantar, backticks, atau JSON parsing error.
- **Probabilitas Semu:** Tidak memberikan probabilitas terkalibrasi secara matematis.
- **Latensi Tinggi:** Membutuhkan 5–15 detik untuk menulis kalimat penalaran panjang.

**TypeSafe Jev (System One)** adalah model neural khusus **Decision & Classification**:
1. **Nol Halusinasi Format:** Output langsung berupa typed decision struct.
2. **Probabilitas Terkalibrasi (Calibrated Confidence):** Mengembalikan angka probabilitas matematis nyata (`0.0` – `1.0`).
3. **Sangat Cepat:** Round-trip rata-rata **~400ms – 900ms**.
4. **Multi-Criteria Single-Pass:** Evaluasi belasan kriteria dalam 1 kali round-trip.
5. **Zero Token Waste:** Tidak ada kalimat basa-basi yang membuang kuota token.

---

## 🛠️ Taksonomi 14 MCP Tools (4 Domain Modular)

### 1. 🛠️ Domain Coding & Acceptance Gating (Anti-Fake Done)
- **`jev_review`**: Evaluasi git diff / patch terhadap permintaan tiket. Mengembalikan skor ordinal 0..2 untuk `correctness`, `spec_match`, `test_gap`, `blast_radius`, komposit terbobot (`0.0 - 1.0`), dan aksi policy (`auto | review | escalate`).
- **`jev_gate`**: Gate penentu sebelum commit/merge. Memeriksa patch diff sekaligus memverifikasi klaim pengembang (*"semua unit test lulus"*, *"no secret leak"*) terhadap bukti log nyata (*evidence*). **Strict Anti-Fake Done:** Jika ada klaim yang kontradiktif terhadap bukti nyata, gate langsung menolak dengan status `escalate`.
- **`jev_action_gate`**: Pre-execution safety screen untuk menyaring command shell atau modifikasi file sebelum dieksekusi autonomous agent. Mengembalikan `risk_score` (0..3), boolean `touches_prod`, dan rekomendasi (`allow | confirm | block`).

### 2. 🔬 Domain Technical Research & Decision Making
- **`jev_decide`**: Memilih 1 opsi terbaik dari 2–6 kandidat alternatif teknis berdasarkan matriks kebutuhan (*requirements*), bukti (*evidence*), dan prioritas. Dilengkapi escape hatches (`ask_user`, `investigate`, `none`) bila data tidak cukup, mencegah spekulasi.
- **`jev_find`**: Menemukan kandidat paling relevan dari daftar array teks dan menentukan apakah ada jawaban yang valid (`exists_verdict: answered | partial | absent`).
- **`jev_rerank`**: Mengurutkan seluruh array kandidat berdasarkan skor relevansi semantik kontinu tanpa memerlukan vector database atau embedding eksternal.
- **`jev_compare`**: Membandingkan 2 passage atau dokumen spek untuk mendeteksi relasi (`same_fact | contradicts | different_facts`), baik secara keseluruhan maupun per aspek individual.

### 3. 🛡️ Domain Guardrails & Verification (Fact-Checking)
- **`jev_verify`**: Fact-checking baris per baris terhadap dokumen bukti (*citation-check*). Menguji relasi klaim (`supports | contradicts | says_nothing`) dan verifikasi kesamaan subjek (*same-subject check*) untuk memutus confirmation bias.
- **`jev_screen`**: Menyaring teks yang di-fetch atau di-paste sebelum masuk ke context window agent: mendeteksi prompt injection, instruksi tersembunyi, teks sampah (*substance check*), dan relevansi tugas.
- **`jev_extract`**: Ekstraksi nilai verbatim dari dokumen menggunakan regex kandidat yang diseleksi oleh Jev (model tidak pernah mengarang atau berhalusinasi teks).
- **`jev_audit`**: Mengaudit data hasil ekstraksi terhadap dokumen sumber untuk mendeteksi kegagalan: `hallucinated`, `off_target`, atau `incomplete`.

### 4. 🌐 Domain Primitives & Universal
- **`jev_judge`**: Evaluasi bebas fleksibel (string tunggal, array of strings, Yes/No, multiple-choice, rating scale, atau map of questions).
- **`jev_judge_batch`**: Evaluasi massal concurrent dengan throughput rate-limiting.
- **`jev_noul`**: Menghitung probabilitas terkalibrasi (`0.0 - 1.0`) untuk hipotesis kalimat tunggal dengan label `likely | unlikely | uncertain`.

---

## ⚙️ Konfigurasi Manual (100% Provider-Agnostic)

Sistem ini **tidak meng-hardcode nama vendor tertentu**. Anda bebas mengarahkannya ke provider/gateway apa saja (OpenRouter, LiteLLM, vLLM, ainyrouter, proxy lokal, atau TypeSafe direct).

Konfigurasi dibaca secara berjenjang:
1. **Explicit CLI flags:** `--base-url`, `--api-key`, `--model`, `--protocol`
2. **MCP config env (`.mcp.json`):** Environment variable yang diatur langsung di client MCP.
3. **File `jev.config.json`:** Diletakkan di root project atau direktori kerja.
4. **File `.env`:** File `.env` lokal di direktori kerja.

### Environment Variables Standar:
- `JEV_BASE_URL` (atau `OPENAI_BASE_URL`): URL endpoint provider Anda (misal: `https://api.openai.com/v1`, `http://localhost:8000/v1`, atau router Anda).
- `JEV_API_KEY` (atau `OPENAI_API_KEY`): API Key otentikasi Anda.
- `JEV_MODEL` (atau `OPENAI_MODEL`): Nama model decision (misal: `opencode-free/jev-1.13-free`, `jev-latest`, dll).
- `JEV_PROTOCOL`: Mode wire protocol: `chat-completions` (default OpenAI-compatible) atau `typesafe-direct`.

---

## 🤖 Panduan Integrasi MCP di Agent (Workspace & Global)

Server MCP `jev` dapat dipasang di level **Workspace Project** (khusus repo ini) atau **Global** (berlaku di semua proyek).

### 🚀 Cara Paling Cepat: Setup Wizard Otomatis (`jev setup`)

Cukup jalankan wizard interaktif berikut di terminal:
```bash
# Menggunakan npx (siapa pun yang punya Node.js):
npx jev-judge setup

# ATAU jika binary jev sudah ada:
jev setup
```
Wizard akan menanyakan:
1. Target Agent: **Claude Code**, **Oh My Pi (OMP)**, **Cursor**, atau **Workspace Local**.
2. Base URL & API Key Anda.
3. Model ID (default `jev-latest`).
Dan otomatis menulis file `.mcp.json` / config tanpa perlu edit JSON manual!

---

### 🛠️ Pilihan Executable untuk Eksternal Developer
1. **NPX / Node.js (Paling Populer & Zero-Install):** `npx -y jev-judge mcp`
2. **Standalone Binary (Zero Runtime Needed):** Unduh `jev-mcp.exe` (Windows) atau `jev-mcp-linux-x64` dari GitHub Releases.
3. **Bun Runtime:** Menggunakan `bun <path>/src/mcp.ts`

---

### 1. Oh My Pi (OMP)

#### A. Workspace Project Level (`.omp/mcp.json` di root project):
File ini sudah terpasang otomatis di repo ini (`.omp/mcp.json`):
```json
{
  "mcpServers": {
    "jev": {
      "command": "bun",
      "args": ["src/mcp.ts"],
      "env": {
        "JEV_BASE_URL": "https://your-api-endpoint.example.com/v1",
        "JEV_API_KEY": "your-api-key-here",
        "JEV_MODEL": "your-model-name"
      }
    }
  }
}
```
*(Atau ganti `command` ke `"D:/Programming/project/jev-judge/jev-mcp.exe"` tanpa `args` jika ingin standalone).*

#### B. Global Level (`~/.omp/mcp.json`):
Tambahkan ke `C:/Users/<Username>/.omp/mcp.json`:
```json
{
  "mcpServers": {
    "jev": {
      "command": "D:/Programming/project/jev-judge/jev-mcp.exe",
      "env": {
        "JEV_BASE_URL": "https://your-api-endpoint.example.com/v1",
        "JEV_API_KEY": "your-api-key-here",
        "JEV_MODEL": "your-model-name"
      }
    }
  }
}
```

---

### 2. Claude Code

#### A. Menambahkan via Terminal Claude Code:
```bash
# Menggunakan binary standalone (paling direkomendasikan):
claude mcp add jev -- "D:/Programming/project/jev-judge/jev-mcp.exe"

# ATAU menggunakan Bun:
claude mcp add jev -- bun "D:/Programming/project/jev-judge/src/mcp.ts"
```

#### B. Workspace Project Level (`.mcp.json` di root project):
File `.mcp.json` sudah dibuat di root workspace ini dan otomatis terbaca oleh Claude Code:
```json
{
  "mcpServers": {
    "jev": {
      "command": "bun",
      "args": ["src/mcp.ts"],
      "env": {
        "JEV_BASE_URL": "https://your-api-endpoint.example.com/v1",
        "JEV_API_KEY": "your-api-key-here",
        "JEV_MODEL": "your-model-name"
      }
    }
  }
}
```

#### C. Global Level (`~/.claude.json`):
Tambahkan ke blok `mcpServers` di `~/.claude.json`:
```json
{
  "mcpServers": {
    "jev": {
      "command": "D:/Programming/project/jev-judge/jev-mcp.exe",
      "env": {
        "JEV_BASE_URL": "https://your-api-endpoint.example.com/v1",
        "JEV_API_KEY": "your-api-key-here",
        "JEV_MODEL": "your-model-name"
      }
    }
  }
}
```

---

### 3. Cursor / Windsurf / Cline
Tambahkan ke `.cursor/mcp.json` atau `.cline/mcp.json`:
```json
{
  "mcpServers": {
    "jev": {
      "command": "D:/Programming/project/jev-judge/jev-mcp.exe",
      "env": {
        "JEV_BASE_URL": "https://your-api-endpoint.example.com/v1",
        "JEV_API_KEY": "your-api-key-here",
        "JEV_MODEL": "your-model-name"
      }
    }
  }
}
```
---

## 💻 Panduan Penggunaan CLI (`jev`)

Binary CLI `jev` siap dipanggil dari command line atau pipa Unix / PowerShell:

```bash
# 1. Quick check boolean (Exit code 0 jika true, 1 jika false):
jev "rm -rf /tmp/cache/*" "Is this safe to run?" --threshold 0.5

# 2. Review git diff langsung dari terminal:
git diff | jev review --stdin --request "Refactor auth middleware to use JWT"

# 3. Acceptance gate sebelum git commit (Anti-Fake Done):
git diff | jev gate --stdin \
  --request "Fix race condition in payment ledger" \
  --evidence test-results.log \
  --claim "All payment tests pass" \
  --claim "No uncommitted secrets"

# 4. Klasifikasi pilihan ganda:
jev -s "PostgreSQL connection pool exhausted" -c "network,database,client"

# 5. Output JSON mentah:
jev "SELECT * FROM users;" "Is this SQL?" --json
```

---

## 📦 TypeScript / Bun Programmatic SDK

Gunakan langsung di kode TypeScript/JavaScript Anda:

```typescript
import {
  judge,
  reviewDiff,
  gatePatch,
  decideChoice,
  verifyClaims,
  screenAction,
} from "jev-judge";

// 1. Review patch diff
const review = await reviewDiff({
  diff: gitDiffString,
  request: "Implement zero-downtime database migration",
});
console.log("Verdict:", review.action, "Composite Score:", review.composite);

// 2. Acceptance Gate dengan verifikasi klaim vs bukti nyata
const gate = await gatePatch({
  diff: gitDiffString,
  request: "Add session rate limiter",
  claims: ["All unit tests pass", "No breaking API changes"],
  evidence: testOutputLogString,
});

if (gate.action === "escalate") {
  throw new Error("Task rejected by Jev Gate: developer claims not backed by evidence!");
}

// 3. Keputusan Teknis Terukur (Decide)
const decision = await decideChoice({
  decision: "Choose caching store for user sessions",
  candidates: [
    { id: "redis", description: "In-memory Redis with TTL and sentinel failover" },
    { id: "local_memory", description: "Node.js process Map (resets on restart)" },
  ],
  evidence: "Sessions must survive server restarts and scale across multiple nodes.",
  priorities: "High availability and distributed access.",
  requirements: ["Survives node restarts"],
});
console.log("Recommended:", decision.recommendation.selected);
```

---

## 🧪 Verifikasi & Testing Suite

Seluruh 14 tools dan core transport telah diverifikasi dengan test suite otomatis:

```bash
bun test
```

Test suite mencakup:
- `test/coding.test.ts` (patch review, gate verification, safety screening)
- `test/research.test.ts` (decision arbitration, semantic find, reranking, passage compare)
- `test/guardrails.test.ts` (fact-checking citation check, anti prompt injection, verbatim extraction, audit)
- `test/judge.test.ts` (core client, multi-criteria normalization, concurrent batch runner)
