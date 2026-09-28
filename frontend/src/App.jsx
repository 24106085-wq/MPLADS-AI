// src/App.jsx
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import EmptyState from "./components/EmptyState";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Alerts from "./pages/Alerts";
import ProjectDetails from "./pages/ProjectDetails";
import Reports from "./pages/Reports";
import ProjectMap from "./pages/ProjectMap";
import Mlops from "./pages/Mlops";
import Settings from "./pages/Settings";
import {
  checkBackendHealth,
  fetchProjectsFromApi,
  createProjectViaApi,
  fetchMeFromApi,
  getAuthToken,
  clearAuthSession,
} from "./utils/apiClient";

const PAGE_TITLES = {
  "/": "Dashboard",
  "/projects": "Projects",
  "/map": "Project Map",
  "/alerts": "Risk & Alerts",
  "/reports": "Reports",
  "/mlops": "MLOps Dashboard",
  "/upload": "Data Upload",
  "/settings": "Settings",
};

function AppShell({ projects, onAddProject, onImportProjects, backendOnline, onLogout, currentUser }) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [profileVersion, setProfileVersion] = useState(0);

  const title = PAGE_TITLES[location.pathname] || "MPLADS AI";

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <div className="app-shell__main">
        <Topbar
          title={title}
          onMenuClick={() => setSidebarOpen((o) => !o)}
          onSearch={setSearchTerm}
          backendOnline={backendOnline}
          onLogout={onLogout}
          profileVersion={profileVersion}
        />

        <div className="app-shell__content">
          <Routes>
            <Route
              path="/"
              element={
                <Dashboard
                  projects={projects}
                  onAddProject={onAddProject}
                  onImportProjects={onImportProjects}
                  searchTerm={searchTerm}
                  backendOnline={backendOnline}
                  currentUser={currentUser}
                />
              }
            />
            <Route
              path="/projects"
              element={<ProjectDetails projects={projects} searchTerm={searchTerm} />}
            />
            <Route path="/map" element={<ProjectMap />} />
            <Route path="/alerts" element={<Alerts projects={projects} searchTerm={searchTerm} />} />
            <Route path="/reports" element={<Reports projects={projects} />} />
            <Route path="/mlops" element={<Mlops backendOnline={backendOnline} />} />
            <Route
              path="/settings"
              element={
                <Settings
                  backendOnline={backendOnline}
                  onProfileChange={() => setProfileVersion((v) => v + 1)}
                />
              }
            />
            <Route
              path="*"
              element={
                <EmptyState title="Page not found" message="The page you're looking for doesn't exist." />
              }
            />
          </Routes>
        </div>
      </div>
    </div>
  );
}

/**
 * REAL DATA MODE.
 *
 * The FastAPI backend + SQLite database is the ONLY source of truth for
 * project data. There is no bundled sample dataset and no client-side
 * fallback that invents, seeds or recalculates project records:
 *   - On load, the app starts with an empty project list.
 *   - If the backend is reachable, projects are fetched from
 *     GET /api/projects and used AS-IS (every project already arrives
 *     fully risk-enriched by the multi-signal risk engine — this app never
 *     recomputes that client-side).
 *   - If the backend is unreachable, the dashboard genuinely shows zero
 *     projects / zero alerts / an empty map, with "Backend unreachable"
 *     messaging, rather than falling back to demo data. Adding or importing
 *     projects requires a reachable backend.
 */
export default function App() {
  const [projects, setProjects] = useState([]);
  const [backendOnline, setBackendOnline] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const handleLogout = () => {
    clearAuthSession();
    setAuthUser(null);
    setProjects([]);
  };

  const handleLoginSuccess = (user) => {
    setAuthUser(user);
  };

  const refetchFromBackend = async () => {
    try {
      const apiProjects = await fetchProjectsFromApi();
      setProjects(apiProjects);
      return true;
    } catch {
      // Leave current state as-is; caller decides how to surface the failure.
      return false;
    }
  };

  // On mount: check the backend, then — if a token was saved from a
  // previous session — validate it against GET /api/auth/me rather than
  // trusting it blindly. An expired/tampered token is discarded and the
  // person is sent back to the login screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const online = await checkBackendHealth();
      if (cancelled) return;
      setBackendOnline(online);
      const token = getAuthToken();
      if (online && token) {
        try {
          const { user } = await fetchMeFromApi();
          if (!cancelled) setAuthUser(user);
        } catch {
          clearAuthSession();
        }
      } else if (token && !online) {
        // Can't validate right now — leave the stored session alone rather
        // than logging the person out just because the backend was briefly
        // unreachable; /api/auth/me will re-validate once it's back.
      }
      if (!cancelled) setAuthChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetches the (now role-scoped) project list once we have a verified
  // session and a reachable backend.
  useEffect(() => {
    if (!authUser || !backendOnline) return;
    let cancelled = false;
    (async () => {
      try {
        const apiProjects = await fetchProjectsFromApi();
        if (!cancelled) setProjects(apiProjects);
      } catch {
        // Leave the list empty; the dashboard shows its own empty state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authUser, backendOnline]);

  const handleAddProject = async (formData) => {
    if (!backendOnline) {
      return { success: false, error: "Backend is unreachable. Start the API server and try again." };
    }
    try {
      await createProjectViaApi(formData);
      await refetchFromBackend();
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || "Could not create the project on the server." };
    }
  };

  // Called by UploadDataModal AFTER it has already POSTed the file to
  // POST /api/upload and the backend has persisted whatever it accepted.
  // This just re-fetches the authoritative, now-current project list — it
  // never merges in a client-side guess of what was imported.
  const handleImportProjects = async () => {
    await refetchFromBackend();
  };

  if (!authChecked) {
    return <div className="app-boot-loading" aria-hidden="true" />;
  }

  if (!authUser) {
    return <Login backendOnline={backendOnline} onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <BrowserRouter>
      <AppShell
        projects={projects}
        onAddProject={handleAddProject}
        onImportProjects={handleImportProjects}
        backendOnline={backendOnline}
        onLogout={handleLogout}
        currentUser={authUser}
      />
    </BrowserRouter>
  );
}
