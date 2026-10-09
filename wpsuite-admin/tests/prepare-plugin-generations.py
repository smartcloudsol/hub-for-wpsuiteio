"""Extract checksum-verified release artifacts into a disposable WordPress only."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import zipfile

wp, baseline, workspace = map(Path, sys.argv[1:4])
scenario = sys.argv[4]
if not re.fullmatch(r"/tmp/wpsuite-generations\.[^/]+/wordpress", str(wp)):
    raise SystemExit("Only the disposable runner directory is allowed")
old = json.loads((baseline / "release-manifest.json").read_text())["packages"]
canonical = workspace / "smartcloud-agent-ready-product-family/wpsuite-plugins"
new = json.loads((canonical / "release-manifest.json").read_text())["packages"]
artifacts = {p["slug"]: (baseline / Path(p["zip"]).name, p["zip_checksum"]) for p in old}
private_baseline = baseline / "private-baseline-checksums.json"
if private_baseline.exists():
    for filename, checksum in json.loads(private_baseline.read_text()).items():
        match = re.fullmatch(r"(smartcloud-(?:consent|content-relations))-\d+\.\d+\.\d+\.zip", filename)
        if not match:
            raise SystemExit("Unexpected private baseline filename")
        artifacts[match[1]] = (baseline / filename, checksum)
for p in new:
    if scenario in (p["slug"], "all-new"):
        artifacts[p["slug"]] = (canonical / p["zip"], p["zip_checksum"])
for name in ("consent", "content-relations"):
    slug = "smartcloud-" + name
    if scenario in (slug, "all-new"):
        root = workspace / "wpsuite-private-plugins" / name
        p = json.loads((root / "dist/release-manifest.json").read_text())["plugin"]
        artifacts[slug] = (root / p["zip"], p["zipChecksum"])
plugins = wp / "wp-content/plugins"
for slug in [p["slug"] for p in new] + ["smartcloud-consent", "smartcloud-content-relations"]:
    shutil.rmtree(plugins / slug, ignore_errors=True)
for slug, (archive, expected) in artifacts.items():
    if "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise SystemExit("Checksum mismatch: " + str(archive))
    with zipfile.ZipFile(archive) as z:
        for member in z.namelist():
            if not member.startswith(slug + "/") or ".." in Path(member).parts:
                raise SystemExit("Unexpected ZIP path: " + member)
        z.extractall(plugins)
(wp / "generation-plugins.json").write_text(json.dumps([s + "/" + s + ".php" for s in artifacts]))
