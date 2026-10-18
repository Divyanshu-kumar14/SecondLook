import { describe, expect, it } from 'vitest';
import { classesOf, drugClass, DRUG_CLASSES, formularyEntries, isKnownDrug } from '../server/formulary.js';

describe('P1-8 · synthetic formulary', () => {
  it('maps the two fixture drugs correctly', () => {
    expect(drugClass('ibuprofen')).toBe('NSAID');
    expect(drugClass('acetaminophen')).toBe('ANALGESIC');
  });

  it('has NSAID present, since R4 depends on it', () => {
    expect(DRUG_CLASSES).toContain('NSAID');
    expect(formularyEntries()).toHaveProperty('ibuprofen', 'NSAID');
  });

  it('normalises case and surrounding whitespace', () => {
    expect(drugClass('  Ibuprofen ')).toBe('NSAID');
    expect(drugClass('IBUPROFEN')).toBe('NSAID');
  });

  it('returns undefined for an unknown drug rather than guessing', () => {
    // Guessing a class would be a clinical claim the system must not make.
    expect(drugClass('synthetic-unknown')).toBeUndefined();
    expect(isKnownDrug('synthetic-unknown')).toBe(false);
    expect(isKnownDrug('ibuprofen')).toBe(true);
  });

  it('covers roughly a dozen drugs and every declared class', () => {
    const entries = formularyEntries();
    const size = Object.keys(entries).length;
    expect(size).toBeGreaterThanOrEqual(12);
    // Every declared class must be reachable from at least one drug.
    for (const cls of DRUG_CLASSES) {
      expect(Object.values(entries), `class ${cls} has no drug`).toContain(cls);
    }
  });

  it('de-duplicates classes across a drug list and skips unknowns', () => {
    expect(classesOf(['ibuprofen', 'naproxen', 'acetaminophen'])).toEqual(['NSAID', 'ANALGESIC']);
    expect(classesOf(['ibuprofen', 'unknown-drug'])).toEqual(['NSAID']);
    expect(classesOf([])).toEqual([]);
  });

  it('exposes an immutable formulary', () => {
    expect(Object.isFrozen(formularyEntries())).toBe(true);
  });
});