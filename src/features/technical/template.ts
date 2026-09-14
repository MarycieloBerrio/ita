import {
  colorMapSchema,
  PATTERNS,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  type ColorMap,
  type PatternId,
  type ZoneId,
  zoneLabel,
} from './types';

export type ViewId = 'front' | 'back' | 'top' | 'left' | 'right';
export type Surface = { zone: ZoneId; d: string; labelAt: [number, number] };
export type HeadViewDefinition = {
  id: ViewId;
  label: string;
  surfaces: Surface[];
  contour: string[];
  features: string[];
};

// Immutable v1 prototype: numbered zones and the proposed junctions are described
// in DESIGN.md. Do not edit this registry to change a saved historical template.
export const TEMPLATE_V1: readonly HeadViewDefinition[] = [
  {
    id: 'left',
    label: 'Lateral izquierdo',
    surfaces: [
      { zone: 'z01', d: 'M45 84 C48 46 83 25 105 24 L97 82 Q72 67 45 84 Z', labelAt: [73, 57] },
      { zone: 'z03', d: 'M105 24 Q124 18 143 25 L143 118 Q122 90 97 82 Z', labelAt: [122, 64] },
      { zone: 'z05', d: 'M143 25 C180 32 207 60 210 103 Q177 118 143 102 Z', labelAt: [173, 71] },
      {
        zone: 'z07',
        d: 'M143 102 Q177 118 210 103 Q212 144 173 190 L150 158 Q166 128 143 118 Z',
        labelAt: [181, 141],
      },
    ],
    contour: [
      'M45 84 Q40 104 42 122 L24 153 Q25 161 41 161 L36 175 L45 183 Q44 192 54 202 Q73 217 100 198 L127 183',
      'M102 198 Q115 224 102 254',
      'M173 190 Q166 225 188 254',
    ],
    features: [
      'M47 112 Q59 102 74 114',
      'M47 118 Q58 110 69 118 M54 115 L54 123',
      'M40 175 L53 176',
      'M142 118 C171 99 175 157 149 160 Q139 152 142 137',
      'M149 129 Q162 117 162 140',
    ],
  },
  {
    id: 'front',
    label: 'Frontal',
    surfaces: [
      {
        zone: 'z02',
        d: 'M40 100 C34 56 74 20 120 28 L120 67 Q98 91 86 91 Q62 76 40 100 Z',
        labelAt: [78, 58],
      },
      {
        zone: 'z01',
        d: 'M120 28 C166 20 206 56 200 100 Q178 76 154 91 Q142 91 120 67 Z',
        labelAt: [161, 58],
      },
    ],
    contour: [
      'M40 100 C37 155 64 207 120 224 C176 207 203 155 200 100',
      'M39 130 C19 117 27 162 47 172',
      'M201 130 C221 117 213 162 193 172',
      'M79 208 Q84 232 61 254',
      'M161 208 Q156 232 179 254',
    ],
    features: [
      'M57 121 Q76 110 94 121 M146 121 Q164 110 183 121',
      'M59 132 Q77 119 94 132 Q77 141 59 132 M147 132 Q164 119 182 132 Q164 141 147 132',
      'M76 126 L76 137 M164 126 L164 137',
      'M116 138 L108 163 Q120 172 132 163',
      'M98 187 Q110 179 120 184 Q130 179 142 187 Q120 204 98 187 Z',
      'M103 188 L137 188',
    ],
  },
  {
    id: 'top',
    label: 'Superior',
    surfaces: [
      {
        zone: 'z02',
        d: 'M120 36 Q106 18 97 37 C53 38 31 82 31 140 Q70 141 120 151 Z',
        labelAt: [77, 94],
      },
      {
        zone: 'z01',
        d: 'M120 36 Q134 18 143 37 C187 38 209 82 209 140 Q170 151 120 151 Z',
        labelAt: [164, 94],
      },
      {
        zone: 'z04',
        d: 'M31 140 Q70 141 120 151 L120 240 C66 242 31 218 31 140 Z',
        labelAt: [77, 191],
      },
      {
        zone: 'z03',
        d: 'M120 151 Q170 151 209 140 C209 218 174 242 120 240 Z',
        labelAt: [164, 191],
      },
    ],
    contour: ['M32 115 C11 131 18 161 31 161', 'M208 115 C229 131 222 161 209 161'],
    features: [],
  },
  {
    id: 'back',
    label: 'Posterior',
    surfaces: [
      { zone: 'z05', d: 'M34 131 C30 91 44 49 69 34 Q90 83 120 114 L34 145 Z', labelAt: [66, 102] },
      { zone: 'z03', d: 'M69 34 Q97 18 120 23 L120 114 Q90 83 69 34 Z', labelAt: [102, 59] },
      { zone: 'z04', d: 'M120 23 Q150 23 174 39 Q151 75 120 114 Z', labelAt: [142, 59] },
      { zone: 'z06', d: 'M174 39 Q207 65 206 145 L120 114 Q151 75 174 39 Z', labelAt: [173, 106] },
      {
        zone: 'z07',
        d: 'M34 145 L120 114 L120 222 Q62 225 45 193 Q34 173 34 145 Z',
        labelAt: [78, 178],
      },
      {
        zone: 'z08',
        d: 'M120 114 L206 145 Q206 173 195 193 Q178 225 120 222 Z',
        labelAt: [163, 178],
      },
    ],
    contour: [
      'M33 146 C11 131 19 180 42 191',
      'M207 146 C229 131 221 180 198 191',
      'M68 215 Q78 238 55 258',
      'M172 215 Q162 238 185 258',
    ],
    features: [],
  },
  {
    id: 'right',
    label: 'Lateral derecho',
    surfaces: [
      {
        zone: 'z02',
        d: 'M195 84 C192 46 157 25 135 24 L143 82 Q168 67 195 84 Z',
        labelAt: [167, 57],
      },
      { zone: 'z04', d: 'M135 24 Q116 18 97 25 L97 118 Q118 90 143 82 Z', labelAt: [118, 64] },
      { zone: 'z06', d: 'M97 25 C60 32 33 60 30 103 Q63 118 97 102 Z', labelAt: [67, 71] },
      {
        zone: 'z08',
        d: 'M97 102 Q63 118 30 103 Q28 144 67 190 L90 158 Q74 128 97 118 Z',
        labelAt: [59, 141],
      },
    ],
    contour: [
      'M195 84 Q200 104 198 122 L216 153 Q215 161 199 161 L204 175 L195 183 Q196 192 186 202 Q167 217 140 198 L113 183',
      'M138 198 Q125 224 138 254',
      'M67 190 Q74 225 52 254',
    ],
    features: [
      'M193 112 Q181 102 166 114',
      'M193 118 Q182 110 171 118 M186 115 L186 123',
      'M200 175 L187 176',
      'M98 118 C69 99 65 157 91 160 Q101 152 98 137',
      'M91 129 Q78 117 78 140',
    ],
  },
];

