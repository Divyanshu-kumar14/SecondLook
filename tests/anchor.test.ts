import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AnchorManifestSchema,
  anchorLog,
  buildAnchorPlan,
  readReceipt,
  verifyAnchor,
  type AnchorObjectRetention,
  type AnchorReceipt,
  type AnchorRetention,
  type AnchorStore,
  type GetAnchorObjectInput,
  type GetAnchorObjectResult,
  type PutAnchorObjectInput,
  type PutAnchorObjectResult,
} from '../server/anchor.js';
import { S3AnchorStore } from '../server/anchor-store.js';
import { EventLog, type NewEventInput } from '../server/log.js';

interface StoredObject {
  key: string;
  body: Buffer;
  versionId: string;
  retention: AnchorRetention;
}

class MemoryAnchorStore implements AnchorStore {
  readonly objects: StoredObject[] = [];
  locked = true;
  failPutKey?: string;
  #nextVersion = 1;

  assertObjectLock(): Promise<void> {
    if (!this.locked) return Promise.reject(new Error('Object Lock is not enabled'));
    return Promise.resolve();
  }

  putObject(input: PutAnchorObjectInput): Promise<PutAnchorObjectResult> {
    if (this.failPutKey !== undefined && input.key.includes(this.failPutKey)) {
      return Promise.reject(new Error(`simulated put failure for ${input.key}`));
    }
    const versionId = `v${this.#nextVersion++}`;
    this.objects.push({
      key: input.key,
      body: Buffer.from(input.body),
      versionId,
      retention: input.retention,
    });
    return Promise.resolve({ versionId, etag: `etag-${versionId}` });
  }

  getObject(input: GetAnchorObjectInput): Promise<GetAnchorObjectResult> {
    const stored = this.find(input);
    if (stored === undefined) return Promise.reject(new Error(`missing object ${input.key}`));
    return Promise.resolve({ body: stored.body, versionId: stored.versionId });
  }

  getObjectRetention(input: GetAnchorObjectInput): Promise<AnchorObjectRetention> {
    const stored = this.find(input);
    if (stored === undefined) return Promise.reject(new Error(`missing object ${input.key}`));
    return Promise.resolve(stored.retention);
  }

  latestFor(suffix: string): StoredObject | undefined {
    return this.objects.filter((entry) => entry.key.endsWith(suffix)).at(-1);
  }

  private find(input: GetAnchorObjectInput): StoredObject | undefined {
    return input.versionId === undefined
      ? this.objects.filter((entry) => entry.key === input.key).at(-1)
      : this.objects.find(
          (entry) => entry.key === input.key && entry.versionId === input.versionId,
        );
  }
}

let dir: string;
let logFile: string;
let receiptFile: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sl-anchor-test-'));
  logFile = path.join(dir, 'events.jsonl');
  receiptFile = path.join(dir, 'anchors.jsonl');
});

const now = new Date('2026-10-21T03:45:00.000Z');

const dose = (amountMg: number, ts: string): NewEventInput => ({
  type: 'dose.recorded',
  payload: { personId: 'p1', medicationId: 'm1', amountMg },
  actorId: 'caregiver-tom',
  actorRole: 'record',
  source: 'caregiver',
  ts,
});

function seedLog(count = 2): EventLog {
  const log = EventLog.open(logFile, 'demo');
  log.append(
    Array.from({ length: count }, (_, index) =>
      dose(500, `2026-10-16T${String(8 + index).padStart(2, '0')}:00:00.000Z`),
    ),
  );
  return log;
}

function options(store: AnchorStore): {
  logFile: string;
  bucket: string;
  region: string;
  prefix: string;
  retentionDays: number;
  retentionMode: 'GOVERNANCE';
  now: Date;
  store: AnchorStore;
  receiptFile: string;
} {
  return {
    logFile,
    bucket: 'test-bucket',
    region: 'ap-southeast-2',
    prefix: 'anchors',
    retentionDays: 30,
    retentionMode: 'GOVERNANCE',
    now,
    store,
    receiptFile,
  };
}

