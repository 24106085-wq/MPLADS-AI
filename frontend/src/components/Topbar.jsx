// src/components/Topbar.jsx
//
// Task 4 — Notifications + Settings + Profile.
//
// The bell is a real, self-contained feed over the backend's notification
// API (backend/notifications.py / GET,POST /api/notifications...) — no
// notification count is ever derived client-side from the project list.
// If the backend is unreachable, the panel says so and shows zero, exactly
// like every other "backend optional" surface in this app (see
// utils/apiClient.js).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Bell, Menu, UserRound, Check, CheckCheck, Loader2, LogOut, Settings as SettingsIcon } from "lucide-react";
import {
  fetchNotificationsFromApi,
  markNotificationReadViaApi,
  markAllNotificationsReadViaApi,
  fetchSettingsFromApi,
} from "../utils/apiClient";

const POLL_MS = 30000;

function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Topbar({ title, onMenuClick, onSearch, backendOnline, onLogout, profileVersion = 0 }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  // ---------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState(null);
  const notifRef = useRef(null);

  // ---------------------------------------------------------------------
  // Profile dropdown
  // ---------------------------------------------------------------------
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState({ name: "Admin Officer", role: "Ministry / Admin", organization: "MPLADS Cell" });
  const profileRef = useRef(null);

  const loadNotifications = async () => {
    if (!backendOnline) return;
    setNotifLoading(true);
    setNotifError(null);
    try {
      const { notifications: items, unreadCount: count } = await fetchNotificationsFromApi();
      setNotifications(items);
      setUnreadCount(count);
    } catch (err) {
      setNotifError(err?.message || "Could not load notifications.");
    } finally {
      setNotifLoading(false);
    }
  };

  const loadProfile = async () => {
    if (!backendOnline) return;
    try {
      const data = await fetchSettingsFromApi();
      if (data?.profile) setProfile(data.profile);
    } catch {
      // Keep whatever profile info is already shown — this is a display
      // convenience, not something the rest of the app depends on.
    }
  };

  useEffect(() => {
    loadNotifications();
    loadProfile();
    if (!backendOnline) return undefined;
    const interval = setInterval(loadNotifications, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendOnline, profileVersion]);

  // Close either dropdown on an outside click.
  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleChange = (e) => {
    setQuery(e.target.value);
    onSearch?.(e.target.value);
  };

  const toggleNotifPanel = () => {
    setProfileOpen(false);
    setNotifOpen((open) => {
      const next = !open;
      if (next) loadNotifications();
      return next;
    });
  };

  const toggleProfileMenu = () => {
    setNotifOpen(false);
    setProfileOpen((open) => !open);
  };

  const handleMarkRead = async (id, e) => {
    e?.stopPropagation();
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await markNotificationReadViaApi(id);
    } catch {
      // Best effort — the next poll/panel-open re-syncs from the backend.
      loadNotifications();
    }
  };

  const handleMarkAllRead = async () => {
    const hadUnread = unreadCount > 0;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    if (!hadUnread) return;
    try {
      await markAllNotificationsReadViaApi();
    } catch {
      loadNotifications();
    }
  };

  const handleNotificationClick = (notification) => {
    if (!notification.is_read) handleMarkRead(notification.id);
    if (notification.project_id) {
      onSearch?.(notification.project_id);
      navigate("/projects");
      setNotifOpen(false);
    }
  };

  const handleOpenSettings = () => {
    setProfileOpen(false);
    navigate("/settings");
  };

  const handleLogout = () => {
    setProfileOpen(false);
    onLogout?.();
  };

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button className="topbar__menu-btn" onClick={onMenuClick} aria-label="Toggle menu">
          <Menu size={20} />
        </button>
        <div className="topbar__context">
          <span className="topbar__breadcrumb">MPLADS · Console</span>
          <h1 className="topbar__title">{title}</h1>
        </div>
      </div>

      <div className="topbar__right">
        <div className="topbar__search">
          <Search size={16} className="topbar__search-icon" />
          <input
            type="text"
            placeholder="Search projects, MPs, districts..."
            value={query}
            onChange={handleChange}
          />
        </div>

        <div className="topbar__system" title="System status">
          <span className={`topbar__system-dot ${backendOnline ? "" : "topbar__system-dot--offline"}`} />
          <span className="topbar__system-text">{backendOnline ? "SYS OK" : "BACKEND OFFLINE"}</span>
        </div>

        <div className="topbar__notif" ref={notifRef}>
          <button
            className="topbar__icon-btn"
            aria-label="Notifications"
            onClick={toggleNotifPanel}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="topbar__badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
            )}
          </button>

          {notifOpen && (
            <div className="notif-panel">
              <div className="notif-panel__header">
                <span className="notif-panel__title">Notifications</span>
                <button
                  className="notif-panel__mark-all"
                  onClick={handleMarkAllRead}
                  disabled={unreadCount === 0}
                >
                  <CheckCheck size={13} />
                  Mark all read
                </button>
              </div>

              <div className="notif-panel__body">
                {!backendOnline && (
                  <div className="notif-panel__empty">Backend unreachable — notifications unavailable.</div>
                )}
                {backendOnline && notifLoading && notifications.length === 0 && (
                  <div className="notif-panel__loading">
                    <Loader2 size={16} className="spin" />
                    Loading notifications...
                  </div>
                )}
                {backendOnline && notifError && (
                  <div className="notif-panel__empty">{notifError}</div>
                )}
                {backendOnline && !notifError && !notifLoading && notifications.length === 0 && (
                  <div className="notif-panel__empty">No new notifications</div>
                )}
                {backendOnline &&
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      className={`notif-item ${n.is_read ? "" : "notif-item--unread"}`}
                      onClick={() => handleNotificationClick(n)}
                    >
                      <span className="notif-item__dot" aria-hidden="true" />
                      <span className="notif-item__body">
                        <span className="notif-item__title">{n.title}</span>
                        {n.description && <span className="notif-item__desc">{n.description}</span>}
                        <span className="notif-item__meta">
                          {n.project_id && <span className="notif-item__project">{n.project_id}</span>}
                          <span className="notif-item__time">{formatTimestamp(n.created_at)}</span>
                        </span>
                      </span>
                      {!n.is_read && (
                        <span
                          className="notif-item__read-btn"
                          role="button"
                          tabIndex={0}
                          title="Mark as read"
                          onClick={(e) => handleMarkRead(n.id, e)}
                        >
                          <Check size={13} />
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        <div className="topbar__profile" ref={profileRef} onClick={toggleProfileMenu}>
          <div className="topbar__avatar">
            <UserRound size={16} />
          </div>
          <div className="topbar__profile-text">
            <span className="topbar__profile-name">{profile.name}</span>
            <span className="topbar__profile-role">{profile.organization || profile.role}</span>
          </div>

          {profileOpen && (
            <div className="profile-menu" onClick={(e) => e.stopPropagation()}>
              <div className="profile-menu__header">
                <span className="profile-menu__name">{profile.name}</span>
                <span className="profile-menu__role">{profile.role}</span>
                <span className="profile-menu__org">{profile.organization}</span>
              </div>
              <div className="profile-menu__divider" />
              <button className="profile-menu__item" onClick={handleOpenSettings}>
                <SettingsIcon size={15} />
                Settings
              </button>
              <button className="profile-menu__item profile-menu__item--danger" onClick={handleLogout}>
                <LogOut size={15} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
