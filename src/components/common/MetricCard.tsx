import React from 'react';
import { Sparkline } from './Sparkline';

interface MetricCardProps {
  title: string;
  value: string;
  unit?: string;
  subtitle?: string;
  history?: number[];
  color?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  isLoading?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  unit,
  subtitle,
  history,
  color = '#356AE6',
  icon,
  badge,
  isLoading
}) => {
  return (
    <div className="meta-card metric-card">
      <div className="metric-header">
        <div className="metric-title-group">
          {icon && <span className="metric-icon">{icon}</span>}
          <span className="metric-title">{title}</span>
        </div>
        {badge}
      </div>

      <div className="metric-content">
        <div className="metric-values">
          {isLoading ? (
            <div className="skeleton-line" style={{ width: 120, height: 28, borderRadius: 6 }} />
          ) : (
            <div className="metric-main-value tabular-nums">
              {value}
              {unit && <span className="metric-unit">{unit}</span>}
            </div>
          )}

          {subtitle && (
            <div className="metric-subtitle tabular-nums">
              {isLoading ? (
                <div className="skeleton-line" style={{ width: 80, height: 14, marginTop: 6, borderRadius: 4 }} />
              ) : (
                subtitle
              )}
            </div>
          )}
        </div>

        {history && history.length > 0 && (
          <div className="metric-chart">
            <Sparkline data={history} color={color} width={110} height={38} />
          </div>
        )}
      </div>
    </div>
  );
};
