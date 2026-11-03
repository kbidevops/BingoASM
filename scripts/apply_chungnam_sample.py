#!/usr/bin/env python3
"""
Puts the 14 충남 교육지원청 and the example 문의처 on a server that already has data.
New databases get them from the seed; this is for existing ones (dev, prod).

  python scripts/apply_chungnam_sample.py --url http://localhost:8080 --password '<admin password>'          # preview only
  python scripts/apply_chungnam_sample.py --url http://localhost:8080 --password '<admin password>' --apply

The 10 충북 sample regions are renamed in place, so schools, accounts and vendors stay attached.
The 문의처 of 도교육청 and of the 14 regions is REPLACED by the examples; a backup is written first.
Other regions are left alone. Running it twice changes nothing more.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

SEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server", "src", "main", "resources", "seed", "contacts-chungnam.json")
RENAMES = [("청주", "천안"), ("충주", "공주"), ("제천", "보령"), ("보은", "아산"), ("옥천", "서산"), ("영동", "논산계룡"), ("진천", "금산"), ("괴산증평", "부여"), ("음성", "서천"), ("단양", "청양")]
ORDER = ["천안", "공주", "보령", "아산", "서산", "논산계룡", "금산", "부여", "서천", "청양", "홍성", "예산", "태안", "당진"]
OFFICE = "교육지원청"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", required=True)
    ap.add_argument("--backup", default=f"contacts-backup-{time.strftime('%Y%m%d-%H%M%S')}.json")
    ap.add_argument("--apply", action="store_true", help="make the changes; without this it only prints the plan")
    args = ap.parse_args()
    base = args.url.rstrip("/")

    def call(method, path, token=None, body=None):
        req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
        try:
            return json.load(urllib.request.urlopen(req)).get("data")
        except urllib.error.HTTPError as e:
            sys.exit(f"{method} {path} failed: {e.code} {e.read().decode(errors='replace')[:300]}")

    token = call("POST", "/api/auth/login", body={"loginId": args.user, "password": args.password})["accessToken"]
    regions = call("GET", "/api/as/regions/usage", token)  # also proves the server runs the newest code
    contacts = call("GET", "/api/as/contacts", token)
    names = {r["regionName"]: r["regionId"] for r in regions}
    rows = json.load(open(SEED, encoding="utf-8"))

    renames = [(a + OFFICE, b + OFFICE) for a, b in RENAMES if a + OFFICE in names]
    clashes = [new for _, new in renames if new in names]
    if clashes:
        sys.exit(f"Both an old region and its new name exist, so nothing was changed: {clashes}")
    after = {next((w for o, w in renames if o == n), n) for n in names}
    adds = [n + OFFICE for n in ORDER if n + OFFICE not in after]
    extra = [n for n in names if next((w for o, w in renames if o == n), n) not in {x + OFFICE for x in ORDER}]
    replaced = sum(len(g["items"]) for s in contacts for g in s["groups"] if s["regionName"] == "도교육청" or next((w for o, w in renames if o == s["regionName"]), s["regionName"]) in {x + OFFICE for x in ORDER})

    print(f"Server: {base}")
    print(f"Rename {len(renames)}: " + (", ".join(f"{a}→{b}" for a, b in renames) or "none"))
    print(f"Add {len(adds)}: " + (", ".join(adds) or "none"))
    print("Left alone: " + (", ".join(extra) or "none"))
    print(f"문의처: {replaced} rows replaced by {len(rows)} example rows")
    print("Schools and 담당자 per region: " + ", ".join(f"{r['regionName'].replace(OFFICE, '')} {r['schools']}/{r['users']}" for r in regions))
    if not args.apply:
        print("\nPreview only. Nothing changed. Add --apply to make these changes.")
        return

    with open(args.backup, "w", encoding="utf-8") as f:
        json.dump({"regions": regions, "contacts": contacts}, f, ensure_ascii=False, indent=1)
    print(f"Backup: {os.path.abspath(args.backup)}")

    for old, new in renames:
        call("PUT", f"/api/as/regions/{names[old]}", token, {"regionName": new})
    for n in adds:
        call("POST", "/api/as/regions", token, {"regionName": n})
    now = {r["regionName"]: r["regionId"] for r in call("GET", "/api/as/regions", token)}
    wanted = [now[n + OFFICE] for n in ORDER]
    call("PUT", "/api/as/regions/order", token, wanted + [i for i in now.values() if i not in wanted])

    call("PUT", "/api/as/contacts/sections/province", token, [r for r in rows if r["region"] is None])
    for n in ORDER:
        call("PUT", f"/api/as/contacts/sections/{now[n + OFFICE]}", token, [r for r in rows if r["region"] == n + OFFICE])

    result = call("GET", "/api/as/contacts", token)
    print("Done: " + ", ".join(f"{s['regionName'].replace(OFFICE, '')} {sum(len(g['items']) for g in s['groups'])}" for s in result))


if __name__ == "__main__":
    main()
