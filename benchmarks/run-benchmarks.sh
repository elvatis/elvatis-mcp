#!/bin/bash
# elvatis-mcp Local LLM Benchmark Suite
# Tests all models on the current runtime with GPU offload
#
# Usage: bash benchmarks/run-benchmarks.sh [runtime]
# Example: bash benchmarks/run-benchmarks.sh rocm
#          bash benchmarks/run-benchmarks.sh vulkan
#          bash benchmarks/run-benchmarks.sh cpu
#
# Prerequisites:
#   - LM Studio installed with lms CLI on PATH
#   - Models downloaded in LM Studio
#   - LM Studio local server enabled (port 1234)

set -e

RUNTIME="${1:-current}"
ENDPOINT="${LLM_ENDPOINT:-http://localhost:1234/v1}"
RESULTS_FILE="benchmarks/results-$(date +%Y%m%d-%H%M%S).json"

# Models to test (order: smallest to largest)
# Add or remove models here to match what you have downloaded
MODELS=(
  "microsoft/phi-4-mini-reasoning"
  "nvidia/nemotron-3-nano-4b"
  "qwen/qwen3.5-9b"
  "deepseek/deepseek-r1-0528-qwen3-8b"
  "mistralai/ministral-3-14b-reasoning"
  "microsoft/phi-4-reasoning-plus"
  "openai/gpt-oss-20b"
)

# Max tokens to prevent runaway generation from reasoning models
MAX_TOKENS=512

build_prompt() {
  local model="$1"
  local messages="$2"
  echo "{\"model\":\"$model\",\"messages\":$messages,\"temperature\":0,\"max_tokens\":$MAX_TOKENS}"
}

echo "=============================================="
echo "  elvatis-mcp Local LLM Benchmark Suite"
echo "=============================================="
echo ""
echo "  Runtime: $RUNTIME"
echo "  Endpoint: $ENDPOINT"
echo "  Date: $(date -Iseconds)"
echo ""

# Show active runtime
echo "  LM Studio Runtime:"
lms runtime ls 2>&1 | grep -E 'active|✓|\*' | head -3
echo ""
echo "=============================================="

# Initialize results JSON
echo "[" > "$RESULTS_FILE"
FIRST=true

for MODEL in "${MODELS[@]}"; do
  echo ""
  echo ">>> Unloading all models..."
  lms unload -a 2>/dev/null || true
  sleep 2

  # Use --identifier to pin the API name and avoid duplicate :2 instances
  IDENTIFIER="${MODEL//\//-}"
  echo ">>> Loading $MODEL with --gpu max (identifier: $IDENTIFIER) ..."
  if ! lms load "$MODEL" --gpu max --identifier "$IDENTIFIER" -y 2>&1; then
    echo "    SKIP: Failed to load $MODEL (not downloaded?)"
    continue
  fi
  sleep 3

  LOADED_ID="$IDENTIFIER"
  echo "    Loaded as: $LOADED_ID"
  echo "    Running benchmarks..."

  CLASSIFY_MSGS='[{"role":"system","content":"Respond with only one word: positive, negative, or neutral."},{"role":"user","content":"Classify this sentiment: The new update broke everything and I lost my data"}]'
  EXTRACT_MSGS='[{"role":"system","content":"Respond with only valid JSON, no explanation."},{"role":"user","content":"Extract name, age, and city as JSON: John Smith is 34 years old and lives in Berlin"}]'
  REASON_MSGS='[{"role":"user","content":"A farmer has 17 sheep. All but 9 die. How many sheep are left? Give only the final number."}]'
  CODE_MSGS='[{"role":"system","content":"Respond with only the code, no explanation."},{"role":"user","content":"Write a Python function that checks if a string is a valid IPv4 address."}]'

  for TEST_NAME in "classify" "extract" "reason" "code"; do
    case $TEST_NAME in
      classify) MESSAGES="$CLASSIFY_MSGS" ;;
      extract)  MESSAGES="$EXTRACT_MSGS" ;;
      reason)   MESSAGES="$REASON_MSGS" ;;
      code)     MESSAGES="$CODE_MSGS" ;;
    esac

    PROMPT=$(build_prompt "$LOADED_ID" "$MESSAGES")

    # Run 3 times and take the median
    TIMES=()
    TOKENS=()
    COMPLETION_TOKENS_ARR=()
    for i in 1 2 3; do
      START=$(date +%s%3N)
      RESPONSE=$(curl -s "$ENDPOINT/chat/completions" \
        -H "Content-Type: application/json" \
        -d "$PROMPT" 2>/dev/null)
      END=$(date +%s%3N)

      MS=$((END - START))
      TOTAL_TOK=$(echo "$RESPONSE" | grep -o '"total_tokens":[0-9]*' | head -1 | cut -d: -f2)
      COMP_TOK=$(echo "$RESPONSE" | grep -o '"completion_tokens":[0-9]*' | head -1 | cut -d: -f2)

      TIMES+=($MS)
      TOKENS+=("${TOTAL_TOK:-0}")
      COMPLETION_TOKENS_ARR+=("${COMP_TOK:-0}")
    done

    # Sort and take median (index 1 of 0-indexed sorted array)
    IFS=$'\n' SORTED=($(sort -n <<<"${TIMES[*]}")); unset IFS
    MEDIAN=${SORTED[1]}
    MEDIAN_TOKENS=${TOKENS[1]}
    MEDIAN_COMP=${COMPLETION_TOKENS_ARR[1]}

    # Compute tokens/sec
    if [ "$MEDIAN" -gt 0 ] && [ "${MEDIAN_COMP:-0}" -gt 0 ]; then
      TPS=$(echo "scale=1; $MEDIAN_COMP * 1000 / $MEDIAN" | bc 2>/dev/null || echo "?")
    else
      TPS="?"
    fi

    echo "    $TEST_NAME: ${MEDIAN}ms | ${MEDIAN_COMP} completion tokens | ${TPS} tok/s"

    # Append to results JSON
    if [ "$FIRST" = true ]; then
      FIRST=false
    else
      printf "," >> "$RESULTS_FILE"
    fi
    cat >> "$RESULTS_FILE" << JSONEOF

  {
    "model": "$MODEL",
    "loaded_id": "$LOADED_ID",
    "runtime": "$RUNTIME",
    "gpu": "max",
    "test": "$TEST_NAME",
    "median_ms": $MEDIAN,
    "total_tokens": ${MEDIAN_TOKENS:-0},
    "completion_tokens": ${MEDIAN_COMP:-0},
    "tokens_per_sec": "$TPS",
    "runs_ms": [${TIMES[0]}, ${TIMES[1]}, ${TIMES[2]}]
  }
JSONEOF
  done
done

echo "" >> "$RESULTS_FILE"
echo "]" >> "$RESULTS_FILE"

echo ""
echo "=============================================="
echo "  Results saved to: $RESULTS_FILE"
echo "=============================================="

lms unload -a 2>/dev/null || true
