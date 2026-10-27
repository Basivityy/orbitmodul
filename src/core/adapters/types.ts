export interface PanelConfig {
  apiUrl: string;
  apiKey: string;
  /** Extra key/value parameters some panels require on create_line. */
  extraParams?: Record<string, string>;
  /** XUI user id (reseller) that new lines belong to — admin API `member_id`. */
  lineOwnerId?: string | null;
  timeoutMs?: number;
}

export interface NamedItem {
  id: string;
  name: string;
  /** True when the API gave only an id (name is a generated placeholder). */
  placeholder?: boolean;
}

/** A package as defined on the XUI panel (duration, credits, bouquets). */
export interface PanelPackage {
  id: string;
  name: string;
  durationDays: number;
  credits: number;
  maxConnections: number;
  bouquetIds: string[];
  isTrial: boolean;
}

export interface LineInfo {
  id: string;
  username: string;
  password?: string;
  expiresAt: Date | null;
  enabled: boolean | null;
  maxConnections: number | null;
  /** XUI user (reseller) that owns the line. */
  memberId?: string | null;
  /** Notes on the line (reseller notes, else admin notes). */
  notes?: string | null;
  /** Test (trial) line on the panel. */
  isTrial?: boolean;
  /** line | mag | enigma | restreamer */
  kind?: string;
  raw?: unknown;
}

export interface CreateLineInput {
  username: string;
  password: string;
  maxConnections: number;
  expiresAt: Date;
  bouquetIds: string[];
  notes?: string;
  isTrial?: boolean;
  /** Package id on the XUI panel. Required by the reseller API (lines are created from a panel package). */
  panelPackageId?: string | null;
}

export interface CreatedLine {
  lineId: string;
  username: string;
  password: string;
  /** Expiry the panel actually gave the line, when the panel decides it (reseller API: from the package). */
  expiresAt?: Date | null;
}

export interface ConnectionInfo {
  ok: boolean;
  credits: string | null;
  username: string | null;
  /** XUI user id of the API key owner (reseller id, e.g. 491). */
  memberId?: string | null;
  message: string;
}

/** Call log hook; adapters never include secrets in messages. */
export type ApiCallLogger = (e: { action: string; success: boolean; statusCode?: number; durationMs?: number; message?: string }) => void;

/**
 * Universal reseller-panel adapter. New panel types implement this interface and
 * register in `createPanelAdapter`.
 */
export interface PanelAdapter {
  readonly type: string;
  testConnection(): Promise<ConnectionInfo>;
  getBouquets(): Promise<NamedItem[]>;
  getPackages(): Promise<NamedItem[]>;
  getPanelPackages(): Promise<PanelPackage[]>;
  getCredits(): Promise<string | null>;
  createLine(input: CreateLineInput): Promise<CreatedLine>;
  /** Sets an absolute expiry (idempotent — safe to repeat). */
  /** Returns the expiry the panel actually stored when it reports one (reseller API: package duration). */
  setLineExpiry(lineId: string, expiresAt: Date, extra?: { bouquetIds?: string[]; maxConnections?: number; panelPackageId?: string | null }): Promise<Date | void>;
  /** All lines visible to this API key (read-only, paged). */
  listLines(opts?: { pageSize?: number; maxPages?: number }): Promise<{ lines: LineInfo[]; complete: boolean }>;
  enableLine(lineId: string): Promise<void>;
  disableLine(lineId: string): Promise<void>;
  /** Permanently removes the line from the panel. A line that no longer exists counts as deleted. */
  deleteLine(lineId: string): Promise<void>;
  getLine(lineId: string): Promise<LineInfo | null>;
  findLineByUsername(username: string): Promise<LineInfo | null>;
}

export class PanelApiError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly statusCode?: number) {
    super(message);
    this.name = "PanelApiError";
  }
}
