/**
 * Anchor the current event log in S3 with Object Lock retention.
 *
 * This is an operator command, not part of the server process. It never runs
 * on `npm start`, and the base demo needs no AWS credentials.
 *
 *   npm run anchor -- --bucket <name> --region ap-southeast-2
 *   npm run anchor -- --dry-run
 */
import { parseArgs } from 'node:util';
import { config } from '../server/config.js';
import { anchorLog, buildAnchorPlan, type AnchorRetentionMode } from '../server/anchor.js';
import { S3AnchorStore } from '../server/anchor-store.js';

const USAGE = `Usage: npm run anchor -- [options]

  --bucket <name>         S3 bucket with Object Lock enabled (or SL_ANCHOR_BUCKET)
  --region <region>       AWS region (default: SL_ANCHOR_REGION, AWS_REGION, us-east-1)
  --prefix <prefix>       S3 key prefix (default: anchors)
  --retention-days <n>    Object Lock retention in days (default: 30)
  --mode <mode>           GOVERNANCE or COMPLIANCE (default: GOVERNANCE)
  --log <path>            Event log (default: SL_LOG_FILE, .data/events.jsonl)
  --receipt <path>        Local receipt file (default: .data/anchors.jsonl)
  --dry-run               Verify the log and print the manifest without calling AWS
  -h, --help              Show this help
`;

function parseInteger(raw: string, label: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}; got "${raw}".`);
  }
  return value;
}

function parseMode(raw: string): AnchorRetentionMode {
  const value = raw.toUpperCase();
  if (value !== 'GOVERNANCE' && value !== 'COMPLIANCE') {
    throw new Error(`Mode must be GOVERNANCE or COMPLIANCE; got "${raw}".`);
  }
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      bucket: { type: 'string' },
      region: { type: 'string' },
      prefix: { type: 'string' },
      'retention-days': { type: 'string' },
      mode: { type: 'string' },
      log: { type: 'string' },
      receipt: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help === true) {
    console.log(USAGE);
    return;
  }

  const dryRun = values['dry-run'] === true;
  const bucket =
    values.bucket ??
    process.env.SL_ANCHOR_BUCKET ??
    (dryRun ? 'example-bucket' : undefined);
  if (bucket === undefined || bucket.trim() === '') {
    throw new Error('S3 bucket is required. Pass --bucket or set SL_ANCHOR_BUCKET.');
  }

  const region =
    values.region ??
    process.env.SL_ANCHOR_REGION ??
    process.env.AWS_REGION ??
    'us-east-1';
  const prefix = values.prefix ?? process.env.SL_ANCHOR_PREFIX ?? 'anchors';
  const retentionDays = parseInteger(
    values['retention-days'] ?? process.env.SL_ANCHOR_RETENTION_DAYS ?? '30',
    'retention-days',
    1,
    3650,
  );
  const retentionMode = parseMode(
    values.mode ?? process.env.SL_ANCHOR_RETENTION_MODE ?? 'GOVERNANCE',
  );
  const logFile = values.log ?? config.logFile;
  const receiptFile = values.receipt ?? process.env.SL_ANCHOR_RECEIPT ?? '.data/anchors.jsonl';
  const now = new Date();

  if (dryRun) {
    const plan = buildAnchorPlan({
      logFile,
      bucket,
      region,
      prefix,
      retentionDays,
      retentionMode,
      now,
    });
    console.log(`[anchor] dry run — no S3 calls were made.`);
    console.log(JSON.stringify(plan.manifest, null, 2));
    console.log(`[anchor] would upload s3://${bucket}/${plan.logKey}`);
    console.log(`[anchor] would upload s3://${bucket}/${plan.manifestKey}`);
    console.log(`[anchor] would append the receipt to ${receiptFile}`);
    return;
  }

  const store = new S3AnchorStore({ bucket, region });
  const receipt = await anchorLog({
    logFile,
    bucket,
    region,
    prefix,
    retentionDays,
    retentionMode,
    now,
    store,
    receiptFile,
  });

  console.log(
    `[anchor] log: ${logFile} (${receipt.eventCount} events, head ${receipt.headHash.slice(0, 12)}…)`,
  );
  console.log(
    `[anchor] s3://${receipt.bucket}/${receipt.logKey} (version ${receipt.logVersionId})`,
  );
  console.log(
    `[anchor] s3://${receipt.bucket}/${receipt.manifestKey} (version ${receipt.manifestVersionId})`,
  );
  console.log(`[anchor] receipt: ${receiptFile}`);
  console.log(
    `[anchor] retention: ${receipt.retention.mode} until ${receipt.retention.until}`,
  );
}

main().catch((error: unknown) => {
  console.error(`[anchor] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
