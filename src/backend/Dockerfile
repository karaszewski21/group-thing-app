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

# Exports Bielik-Guard to ONNX at build time; torch and optimum live only in
# this throwaway stage, never in a runtime image.
FROM python:3.12-slim AS models

# torch is pinned: optimum-onnx 0.1 imports torch.onnx internals removed after 2.7.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch==2.7.1" \
    && pip install --no-cache-dir "optimum-onnx[onnxruntime]==0.1.0"
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
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
