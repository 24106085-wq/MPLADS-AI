// src/pages/ProjectDetails.jsx
// Full "Projects" listing page — reuses the same dataset as the Dashboard and
// opens the shared ProjectModal for a detailed, explainable risk breakdown.
import { useMemo, useState } from "react";
import { FolderKanban } from "lucide-react";
import ProjectTable from "../components/ProjectTable";
import ProjectModal from "../components/ProjectModal";
import { checkCompliance, COMPLIANCE_STATUS_COLORS } from "../utils/complianceChecker";
import "../style/projectDetails.css";

const COMPLIANCE_LABELS = {
  COMPLIANT: "Compliant",
  WARNING: "Warning",
  REQUIRES_REVIEW: "Requires Review",
  NON_COMPLIANT: "Non-Compliant",
};

export default function ProjectDetails({ projects, searchTerm }) {
  const [viewProject, setViewProject] = useState(null);

  const riskBreakdown = useMemo(() => {
    const counts = { Low: 0, Moderate: 0, Medium: 0, High: 0, Critical: 0 };
    projects.forEach((p) => {
      counts[p.riskLevel] = (counts[p.riskLevel] || 0) + 1;
    });
    return counts;
  }, [projects]);

  // Lightweight compliance stat row — independent of the risk breakdown
  // above. Computed client-side via complianceChecker.js so it stays in
  // sync with the same project list without any extra API round-trip.
  const complianceBreakdown = useMemo(() => {
    const counts = { COMPLIANT: 0, WARNING: 0, REQUIRES_REVIEW: 0, NON_COMPLIANT: 0 };
    projects.forEach((p) => {
      const { compliance_status } = checkCompliance(p);
      counts[compliance_status] = (counts[compliance_status] || 0) + 1;
    });
    return counts;
  }, [projects]);

  return (
    <div className="project-details-page">
      <div className="project-details-page__header">
        <div>
          <h1 className="dashboard__title">All MPLADS Projects</h1>
          <p className="dashboard__subtitle">
            Full project register with sortable, filterable financial and physical progress data.
          </p>
        </div>
        <div className="project-details-page__icon">
          <FolderKanban size={20} />
        </div>
      </div>

      <div className="project-details-page__breakdown">
        {Object.entries(riskBreakdown).map(([level, count]) => (
          <div key={level} className={`risk-chip risk-chip--${level.toLowerCase()}`}>
            <span className="risk-chip__count">{count}</span>
            <span className="risk-chip__label">{level}</span>
          </div>
        ))}
      </div>

      <div className="project-details-page__breakdown">
        {Object.entries(complianceBreakdown).map(([statusKey, count]) => (
          <div
            key={statusKey}
            className="risk-chip"
            style={{ borderColor: `${COMPLIANCE_STATUS_COLORS[statusKey]}40` }}
          >
            <span className="risk-chip__count" style={{ color: COMPLIANCE_STATUS_COLORS[statusKey] }}>
              {count}
            </span>
            <span className="risk-chip__label">{COMPLIANCE_LABELS[statusKey]}</span>
          </div>
        ))}
      </div>

      <ProjectTable projects={projects} searchTerm={searchTerm} onView={setViewProject} />

      {viewProject && (
        <ProjectModal project={viewProject} allProjects={projects} onClose={() => setViewProject(null)} />
      )}
    </div>
  );
}
