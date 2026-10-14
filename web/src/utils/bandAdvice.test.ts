import { describe, expect, it } from 'vitest';
import {
  levelMateriallyChanged,
  shouldKeepCachedBandAdvice,
  shouldKeepCachedLongAdvice,
} from './bandAdvice';

describe('levelMateriallyChanged', () => {
  it('missing values count as changed', () => {
    expect(levelMateriallyChanged(undefined, 6.12)).toBe(true);
    expect(levelMateriallyChanged(6.12, undefined)).toBe(true);
  });

  it('zero denominator counts as changed', () => {
    expect(levelMateriallyChanged(0, 6.12)).toBe(true);
  });

  it('drift within 0.5% is stable', () => {
    // 6.12 → 6.14 = 0.33%
    expect(levelMateriallyChanged(6.12, 6.14)).toBe(false);
  });

  it('drift beyond 0.5% is changed', () => {
    // 6.12 → 6.16 = 0.65%
    expect(levelMateriallyChanged(6.12, 6.16)).toBe(true);
  });
});

describe('shouldKeepCachedBandAdvice', () => {
  const base = {
    cachedBand: '接近阻力位不追高',
    cachedBandDate: '2026-10-14',
    today: '2026-10-14',
    cachedSupport: 6.12,
    cachedResistance: 6.85,
    newSupport: 6.13,
    newResistance: 6.86,
  };

  it('keeps today\'s band while levels are stable', () => {
    expect(shouldKeepCachedBandAdvice(base)).toBe(true);
  });

  it('no cached band → accept fresh', () => {
    expect(shouldKeepCachedBandAdvice({ ...base, cachedBand: undefined })).toBe(false);
  });

  it('yesterday\'s band → accept fresh', () => {
    expect(shouldKeepCachedBandAdvice({ ...base, cachedBandDate: '2026-10-13' })).toBe(false);
  });

  it('material support move → accept fresh', () => {
    expect(shouldKeepCachedBandAdvice({ ...base, newSupport: 6.3 })).toBe(false);
  });

  it('material resistance move → accept fresh', () => {
    expect(shouldKeepCachedBandAdvice({ ...base, newResistance: 7.1 })).toBe(false);
  });
});

describe('shouldKeepCachedLongAdvice (v2.14.0 cross-day freeze)', () => {
  const longBase = {
    cachedLong: '中期趋势未破坏，继续持有；仅当跌破 6.12 时减配',
    cachedSupport: 6.12,
    cachedResistance: 6.85,
    newSupport: 6.13,
    newResistance: 6.84,
    price: 6.5,
  };

  it('levels stable + price inside band → keep across days', () => {
    expect(shouldKeepCachedLongAdvice(longBase)).toBe(true);
  });

  it('no cached long advice → accept fresh', () => {
    expect(shouldKeepCachedLongAdvice({ ...longBase, cachedLong: undefined })).toBe(false);
  });

  it('material support move → accept fresh', () => {
    expect(shouldKeepCachedLongAdvice({ ...longBase, newSupport: 6.3 })).toBe(false);
  });

  it('material resistance move → accept fresh', () => {
    expect(shouldKeepCachedLongAdvice({ ...longBase, newResistance: 7.1 })).toBe(false);
  });

  it('price broke below support → accept fresh (exit condition may have fired)', () => {
    expect(shouldKeepCachedLongAdvice({ ...longBase, price: 6.0 })).toBe(false);
  });

  it('price broke above resistance → accept fresh', () => {
    expect(shouldKeepCachedLongAdvice({ ...longBase, price: 6.9 })).toBe(false);
  });

  it('price on the exact level boundary → keep (未穿出)', () => {
    expect(shouldKeepCachedLongAdvice({ ...longBase, price: 6.12 })).toBe(true);
    expect(shouldKeepCachedLongAdvice({ ...longBase, price: 6.85 })).toBe(true);
  });

  it('missing price → keep while levels stable', () => {
    expect(shouldKeepCachedLongAdvice({ ...longBase, price: null })).toBe(true);
    expect(shouldKeepCachedLongAdvice({ ...longBase, price: undefined })).toBe(true);
  });

  it('missing cached levels → accept fresh (fail open)', () => {
    expect(
      shouldKeepCachedLongAdvice({
        cachedLong: '继续持有',
        newSupport: 6.12,
        newResistance: 6.85,
        price: 6.5,
      }),
    ).toBe(false);
  });
});