describe('S3 audit anchor · manifest', () => {
  it('builds a manifest from the verified chain head and exact bytes', () => {
    const log = seedLog(2);
    const plan = buildAnchorPlan(options(new MemoryAnchorStore()));

    expect(plan.manifest.eventCount).toBe(2);
    expect(plan.manifest.headHash).toBe(log.all().at(-1)?.hash);
    expect(plan.manifest.fileSha256).toBe(
      buildAnchorPlan(options(new MemoryAnchorStore())).manifest.fileSha256,
    );
    expect(plan.manifest.retention.until).toBe('2026-11-20T03:45:00.000Z');
    expect(plan.logKey).toContain('anchors/2026-10-21T03-45-00-000Z/events.jsonl');
    expect(plan.manifestKey).toContain('anchors/2026-10-21T03-45-00-000Z/manifest.json');
    expect(AnchorManifestSchema.safeParse(plan.manifest).success).toBe(true);
  });

  it('refuses an empty log before making any AWS call', async () => {
    EventLog.open(logFile, 'demo');
    const store = new MemoryAnchorStore();
    await expect(anchorLog(options(store))).rejects.toThrow(/empty/);
    expect(store.objects).toHaveLength(0);
  });

  it('refuses a broken chain before making any AWS call', async () => {
    seedLog(2);
    writeFileSync(logFile, readFileSync(logFile, 'utf8').replace('"amountMg":500', '"amountMg":900'));
    const store = new MemoryAnchorStore();
    await expect(anchorLog(options(store))).rejects.toThrow(/broken chain/);
    expect(store.objects).toHaveLength(0);
  });

  it('refuses a bucket that is not Object-Lock ready before uploading', async () => {
    seedLog(2);
    const store = new MemoryAnchorStore();
    store.locked = false;
    await expect(anchorLog(options(store))).rejects.toThrow(/Object Lock/);
    expect(store.objects).toHaveLength(0);
  });
});

describe('S3 audit anchor · upload and receipt', () => {
  it('uploads the log and manifest with retention, then appends a receipt', async () => {
    seedLog(2);
    const store = new MemoryAnchorStore();
    const receipt = await anchorLog(options(store));

    expect(store.objects).toHaveLength(2);
    const logObject = store.latestFor('events.jsonl');
    const manifestObject = store.latestFor('manifest.json');
    expect(logObject?.retention).toEqual({ mode: 'GOVERNANCE', until: '2026-11-20T03:45:00.000Z' });
    expect(manifestObject?.retention).toEqual(logObject?.retention);
    expect(logObject?.body.toString('utf8').trim().split('\n')).toHaveLength(2);

    expect(receipt.eventCount).toBe(2);
    expect(receipt.logVersionId).toBe('v1');
    expect(receipt.manifestVersionId).toBe('v2');
    expect(receipt.manifestSha256).toMatch(/^[0-9a-f]{64}$/);

    const storedReceipt: AnchorReceipt = readReceipt(receiptFile);
    expect(storedReceipt).toEqual(receipt);
  });

  it('reports which object was already uploaded when the manifest upload fails', async () => {
    seedLog(2);
    const store = new MemoryAnchorStore();
    store.failPutKey = 'manifest.json';
    await expect(anchorLog(options(store))).rejects.toThrow(
      /Uploaded .*events\.jsonl.*version v1.*manifest\.json/,
    );
  });

  it('reads the latest receipt or a specific 1-based line', async () => {
    seedLog(2);
    const store = new MemoryAnchorStore();
    await anchorLog({ ...options(store), now });
    await anchorLog({ ...options(store), now: new Date('2026-10-22T03:45:00.000Z') });

    const latest = readReceipt(receiptFile);
    const first = readReceipt(receiptFile, 1);
    expect(latest.anchoredAt).toBe('2026-10-22T03:45:00.000Z');
    expect(first.anchoredAt).toBe('2026-10-21T03:45:00.000Z');
    expect(() => readReceipt(receiptFile, 3)).toThrow(/out of range/);
  });
});

