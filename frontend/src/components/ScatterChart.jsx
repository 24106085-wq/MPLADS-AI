// src/components/ScatterChart.jsx
//
// Physical Progress (%) vs Financial Utilization (%) scatter plot. Plain
// SVG, no chart library dependency. Points are colored by the project's
// backend-provided risk level — this component never computes risk.

import { getRiskColor } from "../utils/riskCalculator";

const SIZE = 300;
const PAD = 30;
const PLOT = SIZE - PAD * 2;

function toXY(financial, physical) {
  const x = PAD + (Math.min(Math.max(financial, 0), 150) / 150) * PLOT;
  const y = SIZE - PAD - (Math.min(Math.max(physical, 0), 100) / 100) * PLOT;
  return { x, y };
}

export default function ScatterChart({ points }) {
  return (
    <div className="scatter-chart">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* axes */}
        <line x1={PAD} y1={SIZE - PAD} x2={SIZE - PAD} y2={SIZE - PAD} className="scatter-chart__axis" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={SIZE - PAD} className="scatter-chart__axis" />

        {/* 50% quadrant guides */}
        {(() => {
          const mid = toXY(50, 50);
          return (
            <>
              <line x1={mid.x} y1={PAD} x2={mid.x} y2={SIZE - PAD} className="scatter-chart__guide" />
              <line x1={PAD} y1={mid.y} x2={SIZE - PAD} y2={mid.y} className="scatter-chart__guide" />
            </>
          );
        })()}

        {points.map((p) => {
          const { x, y } = toXY(p.financial, p.physical);
          return (
            <circle
              key={p.id}
              cx={x}
              cy={y}
              r={5}
              fill={getRiskColor(p.riskLevel || "Low")}
              stroke="var(--surface)"
              strokeWidth={1}
              opacity={0.9}
            >
              <title>{`${p.id} — ${p.label}\nPhysical: ${p.physical}%\nFinancial: ${p.financial}%`}</title>
            </circle>
          );
        })}

        <text x={SIZE / 2} y={SIZE - 6} textAnchor="middle" className="scatter-chart__axis-label">
          Financial Utilization (%)
        </text>
        <text
          x={12}
          y={SIZE / 2}
          textAnchor="middle"
          transform={`rotate(-90 12 ${SIZE / 2})`}
          className="scatter-chart__axis-label"
        >
          Physical Progress (%)
        </text>
      </svg>
    </div>
  );
}
