FROM python:3.12-slim
WORKDIR /service
COPY requirements-laya.txt .
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements-laya.txt \
    && useradd --create-home laya \
    && mkdir -p /models/cache && chown -R laya:laya /models
ENV HF_HOME=/models/cache \
    HF_HUB_DISABLE_TELEMETRY=1 \
    USE_TF=0 \
    LAYA_HOST=0.0.0.0 \
    LAYA_PORT=8000 \
    LAYA_DEVICE=cpu \
    LAYA_PRELOAD=1 \
    LAYA_MODELS=typed-decisions \
    LAYA_DEFAULT_MODEL=typed-decisions \
    LAYA_THREADS=4 \
    LAYA_REVISION=7b928d828b7b0e022f929d9bd2e44165aa270148 \
    LAYA_SHA256_DIGESTS='{"model.safetensors":"4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e"}'
USER laya
EXPOSE 8000
CMD ["python", "-m", "laya.serve"]
