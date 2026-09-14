import { describe, expect, it } from 'vitest';
import {
  colorMapSchema,
  copyTechnicalData,
  createTechnicalData,
  PATTERNS,
  technicalDataSchema,
  updateMapZone,
  validateTechnicalCompletion,
  type ColorData,
  type KeratinData,
} from '../src/features/technical/types';
import { exportColorMapSvg, getTemplate, TEMPLATE_V1 } from '../src/features/technical/template';

function color(): ColorData {
  const data = createTechnicalData('color') as ColorData;
  data.procedure = 'Diagnóstico, preparación y acabado.\nResultado documentado sin tinte.';
  data.decolorants.none = true;
  data.oxidants.none = true;
  data.tints.none = true;
  data.finalizers.none = true;
  data.saleDisposition = 'none';
  return data;
}

describe('fichas técnicas persistentes', () => {
  it.each(PATTERNS)('recupera $label y la descripción libre sin un color digital', ({ id }) => {
    const ficha = color();
    ficha.map = updateMapZone(ficha.map, 'z01', {
      pattern: id,
      patternVersion: 1,
      colorText: 'Mezcla libre 7.31 + 9/0, 1:2; revisar después.',
    });
    const reopened = technicalDataSchema.parse(JSON.parse(JSON.stringify(ficha))) as ColorData;
    expect(reopened).toEqual(ficha);
    expect(reopened.map.zones.z01?.pattern).toBe(id);
    expect(validateTechnicalCompletion(reopened)).toEqual([]);
  });

  it('conserva dos servicios Color independientes y la ficha General al alternar', () => {
    const first = color();
    const second = color();
    const general = createTechnicalData('general');
    first.map = updateMapZone(first.map, 'z01', {
      pattern: 'straight',
      patternVersion: 1,
      colorText: 'Primer servicio',
    });
    second.map = updateMapZone(second.map, 'z01', {
      pattern: 'zigzag',
      patternVersion: 1,
      colorText: 'Segundo servicio',
    });
    const visit = JSON.parse(JSON.stringify({ services: [first, general, second] })) as {
      services: unknown[];
    };
    const result = visit.services.map((service) => technicalDataSchema.parse(service));
    expect((result[0] as ColorData).map.zones.z01?.colorText).toBe('Primer servicio');
    expect((result[2] as ColorData).map.zones.z01?.colorText).toBe('Segundo servicio');
    expect(result[1]).toEqual(general);
  });

  it('solo una zona lógica actualiza sus superficies y nunca el lado opuesto', () => {
    const first = color().map;
    const map = updateMapZone(first, 'z01', {
      pattern: 'straight',
      patternVersion: 1,
      colorText: 'Izquierdo',
    });
    expect(
      TEMPLATE_V1.filter((view) => view.surfaces.some((surface) => surface.zone === 'z01')).map(
        (view) => view.id,
      ),
    ).toEqual(['left', 'front', 'top']);
    expect(
      TEMPLATE_V1.find((view) => view.id === 'right')?.surfaces.every(
        (surface) => !map.zones[surface.zone],
      ),
    ).toBe(true);
    expect(map.zones.z02).toBeUndefined();
    expect(first.zones.z01).toBeUndefined();
  });

  it('conserva la versión histórica y rechaza reconstrucciones con versiones desconocidas', () => {
    const map = color().map;
    expect(getTemplate(map)).toBe(TEMPLATE_V1);
    const unknown = { ...map, templateVersion: 2 };
    expect(colorMapSchema.safeParse(unknown).success).toBe(false);
    expect(() => getTemplate(unknown as unknown as typeof map)).toThrow(/versión/);
    expect(() =>
      updateMapZone({ ...map, templateVersion: 2 } as unknown as typeof map, 'z01', null),
    ).toThrow();
    expect(
      colorMapSchema.safeParse({
        ...map,
        zones: { z01: { pattern: 'zigzag', patternVersion: 2, colorText: 'Texto' } },
      }).success,
    ).toBe(false);
  });

  it('limpia una zona sin borrar el resto de la ficha', () => {
    let map = updateMapZone(color().map, 'z01', {
      pattern: 'straight',
      patternVersion: 1,
      colorText: 'Uno',
    });
    map = updateMapZone(map, 'z02', { pattern: 'zigzag', patternVersion: 1, colorText: 'Dos' });
    const cleared = updateMapZone(map, 'z01', null);
    expect(cleared.zones.z01).toBeUndefined();
    expect(cleared.zones.z02?.colorText).toBe('Dos');
    expect(map.zones.z01).toBeDefined();
  });

  it('no acepta quinta opción, zona inexistente, texto vacío ni descripción desbordada', () => {
    for (const zone of [
      { pattern: 'none', patternVersion: 1, colorText: 'Texto' },
      { pattern: 'straight', patternVersion: 1, colorText: ' ' },
      { pattern: 'straight', patternVersion: 1, colorText: 'a'.repeat(251) },
    ])
      expect(colorMapSchema.safeParse({ ...color().map, zones: { z01: zone } }).success).toBe(
        false,
      );
    expect(colorMapSchema.safeParse({ ...color().map, zones: { z99: {} } }).success).toBe(false);
  });

  it('copia referencia técnica sin ventas de otra visita ni datos financieros', () => {
    const original = color();
    original.saleDisposition = 'linked';
    original.saleIds = ['sale-1'];
    original.maintenanceDate = '2027-01-20';
    const copied = copyTechnicalData(original) as ColorData;
    expect(copied.procedure).toBe(original.procedure);
    expect(copied.saleIds).toEqual([]);
    expect(copied.saleDisposition).toBe('pending');
    expect(copied.maintenanceDate).toBe('');
    copied.procedure = 'Nuevo procedimiento';
    expect(original.procedure).not.toBe(copied.procedure);
    expect(original.saleIds).toEqual(['sale-1']);
  });
});

