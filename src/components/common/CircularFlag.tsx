import React from 'react';
import { Globe } from 'lucide-react';
import { matchRegionCode } from '../../utils/proxy';

export interface CircularFlagProps {
  name?: string;
  code?: string | null;
  size?: number; // e.g. 20 (nodes) or 24 (headers / selected)
  className?: string;
  alt?: string;
}

/**
 * Reusable CircularFlag component rendering already-circular SVG flags
 * for recognized regions, or a neutral Globe icon fallback for unknown regions.
 * Fixed-size with non-shrinking flex styles to prevent clipping at narrow widths.
 */
export const CircularFlag: React.FC<CircularFlagProps> = ({
  name,
  code: propCode,
  size = 20,
  className = '',
  alt
}) => {
  const code = propCode || (name ? matchRegionCode(name) : null);

  if (code) {
    const baseUrl = (((import.meta as any).env?.BASE_URL as string) || '/').replace(/\/+$/, '');
    const flagSrc = `${baseUrl}/flags/${code}.svg`;

    return (
      <img
        src={flagSrc}
        alt={alt !== undefined ? alt : ''}
        aria-hidden="true"
        width={size}
        height={size}
        className={`circular-flag-img ${className}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          minWidth: `${size}px`,
          minHeight: `${size}px`,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'inline-block',
          verticalAlign: 'middle',
          objectFit: 'cover'
        }}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <span
      className={`circular-flag-globe ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        flexShrink: 0,
        verticalAlign: 'middle'
      }}
      aria-hidden="true"
    >
      <Globe size={Math.max(14, size - 4)} className="neutral-globe-icon" />
    </span>
  );
};
