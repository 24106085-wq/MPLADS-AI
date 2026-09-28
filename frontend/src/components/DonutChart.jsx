// src/components/DonutChart.jsx
//
// Dependency-free SVG donut chart. No chart library is present in this
// project (see frontend/package.json), so this draws segments directly
// with stroke-dasharray rather than pulling in a new package.
//
// Pure presentation — every {label, value, color} segment is handed in by
// the caller, which is expected to have derived it from real backend data.
// This component never invents or defaults a value.

const SIZE = 168;
const THICKNESS = 26;
const RADIUS = (SIZE - THICKNESS) / 2;
const CIRC = 2 * Math.PI * RADIUS;

export default function DonutChart({ data, centerLabel }) {
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);

  let cumulative = 0;

  return (
    <div className="donut-chart">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--border)"
            strokeWidth={THICKNESS}
          />
          {total > 0 &&
            data
              .filter((d) => d.value > 0)
              .map((d) => {
                const frac = d.value / total;
                const dash = frac * CIRC;
                const offset = -((cumulative / total) * CIRC);
                cumulative += d.value;
                return (
                  <circle
                    key={d.label}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={d.color}
                    strokeWidth={THICKNESS}
                    strokeDasharray={`${dash} ${CIRC - dash}`}
                    strokeDashoffset={offset}
                  >
                    <title>{`${d.label}: ${d.value} (${Math.round(frac * 100)}%)`}</title>
                  </circle>
                );
              })}
        </g>
        <text x={SIZE / 2} y={SIZE / 2 - 4} textAnchor="middle" className="donut-chart__total">
          {total}
        </text>
        <text x={SIZE / 2} y={SIZE / 2 + 14} textAnchor="middle" className="donut-chart__total-label">
          {centerLabel || "Total"}
        </text>
      </svg>

      <div className="donut-chart__legend">
        {data.map((d) => (
          <div className="donut-chart__legend-item" key={d.label}>
            <span className="donut-chart__legend-dot" style={{ background: d.color }} />
            <span className="donut-chart__legend-label">{d.label}</span>
            <span className="donut-chart__legend-value">
              {d.value}
              {total > 0 ? ` (${Math.round((d.value / total) * 100)}%)` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
