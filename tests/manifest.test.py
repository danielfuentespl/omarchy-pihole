#!/usr/bin/env python3
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text())

required = {"schemaVersion", "id", "name", "version", "kinds", "entryPoints"}
missing = required - manifest.keys()
assert not missing, f"missing manifest keys: {sorted(missing)}"
assert manifest["schemaVersion"] == 1
assert "bar-widget" in manifest["kinds"]
assert "service" in manifest["kinds"]
assert (root / manifest["entryPoints"]["barWidget"]).is_file()
assert (root / manifest["entryPoints"]["service"]).is_file()
assert manifest["version"] == "0.1.0"
assert manifest["id"] == "com.blogvirtualizado.omaops.pihole"
assert manifest["id"] in (root / "ServiceHost.js").read_text()
assert manifest["id"] in (root / "Panel.qml").read_text()
assert (root / "assets/pihole.svg").is_file()
assert (root / "preview.png").is_file()
assert "./preview.png" in (root / "README.md").read_text()
for field in manifest["barWidget"]["schema"]:
    default = manifest["barWidget"]["defaults"][field["key"]]
    assert default == field["defaultValue"]
    if field["type"] == "integer":
        assert isinstance(default, int) and field["min"] <= default <= field["max"]
print("Manifest tests: OK")
