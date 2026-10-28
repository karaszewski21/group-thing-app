import json
import random
import sys
from pathlib import Path

frag = Path(sys.argv[1])
out = Path(sys.argv[2])


def load(name):
    return json.loads((frag / name).read_text(encoding="utf-8"))


def node(name, eid, children):
    return {"name": name, "external_id": eid, "children": children}


kob_rest = load("kobiety_rest.json")
kobiety = [node("Ubrania", 4, load("kobiety_ubrania.json"))] + kob_rest
dom = load("dom.json")
zwierzeta = next(n for n in dom if n["name"] == "Zwierzęta")
dom = [n for n in dom if n["name"] != "Zwierzęta"]

tree = [
    node("Kobiety", 1904, kobiety),
    node("Mężczyźni", 5, load("mezczyzni.json")),
    node("Dzieci", 1193, load("dzieci.json")),
    node("Dom", 1918, dom),
    node("Elektronika", 2994, load("elektronika.json")),
    node("Rozrywka", 2309, load("rozrywka.json")),
    node("Hobby i kolekcje", 4824, load("hobby.json")),
    node("Sport", 4332, load("sport.json")),
    node("Zwierzęta", zwierzeta["external_id"], zwierzeta["children"]),
]


def normalize(n):
    n["name"] = n["name"].strip()
    n["children"] = [normalize(c) for c in n.get("children", [])]
    return {"name": n["name"], "external_id": n.get("external_id"), "children": n["children"]}


tree = [normalize(n) for n in tree]
out.write_text(json.dumps(tree, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

paths = []


def walk(nodes, prefix, depth, stats):
    for n in nodes:
        p = prefix + [n["name"]]
        stats["count"] += 1
        stats["depth"] = max(stats["depth"], depth)
        stats["null"] += n["external_id"] is None
        if not n["children"]:
            paths.append(" > ".join(p))
        walk(n["children"], p, depth + 1, stats)


total = {"count": 0, "depth": 0, "null": 0}
for r in tree:
    s = {"count": 0, "depth": 0, "null": 0}
    walk([r], [], 1, s)
    print(f"{r['name']}: nodes={s['count']} depth={s['depth']} null={s['null']}")
    for k in total:
        total[k] = max(total[k], s[k]) if k == "depth" else total[k] + s[k]
print("TOTAL", total)
random.seed(7)
for p in random.sample(paths, 10):
    print("  ", p)
