// src/pages/Login.jsx
//
// Real, backend-verified login (JWT + hashed passwords — see
// backend/auth.py). Replaces the old "logged out screen" that only cleared
// a localStorage flag. A successful login here means the username/password
// were checked against a salted password hash stored server-side, and the
// server issued a signed token that every subsequent request proves
// identity with — this is not a client-side role picker.
import { useState } from "react";
import { Landmark, Loader2, LogIn, UserRound, Building2, MapPinned, ShieldCheck } from "lucide-react";
import { loginViaApi, setAuthSession } from "../utils/apiClient";
import "../style/login.css";

// Demo credentials shown on the screen itself — this is a hackathon
// prototype meant to be explored, not a real credential store, so hiding
// them would only make the demo harder to use. See backend/auth.py's
// DEMO_USERS for the source of truth.
const DEMO_ACCOUNTS = [
  { username: "mp_demo", password: "MpDemo@123", label: "Member of Parliament (MP)", icon: UserRound },
  { username: "district_demo", password: "DistrictDemo@123", label: "District Authority", icon: MapPinned },
  { username: "state_demo", password: "StateDemo@123", label: "State Nodal Authority", icon: Building2 },
  { username: "admin_demo", password: "AdminDemo@123", label: "Ministry / Admin", icon: ShieldCheck },
];

export default function Login({ backendOnline, onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const doLogin = async (u, p) => {
    setSubmitting(true);
    setError(null);
    try {
      const data = await loginViaApi(u, p);
      setAuthSession(data.access_token, data.user);
      onLoginSuccess?.(data.user);
    } catch (err) {
      setError(err?.message || "Login failed. Check the username and password.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    doLogin(username.trim(), password);
  };

  const handleDemoLogin = (account) => {
    setUsername(account.username);
    setPassword(account.password);
    doLogin(account.username, account.password);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__brand">
          <div className="login-card__brand-icon">
            <Landmark size={22} strokeWidth={2.25} />
          </div>
          <div>
            <span className="login-card__brand-title">MPLADS AI</span>
            <span className="login-card__brand-sub">Infrastructure Console</span>
          </div>
        </div>

        {!backendOnline && (
          <div className="login-card__notice">
            Backend unreachable — start the API server before logging in.
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. district_demo"
              autoComplete="username"
              disabled={submitting}
            />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={submitting}
            />
          </label>

          {error && <div className="login-form__error">{error}</div>}

          <button type="submit" className="btn-primary login-form__submit" disabled={submitting || !backendOnline}>
            {submitting ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="login-demo">
          <span className="login-demo__label">Quick demo login</span>
          <div className="login-demo__grid">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.username}
                type="button"
                className="login-demo__btn"
                onClick={() => handleDemoLogin(account)}
                disabled={submitting || !backendOnline}
              >
                <account.icon size={15} />
                {account.label}
              </button>
            ))}
          </div>
          <p className="login-demo__note">
            Each role sees only its own scoped project(s) — verified server-side from the login,
            not a switch you can flip after signing in.
          </p>
        </div>
      </div>
    </div>
  );
}
