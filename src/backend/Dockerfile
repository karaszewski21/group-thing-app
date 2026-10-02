# syntax=docker/dockerfile:1

FROM python:3.12-slim AS builder

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .
RUN uv sync --frozen --no-dev

# --- Moderation worker (`docker build --target worker`) --------------------
# Exports the two small moderation models to ONNX at build time; torch and
# optimum live only in this throwaway stage, never in a runtime image.
# Bielik-Guard is gated on Hugging Face: pass a token with
# `--secret id=hf_token,env=HF_TOKEN`.
FROM python:3.12-slim AS models

# torch is pinned: optimum-onnx 0.1 imports torch.onnx internals removed after 2.7.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch==2.7.1" \
    && pip install --no-cache-dir "optimum-onnx[onnxruntime]==0.1.0"
# The export does not always copy the tokenizer / image preprocessor config, so
# they are fetched explicitly; `model_id.txt` records the Hub id for the audit trail.
RUN --mount=type=secret,id=hf_token,required=true \
    export HF_TOKEN="$(cat /run/secrets/hf_token)" \
    && optimum-cli export onnx --model speakleash/Bielik-Guard-0.1B-v1.1 \
        --task text-classification /models/text \
    && optimum-cli export onnx --model Falconsai/nsfw_image_detection \
        --task image-classification /models/image \
    && python -c "from huggingface_hub import hf_hub_download as get; \
get('speakleash/Bielik-Guard-0.1B-v1.1', 'tokenizer.json', local_dir='/models/text'); \
get('Falconsai/nsfw_image_detection', 'preprocessor_config.json', local_dir='/models/image')" \
    && rm -rf /models/text/.cache /models/image/.cache \
    && echo speakleash/Bielik-Guard-0.1B-v1.1 > /models/text/model_id.txt \
    && echo Falconsai/nsfw_image_detection > /models/image/model_id.txt

FROM builder AS worker-builder
RUN uv sync --frozen --no-dev --group ml

FROM python:3.12-slim AS worker

WORKDIR /app

COPY --from=worker-builder /app /app
COPY --from=models /models /models
ENV PATH="/app/.venv/bin:$PATH" MODERATION_MODELS_DIR=/models

CMD ["python", "-m", "app.moderation.worker"]

# --- API (default target) --------------------------------------------------
FROM python:3.12-slim AS runtime

WORKDIR /app

COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
