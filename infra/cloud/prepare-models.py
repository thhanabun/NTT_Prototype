"""Download and verify only the registered model/demo assets during image build."""
import hashlib
import json
from pathlib import Path
import urllib.request
from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parents[2]
manifest = json.loads((root / "infra/laya/model.json").read_text())
# The launch manifest is also checked by the Laya server at load time.
downloaded = Path(snapshot_download(repo_id=manifest["repository"], revision=manifest["revision"],
                                   allow_patterns=[manifest["checkpoint"] + "/*"], cache_dir="/models/cache"))
with (downloaded / manifest["checkpoint"] / "model.safetensors").open("rb") as weights:
    if hashlib.file_digest(weights, "sha256").hexdigest() != manifest["weightsSha256"]:
        raise ValueError("Laya weight digest mismatch")
assets = json.loads((root / "infra/vision/assets.json").read_text())
target = root / "data/vision"
target.mkdir(parents=True, exist_ok=True)
for asset in [assets["model"], *assets["frames"].values()]:
    destination = target / asset["file"]
    urllib.request.urlretrieve(asset["url"], destination)
    if destination.stat().st_size > 10_000_000 or hashlib.sha256(destination.read_bytes()).hexdigest() != asset["sha256"]:
        raise ValueError("Vision asset digest mismatch")
