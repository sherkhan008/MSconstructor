'use client';

import { useMemo } from 'react';
import type { ColorOption, RearOption, ShelvingConfiguration, SideOption } from '@/lib/types/domain';

/**
 * Dynamic, formula-free CAD-style SVG preview of the current configuration.
 * Built entirely from primitive shapes scaled to the customer's selections —
 * there is no per-configuration static image to keep in sync.
 */

const VIEWBOX_W = 640;
const VIEWBOX_H = 460;
const FLOOR_Y = 380;
const MAX_TOTAL_WIDTH_PX = 480;

interface Props {
  config: ShelvingConfiguration;
  color?: ColorOption;
  className?: string;
}

export function ShelvingPreview({ config, color, className = '' }: Props) {
  const geometry = useMemo(() => computeGeometry(config), [config]);
  const fill = color?.hex ?? '#8B939D';
  const darkFill = shade(fill, -18);
  const lightFill = shade(fill, 22);

  return (
    <div className={`blueprint-grid relative w-full overflow-hidden border border-line bg-surface ${className}`}>
      <svg viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} className="h-full w-full" role="img" aria-label="Схема стеллажа">
        {/* Ground line */}
        <line x1={20} y1={FLOOR_Y} x2={VIEWBOX_W - 20} y2={FLOOR_Y} stroke="#5B6470" strokeWidth={2} />

        {geometry.sections.map((section, i) => (
          <SectionGraphic
            key={i}
            x={section.x}
            width={section.width}
            top={geometry.top}
            bottom={FLOOR_Y}
            shelfYs={geometry.shelfYs}
            rear={config.rear}
            side={config.side}
            isFirst={i === 0}
            isLast={i === geometry.sections.length - 1}
            fill={fill}
            darkFill={darkFill}
            lightFill={lightFill}
          />
        ))}

        <DimensionArrows geometry={geometry} config={config} />
      </svg>

      <div className="tech-label pointer-events-none absolute left-3 top-3 flex flex-col gap-0.5">
        <span>{config.height}×{config.width}×{config.depth} мм</span>
        <span>
          {config.shelves} полок · {config.sections} {sectionsWord(config.sections)}
        </span>
      </div>
      <div className="tech-label pointer-events-none absolute bottom-3 right-3">{config.loadCapacity} кг/полка</div>
    </div>
  );
}

function sectionsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'секция';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'секции';
  return 'секций';
}

interface Geometry {
  top: number;
  shelfYs: number[];
  sections: { x: number; width: number }[];
  totalWidthPx: number;
}

function computeGeometry(config: ShelvingConfiguration): Geometry {
  const heightPx = clamp(map(config.height, 1200, 3200, 140, 320), 140, 320);
  const top = FLOOR_Y - heightPx;

  const sectionWidthPxRaw = clamp(map(config.width, 600, 1600, 90, 170), 70, 190);
  const totalWidthPx = Math.min(sectionWidthPxRaw * config.sections, MAX_TOTAL_WIDTH_PX);
  const sectionWidthPx = totalWidthPx / config.sections;
  const startX = (VIEWBOX_W - totalWidthPx) / 2;

  const sections = Array.from({ length: config.sections }, (_, i) => ({
    x: startX + i * sectionWidthPx,
    width: sectionWidthPx,
  }));

  const shelfYs = Array.from({ length: config.shelves }, (_, i) => {
    const ratio = config.shelves === 1 ? 0.5 : i / (config.shelves - 1);
    return top + 14 + ratio * (heightPx - 28);
  });

  return { top, shelfYs, sections, totalWidthPx };
}

