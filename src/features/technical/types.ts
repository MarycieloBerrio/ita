import { z } from 'zod';

export const PATTERNS = [
  { id: 'zigzag', label: 'Zigzag' },
  { id: 'straight', label: 'Recto' },
  { id: 'diagonal-zigzag', label: 'Zigzag diagonal' },
  { id: 'diagonal-straight', label: 'Recto diagonal' },
] as const;
export type PatternId = (typeof PATTERNS)[number]['id'];
export const ZONE_IDS = ['z01', 'z02', 'z03', 'z04', 'z05', 'z06', 'z07', 'z08'] as const;
export type ZoneId = (typeof ZONE_IDS)[number];
export const TEMPLATE_ID = 'ita-five-views';
export const TEMPLATE_VERSION = 1;
export const PATTERN_VERSION = 1;
export const zoneLabel = (id: ZoneId) => `Zona ${id.slice(1)}`;

const text = z.string().max(1000);
const materialSchema = z.object({
  id: z.string().min(1),
  name: text,
  reference: text,
  details: z.string().max(3000),
});
const materialsSchema = z.object({ none: z.boolean(), items: z.array(materialSchema).max(40) });
const oxidantSchema = materialSchema.extend({ phase: text, concentration: text });
const zoneSchema = z.object({
  pattern: z.enum(['zigzag', 'straight', 'diagonal-zigzag', 'diagonal-straight']),
  patternVersion: z.literal(PATTERN_VERSION),
  colorText: z.string().trim().min(1, 'Escribe el color de la zona.').max(250),
});
const zonesSchema = z
  .object({
    z01: zoneSchema.optional(),
    z02: zoneSchema.optional(),
    z03: zoneSchema.optional(),
    z04: zoneSchema.optional(),
    z05: zoneSchema.optional(),
    z06: zoneSchema.optional(),
    z07: zoneSchema.optional(),
    z08: zoneSchema.optional(),
  })
  .strict();
