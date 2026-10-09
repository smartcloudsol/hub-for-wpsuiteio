"""Extract canonical archives; overlay only source PHP into a disposable test WP."""
import json
import os
import pathlib
import re
import shutil
import sys
import zipfile

repo, wp = map(pathlib.Path, sys.argv[1:])
packaged_only = os.environ.get("WPSUITE_SURFACE_USE_PACKAGED") == "1"
if not re.fullmatch(r"/tmp/wpsuite-surfaces\.[^/]+/wordpress", str(wp)):
    raise SystemExit("Only the disposable test WordPress directory is allowed")
plugins = wp / "wp-content/plugins"
family = repo / "smartcloud-agent-ready-product-family"
manifest = json.loads((family / "wpsuite-plugins/release-manifest.json").read_text())
sources = {"gatey": "gatey", "smartcloud-ai-kit": "ai-kit", "smartcloud-flow": "flow", "smartcloud-static-publisher": "static-publisher", "smartcloud-agent-composer": "smartcloud-agent-ready-product-family/agent-composer"}
for package in manifest["packages"]:
    slug = package["slug"]
    if slug not in sources:
        continue
    archive = family / "wpsuite-plugins/dist" / f"{slug}-{package['version']}.zip"
    with zipfile.ZipFile(archive) as bundle:
        bundle.extractall(plugins)
    if not packaged_only:
        if slug == "smartcloud-static-publisher":
            shutil.copy2(repo / sources[slug] / f"{slug}.php", plugins / slug / f"{slug}.php")
        for source in (repo / sources[slug] / "admin/php").glob("*.php"):
            shutil.copy2(source, plugins / slug / "admin" / source.name)
for folder, slug in (("consent", "smartcloud-consent"), ("content-relations", "smartcloud-content-relations")):
    source = repo / "wpsuite-private-plugins" / folder
    version = re.search(r"^\s*\*?\s*Version:\s*([^\s]+)", (source / f"{slug}.php").read_text(), re.M).group(1)
    with zipfile.ZipFile(source / "dist" / f"{slug}-{version}.zip") as bundle:
        bundle.extractall(plugins)
    if not packaged_only:
        shutil.copy2(source / "includes/class-admin.php", plugins / slug / "includes/class-admin.php")
if not packaged_only:
    for hub in plugins.glob("*/smartcloud-wpsuite"):
        for source in (repo / "common/wpsuite-admin/php").glob("*.php"):
            shutil.copy2(source, hub / source.name)
        shutil.copytree(repo / "common/wpsuite-admin/php/assets", hub / "assets", dirs_exist_ok=True)
if not packaged_only and not (plugins / "smartcloud-flow/admin/placement-inspection.php").is_file():
    raise SystemExit("Flow bounded placement inspection must accompany its surface source overlay")
print("Seven canonical plugins staged from release ZIPs only." if packaged_only else "Seven canonical plugins staged with test-only PHP overlays.")
