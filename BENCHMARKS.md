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
| Runtime | LM Studio with ROCm (`llama.cpp-win-x86_64-amd-rocm-avx2@2.8.0`) |

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

### ROCm Runtime Results (AMD Radeon RX 9070 XT Elite, 16 GB VRAM)

All models loaded with `--gpu max`. Median of 3 runs. `max_tokens=512`.

| Model | Params | Size | classify | extract | reason | code | Notes |
|-------|--------|------|----------|---------|--------|------|-------|
| Phi 4 Mini Reasoning | 3B | 2.5 GB | 3.9s | 5.1s | 8.6s | 8.5s | Solid all-rounder, great for simple tasks |
| Qwen 3.5 9B | 9B | 6.6 GB | 4.9s | 11.2s | 6.6s | 11.4s | Strong reasoning, slower on long output |
| Deepseek R1 0528 Qwen3 | 8B | 5.0 GB | 2.5s | 7.7s | 13.3s | 7.3s | Reasoning model, CoT adds time on reason |
| Phi 4 Reasoning Plus | 15B | 9.1 GB | 0.4s | 17.4s | 4.5s | 17.3s | Fastest classify/reason, slow on long output |
| GPT-OSS 20B | 20B | 12.1 GB | **0.6s** | **0.7s** | **0.7s** | **3.1s** | **Fastest overall** despite being the largest |

### CPU Baseline (AMD Threadripper 3960X, no GPU)

| Model | Params | classify | extract | Notes |
|-------|--------|----------|---------|-------|
| Deepseek R1 0528 Qwen3 | 8B | ~21s | ~25s | CPU-only, all 48 threads |

### GPU Speedup (ROCm vs CPU, Deepseek R1 8B)

| Metric | CPU | GPU (ROCm) | Speedup |
|--------|-----|-----------|---------|
| classify | ~21s | 2.5s | **8.4x** |
| extract | ~25s | 7.7s | **3.2x** |

### Highlights

- **GPT-OSS 20B** is the fastest model overall at 0.6-3.1s despite being 12 GB — the `gpt-oss` architecture is highly optimized for GPU
- **Phi 4 Reasoning Plus 15B** is extremely fast on short answers (0.4s classify) but slower on longer outputs like code (17s)
- **Deepseek R1 8B** has longer reason times (13s) due to chain-of-thought thinking tokens before the final answer
- For `prompt_split` routing: use **GPT-OSS 20B** or **Phi 4 Mini** for fast classify/extract tasks; use **Qwen 3.5-9B** or **Phi 4 Reasoning Plus** for quality reasoning

> Full Vulkan vs ROCm comparison: run `bash benchmarks/run-benchmarks.sh vulkan` after switching runtime in LM Studio.

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

### Heuristic Strategy Results (ThreadripperStation)

No LLM required - pure keyword scoring, runs in under 1ms per prompt.

| Category | Cases | Pass Rate | Notes |
|----------|-------|-----------|-------|
| single-domain | 3 | 2/3 (67%) | "classify" keyword tied with "review" in "reviews" - claude_run wins by insertion order |
| multi-domain-sequential | 1 | 1/1 (100%) | |
| multi-domain-parallel | 1 | 1/1 (100%) | |
| multi-domain-mixed | 1 | 1/1 (100%) | |
| multi-domain-pipeline | 1 | 0/1 (0%) | Splits into 3/4 tasks; wrong first agent (memory_write vs memory_search) |
| full-orchestration | 1 | 0/1 (0%) | Comma-separated 5-way prompt not split (no "then"/"also" markers) |
| cost-optimization | 1 | 1/1 (100%) | |
| home-automation | 1 | 0/1 (0%) | Conditional "if CO2 > 1000ppm..." collapses to 2 tasks instead of 4 |
| **Total** | **10** | **6/10 (60%)** | **<1ms avg latency** |

Known heuristic limitations:
- Keyword scoring uses substring match ("reviews" matches "review" in claude_run keywords)
- Does not split on comma-only separators without explicit "then"/"also" connectors
- Cannot distinguish `openclaw_memory_search` from `openclaw_memory_write` (same rule group)
- Conditional logic ("if X then Y") collapses to fewer tasks

The `auto` strategy (Gemini or local LLM) handles all these cases correctly.

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

### Orchestration Results (heuristic strategy, ThreadripperStation)

| Scenario | Expected Tasks | Got | Latency | Status |
|----------|---------------|-----|---------|--------|
| Single agent routing | 1 | 1 | <1ms | PASS |
| Sequential 2-agent plan | 2 | 2 | <1ms | PASS |
| Parallel 2-agent plan | 2 | 2 | <1ms | PASS |
| 4-agent memory pipeline | 4 | 3 | <1ms | PARTIAL |

Heuristic gets 3/4 correct instantly. The `auto` strategy (Gemini/local LLM) handles the 4-agent pipeline correctly.

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
microsoft/phi-4-mini-reasoning        3B   - fast, great for simple tasks
nvidia/nemotron-3-nano-4b             4B   - NVIDIA Nemotron (arch: nemotron_h, needs llama.cpp update)
qwen/qwen3.5-9b                       9B   - strong multilingual reasoning
deepseek/deepseek-r1-0528-qwen3-8b    8B   - DeepSeek reasoning distilled
mistralai/ministral-3-14b-reasoning   14B  - Mistral reasoning (arch: mistral3, needs llama.cpp update)
microsoft/phi-4-reasoning-plus        15B  - quality reasoning
openai/gpt-oss-20b                    20B  - OpenAI open-source, fastest on GPU
```

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
| AMD RX 9070 XT Elite (16 GB) | Vulkan | Wanted |
| NVIDIA RTX 4090 | CUDA | Wanted |
| NVIDIA RTX 3080 | CUDA | Wanted |
| Apple M3 Max | Metal | Wanted |
| Apple M4 Pro | Metal | Wanted |
| Intel Arc A770 | Vulkan | Wanted |
| CPU-only (AMD Threadripper 3960X, 48 threads) | llama.cpp | Partial (Deepseek R1 8B only) |
| Raspberry Pi 5 | CPU | Wanted |

## Roadmap

- [ ] Add `tokens_per_second` column to all results
- [ ] Vulkan vs ROCm comparison table
- [ ] Automated CI benchmark job (self-hosted runner)
- [ ] prompt_split accuracy results for gemini and local strategies
- [ ] Context length scaling benchmarks (8k / 32k / 128k)
