// src/components/FinancialComparisonChart.jsx
//
// Sanctioned Amount vs Expenditure, per project — a plain CSS bar chart
// (no chart library dependency). Every row is a real project handed in by
// the caller; nothing here is fabricated.

import { formatCurrencyCompact } from "../utils/projectUtils";

export default function FinancialComparisonChart({ rows }) {
  const max = rows.reduce((m, r) => Math.max(m, r.sanctioned, r.expenditure), 0) || 1;

  return (
    <div className="fin-chart">
      {rows.map((r) => {
        const overrun = r.expenditure > r.sanctioned;
        return (
          <div className="fin-chart__row" key={r.id}>
            <div className="fin-chart__row-label" title={r.label}>
              <span className="fin-chart__row-id">{r.id}</span>
              <span className="fin-chart__row-name">{r.label}</span>
            </div>
            <div className="fin-chart__bars">
              <div className="fin-chart__bar-track">
                <div
                  className="fin-chart__bar fin-chart__bar--sanctioned"
                  style={{ width: `${(r.sanctioned / max) * 100}%` }}
                  title={`Sanctioned: ${formatCurrencyCompact(r.sanctioned)}`}
                />
              </div>
              <div className="fin-chart__bar-track">
                <div
                  className={`fin-chart__bar fin-chart__bar--expenditure ${overrun ? "fin-chart__bar--overrun" : ""}`}
                  style={{ width: `${Math.min((r.expenditure / max) * 100, 100)}%` }}
                  title={`Expenditure: ${formatCurrencyCompact(r.expenditure)}`}
                />
              </div>
            </div>
            <div className="fin-chart__row-values">
              <span>{formatCurrencyCompact(r.sanctioned)}</span>
              <span className={overrun ? "fin-chart__value--overrun" : ""}>
                {formatCurrencyCompact(r.expenditure)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