export const colorMapSchema = z.object({
  templateId: z.literal(TEMPLATE_ID),
  templateVersion: z.literal(TEMPLATE_VERSION),
  zones: zonesSchema,
});
const shared = {
  schemaVersion: z.literal(1),
  notes: z.string().max(10000),
};
const capillary = {
  procedure: z.string().max(10000),
  treatment: z.string().max(3000),
  homeRecommendation: z.string().max(3000),
  maintenanceDate: z.string().refine((value) => {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Fecha de mantenimiento inválida.'),
  saleDisposition: z.enum(['pending', 'none', 'linked']),
  saleIds: z.array(z.string().min(1)).max(100),
};
export const technicalDataSchema = z.discriminatedUnion('kind', [
  z.object({
    ...shared,
    ...capillary,
    kind: z.literal('color'),
    map: colorMapSchema,
    decolorants: materialsSchema,
    oxidants: z.object({ none: z.boolean(), items: z.array(oxidantSchema).max(40) }),
    tints: materialsSchema,
    finalizers: materialsSchema,
  }),
  z.object({
    ...shared,
    ...capillary,
    kind: z.literal('keratin'),
    product: z.object({ name: text, reference: text, components: z.string().max(3000) }),
  }),
  z.object({ ...shared, kind: z.literal('general'), materials: materialsSchema }),
]);
export type TechnicalData = z.infer<typeof technicalDataSchema>;
export type TechnicalKind = TechnicalData['kind'];
export type ColorData = Extract<TechnicalData, { kind: 'color' }>;
export type KeratinData = Extract<TechnicalData, { kind: 'keratin' }>;
export type Material = z.infer<typeof materialSchema>;
export type Oxidant = z.infer<typeof oxidantSchema>;
export type MaterialGroup = z.infer<typeof materialsSchema>;
export type ColorMap = z.infer<typeof colorMapSchema>;
export type ZoneData = z.infer<typeof zoneSchema>;
export type LinkedSale = { id: string; name: string; status: string };

export function createTechnicalData(kind: TechnicalKind): TechnicalData {
  const common = { schemaVersion: 1 as const, notes: '' };
  const hair = {
    procedure: '',
    treatment: '',
    homeRecommendation: '',
    maintenanceDate: '',
    saleDisposition: 'pending' as const,
    saleIds: [],
  };
  if (kind === 'general') return { ...common, kind, materials: { none: true, items: [] } };
  if (kind === 'keratin')
    return { ...common, ...hair, kind, product: { name: '', reference: '', components: '' } };
  return {
    ...common,
    ...hair,
    kind,
    map: { templateId: TEMPLATE_ID, templateVersion: TEMPLATE_VERSION, zones: {} },
    decolorants: { none: false, items: [] },
    oxidants: { none: false, items: [] },
    tints: { none: false, items: [] },
    finalizers: { none: false, items: [] },
  };
}

/** Completion is stricter than drafts: an explicit unused choice is valid. */
export function validateTechnicalCompletion(data: TechnicalData, sales?: LinkedSale[]): string[] {
  const parsed = technicalDataSchema.safeParse(data);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const errors: string[] = [];
  const checkMaterials = (group: MaterialGroup, label: string) => {
    if (group.none && group.items.length)
      errors.push(`${label}: revisa los productos o la opción «No se utilizó».`);
    if (!group.none && !group.items.length)
      errors.push(`${label}: registra el producto o indica que no se utilizó.`);
    if (!group.none && group.items.some((item) => !item.name.trim()))
      errors.push(`${label}: completa el nombre de cada producto.`);
    if (data.kind === 'color' && !group.none && group.items.some((item) => !item.reference.trim()))
      errors.push(`${label}: completa marca/referencia de cada producto.`);
  };
  if (data.kind === 'general') {
    checkMaterials(data.materials, 'Materiales');
    return errors;
  }
  if (data.saleDisposition === 'pending')
    errors.push('Indica los productos vendidos o «No se vendieron productos».');
  if (data.saleDisposition === 'none' && data.saleIds.length)
    errors.push('Revisa los productos vinculados y la opción «No se vendieron productos».');
  if (data.saleDisposition === 'linked' && !data.saleIds.length)
    errors.push('Vincula al menos una línea de venta de esta visita.');
  if (
    sales &&
    data.saleDisposition === 'linked' &&
    data.saleIds.some((id) => !sales.some((sale) => sale.id === id && sale.status === 'confirmed'))
  ) {
    errors.push('Confirma la entrega de todos los productos vinculados en la cuenta de la visita.');
  }
  if (data.kind === 'keratin') {
    if (!data.product.name.trim())
      errors.push('Completa el nombre del producto/sistema de keratina.');
    if (!data.product.reference.trim()) errors.push('Completa la marca/referencia de la keratina.');
  } else {
    if (!data.procedure.trim()) errors.push('Describe el procedimiento realizado.');
    checkMaterials(data.decolorants, 'Decolorante');
    checkMaterials(data.oxidants, 'Peróxido/oxidante');
    checkMaterials(data.tints, 'Color');
    checkMaterials(data.finalizers, 'Finalizador');
    if (
      !data.oxidants.none &&
      data.oxidants.items.some(
        (item) =>
          !item.phase.trim() ||
          !item.concentration.trim() ||
          !/(%|vol(?:úmenes|umen|s)?\.?\b)/i.test(item.concentration),
      )
    ) {
      errors.push('Cada oxidante necesita fase/mezcla y concentración expresada en % o volúmenes.');
    }
  }
  return errors;
}

/** Copy only technical reference data; the new visit must decide its own sales. */
export function copyTechnicalData(data: TechnicalData): TechnicalData {
  const copy = structuredClone(technicalDataSchema.parse(data));
  if (copy.kind !== 'general') {
    copy.saleIds = [];
    copy.saleDisposition = 'pending';
    copy.maintenanceDate = '';
  }
  return copy;
}

export function updateMapZone(map: ColorMap, zoneId: ZoneId, value: ZoneData | null): ColorMap {
  colorMapSchema.parse(map);
  const next = structuredClone(map);
  if (value === null) delete next.zones[zoneId];
  else next.zones[zoneId] = zoneSchema.parse(value);
  return next;
}
