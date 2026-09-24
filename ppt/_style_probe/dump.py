import re, glob, os, collections
from xml.etree import ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
}

base = r"d:\code\ai-flows\ppt\_style_probe\x\ppt\slides"
files = sorted(glob.glob(os.path.join(base, "slide*.xml")),
               key=lambda p: int(re.search(r"slide(\d+)", p).group(1)))

def collect_srgb(root):
    out = []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag == "srgbClr":
            v = el.get("val")
            if v:
                out.append(v.upper())
    return out

def gradients(root):
    grads = []
    for gf in root.iter("{%s}gradFill" % NS["a"]):
        stops = []
        for gs in gf.findall(".//{%s}gs" % NS["a"]):
            pos = gs.get("pos")
            clr = gs.find(".//{%s}srgbClr" % NS["a"])
            alpha = gs.find(".//{%s}alpha" % NS["a"])
            if clr is not None:
                stops.append((pos, clr.get("val").upper(), alpha.get("val") if alpha is not None else None))
        lin = gf.find(".//{%s}lin" % NS["a"])
        ang = lin.get("ang") if lin is not None else None
        grads.append({"ang": ang, "stops": stops})
    return grads

print("=" * 70)
for f in files:
    n = int(re.search(r"slide(\d+)", f).group(1))
    root = ET.parse(f).getroot()
    colors = collect_srgb(root)
    cnt = collections.Counter(colors)
    grads = gradients(root)
    # text sizes
    sizes = []
    for r in root.iter("{%s}r" % NS["a"]):
        rpr = r.find("{%s}rPr" % NS["a"])
        if rpr is not None and rpr.get("sz"):
            t = "".join(x.text or "" for x in r.iter("{%s}t" % NS["a"]))
            if t.strip():
                sizes.append((int(rpr.get("sz")) / 100.0, t.strip()[:34]))
    sizes.sort(reverse=True)
    print(f"\n--- slide {n} ---")
    print("colors:", cnt.most_common(12))
    if grads:
        for g in grads[:4]:
            print("  grad ang=%s stops=%s" % (g["ang"], g["stops"]))
    if sizes:
        print("top sizes:", sizes[:6])