describe('S3 audit anchor · verification', () => {
  async function anchored(): Promise<{ store: MemoryAnchorStore; receipt: AnchorReceipt }> {
    seedLog(2);
    const store = new MemoryAnchorStore();
    const receipt = await anchorLog(options(store));
    return { store, receipt };
  }

  it('passes on an unchanged local log', async () => {
    const { store, receipt } = await anchored();
    const result = await verifyAnchor({ localLogFile: logFile, receipt, store });
    expect(result.ok).toBe(true);
    expect(result.localCount).toBe(2);
    expect(result.anchoredCount).toBe(2);
    expect(result.newEvents).toBe(0);
    expect(result.checks.every((entry) => entry.ok)).toBe(true);
  });

  it('passes when the local log has grown since the anchor', async () => {
    const { store, receipt } = await anchored();
    EventLog.open(logFile, 'persist').append([dose(250, '2026-10-18T08:00:00.000Z')]);
    const result = await verifyAnchor({ localLogFile: logFile, receipt, store });
    expect(result.ok).toBe(true);
    expect(result.newEvents).toBe(1);
  });

  it('fails when the local log is shorter than the anchored prefix', async () => {
    const { store, receipt } = await anchored();
    const lines = readFileSync(logFile, 'utf8').trim().split('\n');
    writeFileSync(logFile, `${lines.slice(0, -1).join('\n')}\n`);
    const result = await verifyAnchor({ localLogFile: logFile, receipt, store });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/shorter/);
  });

  it('fails when a local event is edited', async () => {
    const { store, receipt } = await anchored();
    writeFileSync(logFile, readFileSync(logFile, 'utf8').replace('"amountMg":500', '"amountMg":900'));
    const result = await verifyAnchor({ localLogFile: logFile, receipt, store });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/local log hash chain/);
  });

  it('fails when a different, internally valid chain is substituted', async () => {
    const { store, receipt } = await anchored();
    const other = path.join(dir, 'other.jsonl');
    EventLog.open(other, 'demo').append([
      dose(250, '2026-10-16T08:00:00.000Z'),
      dose(250, '2026-10-16T09:00:00.000Z'),
    ]);
    const result = await verifyAnchor({ localLogFile: other, receipt, store });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/diverged/);
  });

  it('fails when the anchored log is edited', async () => {
    const { store, receipt } = await anchored();
    const stored = store.latestFor('events.jsonl');
    if (stored === undefined) throw new Error('test setup: anchored log missing');
    stored.body = Buffer.from(
      stored.body.toString('utf8').replace('"amountMg":500', '"amountMg":900'),
      'utf8',
    );
    const result = await verifyAnchor({ localLogFile: logFile, receipt, store });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/anchored log hash chain/);
  });

  it('fails when the anchored manifest is replaced', async () => {
    const { store, receipt } = await anchored();
    const stored = store.latestFor('manifest.json');
    if (stored === undefined) throw new Error('test setup: manifest missing');
    stored.body = Buffer.from('{"version":1}\n', 'utf8');
    const result = await verifyAnchor({ localLogFile: logFile, receipt, store });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match the local receipt/);
  });

  it('fails when Object Lock retention no longer matches', async () => {
    const { store, receipt } = await anchored();
    const stored = store.latestFor('events.jsonl');
    if (stored === undefined) throw new Error('test setup: anchored log missing');
    stored.retention = { mode: 'COMPLIANCE', until: '2026-12-31T00:00:00.000Z' };
    const result = await verifyAnchor({ localLogFile: logFile, receipt, store });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/retention/);
  });

  it('fails when the local log file is missing, without creating it', async () => {
    const { store, receipt } = await anchored();
    const missing = path.join(dir, 'missing.jsonl');
    const result = await verifyAnchor({ localLogFile: missing, receipt, store });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing/);
    expect(() => readFileSync(missing)).toThrow();
  });
});

