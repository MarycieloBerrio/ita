import { useEffect, useId, useRef, useState } from 'react';
import { Download, Maximize2, X } from 'lucide-react';
import {
  downloadColorMap,
  getTemplate,
  patternPath,
  patternRotation,
  type HeadViewDefinition,
  type ViewId,
} from './template';
import {
  PATTERNS,
  PATTERN_VERSION,
  updateMapZone,
  ZONE_IDS,
  zoneLabel,
  type ColorMap,
  type PatternId,
  type ZoneId,
} from './types';

type Props = {
  value: ColorMap;
  onChange: (map: ColorMap) => void;
  readOnly?: boolean;
  onPendingChange?: (pending: boolean) => void;
};

function HeadView({
  view,
  map,
  selected,
  onSelect,
}: {
  view: HeadViewDefinition;
  map: ColorMap;
  selected: ZoneId | null;
  onSelect: (id: ZoneId) => void;
}) {
  const namespace = useId().replace(/:/g, '');
  return (
    <svg className="ita-head" viewBox="0 0 240 280" aria-label={`${view.label}: zonas del cabello`}>
      <defs>
        {PATTERNS.map(({ id }) => (
          <pattern
            key={id}
            id={`${namespace}-${id}`}
            width="28"
            height="21"
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${patternRotation(id)})`}
          >
            <path d={patternPath(id)} stroke="#6d425a" strokeWidth="1.4" fill="none" />
          </pattern>
        ))}
      </defs>
      {view.surfaces.map((surface) => {
        const treatment = map.zones[surface.zone];
        const label = `${zoneLabel(surface.zone)}, ${treatment ? `${PATTERNS.find((p) => p.id === treatment.pattern)?.label}, ${treatment.colorText}` : 'Sin trabajar'}`;
        return (
          <g key={surface.zone}>
            <path
              d={surface.d}
              className={`ita-map-zone${selected === surface.zone ? ' ita-map-zone-selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selected === surface.zone}
              onClick={() => onSelect(surface.zone)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(surface.zone);
                }
              }}
            >
              <title>{label}</title>
            </path>
            {treatment && (
              <path
                d={surface.d}
                fill={`url(#${namespace}-${treatment.pattern})`}
                pointerEvents="none"
              />
            )}
            <text
              x={surface.labelAt[0]}
              y={surface.labelAt[1]}
              className="ita-zone-number"
              pointerEvents="none"
              aria-hidden="true"
            >
              {surface.zone.slice(1)}
            </text>
          </g>
        );
      })}
      {[...view.contour, ...view.features].map((d, index) => (
        <path key={index} d={d} className="ita-head-contour" pointerEvents="none" />
      ))}
    </svg>
  );
}

