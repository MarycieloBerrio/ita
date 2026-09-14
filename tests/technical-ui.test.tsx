import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import TechnicalForm from '../src/features/technical/TechnicalForm';
import { createTechnicalData, type TechnicalData } from '../src/features/technical/types';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function Editor() {
  const [data, setData] = useState<TechnicalData>(createTechnicalData('color'));
  return (
    <>
      <TechnicalForm kind="color" value={data} onChange={setData} />
      <output data-testid="stored">{JSON.stringify(data)}</output>
    </>
  );
}

describe('interacción del plano', () => {
  it('ofrece cinco vistas y exactamente cuatro patrones con texto libre', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    expect(screen.getByRole('heading', { name: 'Frontal' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Ampliar vista/ })).toHaveLength(5);
    await user.selectOptions(screen.getByLabelText('Seleccionar zona'), 'z01');
    const fieldset = screen.getByRole('group', { name: 'División · elige una opción' });
    expect(within(fieldset).getAllByRole('radio')).toHaveLength(4);
    expect(document.querySelector('input[type="color"]')).toBeNull();
    await user.click(within(fieldset).getByLabelText('Zigzag diagonal'));
    await user.type(screen.getByLabelText('Color', { exact: true }), '8.31 + fórmula libre');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByTestId('stored').textContent).toContain('"pattern":"diagonal-zigzag"');
    expect(screen.getByTestId('stored').textContent).toContain('8.31 + fórmula libre');
    expect(
      screen.getAllByRole('button', { name: 'Zona 01, Zigzag diagonal, 8.31 + fórmula libre' }),
    ).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Zona 02, Sin trabajar' })).toHaveLength(3);
  });

  it('cancelar mantiene el valor aplicado y protege cambios al abrir otra zona', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.selectOptions(screen.getByLabelText('Seleccionar zona'), 'z01');
    await user.click(screen.getByLabelText('Recto', { exact: true }));
    await user.type(screen.getByLabelText('Color', { exact: true }), 'Confirmado');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await user.clear(screen.getByLabelText('Color', { exact: true }));
    await user.type(screen.getByLabelText('Color', { exact: true }), 'Borrador sin aplicar');
    await user.selectOptions(screen.getByLabelText('Seleccionar zona'), 'z02');
    expect(screen.getByRole('alert')).toHaveTextContent('Aplica o cancela');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.selectOptions(screen.getByLabelText('Seleccionar zona'), 'z01');
    expect(screen.getByLabelText('Color', { exact: true })).toHaveValue('Confirmado');
    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(screen.getByTestId('stored').textContent).toContain('"zones":{}');
  });

  it('avisa del límite sin recortar ni aplicar la descripción', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.selectOptions(screen.getByLabelText('Seleccionar zona'), 'z01');
    await user.click(screen.getByLabelText('Recto', { exact: true }));
    fireEvent.change(screen.getByLabelText('Color', { exact: true }), {
      target: { value: 'a'.repeat(251) },
    });
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('250');
    expect(screen.getByLabelText('Color', { exact: true })).toHaveValue('a'.repeat(251));
    expect(screen.getByTestId('stored').textContent).toContain('"zones":{}');
  });

  it('permite seleccionar las zonas del SVG con teclado', () => {
    render(<Editor />);
    fireEvent.keyDown(screen.getAllByRole('button', { name: 'Zona 01, Sin trabajar' })[0], {
      key: 'Enter',
    });
    expect(screen.getByLabelText('Seleccionar zona')).toHaveValue('z01');
  });

  it('modo de consulta permite leer sin modificar', async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(
      <TechnicalForm
        kind="color"
        value={createTechnicalData('color')}
        onChange={change}
        readOnly
      />,
    );
    await user.selectOptions(screen.getByLabelText('Seleccionar zona'), 'z01');
    expect(screen.queryByRole('button', { name: 'Aplicar' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Procedimiento realizado')).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
  });

  it('keratina no renderiza plano y General no exige campos capilares', () => {
    const { rerender } = render(
      <TechnicalForm kind="keratin" value={createTechnicalData('keratin')} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /Ampliar/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del producto / sistema')).toBeInTheDocument();
    rerender(
      <TechnicalForm kind="general" value={createTechnicalData('general')} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Sin materiales')).toBeChecked();
    expect(screen.queryByLabelText('Nombre del producto / sistema')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Procedimiento realizado')).not.toBeInTheDocument();
  });
});
