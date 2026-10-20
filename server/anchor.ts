/**
 * Optional S3 Object Lock audit anchor.
 *
 * The local log is an append-only hash chain. It detects an edit, but somebody
 * who can rewrite the whole file can recompute every hash. This module copies
 * the exact log bytes and a small manifest into S3 with Object Lock retention,
 * so the chain head is also held outside the machine that produced it.
 *
 * The AWS call lives in `anchor-store.ts`. Everything here is pure filesystem
 * logic plus the `AnchorStore` interface, which keeps the tests offline.
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { EventLog, GENESIS_HASH, type VerifyResult } from './log.js';

export type AnchorRetentionMode = 'GOVERNANCE' | 'COMPLIANCE';

export interface AnchorRetention {
  mode: AnchorRetentionMode;
  /** ISO-8601 instant. S3 truncates to seconds, so comparisons allow a small tolerance. */
  until: string;
}

export interface PutAnchorObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  retention: AnchorRetention;
  metadata?: Record<string, string>;
}

export interface PutAnchorObjectResult {
  versionId: string;
  etag?: string;
}

export interface GetAnchorObjectInput {
  key: string;
  versionId?: string;
}

export interface GetAnchorObjectResult {
  body: Uint8Array;
  versionId?: string;
  etag?: string;
  contentType?: string;
}

export interface AnchorObjectRetention {
  mode: AnchorRetentionMode;
  until: string;
}

export interface AnchorStore {
  /** Throws a clear error if the bucket is missing, unversioned or not Object-Lock enabled. */
  assertObjectLock(): Promise<void>;
  putObject(input: PutAnchorObjectInput): Promise<PutAnchorObjectResult>;
  getObject(input: GetAnchorObjectInput): Promise<GetAnchorObjectResult>;
  getObjectRetention(input: GetAnchorObjectInput): Promise<AnchorObjectRetention>;
}

const HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected 64 lowercase hexadecimal characters');

const IsoDateSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'expected an ISO-8601 date',
);

const RetentionModeSchema = z.enum(['GOVERNANCE', 'COMPLIANCE']);

const RetentionSchema = z
  .object({
    mode: RetentionModeSchema,
    until: IsoDateSchema,
  })
  .strict();

const SourceSchema = z
  .object({
    bucket: z.string().min(1),
    region: z.string().min(1),
    prefix: z.string().min(1),
    logKey: z.string().min(1),
    manifestKey: z.string().min(1),
  })
  .strict();

export const AnchorManifestSchema = z
  .object({
    version: z.literal(1),
    generatedAt: IsoDateSchema,
    logFile: z.string().min(1),
    eventCount: z.number().int().positive(),
    headHash: HashSchema,
    genesisHash: HashSchema,
    fileSha256: HashSchema,
    fileBytes: z.number().int().positive(),
    retention: RetentionSchema,
    source: SourceSchema,
  })
  .strict();

export type AnchorManifest = z.infer<typeof AnchorManifestSchema>;

export const AnchorReceiptSchema = z
  .object({
    version: z.literal(1),
    anchoredAt: IsoDateSchema,
    bucket: z.string().min(1),
    region: z.string().min(1),
    prefix: z.string().min(1),
    logFile: z.string().min(1),
    logKey: z.string().min(1),
    logVersionId: z.string().min(1),
    logEtag: z.string().min(1).optional(),
    manifestKey: z.string().min(1),
    manifestVersionId: z.string().min(1),
    manifestEtag: z.string().min(1).optional(),
    manifestSha256: HashSchema,
    eventCount: z.number().int().positive(),
    headHash: HashSchema,
    fileSha256: HashSchema,
    retention: RetentionSchema,
  })
  .strict();

export type AnchorReceipt = z.infer<typeof AnchorReceiptSchema>;

export interface AnchorPlanOptions {
  logFile: string;
  bucket: string;
  region: string;
  prefix?: string;
  retentionDays?: number;
  retentionMode?: AnchorRetentionMode;
  /** Injectable clock so tests and the dry run are deterministic. */
  now?: Date;
}

export interface AnchorPlan {
  manifest: AnchorManifest;
  logBytes: Buffer;
  manifestBytes: Buffer;
  logKey: string;
  manifestKey: string;
}

export interface AnchorOptions extends AnchorPlanOptions {
  store: AnchorStore;
  receiptFile?: string;
}

export interface AnchorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface AnchorVerifyResult {
  ok: boolean;
  checks: AnchorCheck[];
  localCount: number;
  anchoredCount: number;
  /** Local events appended after the anchored prefix. Zero is a valid pass. */
  newEvents: number;
  reason?: string;
}

export interface VerifyAnchorOptions {
  localLogFile: string;
  receipt: AnchorReceipt;
  store: AnchorStore;
}

