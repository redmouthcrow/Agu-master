import { describe, expect, it } from 'vitest';
import { parseSinaFields, parseTencentFields } from './quoteJsonp';

/** 40-field Tencent row: [1]名称 [3]现价 [4]昨收 [5]今开 [6]量 [33]高 [34]低 [37]额。 */
function tencentRaw(fields: Partial<Record<number, string>>): string {
  const arr = new Array(40).fill('0');
  Object.entries(fields).forEach(([i, v]) => {
    arr[Number(i)] = v as string;
  });
  return arr.join('~');
}

describe('parseTencentFields', () => {
  it('提取今开与其余字段', () => {
    const raw = tencentRaw({
      1: '贵州茅台',
      3: '1700.00',
      4: '1690.00',
      5: '1705.00',
      6: '12345',
      33: '1710.00',
      34: '1685.00',
      37: '21000000',
    });
    const snap = parseTencentFields('sh600519', raw);
    expect(snap).not.toBeNull();
    expect(snap!.open).toBe(1705);
    expect(snap!.price).toBe(1700);
    expect(snap!.prevClose).toBe(1690);
    expect(snap!.high).toBe(1710);
    expect(snap!.low).toBe(1685);
    expect(snap!.volume).toBe(12345);
    expect(snap!.amount).toBe(21000000);
    expect(snap!.name).toBe('贵州茅台');
    expect(snap!.changePct).toBeCloseTo(((1700 - 1690) / 1690) * 100, 6);
  });

  it('今开缺失（"--"）→ open 为 null，其余字段正常', () => {
    const raw = tencentRaw({ 1: '某股', 3: '10.00', 4: '10.00', 5: '--' });
    const snap = parseTencentFields('sh600000', raw);
    expect(snap!.open).toBeNull();
    expect(snap!.price).toBe(10);
  });

  it('字段不足 35 → null', () => {
    expect(parseTencentFields('sh600519', 'a~b~c')).toBeNull();
    expect(parseTencentFields('sh600519', undefined)).toBeNull();
  });
});

describe('parseSinaFields', () => {
  it('提取今开（[1]）与其余字段', () => {
    const raw = '贵州茅台,1705.00,1690.00,1700.00,1710.00,1685.00,0,0,12345,21000000';
    const snap = parseSinaFields('sh600519', raw);
    expect(snap).not.toBeNull();
    expect(snap!.open).toBe(1705);
    expect(snap!.prevClose).toBe(1690);
    expect(snap!.price).toBe(1700);
    expect(snap!.high).toBe(1710);
    expect(snap!.low).toBe(1685);
  });

  it('FAILED 响应或字段不足 → null', () => {
    expect(parseSinaFields('sh600519', 'FAILED')).toBeNull();
    expect(parseSinaFields('sh600519', 'a,b,c')).toBeNull();
    expect(parseSinaFields('sh600519', undefined)).toBeNull();
  });
});
