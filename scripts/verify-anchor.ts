/**
 * Verify that the local event log still contains the anchored prefix held in
 * S3 Object Lock.
 *
 *   npm run verify-anchor
 *   npm run verify-anchor -- --receipt .data/anchors.jsonl --line 2
 */
import { parseArgs } from 'node:util';
import { readReceipt, verifyAnchor } from '../server/anchor.js';
import { S3AnchorStore } from '../server/anchor-store.js';

const USAGE = `Usage: npm run verify-anchor -- [options]

  --receipt <path>   Local anchor receipt (default: .data/anchors.jsonl)
  --line <n>         1-based receipt line to verify (default: the latest)
  --log <path>       Local event log (default: the path recorded in the receipt)
  --bucket <name>    Override the bucket recorded in the receipt
  --region <region>  Override the region recorded in the receipt
  -h, --help         Show this help
`;

function parseLine(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--line must be a positive integer; got "${raw}".`);
  }
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      receipt: { type: 'string' },
      line: { type: 'string' },
      log: { type: 'string' },
      bucket: { type: 'string' },
      region: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help === true) {
    console.log(USAGE);
    return;
  }

  const receiptFile =
    values.receipt ?? process.env.SL_ANCHOR_RECEIPT ?? '.data/anchors.jsonl';
  const receipt = readReceipt(
    receiptFile,
    values.line === undefined ? undefined : parseLine(values.line),
  );
  const logFile = values.log ?? receipt.logFile;
  const bucket = values.bucket ?? receipt.bucket;
  const region = values.region ?? receipt.region;
  const store = new S3AnchorStore({ bucket, region });

  const result = await verifyAnchor({ localLogFile: logFile, receipt, store });

  for (const entry of result.checks) {
    console.log(
      `[verify-anchor] ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}: ${entry.detail}`,
    );
  }

  if (!result.ok) {
    console.error(`[verify-anchor] FAIL — ${result.reason ?? 'verification failed'}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[verify-anchor] PASS — anchored ${result.anchoredCount} events; local log has ` +
      `${result.localCount} (${result.newEvents} event(s) appended since the anchor).`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `[verify-anchor] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
});
