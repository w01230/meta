import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '20px',
  borderRadius = '8px',
  className = '',
  style
}) => {
  return (
    <div
      className={`skeleton-line ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style
      }}
    />
  );
};
