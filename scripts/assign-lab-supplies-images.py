"""Gives every Lab Supplies template product a picture of the right kind of item.

The VWR source only had one generic stock photo for all products. This assigns
freely licensed Wikimedia Commons photos by product type instead (the mapping
and the license/source of every image are in scripts/lab-supplies-images.json),
stores them in the local images folder, points snapshot 59 at them, and writes
docs/LAB-SUPPLIES-IMAGE-CREDITS.md.

  python3 -I scripts/assign-lab-supplies-images.py [--apply]     # run from the repo root
Local database only (local.db); defaults to a dry run, --apply backs it up first.
"""
import hashlib, json, os, shutil, sqlite3, sys, time, urllib.request

APPLY = "--apply" in sys.argv
DB = "local.db"
DIR = os.environ.get("SNAPSHOT_IMAGES_DIR", ".snapshot-images")
SNAPSHOT = 59
BRANDS = ["Kimberly-Clark", "Mettler Toledo", "Thermo Scientific", "BD", "Cytiva", "Corning", "Gilson", "Ansell",
          "Eppendorf", "3M", "Merck", "Drummond", "Rainin", "Sartorius", "Binder", "Hettich", "Nalgene", "Avantor", "VWR", "Hach"]
spec = json.load(open(os.path.join(os.path.dirname(__file__), "lab-supplies-images.json")))

def product_type(name):
    name = name.split(",")[0]
    for b in BRANDS:
        if name.startswith(b + " "):
            return name[len(b) + 1:]
    return name

def download(url):
    url = url.replace("/640px-", "/960px-")
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "bc-demoenv-template-images/1.0 (demo data)"})
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("download failed: " + url)

db = sqlite3.connect(DB)
payload = json.loads(db.execute("select payload_json from catalog_snapshots where id=?", (SNAPSHOT,)).fetchone()[0])

files = {}  # image key -> stored file name
if APPLY:
    os.makedirs(DIR, exist_ok=True)
    for key, meta in spec["images"].items():
        data = download(meta["thumb"])
        ext = "png" if data[:4] == b"\x89PNG" else "jpg"
        name = hashlib.sha256(data).hexdigest() + "." + ext
        open(os.path.join(DIR, name), "wb").write(data)
        files[key] = name
        time.sleep(0.5)

seen, unmapped = {}, set()
previews = {p["id"]: p for p in payload["preview"]["products"]}
for product in payload["catalog"]["products"]:
    data = product["data"]
    t = product_type(data["name"])
    options = spec["types"].get(t)
    if not options:
        unmapped.add(t)
        continue
    n = seen[t] = seen.get(t, -1) + 1
    subject, index = options[n % len(options)]
    key = f"{subject}#{index}"
    if not APPLY:
        continue
    file = files[key]
    image = dict(data["images"][0]) if data.get("images") else {"id": 0, "product_id": data["id"], "is_thumbnail": True, "sort_order": 0}
    image.update(local_image=file, is_thumbnail=True, sort_order=0, description=data["name"])
    image.pop("blob_url", None)
    data["images"] = [image]
    data["primary_image"] = dict(image)
    if data["id"] in previews:
        previews[data["id"]]["imageUrl"] = "/api/snapshot-images/" + file

print("unmapped types:", sorted(unmapped) or "none")
print("products per type:", len(seen), "types,", sum(n + 1 for n in seen.values()), "products")
if APPLY:
    shutil.copyfile(DB, f"{DB}.before-lab-images-{int(time.time())}")
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    images = sum(len(p["data"].get("images", [])) for p in payload["catalog"]["products"])
    db.execute("update catalog_snapshots set payload_json=?, payload_bytes=?, image_count=? where id=?",
               (text, len(text.encode()), images, SNAPSHOT))
    db.commit()
    lines = ["# Lab Supplies template image credits", "",
             "Product photos in the *Template - Lab Supplies* snapshot come from Wikimedia Commons, assigned by product type.", ""]
    for key, m in sorted(spec["images"].items()):
        lines.append(f"- {m['title'].replace('File:', '')}: {m['license']} ({m['page']})")
    open("docs/LAB-SUPPLIES-IMAGE-CREDITS.md", "w").write("\n".join(lines) + "\n")
    print("updated snapshot", SNAPSHOT, "with", len(files), "distinct images")
