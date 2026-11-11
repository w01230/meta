import React from 'react';
import { CircularFlag } from './CircularFlag';
import { matchRegionCode } from '../../utils/proxy';

/** Group-only rectangular flags; node flags keep their existing circular shape. */
export const ProxyGroupIcon: React.FC<{
  name: string;
  className?: string;
  fallbackSize?: number;
}> = ({ name, className = 'group-flag-icon', fallbackSize = 16 }) => {
  const code = matchRegionCode(name);
  if (!code) {
    return <CircularFlag name={name} size={fallbackSize} className={className} />;
  }

  const baseUrl = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return (
    <img
      src={`${baseUrl}/flags/rect/${code}.svg`}
      alt=""
      aria-hidden="true"
      width={20}
      height={15}
      className={`proxy-group-rect-flag ${className}`}
      decoding="async"
    />
  );
};