describe('completitud por tipo de ficha', () => {
  it('permite guardar color incompleto pero no finalizar hasta resolver campos', () => {
    const data = createTechnicalData('color');
    expect(technicalDataSchema.safeParse(data).success).toBe(true);
    expect(validateTechnicalCompletion(data)).toHaveLength(6);
    expect(validateTechnicalCompletion(color())).toEqual([]);
  });

  it('acepta oxidantes diferentes de fases distintas, exige la unidad y referencia', () => {
    const data = color();
    data.oxidants = {
      none: false,
      items: [
        {
          id: 'mix-1',
          name: 'Oxidante A',
          reference: 'Marca A',
          phase: 'Decoloración',
          concentration: '20 volúmenes',
          details: '1:2',
        },
        {
          id: 'mix-2',
          name: 'Oxidante B',
          reference: 'Marca B',
          phase: 'Tinte',
          concentration: '3 %',
          details: '1:1',
        },
      ],
    };
    expect(validateTechnicalCompletion(data)).toEqual([]);
    data.oxidants.items[0].concentration = '20';
    expect(validateTechnicalCompletion(data).join(' ')).toMatch(/concentración/);
    data.oxidants.items[0].concentration = '20 vol';
    data.oxidants.items[0].reference = '';
    expect(validateTechnicalCompletion(data).join(' ')).toMatch(/marca\/referencia/);
  });

  it('keratina no tiene plano y necesita producto y resolución de venta', () => {
    const data = createTechnicalData('keratin') as KeratinData;
    expect('map' in data).toBe(false);
    expect(validateTechnicalCompletion(data)).toHaveLength(3);
    data.product = { name: 'Sistema de keratina', reference: 'Marca / referencia', components: '' };
    data.saleDisposition = 'none';
    expect(validateTechnicalCompletion(data)).toEqual([]);
  });

  it('General sin materiales se completa sin exigir campos capilares', () => {
    const data = createTechnicalData('general');
    expect(validateTechnicalCompletion(data)).toEqual([]);
    expect('procedure' in data).toBe(false);
    expect('map' in data).toBe(false);
  });

  it('la venta vinculada requiere entrega confirmada de las líneas provistas', () => {
    const data = color();
    data.saleDisposition = 'linked';
    data.saleIds = ['s1'];
    expect(
      validateTechnicalCompletion(data, [{ id: 's1', name: 'Tratamiento', status: 'draft' }]),
    ).toHaveLength(1);
    expect(
      validateTechnicalCompletion(data, [{ id: 's2', name: 'Otro', status: 'confirmed' }]),
    ).toHaveLength(1);
    expect(
      validateTechnicalCompletion(data, [{ id: 's1', name: 'Tratamiento', status: 'confirmed' }]),
    ).toEqual([]);
  });

  it('anotar o finalizar materiales es una función pura y no produce movimientos', () => {
    const data = color();
    data.finalizers = {
      none: false,
      items: [{ id: 'used-1', name: 'Producto usado', reference: 'Marca', details: '10 ml' }],
    };
    const before = structuredClone(data);
    expect(validateTechnicalCompletion(data)).toEqual([]);
    expect(data).toEqual(before);
    expect(Object.keys(data)).not.toContain('inventoryMovements');
  });

  it('valida fecha real de mantenimiento, incluido febrero bisiesto', () => {
    expect(
      technicalDataSchema.safeParse({ ...color(), maintenanceDate: '2028-02-29' }).success,
    ).toBe(true);
    expect(
      technicalDataSchema.safeParse({ ...color(), maintenanceDate: '2027-02-29' }).success,
    ).toBe(false);
  });
});

describe('exportación vectorial', () => {
  it('incluye las cinco vistas, leyenda, patrones y el texto libre escapado', () => {
    const map = updateMapZone(color().map, 'z01', {
      pattern: 'diagonal-zigzag',
      patternVersion: 1,
      colorText: '<script>alert("texto")</script> & fórmula',
    });
    const svg = exportColorMapSvg(map);
    for (const view of ['Frontal', 'Posterior', 'Superior', 'Lateral izquierdo', 'Lateral derecho'])
      expect(svg).toContain(view);
    expect(svg).toContain('Zigzag diagonal');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('url(#export-diagonal-zigzag)');
    expect(svg).toContain('Zona 01');
  });
});
