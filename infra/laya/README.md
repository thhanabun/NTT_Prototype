# Same Laya service locally and on AWS

The model manifest pins checkpoint revision and weight digest. scripts/start-laya.ps1 and Dockerfile use that same artifact and the Python versions in requirements-laya.txt.

Local Windows setup (Python 3.12 recommended):

    powershell -NoProfile -File scripts/start-laya.ps1 -Install

Later starts:

    npm run model:laya

The service binds 127.0.0.1:8000 and exposes GET /health and POST /v1/systemone. The first startup downloads the open model; subsequent inference runs on CPU. Start the application from a second terminal with npm start. The app selects Laya by default and records actual provider/model/usage in each investigated case.

Container recipe, from the repository root:

    docker build -f infra/laya/Dockerfile -t basket-laya .
    docker run --rm -p 127.0.0.1:8000:8000 -v basket-laya-models:/models basket-laya

The integrated Cloud Agent container bundles this pinned Laya runtime with the YOLO service and listens on loopback inside the Lambda container; it is not exposed as a separate public endpoint. The model artifact is fetched and hash-checked during image build, then served offline at runtime. The standalone recipe above remains useful for local/container checks. The model is not committed to Git.

See docs/local-to-bedrock.md for the selected Bedrock orchestrator, compatibility and measured limits.
