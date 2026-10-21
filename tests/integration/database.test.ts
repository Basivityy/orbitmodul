/**
 * Database-level guarantees on a real PostgreSQL (uses the `psql` CLI, no npm deps).
 * Configure with PGHOST/PGPORT/PGUSER (defaults: 127.0.0.1:5432 postgres). Skips if psql is missing.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const DB = `xb_it_${process.pid}`;
const env = { ...process.env, PGHOST: process.env.PGHOST ?? "127.0.0.1", PGPORT: process.env.PGPORT ?? "5432", PGUSER: process.env.PGUSER ?? "postgres" };
const hasPsql = spawnSync("psql", ["--version"]).status === 0 && spawnSync("psql", ["-d", "postgres", "-c", "select 1"], { env }).status === 0;

function sql(q: string, db = DB): string {
  return execFileSync("psql", ["-d", db, "-v", "ON_ERROR_STOP=1", "-At", "-q", "-c", q], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function sqlFails(q: string): string {
  const r = spawnSync("psql", ["-d", DB, "-v", "ON_ERROR_STOP=1", "-At", "-q", "-c", q], { env, encoding: "utf8" });
  assert.notEqual(r.status, 0, `expected failure: ${q}`);
  return r.stderr;
}

before(() => {
  if (!hasPsql) return;
  sql(`DROP DATABASE IF EXISTS ${DB}`, "postgres");
  sql(`CREATE DATABASE ${DB}`, "postgres");
  for (const m of ["0001_init", "0002_manual_customers", "0003_panel_owner_packages", "0004_bouquet_catalog", "0005_activation_codes", "0006_reseller_mail", "0007_app_api"]) {
    const migration = readFileSync(join(__dirname, `../../../prisma/migrations/${m}/migration.sql`), "utf8");
    execFileSync("psql", ["-d", DB, "-v", "ON_ERROR_STOP=1", "-q"], { env, input: migration });
  }
  sql(`INSERT INTO "User"(id,email,"passwordHash",name,"updatedAt") VALUES ('u1','a@x.co','h','A',now()),('u2','b@x.co','h','B',now())`);
  sql(`INSERT INTO "Reseller"(id,slug,"ownerUserId","storeName","updatedAt") VALUES ('r1','store-a','u1','A',now()),('r2','store-b','u2','B',now())`);
  sql(`INSERT INTO "PanelIntegration"(id,"resellerId",name,"apiUrl","apiKeyEnc","updatedAt") VALUES ('p1','r1','P','https://x','enc',now())`);
  sql(`INSERT INTO "Package"(id,"resellerId","panelId",name,"priceCents",currency,"durationDays","updatedAt") VALUES ('k1','r1','p1','Basic',1000,'EUR',30,now())`);
  sql(`INSERT INTO "Customer"(id,"resellerId",email) VALUES ('c1','r1','c@x.co')`);
});

after(() => {
  if (hasPsql) sql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`, "postgres");
});

test("migration creates every table", { skip: !hasPsql }, () => {
  assert.equal(Number(sql(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`)), 29);
});

test("same customer email may exist in two stores, but not twice in one", { skip: !hasPsql }, () => {
  sql(`INSERT INTO "Customer"(id,"resellerId",email) VALUES ('c2','r2','c@x.co')`);
  assert.match(sqlFails(`INSERT INTO "Customer"(id,"resellerId",email) VALUES ('c3','r1','c@x.co')`), /Customer_resellerId_email_key/);
});

test("webhook events are recorded once per provider+reseller", { skip: !hasPsql }, () => {
  sql(`INSERT INTO "WebhookEvent"(id,provider,scope,"eventId") VALUES ('w1','STRIPE','r1','evt_1')`);
  assert.match(sqlFails(`INSERT INTO "WebhookEvent"(id,provider,scope,"eventId") VALUES ('w2','STRIPE','r1','evt_1')`), /WebhookEvent_provider_scope_eventId_key/);
  sql(`INSERT INTO "WebhookEvent"(id,provider,scope,"eventId") VALUES ('w3','STRIPE','r2','evt_1')`); // other tenant OK
});

const order = (id: string, extra = "") =>
  `INSERT INTO "Order"(id,number,"resellerId","customerId","packageId",status,"amountCents",currency,provider,"packageSnapshot","accessToken","idempotencyKey","updatedAt"${extra ? "," + extra.split("|")[0] : ""}) VALUES ('${id}','N-${id}','r1','c1','k1','PAID',1000,'EUR','STRIPE','{}','tok-${id}','idem-${id}',now()${extra ? "," + extra.split("|")[1] : ""})`;

test("one payment id can only belong to one order; idempotency keys are unique", { skip: !hasPsql }, () => {
  sql(order("o1", `"providerPaymentId"|'pi_1'`));
  assert.match(sqlFails(order("o2", `"providerPaymentId"|'pi_1'`)), /Order_provider_providerPaymentId_key/);
  assert.match(sqlFails(`INSERT INTO "Order"(id,number,"resellerId","customerId","packageId","amountCents",currency,provider,"packageSnapshot","accessToken","idempotencyKey","updatedAt") VALUES ('o3','N-o3','r1','c1','k1',1,'EUR','STRIPE','{}','t3','idem-o1',now())`), /Order_idempotencyKey_key/);
});

test("activation lease: only one worker can claim an order", { skip: !hasPsql }, () => {
  sql(order("o4"));
  const claim = `WITH c AS (UPDATE "Order" SET status='ACTIVATING', "lockedUntil"=now()+interval '5 minutes', attempts=attempts+1 WHERE id='o4' AND status IN ('PAID','ACTIVATING','ACTIVATION_FAILED','ON_HOLD') AND ("lockedUntil" IS NULL OR "lockedUntil" < now()) RETURNING 1) SELECT count(*) FROM c`;
  assert.equal(sql(claim), "1");
  assert.equal(sql(claim), "0", "second claim while leased must fail");
  sql(`UPDATE "Order" SET "lockedUntil"=now()-interval '1 second' WHERE id='o4'`);
  assert.equal(sql(claim), "1", "expired lease can be re-claimed");
  sql(`UPDATE "Order" SET status='COMPLETED', "lockedUntil"=NULL WHERE id='o4'`);
  assert.equal(sql(claim), "0", "completed orders are never re-claimed");
});

test("manual orders: MANUAL provider and notifyCustomer flag exist", { skip: !hasPsql }, () => {
  sql(order("o9", `provider,"notifyCustomer"|'MANUAL',false`).replace(",provider,", ",").replace("'STRIPE',", ""));
  assert.equal(sql(`SELECT provider||':'||"notifyCustomer" FROM "Order" WHERE id='o9'`), "MANUAL:false");
});

test("transactions are unique per provider reference", { skip: !hasPsql }, () => {
  sql(`INSERT INTO "Transaction"(id,"resellerId",type,"amountCents",currency,provider,"providerRef") VALUES ('t1','r1','PAYMENT',1000,'EUR','STRIPE','pi_1')`);
  sqlFails(`INSERT INTO "Transaction"(id,"resellerId",type,"amountCents",currency,provider,"providerRef") VALUES ('t2','r1','PAYMENT',1000,'EUR','STRIPE','pi_1')`);
  sql(`INSERT INTO "Transaction"(id,"resellerId",type,"amountCents",currency,provider,"providerRef") VALUES ('t3','r1','REFUND',-1000,'EUR','STRIPE','pi_1')`);
});

test("daily revenue SQL used by the dashboard runs and groups by day", { skip: !hasPsql }, () => {
  const out = sql(`SELECT date_trunc('day', "createdAt") AS d, SUM("amountCents") AS s FROM "Transaction" WHERE "resellerId" = 'r1' AND "currency" = 'EUR' AND "status" = 'SUCCEEDED' AND "createdAt" >= now() - interval '30 days' GROUP BY 1 ORDER BY 1`);
  assert.match(out, /\|0$/); // +1000 and -1000 today
});

test("bouquet catalog: one name per panel host and bouquet id", { skip: !hasPsql }, () => {
  sql(`INSERT INTO "BouquetCatalog"(id,host,"externalId",name) VALUES ('bc1','televizija.tel','1','BIH')`);
  assert.match(sqlFails(`INSERT INTO "BouquetCatalog"(id,host,"externalId",name) VALUES ('bc2','televizija.tel','1','X')`), /BouquetCatalog_host_externalId_key/);
  sql(`INSERT INTO "BouquetCatalog"(id,host,"externalId",name) VALUES ('bc3','other.tv','1','Y')`);
});

test("deleting a customer (same statements as deleteCustomer): orders/invoices/subscriptions go, revenue stays", { skip: !hasPsql }, () => {
  sql(`INSERT INTO "Customer"(id,"resellerId",email) VALUES ('c5','r1','del@x.co')`);
  sql(`INSERT INTO "Subscription"(id,"resellerId","customerId","packageId","panelId","priceCents",currency,"durationDays","updatedAt") VALUES ('s5','r1','c5','k1','p1',1000,'EUR',30,now())`);
  sql(order("o5").replace("'c1'", "'c5'").replace("now())", "now())").replace(`"updatedAt")`, `"updatedAt","subscriptionId")`).replace("now())", "now(),'s5')"));
  sql(`INSERT INTO "Invoice"(id,"resellerId","customerId","orderId",number,"amountCents",currency,lines) VALUES ('i5','r1','c5','o5','INV-5',1000,'EUR','[]')`);
  sql(`INSERT INTO "Transaction"(id,"resellerId","orderId","subscriptionId",type,"amountCents",currency,provider,"providerRef") VALUES ('t5','r1','o5','s5','PAYMENT',1000,'EUR','STRIPE','pi_5')`);
  // Without detaching/removing dependents first, the customer cannot be deleted (no silent data loss).
  sqlFails(`DELETE FROM "Customer" WHERE id='c5'`);
  sql(`BEGIN;
    UPDATE "Transaction" SET "orderId"=NULL,"subscriptionId"=NULL WHERE "resellerId"='r1' AND ("orderId" IN ('o5') OR "subscriptionId" IN ('s5'));
    DELETE FROM "Invoice" WHERE "customerId"='c5';
    DELETE FROM "Order" WHERE "customerId"='c5';
    DELETE FROM "Subscription" WHERE "customerId"='c5';
    DELETE FROM "Customer" WHERE id='c5';
    COMMIT;`);
  assert.equal(sql(`SELECT count(*) FROM "Customer" WHERE id='c5'`), "0");
  assert.equal(sql(`SELECT "amountCents" FROM "Transaction" WHERE id='t5'`), "1000", "revenue record kept");
  assert.equal(sql(`SELECT count(*) FROM "Customer" WHERE id='c1'`), "1", "other customers untouched");
});

test("activation codes: globally unique, and only one request can redeem a code", { skip: !hasPsql }, () => {
  sql(`INSERT INTO "ActivationCode"(id,"resellerId","packageId",code) VALUES ('ac1','r1','k1','AAAA-BBBB-CCCC')`);
  assert.match(sqlFails(`INSERT INTO "ActivationCode"(id,"resellerId","packageId",code) VALUES ('ac2','r2','k1','AAAA-BBBB-CCCC')`), /ActivationCode_code_key/);
  const claim = `WITH c AS (UPDATE "ActivationCode" SET status='USED', "usedAt"=now() WHERE id='ac1' AND status='UNUSED' RETURNING 1) SELECT count(*) FROM c`;
  assert.equal(sql(claim), "1");
  assert.equal(sql(claim), "0", "second redeem of the same code does nothing");
  assert.equal(sql(`SELECT status FROM "ActivationCode" WHERE id='ac1'`), "USED");
});

test("app login: one app code per line, one row per device", { skip: !hasPsql }, () => {
  sql(`INSERT INTO "Customer"(id,"resellerId",email) VALUES ('c8','r1','app@x.co')`);
  sql(`INSERT INTO "Subscription"(id,"resellerId","customerId","packageId","panelId","priceCents",currency,"durationDays","updatedAt","appCode") VALUES ('s8','r1','c8','k1','p1',0,'EUR',30,now(),'AAAA-BBBB-DDDD')`);
  assert.match(sqlFails(`INSERT INTO "Subscription"(id,"resellerId","customerId","packageId","panelId","priceCents",currency,"durationDays","updatedAt","appCode") VALUES ('s9','r1','c8','k1','p1',0,'EUR',30,now(),'AAAA-BBBB-DDDD')`), /Subscription_appCode_key/);
  sql(`INSERT INTO "AppDevice"(id,"subscriptionId","deviceId") VALUES ('d1','s8','tv-1')`);
  assert.match(sqlFails(`INSERT INTO "AppDevice"(id,"subscriptionId","deviceId") VALUES ('d2','s8','tv-1')`), /AppDevice_subscriptionId_deviceId_key/);
  sql(`DELETE FROM "Subscription" WHERE id='s8'`);
  assert.equal(sql(`SELECT count(*) FROM "AppDevice" WHERE id='d1'`), "0", "devices go with the line");
  sql(`DELETE FROM "Customer" WHERE id='c8'`);
});

test("deleting a reseller removes only its own data (tenant cascade)", { skip: !hasPsql }, () => {
  sql(`UPDATE "Order" SET "subscriptionId"=NULL`);
  sql(`DELETE FROM "Transaction" WHERE "resellerId"='r1'`);
  sql(`DELETE FROM "Order" WHERE "resellerId"='r1'`);
  sql(`DELETE FROM "Reseller" WHERE id='r1'`);
  assert.equal(sql(`SELECT count(*) FROM "Package"`), "0");
  assert.equal(sql(`SELECT count(*) FROM "Customer" WHERE "resellerId"='r2'`), "1", "other tenant untouched");
});
