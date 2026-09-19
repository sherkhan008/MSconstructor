import type { ColorOption, ShelvingConfiguration } from '@/lib/types/domain';
import { computeSectionLayout, computeBoundaryXs } from '@/components/configurator/resize/section-geometry';
import { mmToPx, DEPTH_ANGLE_DEG } from '@/components/configurator/resize/dimension-scale';
import { computeRenderDepthVec } from '@/components/configurator/shelf-depth-projection';
import { resolveRackFill, shade } from '@/components/configurator/rack-colors';

/** Server-rendered catalog illustration. Shares the configurator's geometry,
 * depth projection and paint, without loading its drag controls or hooks.
 * The caller passes this through ProductCard's existing visual slot. */
export function CatalogRackPreview({ config, color, className = '' }: {
  config: ShelvingConfiguration;
  color?: ColorOption;
  className?: string;
}) {
  const layout = computeSectionLayout(config.sections, 300, 420, 260);
  const posts = computeBoundaryXs(layout);
  const height = mmToPx('height', config.height);
  const bottom = 350;
  const top = bottom - height;
  const ys = Array.from({ length: config.shelves }, (_, i) => top + 14 + i / Math.max(1, config.shelves - 1) * (height - 28));
  const depth = mmToPx('depth', config.depth);
  const angle = DEPTH_ANGLE_DEG * Math.PI / 180;
  const { dx, dy } = computeRenderDepthVec({ dx: depth * Math.cos(angle), dy: -depth * Math.sin(angle) }, ys);
  const fill = resolveRackFill(color);
  const dark = shade(fill, -6);
  const light = shade(fill, 4);
  const label = `${config.modelSlug}: ${config.height}×${config.sections.map(s => s.width).join('+')}×${config.depth} мм, ${config.shelves} полки`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 390" role="img" aria-label={label} className={`bg-white ${className}`}>
      <rect width="500" height="390" fill="white" />
      <title>{label}</title>
      {posts.map(x => <rect key={x} x={x + dx - 3} y={top + dy} width="6" height={height} fill={dark} />)}
      {layout.map(({ id, x, width, section }) => (
        <g key={id}>
          {section.rearWall && <rect x={x + dx} y={top + dy} width={width} height={height} fill={dark} />}
          {section.leftWall && <polygon points={`${x},${top} ${x + dx},${top + dy} ${x + dx},${bottom + dy} ${x},${bottom}`} fill={light} />}
          {section.rightWall && <polygon points={`${x + width},${top} ${x + width + dx},${top + dy} ${x + width + dx},${bottom + dy} ${x + width},${bottom}`} fill={dark} />}
          {ys.map(y => (
            <g key={y} data-shelf>
              <polygon points={`${x},${y} ${x + dx},${y + dy} ${x + width + dx},${y + dy} ${x + width},${y}`} fill={light} stroke={dark} strokeWidth="0.7" />
              <polygon points={`${x + width},${y} ${x + width + dx},${y + dy} ${x + width + dx},${y + dy + 5} ${x + width},${y + 5}`} fill={dark} />
              <rect x={x} y={y} width={width} height="5" fill={fill} />
            </g>
          ))}
        </g>
      ))}
      {posts.map(x => (
        <g key={x}>
          <rect x={x - 3} y={top} width="6" height={height} fill={fill} />
          {Array.from({ length: Math.floor((height - 14) / 11) }, (_, i) => <circle key={i} cx={x} cy={top + 7 + i * 11} r="1" fill="white" />)}
          <rect x={x - 4} y={bottom} width="8" height="4" fill="#6B6B6B" />
        </g>
      ))}
    </svg>
  );
}
