/**
 * Synthetic formulary (Phase 1, task P1-8).
 *
 * PRD §6.3: the system asserts NO clinical knowledge of its own beyond this
 * small static drug -> class map. Barred classes come from a sourced
 * `plan.constraint_set` event, not from hard-coded clinical judgement.
 *
 * These are synthetic names/entries for a demo. Nothing here is dosing advice.
 */

export const DRUG_CLASSES = [
  'NSAID',
  'ANALGESIC',
  'OPIOID',
  'ANTIHYPERTENSIVE',
  'ACE_INHIBITOR',
  'SGLT2_INHIBITOR',
  'INSULIN',
  'STATIN',
  'PPI',
  'ANTICOAGULANT',
  'ANTIBIOTIC',
  'BENZODIAZEPINE',
] as const;

export type DrugClass = (typeof DRUG_CLASSES)[number];

/** Drug (lowercase) -> class. ~12 synthetic entries covering every class. */
const FORMULARY: Readonly<Record<string, DrugClass>> = Object.freeze({
  ibuprofen: 'NSAID',
  naproxen: 'NSAID',
  diclofenac: 'NSAID',
  celecoxib: 'NSAID',
  ketorolac: 'NSAID',

  acetaminophen: 'ANALGESIC',
  paracetamol: 'ANALGESIC',
  tramadol: 'ANALGESIC',

  oxycodone: 'OPIOID',

  amlodipine: 'ANTIHYPERTENSIVE',
  losartan: 'ANTIHYPERTENSIVE',

  lisinopril: 'ACE_INHIBITOR',
  dapagliflozin: 'SGLT2_INHIBITOR',
  'insulin-glargine': 'INSULIN',
  atorvastatin: 'STATIN',
  omeprazole: 'PPI',
  apixaban: 'ANTICOAGULANT',
  amoxicillin: 'ANTIBIOTIC',
  diazepam: 'BENZODIAZEPINE',
});

export function normalizeDrug(name: string): string {
  return name.trim().toLowerCase();
}

/** Returns undefined for an unknown drug. Callers must NOT guess. */
export function drugClass(name: string): DrugClass | undefined {
  return FORMULARY[normalizeDrug(name)];
}

export function isKnownDrug(name: string): boolean {
  return drugClass(name) !== undefined;
}

export function classesOf(names: readonly string[]): DrugClass[] {
  const out = new Set<DrugClass>();
  for (const name of names) {
    const cls = drugClass(name);
    if (cls) out.add(cls);
  }
  return [...out];
}

/** Exposed for tests and the README; never used to infer dosing. */
export function formularyEntries(): Readonly<Record<string, DrugClass>> {
  return FORMULARY;
}