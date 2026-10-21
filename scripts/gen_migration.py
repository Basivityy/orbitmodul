#!/usr/bin/env python3
"""Generate an initial Prisma-compatible PostgreSQL migration from schema.prisma.

Used only because `prisma migrate dev` was unavailable while authoring. It follows
Prisma's naming conventions (Model_pkey, Model_field_key, Model_a_b_idx,
Model_field_fkey). On a machine with Prisma you can verify there is no drift with:
  npx prisma migrate diff --from-migrations prisma/migrations \
     --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_URL"
"""
import re, sys

src = open(sys.argv[1]).read()
src = re.sub(r"//[^\n]*", "", src)

enums = {}
for m in re.finditer(r"enum\s+(\w+)\s*\{([^}]*)\}", src):
    enums[m.group(1)] = m.group(2).split()

models = {}
order = []
for m in re.finditer(r"model\s+(\w+)\s*\{(.*?)\n\}", src, re.S):
    models[m.group(1)] = m.group(2)
    order.append(m.group(1))

SCALAR = {"String": "TEXT", "Int": "INTEGER", "Boolean": "BOOLEAN", "DateTime": "TIMESTAMP(3)", "Json": "JSONB", "BigInt": "BIGINT", "Float": "DOUBLE PRECISION"}

out = []
for name, vals in enums.items():
    out.append(f"-- CreateEnum\nCREATE TYPE \"{name}\" AS ENUM ({', '.join(repr(v) for v in vals)});\n")

indexes = []
fks = []
for model in order:
    body = models[model]
    cols = []
    pk = None
    for line in body.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("@@"):
            mm = re.match(r"@@(id|unique|index)\(\[([^\]]*)\]", line)
            kind, fields = mm.group(1), [f.strip() for f in mm.group(2).split(",")]
            if kind == "id":
                pk = fields
            elif kind == "unique":
                indexes.append(f"CREATE UNIQUE INDEX \"{model}_{'_'.join(fields)}_key\" ON \"{model}\"({', '.join(chr(34)+f+chr(34) for f in fields)});")
            else:
                indexes.append(f"CREATE INDEX \"{model}_{'_'.join(fields)}_idx\" ON \"{model}\"({', '.join(chr(34)+f+chr(34) for f in fields)});")
            continue
        parts = line.split(None, 2)
        fname, ftype = parts[0], parts[1]
        attrs = parts[2] if len(parts) > 2 else ""
        base = ftype.rstrip("?").replace("[]", "")
        is_list = ftype.endswith("[]")
        optional = ftype.endswith("?")
        if base not in SCALAR and base not in enums:
            # relation field
            rm = re.search(r"@relation\(fields:\s*\[([^\]]*)\],\s*references:\s*\[([^\]]*)\](?:,\s*onDelete:\s*(\w+))?", attrs)
            if rm:
                lf = [f.strip() for f in rm.group(1).split(",")]
                rf = [f.strip() for f in rm.group(2).split(",")]
                # optional relation if the local scalar field is optional
                local_opt = re.search(r"^\s*" + lf[0] + r"\s+\w+\?", body, re.M) is not None
                ondel = {"Cascade": "CASCADE", "SetNull": "SET NULL", "Restrict": "RESTRICT", "NoAction": "NO ACTION"}.get(rm.group(3) or "", "SET NULL" if local_opt else "RESTRICT")
                fks.append(f"ALTER TABLE \"{model}\" ADD CONSTRAINT \"{model}_{'_'.join(lf)}_fkey\" FOREIGN KEY ({', '.join(chr(34)+f+chr(34) for f in lf)}) REFERENCES \"{base}\"({', '.join(chr(34)+f+chr(34) for f in rf)}) ON DELETE {ondel} ON UPDATE CASCADE;")
            continue
        sqltype = SCALAR.get(base, f'"{base}"')
        if is_list:
            sqltype += "[]"
        col = f'    "{fname}" {sqltype}'
        if not optional and not is_list:
            col += " NOT NULL"
        d = re.search(r"@default\((.*?)\)(?:\s|$)", attrs + " ")
        if d:
            dv = d.group(1)
            if dv in ("cuid(", "cuid()", "uuid()"):
                pass
            elif dv.startswith("now("):
                col += " DEFAULT CURRENT_TIMESTAMP"
            elif dv in ("true", "false") or re.fullmatch(r"-?\d+", dv):
                col += f" DEFAULT {dv}"
            elif dv == "[]":
                col += f" DEFAULT ARRAY[]::{SCALAR.get(base, base)}[]"
            elif dv.startswith('"'):
                col += " DEFAULT '" + dv.strip('"').replace("'", "''") + "'"
            else:
                col += f" DEFAULT '{dv}'"
        cols.append(col)
        if "@id" in attrs.split():
            pk = [fname]
        if re.search(r"@unique\b", attrs):
            indexes.append(f"CREATE UNIQUE INDEX \"{model}_{fname}_key\" ON \"{model}\"(\"{fname}\");")
    cols.append(f"\n    CONSTRAINT \"{model}_pkey\" PRIMARY KEY ({','.join(chr(34)+f+chr(34) for f in pk)})")
    out.append(f"-- CreateTable\nCREATE TABLE \"{model}\" (\n" + ",\n".join(cols) + "\n);\n")

out.append("\n".join("-- CreateIndex\n" + i + "\n" for i in indexes))
out.append("\n".join("-- AddForeignKey\n" + f + "\n" for f in fks))
print("\n".join(out))