function SectionGraphic({
  x,
  width,
  top,
  bottom,
  shelfYs,
  rear,
  side,
  isFirst,
  isLast,
  fill,
  darkFill,
  lightFill,
}: {
  x: number;
  width: number;
  top: number;
  bottom: number;
  shelfYs: number[];
  rear: RearOption;
  side: SideOption;
  isFirst: boolean;
  isLast: boolean;
  fill: string;
  darkFill: string;
  lightFill: string;
}) {
  const uprightWidth = 5;
  const showLeftWall = side === 'BOTH' || side === 'BOTH_PERFORATED' || (isFirst && (side === 'LEFT' || side === 'LEFT_PERFORATED'));
  const showRightWall = side === 'BOTH' || side === 'BOTH_PERFORATED' || (isLast && (side === 'RIGHT' || side === 'RIGHT_PERFORATED'));
  const perforated = side.includes('PERFORATED');

  return (
    <g>
      {rear === 'SOLID' && (
        <rect x={x + uprightWidth} y={top} width={width - uprightWidth * 2} height={bottom - top} fill={darkFill} opacity={0.35} />
      )}
      {rear === 'PERFORATED' && (
        <rect
          x={x + uprightWidth}
          y={top}
          width={width - uprightWidth * 2}
          height={bottom - top}
          fill={darkFill}
          opacity={0.2}
          style={{ maskImage: 'repeating-linear-gradient(45deg, black 0 2px, transparent 2px 6px)' }}
        />
      )}
      {rear === 'CROSS_BRACE' && (
        <>
          <line x1={x + uprightWidth} y1={top} x2={x + width - uprightWidth} y2={bottom} stroke={darkFill} strokeWidth={2} opacity={0.6} />
          <line x1={x + width - uprightWidth} y1={top} x2={x + uprightWidth} y2={bottom} stroke={darkFill} strokeWidth={2} opacity={0.6} />
        </>
      )}

      {showLeftWall && (
        <rect x={x} y={top} width={uprightWidth * 2.4} height={bottom - top} fill={lightFill} opacity={perforated ? 0.5 : 0.8} />
      )}
      {showRightWall && (
        <rect x={x + width - uprightWidth * 2.4} y={top} width={uprightWidth * 2.4} height={bottom - top} fill={lightFill} opacity={perforated ? 0.5 : 0.8} />
      )}

      {/* Uprights */}
      <rect x={x} y={top} width={uprightWidth} height={bottom - top} fill="#5B6470" />
      <rect x={x + width - uprightWidth} y={top} width={uprightWidth} height={bottom - top} fill="#5B6470" />

      {/* Shelves */}
      {shelfYs.map((y, i) => (
        <rect key={i} x={x} y={y - 4} width={width} height={8} fill={fill} stroke="#1C2024" strokeOpacity={0.15} strokeWidth={0.5} />
      ))}

      {/* Feet */}
      <rect x={x - 2} y={bottom} width={uprightWidth + 4} height={6} fill="#1C2024" opacity={0.5} />
      <rect x={x + width - uprightWidth - 2} y={bottom} width={uprightWidth + 4} height={6} fill="#1C2024" opacity={0.5} />
    </g>
  );
}

function DimensionArrows({ geometry, config }: { geometry: Geometry; config: ShelvingConfiguration }) {
  const first = geometry.sections[0];
  const last = geometry.sections[geometry.sections.length - 1];
  const arrowY = FLOOR_Y + 24;
  const heightArrowX = first.x - 24;

  return (
    <g stroke="#2F5D8A" strokeWidth={1} fontFamily="IBM Plex Mono, monospace">
      {/* Width arrow */}
      <line x1={first.x} y1={arrowY} x2={last.x + last.width} y2={arrowY} markerStart="url(#arrowStart)" markerEnd="url(#arrowEnd)" />
      <text x={(first.x + last.x + last.width) / 2} y={arrowY + 16} textAnchor="middle" fontSize={11} fill="#2F5D8A" stroke="none">
        {config.width * config.sections} мм
      </text>

      {/* Height arrow */}
      <line
        x1={heightArrowX}
        y1={geometry.top}
        x2={heightArrowX}
        y2={FLOOR_Y}
        markerStart="url(#arrowStart)"
        markerEnd="url(#arrowEnd)"
      />
      <text
        x={heightArrowX - 8}
        y={(geometry.top + FLOOR_Y) / 2}
        textAnchor="middle"
        fontSize={11}
        fill="#2F5D8A"
        stroke="none"
        transform={`rotate(-90 ${heightArrowX - 8} ${(geometry.top + FLOOR_Y) / 2})`}
      >
        {config.height} мм
      </text>

      <defs>
        <marker id="arrowStart" markerWidth={8} markerHeight={8} refX={4} refY={4} orient="auto">
          <path d="M7,1 L1,4 L7,7" fill="none" stroke="#2F5D8A" strokeWidth={1} />
        </marker>
        <marker id="arrowEnd" markerWidth={8} markerHeight={8} refX={4} refY={4} orient="auto">
          <path d="M1,1 L7,4 L1,7" fill="none" stroke="#2F5D8A" strokeWidth={1} />
        </marker>
      </defs>
    </g>
  );
}

function map(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shade(hex: string, percent: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const num = Number.parseInt(normalized, 16);
  const r = clamp(((num >> 16) & 0xff) + Math.round((percent / 100) * 255), 0, 255);
  const g = clamp(((num >> 8) & 0xff) + Math.round((percent / 100) * 255), 0, 255);
  const b = clamp((num & 0xff) + Math.round((percent / 100) * 255), 0, 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
