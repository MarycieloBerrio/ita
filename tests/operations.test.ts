import { describe, expect, it } from 'vitest';
import { categoryContains, categoryPath, integerAmount } from '../src/features/catalog/operations';
import {
  bogotaInput,
  csvCell,
  fromBogotaInput,
  paymentTimestamp,
  periodRange,
} from '../src/features/finance/reporting';
import type { Category } from '../src/lib/contracts';

const categories: Category[] = [
  { id: 'root', name: 'Depilación', parent_id: null },
  { id: 'wax', name: 'Con cera', parent_id: 'root' },
  { id: 'razor', name: 'Con cuchilla', parent_id: 'root' },
  { id: 'other', name: 'Peluquería', parent_id: null },
].map((item) => ({
  ...item,
  kind: 'service',
  active: true,
  version: 1,
  sort_order: 0,
  default_price_mode: null,
}));

describe('Operaciones: importes y clasificación', () => {
  it('mantiene pesos exactos y distingue precio pendiente de cero', () => {
    expect(integerAmount('230000')).toBe(230000);
    expect(integerAmount('0', true)).toBe(0);
    for (const invalid of ['', '0', '-1', '1.5', '1,000', '1e3', '9000000000001'])
      expect(() => integerAmount(invalid)).toThrow();
  });
  it('incluye descendientes sin confundir métodos hermanos y termina ante ciclos', () => {
    expect(categoryPath(categories, 'wax')).toBe('Depilación / Con cera');
    expect(categoryContains(categories, 'root', 'wax')).toBe(true);
    expect(categoryContains(categories, 'wax', 'razor')).toBe(false);
    expect(categoryContains(categories, 'root', 'other')).toBe(false);
    expect(categoryContains(categories, '', null)).toBe(true);
    const cycle = categories.map((item) =>
      item.id === 'root' ? { ...item, parent_id: 'wax' } : item,
    );
    expect(categoryContains(cycle, 'missing', 'wax')).toBe(false);
    expect(categoryPath(cycle, 'wax')).toBe('Depilación / Con cera');
  });
});

describe('Fechas financieras de Bogotá', () => {
  it('no depende del huso horario del dispositivo y cruza medianoche', () => {
    expect(bogotaInput('2026-10-01T03:30:00Z')).toBe('2026-09-30T22:30');
    expect(fromBogotaInput('2026-09-30T22:30')).toBe('2026-10-01T03:30:00.000Z');
    expect(fromBogotaInput('2024-02-29T00:00')).toBe('2024-02-29T05:00:00.000Z');
  });
  it('rechaza fechas que Date normaliza silenciosamente', () => {
    for (const invalid of [
      '2026-02-29T12:00',
      '2026-04-31T12:00',
      '2026-12-01T24:00',
      '2026-13-01T10:00',
      '',
    ])
      expect(() => fromBogotaInput(invalid)).toThrow();
  });
  it('conserva segundos y fracciones al rectificar sin cambiar la fecha, y al cobrar tras apertura', () => {
    const original = '2026-09-12T18:45:37.985Z';
    expect(paymentTimestamp(bogotaInput(original, true), original)).toBe(original);
    expect(paymentTimestamp('2026-09-12T13:45', '2026-09-12T18:45:00.985Z')).toBe(
      '2026-09-12T18:45:00.985Z',
    );
    expect(paymentTimestamp('2026-09-12T13:46:40', original)).toBe('2026-09-12T18:46:40.000Z');
    expect(() => fromBogotaInput('2026-09-12T13:46:60')).toThrow();
  });
  it('calcula semana lunes-domingo y meses bisiestos y cambio de año', () => {
    expect(periodRange('2026-01-01', 'week')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
    expect(periodRange('2024-02-29', 'month')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(periodRange('2025-02-28', 'month')).toEqual({ from: '2025-02-01', to: '2025-02-28' });
    expect(periodRange('2026-09-30', 'day')).toEqual({ from: '2026-09-30', to: '2026-09-30' });
  });
});

describe('Exportación CSV', () => {
  it('escapa comillas, delimitadores y líneas; neutraliza fórmulas de texto', () => {
    expect(csvCell('Color; "tono"\nlibre')).toBe('"Color; ""tono""\nlibre"');
    for (const value of ['=1+1', '+SUM(A1)', '-3+2', '@SUM(A1)', '\t =1+1', '\r\n@foo'])
      expect(csvCell(value)).toBe(`"'${value}"`);
    expect(csvCell(-1000)).toBe('"-1000"');
    expect(csvCell(null)).toBe('""');
  });
});
