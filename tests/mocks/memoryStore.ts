import { ActivationContext, ActivationStore, MaxPlayerContext, MaxPlayerStore, PackageSnapshot } from "../../src/core/activation/engine";

/** In-memory ActivationStore mirroring the Prisma store semantics (lease + status rules). */
export class MemoryActivationStore implements ActivationStore {
  orders = new Map<string, any>();
  subs = new Map<string, any>();
  reseller = { id: "r1", active: true, billingEnabled: true, linePrefix: "" };
  platformBillingEnabled = true;
  panel: ActivationContext["panel"];
  private seq = 0;

  constructor(panelCfg: { apiUrl: string; apiKey: string }, testMode = false) {
    this.panel = { id: "panel1", type: "XUI_ONE", testMode, config: panelCfg };
  }

  addOrder(o: Partial<any> & { id: string; snapshot: PackageSnapshot }) {
    this.orders.set(o.id, { number: "ORD-" + o.id, kind: "NEW", status: "PAID", attempts: 0, lineUsername: null, linePassword: null, plannedExpiresAt: null, subscriptionId: null, customerEmail: "c@x.com", lockedUntil: null, errorMessage: null, ...o });
  }

  async load(orderId: string): Promise<ActivationContext | null> {
    const o = this.orders.get(orderId);
    if (!o) return null;
    const s = o.subscriptionId ? this.subs.get(o.subscriptionId) : null;
    return {
      order: { id: o.id, number: o.number, kind: o.kind, status: o.status, attempts: o.attempts, snapshot: o.snapshot, lineUsername: o.lineUsername, linePassword: o.linePassword, plannedExpiresAt: o.plannedExpiresAt, subscriptionId: o.subscriptionId, customerEmail: o.customerEmail, autoRenameTakenUsername: o.autoRename ?? false },
      subscription: s ? { id: s.id, xuiLineId: s.xuiLineId, lineUsername: s.lineUsername, expiresAt: s.expiresAt, maxPlayerStatus: s.maxPlayerStatus ?? "ACTIVE" } : null,
      panel: this.panel,
      reseller: this.reseller,
      platformBillingEnabled: this.platformBillingEnabled,
    };
  }

  async claim(orderId: string, leaseMs: number, now: Date) {
    const o = this.orders.get(orderId);
    if (!o || !["PAID", "ACTIVATING", "ACTIVATION_FAILED", "ON_HOLD"].includes(o.status)) return false;
    if (o.lockedUntil && o.lockedUntil.getTime() > now.getTime()) return false;
    o.status = "ACTIVATING";
    o.lockedUntil = new Date(now.getTime() + leaseMs);
    o.attempts++;
    return true;
  }

  async savePlan(orderId: string, plan: { username?: string; password?: string; expiresAt: Date }) {
    const o = this.orders.get(orderId);
    if (plan.username) o.lineUsername = plan.username;
    if (plan.password) o.linePassword = plan.password;
    o.plannedExpiresAt = plan.expiresAt;
  }

  async completeNew(orderId: string, r: any) {
    const o = this.orders.get(orderId);
    const id = o.subscriptionId ?? `sub_${++this.seq}`;
    this.subs.set(id, { id, status: "ACTIVE", xuiLineId: r.lineId, lineUsername: r.username, linePassword: r.password, expiresAt: r.expiresAt, startsAt: r.startsAt, isTest: r.test, maxPlayerUserId: null, maxPlayerStatus: "NONE" });
    o.subscriptionId = id;
    o.status = "COMPLETED";
    o.lockedUntil = null;
    return { subscriptionId: id };
  }

  async completeRenewal(orderId: string, r: { subscriptionId: string; expiresAt: Date }) {
    const o = this.orders.get(orderId);
    this.subs.get(r.subscriptionId).expiresAt = r.expiresAt;
    this.subs.get(r.subscriptionId).status = "ACTIVE";
    o.status = "COMPLETED";
    o.lockedUntil = null;
  }

  async fail(orderId: string, message: string, final: boolean) {
    const o = this.orders.get(orderId);
    o.errorMessage = message;
    o.lockedUntil = null;
    if (final) o.status = "ACTIVATION_FAILED";
  }

  async hold(orderId: string, reason: string) {
    const o = this.orders.get(orderId);
    o.status = "ON_HOLD";
    o.errorMessage = reason;
  }
}

export class MemoryMaxPlayerStore implements MaxPlayerStore {
  integration: MaxPlayerContext["integration"] = null;
  reseller = { active: true, billingEnabled: true };
  constructor(public subs: Map<string, any>) {}
  async load(id: string): Promise<MaxPlayerContext | null> {
    const s = this.subs.get(id);
    if (!s) return null;
    return { subscription: { id, lineUsername: s.lineUsername, linePassword: s.linePassword, maxPlayerUserId: s.maxPlayerUserId, customerEmail: s.customerEmail ?? "c@x.com", customerName: null }, integration: this.integration, reseller: this.reseller };
  }
  async markPending(id: string) { this.subs.get(id).maxPlayerStatus = "PENDING"; }
  async markActive(id: string, mp: string) { const s = this.subs.get(id); s.maxPlayerStatus = "ACTIVE"; s.maxPlayerUserId = mp; s.maxPlayerError = null; }
  async markFailed(id: string, msg: string) { const s = this.subs.get(id); s.maxPlayerStatus = "FAILED"; s.maxPlayerError = msg; }
  async markWaiting(id: string, msg: string) { const s = this.subs.get(id); s.maxPlayerStatus = "PENDING"; s.maxPlayerError = msg; }
}