describe('S3 anchor store mapping', () => {
  function fakeSend(responses: Record<string, unknown>): (command: unknown) => Promise<unknown> {
    return (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor.name;
      const response = responses[name];
      if (response === undefined) return Promise.reject(new Error(`unexpected command ${name}`));
      return Promise.resolve(response);
    };
  }

  it('accepts a versioned bucket with Object Lock enabled', async () => {
    const store = new S3AnchorStore({
      bucket: 'b',
      region: 'ap-southeast-2',
      send: fakeSend({
        GetBucketVersioningCommand: { Status: 'Enabled' },
        GetObjectLockConfigurationCommand: {
          ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' },
        },
      }),
    });
    await expect(store.assertObjectLock()).resolves.toBeUndefined();
  });

  it('rejects a bucket without Object Lock and explains the fix', async () => {
    const store = new S3AnchorStore({
      bucket: 'b',
      region: 'ap-southeast-2',
      send: fakeSend({
        GetBucketVersioningCommand: { Status: 'Enabled' },
        GetObjectLockConfigurationCommand: { ObjectLockConfiguration: {} },
      }),
    });
    await expect(store.assertObjectLock()).rejects.toThrow(/only.*created/);
  });

  it('wraps a missing bucket in a setup error', async () => {
    const missing = Object.assign(new Error('no such bucket'), { name: 'NoSuchBucket' });
    const store = new S3AnchorStore({
      bucket: 'b',
      region: 'ap-southeast-2',
      send: () => Promise.reject(missing),
    });
    await expect(store.assertObjectLock()).rejects.toThrow(/does not exist/);
  });

  it('maps putObject, getObject and retention responses', async () => {
    const body = Buffer.from('events\n', 'utf8');
    const store = new S3AnchorStore({
      bucket: 'b',
      region: 'ap-southeast-2',
      send: fakeSend({
        PutObjectCommand: { VersionId: 'v9', ETag: '"etag"' },
        GetObjectCommand: {
          Body: { transformToByteArray: () => Promise.resolve(body) },
          VersionId: 'v9',
          ETag: '"etag"',
          ContentType: 'application/x-ndjson',
        },
        GetObjectRetentionCommand: {
          Retention: {
            Mode: 'GOVERNANCE',
            RetainUntilDate: new Date('2026-11-20T03:45:00.000Z'),
          },
        },
      }),
    });

    await expect(
      store.putObject({
        key: 'anchors/x/events.jsonl',
        body,
        contentType: 'application/x-ndjson',
        retention: { mode: 'GOVERNANCE', until: '2026-11-20T03:45:00.000Z' },
      }),
    ).resolves.toEqual({ versionId: 'v9', etag: '"etag"' });

    await expect(store.getObject({ key: 'anchors/x/events.jsonl', versionId: 'v9' }))
      .resolves.toMatchObject({ body, versionId: 'v9', etag: '"etag"' });

    await expect(
      store.getObjectRetention({ key: 'anchors/x/events.jsonl', versionId: 'v9' }),
    ).resolves.toEqual({
      mode: 'GOVERNANCE',
      until: '2026-11-20T03:45:00.000Z',
    });
  });

  it('rejects a put response without a version id', async () => {
    const store = new S3AnchorStore({
      bucket: 'b',
      region: 'ap-southeast-2',
      send: fakeSend({ PutObjectCommand: {} }),
    });
    await expect(
      store.putObject({
        key: 'k',
        body: Buffer.from('x'),
        contentType: 'text/plain',
        retention: { mode: 'GOVERNANCE', until: new Date().toISOString() },
      }),
    ).rejects.toThrow(/version id/);
  });
});
