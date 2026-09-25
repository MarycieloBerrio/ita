import { expect, it } from 'vitest';
import { financeCsv } from '../src/features/finance/reporting';
import type { FinanceResult } from '../src/lib/contracts';

it('el CSV no duplica el nombre del cargo ni anuncia estados que el servidor no envía', () => {
  const report = {
    from: '2026-09-01',
    to: '2026-09-30',
    generated_at: '2026-09-24T12:00:00Z',
    charges: [
      {
        id: 'c1',
        account_id: 'a1',
        kind: 'service',
        name: 'Cepillado',
        path: 'Cabello / Cepillado',
        amount: 30000,
        confirmed_at: '2026-09-24T12:00:00Z',
      },
    ],
    payments: [
      {
        id: 'p2',
        account_id: 'a1',
        paid_at: '2026-09-24T12:00:00Z',
        reference: '',
        method_name: 'Efectivo',
        amount: 30000,
        corrected_by: null,
        correction_of: 'p1',
      },
    ],
    expenses: [],
    accounts: [],
    cash_sessions: [],
    cash_movements: [],
    totals: {
      charges: 30000,
      collected: 30000,
      expenses: 0,
      operating_flow: 30000,
      balance: 0,
      pending_prices: 0,
    },
  } as unknown as FinanceResult;
  const csv = financeCsv(report);
  expect(csv).toContain('"Cabello / Cepillado"');
  expect(csv).not.toContain('Cepillado / Cabello');
  expect(csv).not.toContain('Rectificado');
  expect(csv).toContain('"Rectifica a"');
  expect(csv).toContain('"Válido";"p1"');
});
