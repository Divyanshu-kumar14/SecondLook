/**
 * Latency benchmark (Phase 3, task P3-12).
 *
 * Budgets:
 *   • p95 server time < 150 ms overall
 *   • find_problems on 500 events < 50 ms
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedDemoLog } from '../fixtures/seed.js';
import { AS_OF, PERSON_ID } from '../fixtures/scenario.js';
import { EventLog, type NewEventInput } from '../server/log.js';
import { fold } from '../server/fold.js';
import { findProblems } from '../server/rules/index.js';
import { findProblemsTool } from '../server/tools/find_problems.js';
import { checkDose } from '../server/tools/check_dose.js';
import { guestContext } from '../server/tools/_shared.js';
import { Store } from '../server/store.js';
import type { EventType } from '../server/schemas/events.js';

const P95_BUDGET_MS = 150;
const FIND_PROBLEMS_BUDGET_MS = 50;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function report(label: string, ms: number[], budget: number): boolean {
  const p50 = percentile(ms, 50);
  const p95 = percentile(ms, 95);
  const pass = p95 < budget;
  console.log(
    `  ${label.padEnd(38)} p50 ${p50.toFixed(2).padStart(7)} ms   ` +
      `p95 ${p95.toFixed(2).padStart(7)} ms   budget ${budget} ms   ${pass ? 'PASS' : 'FAIL'}`,
  );
  return pass;
}

/** Minimal extra scaffolding to reach exactly 500 events. */
const BASE: NewEventInput[] = [
  {
    type: 'person.registered',
    payload: { personId: PERSON_ID, name: 'Robert Alvarez', ageYears: 74, condition: 'CKD stage 3' },
    actorId: 'system:seed',
    actorRole: 'full',
    source: 'clinician',
    ts: '2026-10-11T08:00:00.000Z',
  },
  {
    type: 'caregiver.joined',
    payload: { caregiverId: 'caregiver-tom', name: 'Tom', role: 'record' },
    actorId: 'system:seed',
    actorRole: 'full',
    source: 'clinician',
    ts: '2026-10-11T08:01:00.000Z',
  },
  {
    type: 'med.prescribed',
    payload: {
      personId: PERSON_ID,
      medicationId: 'med-acetaminophen',
      name: 'acetaminophen',
      doseMg: 500,
      form: 'IR',
      frequencyHours: 6,
      maxDailyMg: 3000,
    },
    actorId: 'system:seed',
    actorRole: 'full',
    source: 'document',
    ts: '2026-10-11T08:10:00.000Z',
  },
];

/** Build a 500-event log by topping the scenario up with extra doses. */
function bigLog(events: number): EventLog {
  const dir = mkdtempSync(path.join(tmpdir(), 'sl-bench-'));
  const log = EventLog.open(path.join(dir, 'events.jsonl'), 'demo');

  const extra: NewEventInput[] = [];
  for (let i = 0; i < events - BASE.length; i += 1) {
    const medicationId = i % 2 === 0 ? 'med-acetaminophen' : 'med-ibuprofen';
    extra.push({
      type: 'dose.recorded' as EventType,
      payload: { personId: PERSON_ID, medicationId, amountMg: 500 },
      actorId: `caregiver-${i % 3}`,
      actorRole: 'record' as const,
      source: 'caregiver' as const,
      ts: new Date(Date.UTC(2026, 9, 12, 0, i % 1400)).toISOString(),
    });
  }
  log.append([...BASE, ...extra]);
  return log;
}

function main(): void {
  console.log('[bench] Second Look latency\n');

  const dir = mkdtempSync(path.join(tmpdir(), 'sl-bench-main-'));
  const store = new Store(seedDemoLog(path.join(dir, 'events.jsonl')).log);
  const ctx = guestContext(store, AS_OF, PERSON_ID);

  const ITER = 300;
  const findProblemsMs: number[] = [];
  for (let i = 0; i < ITER; i += 1) {
    const t = performance.now();
    findProblems(store.careState(), AS_OF);
    findProblemsMs.push(performance.now() - t);
  }

  const toolMs: number[] = [];
  for (let i = 0; i < ITER; i += 1) {
    const t = performance.now();
    findProblemsTool(ctx, { personId: PERSON_ID });
    toolMs.push(performance.now() - t);
  }

  const checkMs: number[] = [];
  for (let i = 0; i < ITER; i += 1) {
    const t = performance.now();
    checkDose(ctx, { medicationId: 'med-ibuprofen' });
    checkMs.push(performance.now() - t);
  }

  // 500-event log.
  const big = new Store(bigLog(500));
  const bigState = fold(big.events());
  const bigMs: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const t = performance.now();
    findProblems(bigState, AS_OF);
    bigMs.push(performance.now() - t);
  }

  const foldMs: number[] = [];
  const events = big.events();
  for (let i = 0; i < 100; i += 1) {
    const t = performance.now();
    fold(events);
    foldMs.push(performance.now() - t);
  }

  console.log(`  ${ITER} iterations on the ${store.events().length}-event demo log;`);
  console.log(`  100 iterations on a ${events.length}-event log.\n`);

  const a = report('find_problems (rules only)', findProblemsMs, P95_BUDGET_MS);
  const b = report('find_problems (full tool path)', toolMs, P95_BUDGET_MS);
  const c = report('check_dose (projects a dose)', checkMs, P95_BUDGET_MS);
  const d = report('find_problems on 500 events', bigMs, FIND_PROBLEMS_BUDGET_MS);
  const e = report('cold fold on 500 events', foldMs, 25);

  const ok = a && b && c && d && e;
  console.log(`\n[bench] ${ok ? 'ALL BUDGETS MET' : 'BUDGET EXCEEDED'}`);
  process.exit(ok ? 0 : 1);
}

main();