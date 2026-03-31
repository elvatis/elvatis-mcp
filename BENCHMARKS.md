# elvatis-mcp Benchmark Results

Performance data for local LLM inference via elvatis-mcp on consumer and workstation hardware.

## Hardware Reference

### Workstation (ThreadripperStation)
| Component | Spec |
|-----------|------|
| CPU | AMD Threadripper 3960X (24 cores / 48 threads) |
| RAM | 128 GB DDR4 |
| GPU | AMD Radeon RX 9070 XT Elite (16 GB GDDR6) |
| OS | Windows 11 Pro |
| Runtime | LM Studio with ROCm and Vulkan (`llama.cpp 2.8.0`) |

## Local LLM Inference Benchmarks

All tests use [LM Studio](https://lmstudio.ai/) with `--gpu max` offload.
Each test runs 3 times; the **median** is reported.
`max_tokens` is capped at 512 to prevent runaway generation from reasoning models.

### Test Suite

| Test | Prompt | Measures |
|------|--------|---------|
| **classify** | "Classify this sentiment: The new update broke everything..." | Simple 1-word classification |
| **extract** | "Extract name, age, city as JSON: John Smith is 34..." | Structured JSON extraction |
| **reason** | "A farmer has 17 sheep. All but 9 die. How many are left?" | Short arithmetic reasoning |
| **code** | "Write a Python function to validate an IPv4 address" | Code generation |

### ROCm vs Vulkan Comparison (AMD Radeon RX 9070 XT Elite, 16 GB VRAM)

All models loaded with `--gpu max`, one at a time. Median of 3 runs. `max_tokens=512`.

#### Latency (median ms)

| Model | Params | Size | Runtime | classify | extract | reason | code |
|-------|--------|------|---------|----------|---------|--------|------|
| Phi 4 Mini Reasoning | 3B | 2.5 GB | ROCm | 4459ms | 5541ms | 9164ms | 9173ms |
| | | | Vulkan | **2607ms** | **1857ms** | **4709ms** | **4790ms** |
| Qwen 3.5 9B | 9B | 6.6 GB | ROCm | **3419ms** | 7615ms | **4548ms** | 7718ms |
| | | | Vulkan | 6235ms | **3977ms** | 8359ms | **7192ms** |
| Deepseek R1 0528 Qwen3 | 8B | 5.0 GB | ROCm | 2550ms | 8275ms | 13736ms | 7928ms |
| | | | Vulkan | **2954ms** | **6529ms** | **7225ms** | **7359ms** |
| Phi 4 Reasoning Plus | 15B | 9.1 GB | ROCm | 378ms | 17955ms | 4511ms | 17945ms |
| | | | Vulkan | **375ms** | **9662ms** | **3545ms** | **9943ms** |
| GPT-OSS 20B | 20B | 12.1 GB | ROCm | 626ms | 703ms | 674ms | 3233ms |
| | | | Vulkan | **593ms** | **641ms** | **640ms** | **1860ms** |

#### Throughput (tok/s)

| Model | Params | ROCm avg tok/s | Vulkan avg tok/s | Winner |
|-------|--------|---------------|-----------------|--------|
| Phi 4 Mini Reasoning | 3B | 48 | **106** | **Vulkan 2.2x** |
| Qwen 3.5 9B | 9B | **65** | 48 | ROCm 1.4x |
| Deepseek R1 0528 Qwen3 | 8B | 43 | **70** | **Vulkan 1.6x** |
| Phi 4 Reasoning Plus | 15B | 25 | **40** | **Vulkan 1.6x** |
| GPT-OSS 20B | 20B | 55 | **63** | **Vulkan 1.1x** |

### CPU Baseline (AMD Threadripper 3960X, no GPU)

| Model | Params | classify | extract | Notes |
|-------|--------|----------|---------|-------|
| Deepseek R1 0528 Qwen3 | 8B | ~21s | ~25s | CPU-only, all 48 threads |

### GPU Speedup (Vulkan vs CPU, Deepseek R1 8B)

| Metric | CPU | GPU (Vulkan) | Speedup |
|--------|-----|-------------|---------|
| classify | ~21s | 2.9s | **7.2x** |
| extract | ~25s | 6.5s | **3.8x** |

### Highlights

- **Vulkan wins 4 of 5 models**, often by significant margins. Phi 4 Mini sees a 2.2x throughput increase on Vulkan
- **ROCm wins only on Qwen 3.5 9B** (the `qwen35` architecture may be better optimized for ROCm)
- **GPT-OSS 20B** remains the fastest model overall at 0.6-1.9s despite being 12 GB
- **Phi 4 Mini on Vulkan** hits **106 tok/s**, the highest throughput measured
- **Phi 4 Reasoning Plus** benefits hugely from Vulkan on long outputs: extract drops from 18s to 10s
- For `prompt_split` routing: use **GPT-OSS 20B** for fast classify/extract; use **Phi 4 Mini (Vulkan)** for best throughput per watt
- **Recommendation:** Use Vulkan as the default runtime on AMD RX 9070 XT unless running Qwen models

> Switch runtimes: `lms runtime select llama.cpp-win-x86_64-vulkan-avx2@2.8.0`

## prompt_split Accuracy Benchmark

Tests the `prompt_split` tool against 10 reference prompts covering single-domain to full 5-way orchestration.

### Running the test suite

No server required for the heuristic strategy:

```bash
# Clone and install
git clone https://github.com/elvatis/elvatis-mcp.git
cd elvatis-mcp
npm install

# Run heuristic strategy (no LLM needed, instant)
npx tsx benchmarks/test-prompt-split.ts

# Run with local LLM (requires LM Studio or Ollama on port 1234)
npx tsx benchmarks/test-prompt-split.ts --strategy local

# Run with Gemini CLI (requires `gemini` CLI installed and authenticated)
npx tsx benchmarks/test-prompt-split.ts --strategy gemini

# Verbose output + save results to JSON
npx tsx benchmarks/test-prompt-split.ts --verbose --save
```

### Heuristic Strategy Results (ThreadripperStation, v0.9.0)

No LLM required. Uses word boundary matching, comma-clause splitting, and per-tool routing rules. Runs in under 1ms per prompt.

| Category | Cases | Pass Rate | Notes |
|----------|-------|-----------|-------|
| single-domain | 3 | 3/3 (100%) | |
| multi-domain-sequential | 1 | 1/1 (100%) | |
| multi-domain-parallel | 1 | 1/1 (100%) | |
| multi-domain-mixed | 1 | 1/1 (100%) | |
| multi-domain-pipeline | 1 | 1/1 (100%) | |
| full-orchestration | 1 | 1/1 (100%) | 5-way comma-separated split works |
| cost-optimization | 1 | 1/1 (100%) | |
| home-automation | 1 | 1/1 (100%) | Conditional "if CO2..." splits correctly |
| **Total** | **10** | **10/10 (100%)** | **<1ms avg latency** |

Improvements in v0.8.0+:
- Word boundary regex matching (no more partial matches like "reviews" matching "review")
- Comma-clause splitting for multi-agent prompts (splits when clauses route to different agents)
- Individual routing rules per tool (home_light, home_climate, etc. instead of combined entries)
- Added `openclaw_notify` routing for WhatsApp/Telegram notifications

> Run `npx tsx benchmarks/test-prompt-split.ts --save` and submit your results as a PR.

### Test Prompts

See [`benchmarks/prompt-split-examples.json`](benchmarks/prompt-split-examples.json) for the full prompt corpus. Examples:

| ID | Prompt (abbreviated) | Expected Tasks | Expected Agents |
|----|---------------------|---------------|-----------------|
| single-coding | "Fix the authentication bug..." | 1 | codex_run |
| single-analysis | "Summarize this 50-page research paper..." | 1 | gemini_run |
| single-local | "Classify these 20 customer reviews..." | 1 | local_llm_run |
| dual-code-review | "Refactor auth module, then ask Gemini to review..." | 2 | codex_run, gemini_run |
| dual-parallel | "Check portfolio AND turn on living room lights" | 2 | openclaw_run, home_light |
| quad-pipeline | "Search memory, summarize with Gemini, reformat locally, save..." | 4 | openclaw_memory_search, gemini_run, local_llm_run, openclaw_memory_write |
| five-way-orchestration | "Check server, debug test, review fix, format report, notify..." | 5 | openclaw_run, codex_run, claude_run, local_llm_run, openclaw_notify |

## Sub-Agent + Orchestration Benchmark

Tests all sub-agents on the same 5 tasks, then runs 4 orchestration scenarios through `prompt_split`.

### Running the sub-agent benchmark

```bash
# All agents (requires all CLIs installed and authenticated)
npx tsx benchmarks/test-subagents.ts --verbose --save

# Select specific agents
npx tsx benchmarks/test-subagents.ts --agents local,gemini
npx tsx benchmarks/test-subagents.ts --agents claude

# Orchestration only (no CLIs needed)
npx tsx benchmarks/test-subagents.ts --agents none
```

### Tasks

| ID | Name | Prompt (abbreviated) | Measures |
|----|------|----------------------|---------|
| classify | Sentiment classification | "Classify this sentiment: The new update..." | 1-word output accuracy |
| extract | JSON extraction | "Extract name, age, city as JSON..." | Structured output |
| reason | Arithmetic reasoning | "17 sheep, all but 9 die, how many left?" | Logical accuracy |
| code | Python code generation | "Write is_valid_ipv4 function..." | Code quality |
| analysis | Technical explanation | "What is MCP in 2 sentences?" | Fluency |

### Results (ThreadripperStation)

All agents tested on the same 5 tasks. Local LLM uses GPT-OSS 20B with ROCm GPU offload.

| Agent | Backend | classify | extract | reason | code | analysis | Avg | Success |
|-------|---------|----------|---------|--------|------|----------|-----|---------|
| **local_llm_run** | GPT-OSS 20B (ROCm) | **0.9s** | **0.5s** | **1.0s** | **2.9s** | - | **1.3s** | 100% |
| codex_run | OpenAI Codex CLI | 2.1s | 3.6s | 2.3s | 8.6s | 3.8s | 4.1s | 100% |
| claude_run | Claude Sonnet 4.6 | 6.3s | 5.5s | 4.7s | 7.9s | 6.8s | 6.3s | 100% |
| gemini_run | Gemini 2.5 Flash | 37.4s | 44.8s | 19.3s | 41.9s | 26.8s | 34.0s | 100% |

**Key takeaway:** The local LLM (free, private, on-device) is **3x faster than Codex**, **5x faster than Claude**, and **26x faster than Gemini** for simple tasks like classify and extract. Cloud agents add value for complex reasoning, long-context analysis, and code generation.

> Community contributors: run `npx tsx benchmarks/test-subagents.ts --save` and submit results as a PR.

### Orchestration Results (heuristic strategy, ThreadripperStation, v0.9.0)

| Scenario | Expected Tasks | Got | Latency | Status |
|----------|---------------|-----|---------|--------|
| Single agent routing | 1 | 1 | <1ms | PASS |
| Sequential 2-agent plan | 2 | 2 | <1ms | PASS |
| Parallel 2-agent plan | 2 | 2 | <1ms | PASS |
| 4-agent memory pipeline | 4 | 4 | <1ms | PASS |

All 4 orchestration scenarios pass with the improved heuristic.

## How to Reproduce

### Prerequisites
- LM Studio installed with `lms` CLI on PATH
- Models downloaded (run `lms ls` to check)
- LM Studio local server enabled on port 1234

### Run the full benchmark suite

```bash
# ROCm (AMD GPU)
bash benchmarks/run-benchmarks.sh rocm

# Vulkan (AMD or NVIDIA via Vulkan backend)
lms runtime select llama.cpp-win-x86_64-vulkan-avx2
bash benchmarks/run-benchmarks.sh vulkan

# CPU only
bash benchmarks/run-benchmarks.sh cpu
```

Results are saved to `benchmarks/results-YYYYMMDD-HHMMSS.json`.

### Models tested

The benchmark script tests these models by default (skips any not downloaded):

```
qwen/qwen3.5-9b                       9B   - strong multilingual reasoning
deepseek/deepseek-r1-0528-qwen3-8b    8B   - DeepSeek reasoning distilled
microsoft/phi-4-reasoning-plus        15B  - quality reasoning
openai/gpt-oss-20b                    20B  - OpenAI open-source, fastest on GPU
microsoft/phi-4-mini-reasoning        3B   - fast, great for simple tasks (loaded last)
```

Models excluded from benchmarks:
- `nvidia/nemotron-3-nano-4b` (nemotron_h architecture unsupported by llama.cpp 2.8)
- `mistralai/ministral-3-14b-reasoning` (mistral3 architecture unsupported, 9 GB RAM, slow to load)

## Community Contributions

We welcome benchmark results from different hardware configurations. To contribute:

1. Fork the repo and run `bash benchmarks/run-benchmarks.sh <runtime>`
2. Also run `npx tsx benchmarks/test-prompt-split.ts --save`
3. Open a PR adding your results JSON to `benchmarks/results/` with this naming convention:

```
benchmarks/results/
  YYYYMMDD-gpu-model-runtime.json       # e.g. 20260331-rx9070xt-rocm.json
  YYYYMMDD-prompt-split-strategy.json   # e.g. 20260331-prompt-split-heuristic.json
```

4. Include your hardware specs in the PR description.

### Interesting hardware to benchmark

| Platform | Runtime | Status |
|----------|---------|--------|
| AMD RX 9070 XT Elite (16 GB) | ROCm llama.cpp 2.8 | **Reference (this repo)** |
| AMD RX 9070 XT Elite (16 GB) | Vulkan | **Done (this repo)** |
| NVIDIA RTX 4090 | CUDA | Wanted |
| NVIDIA RTX 3080 | CUDA | Wanted |
| Apple M3 Max | Metal | Wanted |
| Apple M4 Pro | Metal | Wanted |
| Intel Arc A770 | Vulkan | Wanted |
| CPU-only (AMD Threadripper 3960X, 48 threads) | llama.cpp | Partial (Deepseek R1 8B only) |
| Raspberry Pi 5 | CPU | Wanted |

## Roadmap

- [x] Add `tokens_per_second` column to all results
- [x] Vulkan vs ROCm comparison table
- [x] prompt_split heuristic accuracy 100% (v0.8.0)
- [ ] Automated CI benchmark job (self-hosted runner)
- [ ] prompt_split accuracy results for gemini and local strategies
- [ ] Context length scaling benchmarks (8k / 32k / 128k)
- [ ] NVIDIA CUDA comparison (community contribution)