export interface VerifiedLogBytes {
  count: number;
  headHash: string;
  verify: VerifyResult;
}

const DEFAULT_PREFIX = 'anchors';
const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export function sha256Hex(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') throw new Error('S3 anchor prefix must not be empty.');
  if (trimmed.includes('..')) throw new Error(`S3 anchor prefix "${prefix}" must not contain "..".`);
  return trimmed;
}

function assertPositiveInteger(value: number, label: string, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${label} must be an integer between 1 and ${max}; got ${value}.`);
  }
  return value;
}

/**
 * Verify JSONL bytes by writing them to a throwaway file and reusing the real
 * verifier. That keeps one definition of "valid chain" in `server/log.ts`.
 */
export function verifyLogBytes(bytes: Uint8Array, label: string): VerifiedLogBytes {
  if (bytes.length === 0) {
    throw new Error(`${label} is empty. Run "npm run seed" first.`);
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'sl-anchor-'));
  const file = path.join(dir, 'events.jsonl');
  try {
    writeFileSync(file, bytes);
    const log = EventLog.open(file, 'persist');
    const verify = log.verify();
    const head = log.all().at(-1);
    if (head === undefined) throw new Error(`${label} has no events.`);
    return { count: log.length, headHash: head.hash, verify };
  } catch (error) {
    throw new Error(`${label}: ${(error as Error).message}`, { cause: error });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function buildAnchorPlan(options: AnchorPlanOptions): AnchorPlan {
  const bucket = options.bucket.trim();
  const region = options.region.trim();
  if (bucket === '') throw new Error('S3 anchor bucket is required.');
  if (region === '') throw new Error('S3 anchor region is required.');
  if (!existsSync(options.logFile)) {
    throw new Error(`Log file ${options.logFile} does not exist. Run "npm run seed" first.`);
  }

  const prefix = normalizePrefix(options.prefix ?? DEFAULT_PREFIX);
  const retentionDays = assertPositiveInteger(
    options.retentionDays ?? DEFAULT_RETENTION_DAYS,
    'Retention days',
    3650,
  );
  const retentionMode = options.retentionMode ?? 'GOVERNANCE';
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Anchor clock is invalid.');

  const logBytes = readFileSync(options.logFile);
  const checked = verifyLogBytes(logBytes, options.logFile);
  if (!checked.verify.ok) {
    throw new Error(
      `Refusing to anchor a broken chain at event ${checked.verify.failedAt} of ` +
        `${checked.verify.count}: ${checked.verify.reason ?? 'unknown reason'}`,
    );
  }

  const anchorId = now.toISOString().replace(/[:.]/g, '-');
  const logKey = `${prefix}/${anchorId}/events.jsonl`;
  const manifestKey = `${prefix}/${anchorId}/manifest.json`;
  const until = new Date(now.getTime() + retentionDays * DAY_MS).toISOString();

  const manifest: AnchorManifest = {
    version: 1,
    generatedAt: now.toISOString(),
    logFile: path.basename(options.logFile),
    eventCount: checked.count,
    headHash: checked.headHash,
    genesisHash: GENESIS_HASH,
    fileSha256: sha256Hex(logBytes),
    fileBytes: logBytes.byteLength,
    retention: { mode: retentionMode, until },
    source: { bucket, region, prefix, logKey, manifestKey },
  };

  return {
    manifest,
    logBytes,
    manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    logKey,
    manifestKey,
  };
}

export function appendReceipt(file: string, receipt: AnchorReceipt): void {
  const parsed = AnchorReceiptSchema.parse(receipt);
  const dir = path.dirname(file);
  if (dir !== '' && dir !== '.') mkdirSync(dir, { recursive: true });
  appendFileSync(file, `${JSON.stringify(parsed)}\n`, 'utf8');
}

/**
 * Read one receipt. `line` is 1-based; omit it to read the most recent anchor.
 */
export function readReceipt(file: string, line?: number): AnchorReceipt {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Could not read anchor receipt ${file}: ${(error as Error).message}`, {
      cause: error,
    });
  }

  const lines = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (lines.length === 0) {
    throw new Error(`Anchor receipt ${file} is empty. Run "npm run anchor" first.`);
  }

  const index = line === undefined ? lines.length - 1 : line - 1;
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    throw new Error(
      `Anchor receipt ${file} has ${lines.length} line(s); line ${line ?? '?'} is out of range.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(lines[index]!);
  } catch (error) {
    throw new Error(
      `Anchor receipt ${file} line ${index + 1} is not valid JSON: ${(error as Error).message}`,
      { cause: error },
    );
  }

  const parsed = AnchorReceiptSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Anchor receipt ${file} line ${index + 1} is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function anchorLog(options: AnchorOptions): Promise<AnchorReceipt> {
  const plan = buildAnchorPlan(options);
  await options.store.assertObjectLock();

  const metadata = {
    'secondlook-head-hash': plan.manifest.headHash,
    'secondlook-event-count': String(plan.manifest.eventCount),
    'secondlook-log-sha256': plan.manifest.fileSha256,
  };

  let logPut;
  try {
    logPut = await options.store.putObject({
      key: plan.logKey,
      body: plan.logBytes,
      contentType: 'application/x-ndjson',
      retention: plan.manifest.retention,
      metadata,
    });
  } catch (error) {
    throw new Error(
      `Failed to upload ${plan.logKey} to ${options.bucket}: ${(error as Error).message}`,
      { cause: error },
    );
  }

  let manifestPut;
  try {
    manifestPut = await options.store.putObject({
      key: plan.manifestKey,
      body: plan.manifestBytes,
      contentType: 'application/json',
      retention: plan.manifest.retention,
      metadata: {
        'secondlook-head-hash': plan.manifest.headHash,
        'secondlook-event-count': String(plan.manifest.eventCount),
      },
    });
  } catch (error) {
    throw new Error(
      `Uploaded ${plan.logKey} as version ${logPut.versionId}, but failed to upload ` +
        `${plan.manifestKey}: ${(error as Error).message}`,
      { cause: error },
    );
  }

  const receipt: AnchorReceipt = {
    version: 1,
    anchoredAt: plan.manifest.generatedAt,
    bucket: plan.manifest.source.bucket,
    region: plan.manifest.source.region,
    prefix: plan.manifest.source.prefix,
    logFile: options.logFile,
    logKey: plan.logKey,
    logVersionId: logPut.versionId,
    ...(logPut.etag === undefined ? {} : { logEtag: logPut.etag }),
    manifestKey: plan.manifestKey,
    manifestVersionId: manifestPut.versionId,
    ...(manifestPut.etag === undefined ? {} : { manifestEtag: manifestPut.etag }),
    manifestSha256: sha256Hex(plan.manifestBytes),
    eventCount: plan.manifest.eventCount,
    headHash: plan.manifest.headHash,
    fileSha256: plan.manifest.fileSha256,
    retention: plan.manifest.retention,
  };

  const receiptFile = options.receiptFile ?? '.data/anchors.jsonl';
  try {
    appendReceipt(receiptFile, receipt);
  } catch (error) {
    throw new Error(
      `Anchored ${plan.logKey} (version ${logPut.versionId}) and ${plan.manifestKey} ` +
        `(version ${manifestPut.versionId}), but could not write ${receiptFile}: ` +
        `${(error as Error).message}`,
      { cause: error },
    );
  }

  return receipt;
}

function check(
  checks: AnchorCheck[],
  name: string,
  ok: boolean,
  detail: string,
): boolean {
  checks.push({ name, ok, detail });
  return ok;
}

function failed(
  checks: AnchorCheck[],
  reason: string,
  localCount: number,
  anchoredCount: number,
  newEvents: number,
): AnchorVerifyResult {
  return { ok: false, checks, localCount, anchoredCount, newEvents, reason };
}

export async function verifyAnchor(options: VerifyAnchorOptions): Promise<AnchorVerifyResult> {
  const { receipt, store } = options;
  const checks: AnchorCheck[] = [];

  let manifestBytes: Buffer;
  try {
    const object = await store.getObject({
      key: receipt.manifestKey,
      versionId: receipt.manifestVersionId,
    });
    manifestBytes = Buffer.from(object.body);
    check(checks, 'manifest-fetch', true, `fetched ${receipt.manifestKey} version ${receipt.manifestVersionId}`);
  } catch (error) {
    check(checks, 'manifest-fetch', false, (error as Error).message);
    return failed(checks, 'could not fetch the anchored manifest', 0, 0, 0);
  }

  if (
    !check(
      checks,
      'manifest-sha256',
      sha256Hex(manifestBytes) === receipt.manifestSha256,
      'the manifest bytes match the digest recorded in the local receipt',
    )
  ) {
    return failed(checks, 'the anchored manifest does not match the local receipt', 0, 0, 0);
  }

  let manifest: AnchorManifest;
  try {
    manifest = AnchorManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
    check(checks, 'manifest-schema', true, 'manifest matches AnchorManifestSchema');
  } catch (error) {
    check(checks, 'manifest-schema', false, (error as Error).message);
    return failed(checks, 'the anchored manifest is not valid', 0, 0, 0);
  }

  const agrees =
    manifest.eventCount === receipt.eventCount &&
    manifest.headHash === receipt.headHash &&
    manifest.fileSha256 === receipt.fileSha256 &&
    manifest.source.bucket === receipt.bucket &&
    manifest.source.region === receipt.region &&
    manifest.source.logKey === receipt.logKey &&
    manifest.source.manifestKey === receipt.manifestKey;
  if (!check(checks, 'manifest-receipt-agreement', agrees, 'manifest and receipt describe the same anchor')) {
    return failed(checks, 'the manifest and local receipt disagree', 0, 0, 0);
  }

  let anchoredBytes: Buffer;
  try {
    const object = await store.getObject({
      key: receipt.logKey,
      versionId: receipt.logVersionId,
    });
    anchoredBytes = Buffer.from(object.body);
    check(checks, 'anchored-log-fetch', true, `fetched ${receipt.logKey} version ${receipt.logVersionId}`);
  } catch (error) {
    check(checks, 'anchored-log-fetch', false, (error as Error).message);
    return failed(checks, 'could not fetch the anchored log', 0, 0, 0);
  }

  let anchored: VerifiedLogBytes;
  try {
    anchored = verifyLogBytes(anchoredBytes, `anchored log ${receipt.logKey}`);
    check(checks, 'anchored-log-chain', anchored.verify.ok, anchored.verify.ok ? 'hash chain intact' : `hash chain broken: ${anchored.verify.reason ?? 'unknown reason'}`);
  } catch (error) {
    check(checks, 'anchored-log-chain', false, (error as Error).message);
    return failed(checks, 'the anchored log cannot be parsed', 0, 0, 0);
  }

  if (!anchored.verify.ok) {
    return failed(checks, 'the anchored log hash chain is broken', 0, anchored.count, 0);
  }

  const anchoredChecks = [
    check(checks, 'anchored-log-count', anchored.count === manifest.eventCount, `${anchored.count} anchored event(s), manifest says ${manifest.eventCount}`),
    check(checks, 'anchored-log-head', anchored.headHash === manifest.headHash, 'anchored head hash matches the manifest'),
    check(checks, 'anchored-log-sha256', sha256Hex(anchoredBytes) === manifest.fileSha256, 'anchored bytes match the manifest digest'),
    check(checks, 'anchored-log-bytes', anchoredBytes.byteLength === manifest.fileBytes, `${anchoredBytes.byteLength} anchored byte(s), manifest says ${manifest.fileBytes}`),
  ];
  if (anchoredChecks.includes(false)) {
    return failed(checks, 'the anchored log does not match the manifest', 0, anchored.count, 0);
  }

  if (!existsSync(options.localLogFile)) {
    check(checks, 'local-log-read', false, `${options.localLogFile} does not exist`);
    return failed(checks, 'the local log is missing', 0, anchored.count, 0);
  }

  let localCount: number;
  try {
    const local = EventLog.open(options.localLogFile, 'persist');
    localCount = local.length;
    const localVerify = local.verify();
    if (!check(checks, 'local-log-chain', localVerify.ok, localVerify.ok ? 'hash chain intact' : `hash chain broken: ${localVerify.reason ?? 'unknown reason'}`)) {
      return failed(checks, 'the local log hash chain is broken', localCount, anchored.count, 0);
    }
    if (!check(checks, 'local-log-length', localCount >= manifest.eventCount, `${localCount} local event(s), anchor covers ${manifest.eventCount}`)) {
      return failed(checks, 'the local log is shorter than the anchor', localCount, anchored.count, 0);
    }
    const localHead = local.all()[manifest.eventCount - 1];
    if (!check(checks, 'local-log-head', localHead?.hash === manifest.headHash, 'local prefix ends at the anchored head hash')) {
      return failed(checks, 'the local log has diverged from the anchor', localCount, anchored.count, 0);
    }
  } catch (error) {
    check(checks, 'local-log-read', false, (error as Error).message);
    return failed(checks, 'the local log cannot be read', 0, anchored.count, 0);
  }

  const retentionToleranceMs = 2_000;
  for (const [label, key, versionId] of [
    ['manifest', receipt.manifestKey, receipt.manifestVersionId],
    ['log', receipt.logKey, receipt.logVersionId],
  ] as const) {
    try {
      const retention = await store.getObjectRetention({ key, versionId });
      const modeOk = retention.mode === manifest.retention.mode;
      const untilOk =
        Math.abs(Date.parse(retention.until) - Date.parse(manifest.retention.until)) <=
        retentionToleranceMs;
      if (!check(checks, `retention-${label}`, modeOk && untilOk, `${retention.mode} until ${retention.until}`)) {
        return failed(checks, `the ${label} object is not under the expected Object Lock retention`, localCount, anchored.count, 0);
      }
    } catch (error) {
      check(checks, `retention-${label}`, false, (error as Error).message);
      return failed(checks, `could not read ${label} Object Lock retention`, localCount, anchored.count, 0);
    }
  }

  return {
    ok: true,
    checks,
    localCount,
    anchoredCount: anchored.count,
    newEvents: localCount - manifest.eventCount,
  };
}
