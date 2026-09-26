import React, { useState, useMemo, useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import { Activity, ChartNoAxesCombined, ArrowDown, ArrowUp } from 'lucide-react';
import type { TrafficTick } from '../../types/api';
import { formatBytes, formatSpeed } from '../../utils/format';
import { getAdaptiveRateAxis, getTrafficTimeTicks } from '../../utils/trafficAxis';

interface TrafficRateChartProps {
  samples: TrafficTick[];
  currentTraffic: TrafficTick | null;
  trafficTotal: { downTotal: number; upTotal: number };
  isConnected: boolean;
  demoMode: boolean;
}

const TRAFFIC_WINDOW_MINUTES = 5;
const CHART_MARGIN = Object.freeze({ top: 14, right: 20, bottom: 26, left: 88 });

export interface TrafficWindow {
  startTime: number;
  endTime: number;
  samples: TrafficTick[];
}

const MAX_SAMPLE_GAP_MS = 10_000;

/** Filter measurements against the selected clock window; never stretch sparse history to fill it. */
export function selectTrafficWindow(
  samples: TrafficTick[],
  minutes: number,
  now: number,
): TrafficWindow {
  const endTime = now;
  const startTime = endTime - minutes * 60_000;
  return {
    startTime,
    endTime,
    samples: samples.filter((sample) =>
      typeof sample.time === 'number' &&
      Number.isFinite(sample.time) &&
      sample.time >= startTime &&
      sample.time <= endTime,
    ),
  };
}

/** Position samples on the full selected time axis, rather than spacing by sample index. */
export function getTrafficSampleX(
  time: number,
  startTime: number,
  endTime: number,
  left: number,
  plotWidth: number,
): number {
  const span = Math.max(1, endTime - startTime);
  const ratio = Math.max(0, Math.min(1, (time - startTime) / span));
  return left + ratio * plotWidth;
}

/** Split the line at long sampling interruptions so the chart doesn't imply continuous data. */
export function splitTrafficSamplesAtGaps(
  samples: TrafficTick[],
  maxGapMs = MAX_SAMPLE_GAP_MS,
): TrafficTick[][] {
  const segments: TrafficTick[][] = [];
  for (const sample of samples) {
    const previousSegment = segments[segments.length - 1];
    const previous = previousSegment?.[previousSegment.length - 1];
    if (
      previous &&
      typeof previous.time === 'number' &&
      typeof sample.time === 'number' &&
      sample.time - previous.time > maxGapMs
    ) {
      segments.push([sample]);
    } else if (previousSegment) {
      previousSegment.push(sample);
    } else {
      segments.push([sample]);
    }
  }
  return segments;
}

export const TrafficRateChart: React.FC<TrafficRateChartProps> = ({
  samples,
  currentTraffic,
  trafficTotal,
  isConnected,
  demoMode
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const svgRef = useRef<SVGSVGElement | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [measuredChartWidth, setMeasuredChartWidth] = useState<number | null>(null);

  // Latest sample for live legend display
  const latestSample = samples[samples.length - 1] || currentTraffic;
  const latestDown = latestSample?.down ?? 0;
  const latestUp = latestSample?.up ?? 0;

  const isActive = isConnected || demoMode;
  useEffect(() => {
    if (!isActive) return;
    setClockNow(Date.now());
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isActive]);

  // Filter actual measured samples within the fixed five-minute window without fabricating missing points
  const trafficWindow = useMemo(() => {
    return selectTrafficWindow(
      isActive ? samples : [],
      TRAFFIC_WINDOW_MINUTES,
      clockNow,
    );
  }, [samples, isActive, clockNow]);
  const visibleSamples = trafficWindow.samples;
  const hasSamples = visibleSamples.length > 0;

  // Use the actual CSS width as the SVG coordinate width. Layout effect provides
  // the first measurement before paint; ResizeObserver keeps it accurate on resize.
  useLayoutEffect(() => {
    if (!hasSamples || !chartWrapRef.current) return;
    const element = chartWrapRef.current;
    const updateWidth = (width = element.getBoundingClientRect().width) => {
      if (!Number.isFinite(width) || width <= 0) return;
      setMeasuredChartWidth((previous) => previous !== null && Math.abs(previous - width) < 0.5 ? previous : width);
    };
    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => updateWidth(entries[0]?.contentRect.width));
      observer.observe(element);
      return () => observer.disconnect();
    }

    const handleResize = () => updateWidth();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [hasSamples]);

  // Dimensions & bounds for SVG canvas
  const viewBoxWidth = measuredChartWidth || 900;
  const viewBoxHeight = 220;
  const plotWidth = viewBoxWidth - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = viewBoxHeight - CHART_MARGIN.top - CHART_MARGIN.bottom;

  // Select a scale that includes the highest finite, nonnegative measured rate.
  const rateAxis = useMemo(() => {
    const rates = visibleSamples.flatMap((sample) => [sample.down, sample.up])
      .filter((rate) => Number.isFinite(rate) && rate >= 0);
    return getAdaptiveRateAxis(Math.max(0, ...rates));
  }, [visibleSamples]);
  const maxVal = rateAxis.maxBytesPerSecond;

  // Compute SVG paths and coordinate mapping
  const { downAreaPath, downLinePath, upAreaPath, upLinePath, points, isolatedPoints } = useMemo(() => {
    const n = visibleSamples.length;
    if (n === 0) {
      return {
        downAreaPath: '',
        downLinePath: '',
        upAreaPath: '',
        upLinePath: '',
        points: [],
        isolatedPoints: [],
      };
    }

    const baselineY = CHART_MARGIN.top + plotHeight;
    const pts = visibleSamples.map((s) => {
      const x = getTrafficSampleX(s.time!, trafficWindow.startTime, trafficWindow.endTime, CHART_MARGIN.left, plotWidth);
      const downRate = Number.isFinite(s.down) && s.down > 0 ? s.down : 0;
      const upRate = Number.isFinite(s.up) && s.up > 0 ? s.up : 0;
      const downY = CHART_MARGIN.top + plotHeight - (downRate / maxVal) * plotHeight;
      const upY = CHART_MARGIN.top + plotHeight - (upRate / maxVal) * plotHeight;
      return { x, downY, upY, sample: s };
    });

    const pointIndices = new Map(pts.map((point, index) => [point.sample, index]));
    const segments = splitTrafficSamplesAtGaps(visibleSamples).map((segment) =>
      segment.map((sample) => pts[pointIndices.get(sample)!]),
    );
    const buildLine = (segment: typeof pts, getY: (p: (typeof pts)[number]) => number) => {
      let d = `M ${segment[0].x.toFixed(1)} ${getY(segment[0]).toFixed(1)}`;
      for (let i = 1; i < segment.length; i++) {
        const prev = segment[i - 1];
        const curr = segment[i];
        const midX = (prev.x + curr.x) / 2;
        d += ` C ${midX.toFixed(1)} ${getY(prev).toFixed(1)}, ${midX.toFixed(1)} ${getY(curr).toFixed(1)}, ${curr.x.toFixed(1)} ${getY(curr).toFixed(1)}`;
      }
      return d;
    };

    const lineSegments = segments.filter((segment) => segment.length >= 2);
    const downLine = lineSegments.map((segment) => buildLine(segment, (point) => point.downY)).join(' ');
    const upLine = lineSegments.map((segment) => buildLine(segment, (point) => point.upY)).join(' ');
    const buildArea = (segment: typeof pts, getY: (p: (typeof pts)[number]) => number) => {
      const line = buildLine(segment, getY);
      const firstX = segment[0].x.toFixed(1);
      const lastX = segment[segment.length - 1].x.toFixed(1);
      return `${line} L ${lastX} ${baselineY.toFixed(1)} L ${firstX} ${baselineY.toFixed(1)} Z`;
    };
    const downArea = lineSegments.map((segment) => buildArea(segment, (point) => point.downY)).join(' ');
    const upArea = lineSegments.map((segment) => buildArea(segment, (point) => point.upY)).join(' ');

    return {
      downAreaPath: downArea,
      downLinePath: downLine,
      upAreaPath: upArea,
      upLinePath: upLine,
      points: pts,
      isolatedPoints: segments.filter((segment) => segment.length === 1).map((segment) => segment[0]),
    };
  }, [visibleSamples, maxVal, plotWidth, plotHeight, trafficWindow.startTime, trafficWindow.endTime]);

  // Pointer interactions for crosshair tooltip
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current || points.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const pointerX = ((e.clientX - rect.left) / rect.width) * viewBoxWidth;
      const clampedX = Math.max(CHART_MARGIN.left, Math.min(CHART_MARGIN.left + plotWidth, pointerX));
      const idx = points.reduce((nearest, point, index) =>
        Math.abs(point.x - clampedX) < Math.abs(points[nearest].x - clampedX) ? index : nearest,
      0);
      if (idx >= 0 && idx < points.length) {
        setHoverIndex(idx);
      }
    },
    [points, plotWidth, viewBoxWidth]
  );

  const handlePointerLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  // Time formatter helper
  const formatTimeLabel = (timestamp?: number) => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // Place each boundary across the plot, regardless of the adaptive tick count.
  const yTicks = useMemo(() => {
    return rateAxis.ticks.map((tick, index) => ({
      ...tick,
      y: CHART_MARGIN.top + plotHeight - (index / Math.max(1, rateAxis.ticks.length - 1)) * plotHeight,
    }));
  }, [rateAxis, plotHeight]);

  // Fixed-interval clock ticks preserve the exact current-time boundary.
  const xTicks = useMemo(() => {
    const tickTimes = getTrafficTimeTicks(trafficWindow.startTime, trafficWindow.endTime);
    return tickTimes.map((time, i) => {
      const ratio = (time - trafficWindow.startTime) / Math.max(1, trafficWindow.endTime - trafficWindow.startTime);
      return {
        time,
        x: CHART_MARGIN.left + ratio * plotWidth,
        label: formatTimeLabel(time),
        alignment: i === 0 ? 'start' as const : i === tickTimes.length - 1 ? 'end' as const : 'middle' as const,
        isIntermediate: i !== 0 && i !== tickTimes.length - 1,
      };
    });
  }, [trafficWindow.startTime, trafficWindow.endTime, plotWidth]);

  const activePoint = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null;

  return (
    <div className="overview-full-card traffic-rate-card" role="region" aria-label="实时速率历史图表">
      {/* Header Bar */}
      <div className="panel-header-bar">
        <div className="panel-header-left">
          <ChartNoAxesCombined size={19} className="panel-header-icon" aria-hidden="true" />
          <h2 className="panel-heading-title">实时速率</h2>
          {demoMode && <span className="demo-tag-pill">【仿真】</span>}
        </div>

      </div>

      {/* Legend Bar */}
      <div className="rate-legend-bar">
        <div className="rate-legend-item rate-legend-down">
          <ArrowDown size={14} className="legend-arrow down-arrow" aria-hidden="true" />
          <span className="legend-metrics">
            <span className="legend-primary">
              <span className="legend-label">下载</span>
              <span className="legend-value tabular-nums">
                {isActive ? formatSpeed(latestDown) : '— B/s'}
              </span>
            </span>
            <span className="legend-total tabular-nums">累计 {formatBytes(trafficTotal.downTotal)}</span>
          </span>
        </div>

        <div className="rate-legend-item rate-legend-up">
          <ArrowUp size={14} className="legend-arrow up-arrow" aria-hidden="true" />
          <span className="legend-metrics">
            <span className="legend-primary">
              <span className="legend-label">上传</span>
              <span className="legend-value tabular-nums">
                {isActive ? formatSpeed(latestUp) : '— B/s'}
              </span>
            </span>
            <span className="legend-total tabular-nums">累计 {formatBytes(trafficTotal.upTotal)}</span>
          </span>
        </div>
      </div>

      {/* Main Chart Canvas or Empty State */}
      <div className="traffic-chart-container">
        {visibleSamples.length === 0 ? (
          <div className="chart-empty-state" role="status">
            <Activity size={24} className="empty-state-icon" aria-hidden="true" />
            <div className="empty-state-title">等待实时流量</div>
            <div className="empty-state-desc">
              {isConnected || demoMode
                ? '正在采样网络速率，稍后自动绘制历史曲线...'
                : '连接控制器后开始采集，不补充历史数据。'}
            </div>
          </div>
        ) : (
          <div ref={chartWrapRef} className="traffic-chart-svg-wrap">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
              className="traffic-svg-canvas"
              preserveAspectRatio="xMidYMid meet"
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
              aria-label="实时下行与上行速率曲线"
            >
              <defs>
                <linearGradient id="downFillGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="upFillGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#A855F7" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#A855F7" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal grid lines and six rate-axis boundaries */}
              {yTicks.map((tick, i) => (
                <g key={i} className="chart-grid-line-group">
                  <line
                    x1={CHART_MARGIN.left}
                    y1={tick.y}
                    x2={CHART_MARGIN.left + plotWidth}
                    y2={tick.y}
                    className="chart-grid-line"
                    strokeDasharray={i === 0 ? undefined : '3 4'}
                  />
                  <text
                    x={CHART_MARGIN.left - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                    className="chart-axis-text"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* Vertical grid lines remain visible even when responsive styles hide labels. */}
              {xTicks.map((tick) => (
                <line
                  key={`grid-${tick.time}`}
                  x1={tick.x}
                  y1={CHART_MARGIN.top}
                  x2={tick.x}
                  y2={CHART_MARGIN.top + plotHeight}
                  className="chart-grid-line chart-time-grid-line"
                  strokeDasharray="3 4"
                />
              ))}

              {/* X-axis labels have dedicated classes for optional mobile label hiding. */}
              {xTicks.map((tick) => (
                <text
                  key={tick.time}
                  x={tick.x}
                  y={viewBoxHeight - 6}
                  textAnchor={tick.alignment}
                  className={`chart-axis-text chart-time-axis-label ${tick.isIntermediate ? 'chart-time-axis-label-intermediate' : ''}`}
                >
                  {tick.label}
                </text>
              ))}

              {/* Areas & Lines */}
              {downAreaPath && <path d={downAreaPath} fill="url(#downFillGrad)" />}
              {upAreaPath && <path d={upAreaPath} fill="url(#upFillGrad)" />}

              {downLinePath && (
                <path
                  d={downLinePath}
                  fill="none"
                  stroke="#3B82F6"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {upLinePath && (
                <path
                  d={upLinePath}
                  fill="none"
                  stroke="#A855F7"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Keep isolated measured samples visible without drawing a misleading line. */}
              {isolatedPoints.map((point) => (
                <g key={`isolated-${point.sample.time}`} aria-hidden="true">
                  <circle cx={point.x} cy={point.downY} r="3.5" fill="#3B82F6" stroke="#FFFFFF" strokeWidth="1.5" />
                  <circle cx={point.x} cy={point.upY} r="3.5" fill="#A855F7" stroke="#FFFFFF" strokeWidth="1.5" />
                </g>
              ))}

              {/* Hover Crosshair & Dots */}
              {activePoint && (
                <g className="chart-hover-overlay" pointerEvents="none">
                  {/* Vertical Crosshair Line */}
                  <line
                    x1={activePoint.x}
                    y1={CHART_MARGIN.top}
                    x2={activePoint.x}
                    y2={CHART_MARGIN.top + plotHeight}
                    stroke="var(--border-card)"
                    strokeWidth="1.5"
                    strokeDasharray="2 3"
                  />
                  {/* Download Dot */}
                  <circle
                    cx={activePoint.x}
                    cy={activePoint.downY}
                    r="4"
                    fill="#3B82F6"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />
                  {/* Upload Dot */}
                  <circle
                    cx={activePoint.x}
                    cy={activePoint.upY}
                    r="4"
                    fill="#A855F7"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />
                </g>
              )}
            </svg>

            {/* Floating Tooltip Box */}
            {activePoint && (
              <div
                className="chart-tooltip-floating"
                style={{
                  left: `clamp(92px, ${(activePoint.x / viewBoxWidth) * 100}%, calc(100% - 92px))`
                }}
              >
                <div className="tooltip-time">{formatTimeLabel(activePoint.sample.time)}</div>
                <div className="tooltip-row tooltip-down">
                  <span className="tooltip-dot down-dot" />
                  <span>下载: {formatSpeed(activePoint.sample.down || 0)}</span>
                </div>
                <div className="tooltip-row tooltip-up">
                  <span className="tooltip-dot up-dot" />
                  <span>上传: {formatSpeed(activePoint.sample.up || 0)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
