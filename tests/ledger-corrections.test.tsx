import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PaymentEditor from '../src/features/finance/PaymentEditor';
import ChargeCorrection from '../src/features/visits/ChargeCorrection';
import ServiceEditor from '../src/features/visits/ServiceEditor';
import type { Account, Payment, PaymentMethod, VisitService } from '../src/lib/contracts';
import { createTechnicalData } from '../src/features/technical/types';

const mocks = vi.hoisted(() => ({ command: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ profile: { role: 'owner' } }) }));
vi.mock('../src/lib/api', () => ({
  command: mocks.command,
  queryClient: { invalidateQueries: mocks.invalidateQueries },
  ApiError: class ApiError extends Error {},
}));
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
const account: Account = {
  id: 'account-test',
  visit_id: 'visit-test',
  professional_id: 'owner-test',
  subtotal_known: 30000,
  pending_prices: 0,
  total: 30000,
  paid: 30000,
  balance: 0,
  payment_status: 'paid',
  ready_for_payment: true,
};
const methods: PaymentMethod[] = [
  { id: 'cash', name: 'Efectivo', is_cash: true, active: true, version: 1 },
];
const payment: Payment = {
  id: 'payment-test',
  account_id: account.id,
  amount: 30000,
  paid_at: '2026-09-20T15:00:00Z',
  method_id: 'cash',
  method_name: 'Efectivo',
  is_cash: true,
  reference: '',
  created_by: 'owner-test',
  corrected_by: null,
  correction_of: null,
  reason: null,
  voided_at: null,
  void_reason: null,
};
const service: VisitService = {
  id: 'service-test',
  visit_id: 'visit-test',
  service_id: 'catalog-test',
  version: 3,
  group_id: null,
  name: 'General',
  path: 'Cabello',
  form_type: 'general',
  form_version: 1,
  price_mode: 'custom',
  reference_price: null,
  price: 30000,
  status: 'completed',
  technical: createTechnicalData('general'),
  completed_at: '2026-09-15T12:00:00Z',
};
beforeEach(() => {
  mocks.command.mockReset();
  mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

it('anula un pago completo sin reemplazo y exige motivo', async () => {
  mocks.command.mockResolvedValue({ id: payment.id });
  const close = vi.fn();
  render(
    <PaymentEditor account={account} methods={methods} correction={payment} onClose={close} />,
    { wrapper },
  );
  fireEvent.click(screen.getByLabelText(/Anular el pago completo/));
  expect(screen.queryByLabelText('Importe')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }));
  await screen.findByText('Explica el error de registro.');
  expect(mocks.command).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Motivo de la anulación/), {
    target: { value: 'Cobro duplicado' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(mocks.command).toHaveBeenCalledWith(
    'payment.void',
    { id: payment.id, reason: 'Cobro duplicado' },
    expect.any(String),
  );
});

it('rectifica el importe de una atención finalizada con charge.correct', async () => {
  mocks.command.mockResolvedValue({ id: service.id, version: 4 });
  const close = vi.fn();
  render(<ChargeCorrection service={service} version={3} onClose={close} />, { wrapper });
  fireEvent.change(screen.getByLabelText('Importe correcto'), { target: { value: '35000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar importe' }));
  await screen.findByText('Explica el error del importe.');
  fireEvent.change(screen.getByLabelText(/Motivo del error/), {
    target: { value: 'Precio acordado' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar importe' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(mocks.command).toHaveBeenCalledWith(
    'charge.correct',
    { id: service.id, version: 3, price: 35000, reason: 'Precio acordado' },
    expect.any(String),
  );
});

it('bloquea el precio de una atención valorada incluso al corregir la ficha', async () => {
  render(<ServiceEditor service={service} sales={[]} onDirty={vi.fn()} />, { wrapper });
  await screen.findByLabelText('Observaciones (opcional)');
  fireEvent.click(screen.getByRole('button', { name: 'Corregir ficha' }));
  expect(screen.getByLabelText(/Precio de esta atención/)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Rectificar importe' }));
  expect(await screen.findByLabelText('Importe correcto')).toHaveValue(30000);
});
