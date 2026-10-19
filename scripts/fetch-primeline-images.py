"""Finds Prime-Line Parts (primelineparts.com) images for snapshot 60 products.

Searches the public site by part number (SKU 'IPH-M6258' -> 'M 6258') and writes
{snapshot image stem: image url} to the output JSON, for repair-snapshot-images.mjs.

  python3 -I scripts/fetch-primeline-images.py [local.db] [out.json]
"""
import json, os, re, sqlite3, sys, time, urllib.parse, urllib.request

DB = sys.argv[1] if len(sys.argv) > 1 else "local.db"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/primeline-image-map.json"
SNAPSHOT = 60
IMG = re.compile(r'https://cdn11\.bigcommerce\.com/s-4ytrikgs1c/images/stencil/\d+w/products/\d+/\d+/([^"\'\s?]+)')

def stem_bc(image_file):  # same rule as repair-snapshot-images.mjs exactStem
    b = os.path.splitext(os.path.basename(image_file))[0]
    return re.sub(r"__\d+$", "", b).lower()

def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
        except Exception:
            time.sleep(2 * (attempt + 1))
    return ""

payload = json.loads(sqlite3.connect(DB).execute(
    "select payload_json from catalog_snapshots where id=?", (SNAPSHOT,)).fetchone()[0])
result = json.load(open(OUT)) if os.path.exists(OUT) else {}  # resume: keep earlier matches
missing = []
for product in payload["catalog"]["products"]:
    data = product["data"]
    part = re.sub(r"^IPH-", "", data["sku"])               # M6258
    queries = [re.sub(r"^([A-Za-z]+)(\d+)", r"\1 \2", part), part,  # "M 6258", "M6258"
               re.sub(r"^([A-Za-z]+)(\d+)", r"\1-\2", part),         # "M-6258"
               re.sub(r"\s*\(.*?\)", "", data["name"])[:60],           # product name
               data["name"].split(",")[0]]                             # name before the first comma
    for image in data.get("images", []):
        want = stem_bc(image["image_file"])                 # m-6258__69542.1 -> see below
        want = re.sub(r"__\d+\.\d+$", "", want)             # strip BC re-upload suffix
        if stem_bc(image["image_file"]) in result:
            continue
        found = None
        for query in queries:
            html = get("https://www.primelineparts.com/search/?q=" + urllib.parse.quote(query))
            time.sleep(0.6)
            candidates = {m.group(0): m.group(1) for m in IMG.finditer(html)}
            for url, name in candidates.items():
                stem = os.path.splitext(name)[0]
                stem = re.sub(r"__\d+\.\d+$", "", stem)
                if norm(stem) == norm(want):
                    found = re.sub(r"/stencil/\d+w/", "/stencil/1280w/", url)
                    break
            if not found:  # variant file names on the site: M-6258 -> M-6258-1
                prefixes = (norm(part), norm(want))
                for url, name in candidates.items():
                    stem = norm(re.sub(r"__\d+\.\d+$", "", os.path.splitext(name)[0]))
                    if any(stem.startswith(p) for p in prefixes):
                        found = re.sub(r"/stencil/\d+w/", "/stencil/1280w/", url)
                        break
            if found:
                break
        if found:
            result[stem_bc(image["image_file"])] = found
        else:
            missing.append((data["sku"], image["image_file"]))
json.dump(result, open(OUT, "w"), indent=1)
print(f"matched {len(result)} images, missing {len(missing)}")
for m in missing[:15]:
    print("  missing:", m)
