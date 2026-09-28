// src/components/RiskBadge.jsx
import { getRiskColor } from "../utils/riskCalculator";

/**
 * Displays a risk level pill (Low/Moderate/Medium/High/Critical) with
 * consistent color coding, and optionally the numeric score alongside it.
 */
export default function RiskBadge({ level, score, showScore = false, size = "md" }) {
  const color = getRiskColor(level);
  const className = `risk-badge risk-badge--${size}`;

  return (
    <span
      className={className}
      style={{
        color,
        backgroundColor: `${color}1A`,
        borderColor: `${color}40`,
      }}
    >
      <span className="risk-badge__dot" style={{ backgroundColor: color }} />
      {level}
      {showScore && typeof score === "number" && (
        <span className="risk-badge__score">{score}</span>
      )}
    </span>
  );
}
