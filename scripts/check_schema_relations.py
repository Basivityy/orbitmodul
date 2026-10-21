#!/usr/bin/env python3
"""Offline check that every Prisma relation has its opposite side (what `prisma validate` reports as P1012)."""
import re, sys

src = re.sub(r"//[^\n]*", "", open(sys.argv[1] if len(sys.argv) > 1 else "prisma/schema.prisma").read())
models = {m.group(1): m.group(2) for m in re.finditer(r"model\s+(\w+)\s*\{(.*?)\n\}", src, re.S)}
fields = {}
for name, body in models.items():
    fs = []
    for line in body.split("\n"):
        line = line.strip()
        if not line or line.startswith("@@"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        typ = parts[1].rstrip("?").replace("[]", "")
        if typ in models:
            fs.append((parts[0], typ, "[]" in parts[1], "@relation(fields" in line or "@relation(\"" in line and "fields" in line))
    fields[name] = fs
errors = []
for name, fs in fields.items():
    for fname, typ, is_list, owns in fs:
        opposite = [f for f in fields[typ] if f[1] == name]
        if typ == name:
            continue
        if not opposite:
            errors.append(f"{name}.{fname} -> {typ}: missing opposite relation field on {typ}")
        if is_list and not any(o[3] for o in opposite):
            errors.append(f"{name}.{fname} (list) -> {typ}: {typ} has no @relation(fields: …) back to {name}")
if errors:
    print("\n".join(errors)); sys.exit(1)
print(f"relations OK ({sum(len(v) for v in fields.values())} relation fields in {len(models)} models)")
