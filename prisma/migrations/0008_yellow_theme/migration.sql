-- Black & yellow theme: new stores start yellow; stores still on the old untouched default follow.
ALTER TABLE "Reseller" ALTER COLUMN "primaryColor" SET DEFAULT '#ffd400';
ALTER TABLE "Reseller" ALTER COLUMN "accentColor" SET DEFAULT '#000000';
UPDATE "Reseller" SET "primaryColor" = '#ffd400' WHERE "primaryColor" = '#3b63f6';
UPDATE "Reseller" SET "accentColor" = '#000000' WHERE "accentColor" = '#0ea5e9';
