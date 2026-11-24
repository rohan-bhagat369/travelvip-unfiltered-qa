import json
from pathlib import Path

p = Path(r"d:\Travel VIP API Automation\byufuel\reports\byufuel-drive\_tmp-tc-extract.json")
d = json.loads(p.read_text(encoding="utf-8"))
print("sheets:", list(d["sheets"].keys()))
for k, v in d["sheets"].items():
    cases = v.get("cases") or []
    keys = list(cases[0].keys()) if cases else []
    print(f"\n=== {k} total={v.get('total')} counts={v.get('counts')} keys={keys}")
    for c in cases[:3]:
        print(" ", {kk: (str(vv)[:80] if vv is not None else None) for kk, vv in c.items()})