export function getTemplate(map: ColorMap): readonly HeadViewDefinition[] {
  if (map.templateId !== TEMPLATE_ID || map.templateVersion !== TEMPLATE_VERSION) {
    throw new Error(
      'Esta versión de la plantilla no está disponible. Conserva la ficha y actualiza la aplicación.',
    );
  }
  return TEMPLATE_V1;
}

export const patternPath = (id: PatternId) =>
  id.includes('zigzag') ? 'M0 10 L7 3 L14 10 L21 3 L28 10' : 'M0 7 H28';
export const patternRotation = (id: PatternId) => (id.startsWith('diagonal') ? -40 : 0);
const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
  );

function wrapText(value: string, width = 95): string[] {
  const result: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (`${line} ${word}`.trim().length > width && line) {
        result.push(line);
        line = '';
      }
      const chunks = word.match(new RegExp(`.{1,${width}}`, 'g')) ?? [''];
      for (const [index, chunk] of chunks.entries()) {
        if (index < chunks.length - 1) {
          if (line) result.push(line);
          result.push(chunk);
          line = '';
        } else line = `${line} ${chunk}`.trim();
      }
    }
    result.push(line);
  }
  return result;
}

/** Self-contained vector export; user text is escaped and never interpreted. */
export function exportColorMapSvg(map: ColorMap): string {
  colorMapSchema.parse(map);
  const template = getTemplate(map);
  const positions: Record<ViewId, [number, number]> = {
    left: [55, 100],
    front: [650, 100],
    top: [350, 275],
    back: [55, 495],
    right: [650, 495],
  };
  const legendLines: string[] = [];
  for (const [zone, value] of Object.entries(map.zones)) {
    if (!value) continue;
    const label = PATTERNS.find((pattern) => pattern.id === value.pattern)?.label ?? value.pattern;
    legendLines.push(...wrapText(`${zoneLabel(zone as ZoneId)} · ${label} · ${value.colorText}`));
  }
  if (!legendLines.length) legendLines.push('Todas las zonas están sin trabajar.');
  const height = 875 + legendLines.length * 25;
  const patterns = PATTERNS.map(
    ({ id }) =>
      `<pattern id="export-${id}" width="28" height="21" patternUnits="userSpaceOnUse" patternTransform="rotate(${patternRotation(id)})"><path d="${patternPath(id)}" stroke="#6d425a" stroke-width="1.4" fill="none"/></pattern>`,
  ).join('');
  const heads = template
    .map((view) => {
      const [x, y] = positions[view.id];
      const zones = view.surfaces
        .map((surface) => {
          const treatment = map.zones[surface.zone];
          return `<path d="${surface.d}" fill="#faf8f4" stroke="#47554e" stroke-width="1.5"/>${treatment ? `<path d="${surface.d}" fill="url(#export-${treatment.pattern})"/>` : ''}<text x="${surface.labelAt[0]}" y="${surface.labelAt[1]}" text-anchor="middle" font-size="11" fill="#233d30" paint-order="stroke" stroke="#faf8f4" stroke-width="4">${surface.zone.slice(1)}</text>`;
        })
        .join('');
      const outlines = [...view.contour, ...view.features]
        .map(
          (d) =>
            `<path d="${d}" fill="none" stroke="#66736c" stroke-width="1.5" stroke-linecap="round"/>`,
        )
        .join('');
      return `<g transform="translate(${x} ${y})"><text x="120" y="-15" font-size="19" text-anchor="middle" fill="#213e30">${view.label}</text>${zones}${outlines}</g>`;
    })
    .join('');
  const legend = legendLines
    .map(
      (line, index) =>
        `<text x="48" y="${850 + index * 25}" font-size="16" fill="#233d30">${escapeXml(line)}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}" role="img" aria-labelledby="export-title"><title id="export-title">Plano de color · cinco vistas y leyenda</title><rect width="960" height="${height}" fill="white"/><defs>${patterns}</defs><g font-family="Arial, sans-serif"><text x="48" y="40" font-size="26" fill="#213e30">ita · Plano de color</text><text x="48" y="65" font-size="14" fill="#66736c">Plantilla ${TEMPLATE_ID} · v${map.templateVersion} · lados de la clienta</text>${heads}<text x="48" y="811" font-size="20" fill="#213e30">Zonas y fórmulas</text>${legend}</g></svg>`;
}

export function downloadColorMap(map: ColorMap): void {
  const url = URL.createObjectURL(
    new Blob([exportColorMapSvg(map)], { type: 'image/svg+xml;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `ita-plano-v${map.templateVersion}.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