function PatternIllustration({ id }: { id: PatternId }) {
  const diagonal = id.startsWith('diagonal');
  const zigzag = id.includes('zigzag');
  return (
    <svg width="90" height="45" viewBox="0 0 90 45" aria-hidden="true">
      <path
        d={zigzag ? 'M14 22 L22 13 L30 31 L38 13 L46 31 L54 13 L62 31 L70 22' : 'M14 22 H70'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={diagonal ? 'rotate(-22 45 22)' : undefined}
      />
    </svg>
  );
}

export function ColorMapEditor({ value, onChange, readOnly = false, onPendingChange }: Props) {
  const [selected, setSelected] = useState<ZoneId | null>(null);
  const [pattern, setPattern] = useState<PatternId | ''>('');
  const [colorText, setColorText] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<ViewId | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const radioName = useId();
  const template = getTemplate(value);
  const expandedView = template.find((view) => view.id === expanded);
  const original = selected ? value.zones[selected] : undefined;
  const dirty =
    !!selected &&
    ((original?.pattern ?? '') !== pattern || (original?.colorText ?? '') !== colorText);

  useEffect(() => {
    onPendingChange?.(dirty);
  }, [dirty, onPendingChange]);

  useEffect(() => {
    if (expanded && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [expanded]);

  function selectZone(id: ZoneId) {
    if (id === selected) return;
    if (id !== selected && dirty) {
      setError('Aplica o cancela los cambios de esta zona antes de abrir otra.');
      return;
    }
    setSelected(id);
    setPattern(value.zones[id]?.pattern ?? '');
    setColorText(value.zones[id]?.colorText ?? '');
    setError('');
    if (expanded) {
      dialog.current?.close();
      setExpanded(null);
    }
    setTimeout(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  }

  function applyZone() {
    if (!selected || !pattern) {
      setError('Selecciona una de las cuatro divisiones.');
      return;
    }
    if (!colorText.trim()) {
      setError('Escribe el color, tono o fórmula de esta zona.');
      return;
    }
    if (colorText.length > 250) {
      setError(
        'El color supera el límite de 250 caracteres. Conserva el detalle adicional en el procedimiento.',
      );
      return;
    }
    onChange(
      updateMapZone(value, selected, {
        pattern,
        patternVersion: PATTERN_VERSION,
        colorText: colorText.trim(),
      }),
    );
    setColorText(colorText.trim());
    setError('');
  }

  function cancelZone() {
    setPattern(original?.pattern ?? '');
    setColorText(original?.colorText ?? '');
    setError('');
    setSelected(null);
  }

  return (
    <section className="ita-color-map" aria-label="Plano de color">
      <div className="ita-technical-heading">
        <div>
          <h3>Un plano, cinco miradas</h3>
          <p>Selecciona una zona para anotar la división y el color del trabajo.</p>
        </div>
        <button
          type="button"
          className="ita-technical-button"
          onClick={() => downloadColorMap(value)}
        >
          <Download size={18} /> Exportar plano
        </button>
      </div>
      <p className="ita-technical-hint">
        Izquierda y derecha corresponden a la clienta. Los números identifican las mismas zonas
        entre vistas.
      </p>
      <div className="ita-map-layout">
        <div className="ita-map-overview">
          {template.map((view) => (
            <article key={view.id} className={`ita-view-card ita-view-${view.id}`}>
              <div className="ita-view-heading">
                <h4>{view.label}</h4>
                <button
                  type="button"
                  className="ita-icon-button"
                  aria-label={`Ampliar vista ${view.label.toLowerCase()}`}
                  onClick={() => setExpanded(view.id)}
                >
                  <Maximize2 size={17} />
                </button>
              </div>
              <HeadView view={view} map={value} selected={selected} onSelect={selectZone} />
            </article>
          ))}
        </div>
        <aside className="ita-zone-panel" ref={panel} aria-label="Opciones de la zona">
          <label className="ita-technical-field">
            <span>Seleccionar zona</span>
            <select
              value={selected ?? ''}
              onChange={(event) => {
                if (event.target.value) selectZone(event.target.value as ZoneId);
              }}
            >
              <option value="">Elige una zona</option>
              {ZONE_IDS.map((id) => (
                <option key={id} value={id}>
                  {zoneLabel(id)} · {value.zones[id] ? 'Trabajada' : 'Sin trabajar'}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <>
              <div className="ita-zone-status">
                <h4>{zoneLabel(selected)}</h4>
                <span>
                  {dirty
                    ? 'Cambios sin aplicar'
                    : original
                      ? 'Aplicado en la ficha'
                      : 'Sin trabajar'}
                </span>
              </div>
              {readOnly ? (
                <div className="ita-zone-readonly">
                  <strong>
                    {original
                      ? PATTERNS.find((item) => item.id === original.pattern)?.label
                      : 'Sin trabajar'}
                  </strong>
                  <p>{original?.colorText ?? 'Esta zona no tiene una división registrada.'}</p>
                </div>
              ) : (
                <>
                  <fieldset className="ita-pattern-fieldset">
                    <legend>División · elige una opción</legend>
                    <div className="ita-pattern-options">
                      {PATTERNS.map((item) => (
                        <label
                          key={item.id}
                          className={`ita-pattern-option${pattern === item.id ? ' ita-pattern-active' : ''}`}
                        >
                          <input
                            type="radio"
                            name={radioName}
                            value={item.id}
                            checked={pattern === item.id}
                            onChange={() => setPattern(item.id)}
                          />
                          <PatternIllustration id={item.id} />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="ita-technical-field">
                    <span>Color</span>
                    <textarea
                      rows={2}
                      placeholder="Tono, descripción o fórmula"
                      value={colorText}
                      onChange={(event) => setColorText(event.target.value)}
                      aria-invalid={colorText.length > 250}
                    />
                  </label>
                  <p
                    className={`ita-character-count${colorText.length > 250 ? ' ita-technical-error' : ''}`}
                  >
                    {colorText.length} / 250 caracteres
                  </p>
                  {error && (
                    <p role="alert" className="ita-technical-error">
                      {error}
                    </p>
                  )}
                  <div className="ita-zone-actions">
                    <button
                      type="button"
                      className="ita-technical-button ita-technical-primary"
                      onClick={applyZone}
                    >
                      Aplicar
                    </button>
                    <button type="button" className="ita-technical-button" onClick={cancelZone}>
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="ita-technical-button ita-technical-quiet"
                      onClick={() => {
                        onChange(updateMapZone(value, selected, null));
                        setPattern('');
                        setColorText('');
                        setError('');
                      }}
                    >
                      Limpiar
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="ita-zone-empty">
              <span>01 — 08</span>
              <p>
                Toca el plano o elige una zona en la lista. Las zonas sin trabajar pueden permanecer
                vacías.
              </p>
            </div>
          )}
          <details className="ita-map-legend">
            <summary>Leyenda del trabajo</summary>
            <dl>
              {ZONE_IDS.map((id) => (
                <div key={id}>
                  <dt>{zoneLabel(id)}</dt>
                  <dd>
                    {value.zones[id] ? (
                      <>
                        {PATTERNS.find((item) => item.id === value.zones[id]?.pattern)?.label}
                        <br />
                        {value.zones[id]?.colorText}
                      </>
                    ) : (
                      'Sin trabajar'
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </aside>
      </div>
      <p className="ita-template-note">
        Plantilla v{value.templateVersion} · Prototipo de zonas numeradas para revisión.
      </p>
      {expandedView && (
        <dialog
          ref={dialog}
          className="ita-map-dialog"
          onCancel={() => setExpanded(null)}
          onClose={() => setExpanded(null)}
        >
          <div className="ita-view-heading">
            <h3>{expandedView.label}</h3>
            <button
              autoFocus
              type="button"
              className="ita-icon-button"
              aria-label="Cerrar vista ampliada"
              onClick={() => {
                dialog.current?.close();
                setExpanded(null);
              }}
            >
              <X size={22} />
            </button>
          </div>
          <p>Selecciona una zona para abrir sus opciones.</p>
          <HeadView view={expandedView} map={value} selected={selected} onSelect={selectZone} />
        </dialog>
      )}
    </section>
  );
}
