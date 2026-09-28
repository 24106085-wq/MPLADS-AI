// src/pages/Settings.jsx
//
// Task 4, Priority 3 — functional Settings page. Everything shown here is
// loaded from GET /api/settings and saved with PUT /api/settings (see
// backend/main.py / backend/db.py's app_settings table); nothing is
// invented client-side. If the backend is unreachable, the page says so
// rather than pretending to save.
import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Loader2, Save, CheckCircle2, Sun, Moon, Monitor } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { fetchSettingsFromApi, updateSettingsViaApi } from "../utils/apiClient";
import { getStoredThemePreference, setThemePreference } from "../utils/theme";
import "../style/settings.css";

const RISK_FILTER_OPTIONS = ["All", "Low", "Moderate", "Medium", "High", "Critical"];
const MAP_VIEW_OPTIONS = ["All Markers", "High Risk Only", "Unmapped Only"];
const THEME_CHOICES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function formatTimestamp(iso) {
  if (!iso) return "No imports yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Settings({ backendOnline, onProfileChange }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);

  // Manual dark-mode toggle. This is applied instantly on click and stored
  // in localStorage (see utils/theme.js) — it is separate from the
  // server-backed `form` state below, which is only persisted on Save.
  const [themePreference, setThemePreferenceState] = useState(() => getStoredThemePreference());

  const handleThemeChange = (value) => {
    setThemePreference(value);
    setThemePreferenceState(value);
  };

  const [form, setForm] = useState({
    profile_name: "",
    profile_role: "",
    profile_org: "",
    notify_high_risk: true,
    notify_investigation: true,
    notify_import: true,
    notify_mlops: true,
    default_map_view: MAP_VIEW_OPTIONS[0],
    default_risk_filter: RISK_FILTER_OPTIONS[0],
  });

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchSettingsFromApi();
      setForm({
        profile_name: data.profile?.name || "",
        profile_role: data.profile?.role || "",
        profile_org: data.profile?.organization || "",
        notify_high_risk: !!data.notification_preferences?.high_risk_alerts,
        notify_investigation: !!data.notification_preferences?.investigation_updates,
        notify_import: !!data.notification_preferences?.import_notifications,
        notify_mlops: !!data.notification_preferences?.mlops_notifications,
        default_map_view: data.display?.default_map_view || MAP_VIEW_OPTIONS[0],
        default_risk_filter: data.display?.default_risk_filter || RISK_FILTER_OPTIONS[0],
      });
      setDataStatus(data.data_status || null);
    } catch (err) {
      setLoadError(err?.message || "Could not load settings from the backend.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (backendOnline) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendOnline]);

  const update = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateSettingsViaApi(form);
      setDataStatus(updated.data_status || dataStatus);
      setSavedAt(Date.now());
      onProfileChange?.(updated.profile);
    } catch (err) {
      setSaveError(err?.message || "Could not save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Appearance is a purely client-side preference (localStorage, not the
  // backend-persisted `form`), so it's rendered before any backend gating
  // below and stays usable even when the backend is offline or the rest
  // of the form fails to load.
  const appearanceSection = (
    <section className="settings-card">
      <h2 className="settings-card__title">Appearance</h2>
      <div className="theme-toggle" role="radiogroup" aria-label="Color theme">
        {THEME_CHOICES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={themePreference === value}
            className={
              "theme-toggle__option" +
              (themePreference === value ? " theme-toggle__option--active" : "")
            }
            onClick={() => handleThemeChange(value)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <p className="form-note">
        "System" follows your device's light/dark setting; "Light" and "Dark" override it for this browser.
      </p>
    </section>
  );

  if (!backendOnline) {
    return (
      <div className="settings-page">
        <div className="project-details-page__header">
          <div>
            <h1 className="dashboard__title">Settings</h1>
            <p className="dashboard__subtitle">
              Profile, notification preferences and display defaults for this console.
            </p>
          </div>
          <div className="project-details-page__icon">
            <SettingsIcon size={20} />
          </div>
        </div>
        {appearanceSection}
        <EmptyState
          icon={SettingsIcon}
          title="Backend unreachable"
          message="The rest of Settings is stored on the server and can't be loaded or saved while the backend is offline."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="settings-loading">
        <Loader2 size={18} className="spin" />
        Loading settings...
      </div>
    );
  }

  if (loadError) {
    return <EmptyState icon={SettingsIcon} title="Could not load settings" message={loadError} />;
  }

  return (
    <div className="settings-page">
      <div className="project-details-page__header">
        <div>
          <h1 className="dashboard__title">Settings</h1>
          <p className="dashboard__subtitle">
            Profile, notification preferences and display defaults for this console.
          </p>
        </div>
        <div className="project-details-page__icon">
          <SettingsIcon size={20} />
        </div>
      </div>

      {appearanceSection}

      <form onSubmit={handleSave}>
        <section className="settings-card">
          <h2 className="settings-card__title">Profile</h2>
          <div className="form-grid">
            <label className="form-field">
              <span>Name</span>
              <input value={form.profile_name} onChange={update("profile_name")} placeholder="e.g. Admin Officer" />
            </label>
            <label className="form-field">
              <span>Role</span>
              <input value={form.profile_role} onChange={update("profile_role")} placeholder="e.g. Ministry / Admin" />
            </label>
            <label className="form-field form-field--span2">
              <span>Organization / MPLADS Cell</span>
              <input value={form.profile_org} onChange={update("profile_org")} placeholder="e.g. MPLADS Cell" />
            </label>
          </div>
        </section>

        <section className="settings-card">
          <h2 className="settings-card__title">Notification Preferences</h2>
          <div className="settings-toggle-list">
            <label className="settings-toggle">
              <input type="checkbox" checked={form.notify_high_risk} onChange={update("notify_high_risk")} />
              <span>
                <strong>High-risk alerts</strong>
                <small>High/Critical risk, mismatches, cost overrun, delay risk and duplicate work signals.</small>
              </span>
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={form.notify_investigation} onChange={update("notify_investigation")} />
              <span>
                <strong>Investigation updates</strong>
                <small>Status changes, evidence uploads and feedback submitted on a project.</small>
              </span>
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={form.notify_import} onChange={update("notify_import")} />
              <span>
                <strong>Import notifications</strong>
                <small>A dataset import (CSV/JSON) has finished processing.</small>
              </span>
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={form.notify_mlops} onChange={update("notify_mlops")} />
              <span>
                <strong>MLOps notifications</strong>
                <small>A manual model retrain has been triggered.</small>
              </span>
            </label>
          </div>
        </section>

        <section className="settings-card">
          <h2 className="settings-card__title">Display</h2>
          <div className="form-grid">
            <label className="form-field">
              <span>Default Map View</span>
              <select value={form.default_map_view} onChange={update("default_map_view")}>
                {MAP_VIEW_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Default Risk Filter</span>
              <select value={form.default_risk_filter} onChange={update("default_risk_filter")}>
                {RISK_FILTER_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="form-note">Saved as your preference for next time — a starting point, not a live filter applied automatically.</p>
        </section>

        <section className="settings-card settings-card--readonly">
          <h2 className="settings-card__title">Data Status</h2>
          <div className="settings-status-grid">
            <div className="settings-status-item">
              <span className="settings-status-item__label">Imported Project Count</span>
              <span className="settings-status-item__value">{dataStatus?.imported_project_count ?? 0}</span>
            </div>
            <div className="settings-status-item">
              <span className="settings-status-item__label">Last Import</span>
              <span className="settings-status-item__value">{formatTimestamp(dataStatus?.last_import_at)}</span>
            </div>
            <div className="settings-status-item">
              <span className="settings-status-item__label">Database Status</span>
              <span className="settings-status-item__value settings-status-item__value--ok">
                {dataStatus?.database_status || "Unknown"}
              </span>
            </div>
          </div>
        </section>

        <div className="settings-actions">
          {saveError && <span className="settings-actions__error">{saveError}</span>}
          {savedAt && !saveError && (
            <span className="settings-actions__saved">
              <CheckCircle2 size={14} />
              Settings saved
            </span>
          )}
          <button type="submit" className="btn-primary" disabled={saving}>
            <Save size={15} />
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
