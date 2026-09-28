// src/components/Sidebar.jsx
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  ShieldAlert,
  FileBarChart2,
  Settings,
  Landmark,
  MapPinned,
  BrainCircuit,
} from "lucide-react";

// Same routes, same labels, same order — grouped only so the rail can
// print compact section headings between them.
const NAV_SECTIONS = [
  {
    label: "Monitoring",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/projects", label: "Projects", icon: FolderKanban },
      { to: "/map", label: "Project Map", icon: MapPinned },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/alerts", label: "Risk & Alerts", icon: ShieldAlert },
      { to: "/reports", label: "Reports", icon: FileBarChart2 },
      { to: "/mlops", label: "MLOps Dashboard", icon: BrainCircuit },
    ],
  },
  {
    label: "System",
    items: [{ to: "/settings", label: "Settings", icon: Settings }],
  },
];

export default function Sidebar({ open = false, onNavigate }) {
  return (
    <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
      <div className="sidebar__brand">
        <div className="sidebar__brand-icon">
          <Landmark size={20} strokeWidth={2.25} />
        </div>
        <div className="sidebar__brand-text">
          <span className="sidebar__brand-title">MPLADS AI</span>
          <span className="sidebar__brand-sub">Infrastructure Console</span>
        </div>
      </div>

      <nav className="sidebar__nav">
        {NAV_SECTIONS.map((section) => (
          <div className="sidebar__group" key={section.label}>
            <span className="sidebar__group-label">{section.label}</span>
            {section.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `sidebar__link ${isActive ? "sidebar__link--active" : ""}`
                }
              >
                <Icon size={17} strokeWidth={1.9} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__status">
          <span className="sidebar__status-dot" />
          AI Engine Online
        </div>
        <span className="sidebar__version">v1.0 · Hackathon Build</span>
      </div>
    </aside>
  );
}
