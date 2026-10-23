FROM --platform=linux/arm64 node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM --platform=linux/arm64 python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 libgomp1 libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY requirements-laya.txt requirements-vision.txt ./
RUN python -m venv /opt/laya && /opt/laya/bin/pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
    && /opt/laya/bin/pip install --no-cache-dir -r requirements-laya.txt \
    && python -m venv /opt/vision && /opt/vision/bin/pip install --no-cache-dir torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cpu \
    && /opt/vision/bin/pip install --no-cache-dir -r requirements-vision.txt
COPY infra/cloud/prepare-models.py ./infra/cloud/prepare-models.py
COPY infra/laya/model.json ./infra/laya/model.json
COPY infra/vision/assets.json ./infra/vision/assets.json
ENV HF_HOME=/models/cache HF_HUB_DISABLE_TELEMETRY=1 USE_TF=0 \
    LAYA_DEVICE=cpu LAYA_PRELOAD=1 LAYA_MODELS=typed-decisions LAYA_DEFAULT_MODEL=typed-decisions LAYA_THREADS=2 \
    LAYA_REVISION=7b928d828b7b0e022f929d9bd2e44165aa270148 \
    LAYA_SHA256_DIGESTS='{"model.safetensors":"4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e"}'
RUN /opt/laya/bin/python infra/cloud/prepare-models.py \
    && useradd --create-home agent && chown -R agent:agent /models /app/data
ENV HF_HUB_CACHE=/models/cache HF_HUB_OFFLINE=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts/vision-service.py ./scripts/vision-service.py
COPY infra/cloud/agent-entrypoint.mjs ./infra/cloud/agent-entrypoint.mjs
USER agent
EXPOSE 8080
CMD ["node", "infra/cloud/agent-entrypoint.mjs"]
