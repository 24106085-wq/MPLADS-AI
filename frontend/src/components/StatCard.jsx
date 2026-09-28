// src/components/StatCard.jsx

/**
 * A single KPI card: icon, value, label, and a small trend/context line.
 * `tone` controls the icon accent color (default | good | warn | bad).
 */
export default function StatCard({ icon: Icon, value, label, trend, tone = "default" }) {
  return (
    <div className="stat-card">
      <div className={`stat-card__icon stat-card__icon--${tone}`}>
        {Icon && <Icon size={20} strokeWidth={2} />}
      </div>
      <div className="stat-card__body">
        <div className="stat-card__value">{value}</div>
        <div className="stat-card__label">{label}</div>
        {trend && <div className="stat-card__trend">{trend}</div>}
      </div>
    </div>
  );
}
