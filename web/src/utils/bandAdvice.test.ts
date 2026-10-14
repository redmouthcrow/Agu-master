import { describe, expect, it } from 'vitest';
import { levelMateriallyChanged, shouldKeepCachedBandAdvice } from './bandAdvice';

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
