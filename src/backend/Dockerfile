# syntax=docker/dockerfile:1

# Production API image (default target, needs the gated Bielik-Guard model):
#   docker build --secret id=hf_token,env=HF_TOKEN src/backend
# Model-free target (no secret needed): `--target runtime-dev`.

FROM python:3.12-slim AS builder

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .
RUN uv sync --frozen --no-dev

# Exports Bielik-Guard and the embedding model to ONNX at build time; torch and optimum live only in
# this throwaway stage, never in a runtime image.
FROM python:3.12-slim AS models

# torch is pinned: optimum-onnx 0.1 imports torch.onnx internals removed after 2.7.
# The rest is pinned to the resolution that measured the int8 parity of 0.9904:
# the margin over the 0.99 gate is thin, so a different onnxruntime (the
# quantizer) or export stack can fail the build or change the weights under the
# same `EMBEDDING_MODEL_ID`. Bump them only together with a new parity run.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch==2.7.1" \
    && pip install --no-cache-dir "optimum-onnx[onnxruntime]==0.1.0" "optimum==2.1.0" \
        "onnxruntime==1.32.0" "onnx==1.23.2" "transformers==4.57.6" "tokenizers==0.22.2" \
        "numpy==2.5.5" "huggingface_hub==0.36.2"
# The export does not always copy the tokenizer, so it is fetched explicitly;
# `model_id.txt` records the Hub id for the audit trail.
RUN --mount=type=secret,id=hf_token,required=true \
    export HF_TOKEN="$(cat /run/secrets/hf_token)" \
    && optimum-cli export onnx --model speakleash/Bielik-Guard-0.1B-v1.1 \
        --task text-classification /models/text \
    && python -c "from huggingface_hub import hf_hub_download as get; \
get('speakleash/Bielik-Guard-0.1B-v1.1', 'tokenizer.json', local_dir='/models/text')" \
    && rm -rf /models/text/.cache \
    && echo speakleash/Bielik-Guard-0.1B-v1.1 > /models/text/model_id.txt

# The embedding model is public, so this RUN has no secret mount. The pinned
# revision and `model_id.txt` must equal `EMBEDDING_MODEL_ID` (matcher drift
# test). The int8 quantization must keep cosine >= 0.99 against fp32 on the
# parity names, or the build fails; the script is removed after the check.
# `model.sha256` records the hash of the quantized weights and is printed in
# the build log, so two builds of the same id can be compared.
ARG EMBED_MODEL=sdadas/mmlw-roberta-base
ARG EMBED_REVISION=bdeb29a43c3d58af1e6ed9d1836703a1ddfbe1d7
COPY scripts/check_embed_parity.py /tmp/check_embed_parity.py
# `optimum-cli export onnx` has no revision option, so the pinned snapshot is
# downloaded first and exported from the local directory. Only MatMul weights
# are quantized: with the embedding table quantized too the parity was 0.9895,
# with `per_channel=True` 0.63 (measured 2026-11-18; MatMul-only gave 0.9904).
RUN python -c "from huggingface_hub import snapshot_download as get; \
get('${EMBED_MODEL}', revision='${EMBED_REVISION}', local_dir='/models/embed-src')" \
    && optimum-cli export onnx --model /models/embed-src \
        --task feature-extraction /models/embed-fp32 \
    && mkdir -p /models/embed \
    && cp /models/embed-src/tokenizer.json /models/embed/tokenizer.json \
    && python -c "from onnxruntime.quantization import QuantType, quantize_dynamic; \
quantize_dynamic('/models/embed-fp32/model.onnx', '/models/embed/model.onnx', \
weight_type=QuantType.QInt8, op_types_to_quantize=['MatMul'])" \
    && python /tmp/check_embed_parity.py /models/embed-fp32 /models/embed \
    && sha256sum /models/embed/model.onnx > /models/embed/model.sha256 \
    && cat /models/embed/model.sha256 \
    && rm -rf /tmp/check_embed_parity.py /models/embed-src /models/embed-fp32 /root/.cache/huggingface \
    && echo "${EMBED_MODEL}@${EMBED_REVISION}+int8" > /models/embed/model_id.txt

FROM builder AS ml-builder
RUN uv sync --frozen --no-dev --group ml

# --- API without the text model (dev compose) -----------------------------
FROM python:3.12-slim AS runtime-dev

WORKDIR /app

COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]

# --- API (default target; must stay the last stage) ------------------------
FROM python:3.12-slim AS runtime

WORKDIR /app

COPY --from=ml-builder /app /app
COPY --from=models /models/text /models/text
COPY --from=models /models/embed /models/embed
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
