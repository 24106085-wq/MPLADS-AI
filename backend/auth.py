# backend/auth.py
"""
Simple, backend-verified prototype authentication.

Replaces the old "fake logout" (a localStorage flag — see the previous
App.jsx docstring) and the old free-text/self-declared role pickers
(Dashboard's role-switcher, InvestigationModal's role dropdown) with real
login: a username + password checked against a salted, hashed password
stored server-side, and a signed JWT that every subsequent request proves
identity with. The server — never the client — decides what role and
scope (mpName / district / state) a logged-in user acts as.

Deliberately NOT enterprise auth. No SSO/OAuth, no refresh-token rotation,
no password-reset flow, no account lockout policy, no user-management UI.
Four fixed demo accounts, one per role in workflow.ROLES — exactly enough
to make the existing role-based screens genuinely backend-verified instead
of a client-side label a user could pick for themselves.

Password hashing uses the stdlib's hashlib.pbkdf2_hmac rather than adding
bcrypt/passlib as a new dependency — appropriate for a prototype with a
small, fixed set of demo accounts, not a production user base.
"""

import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException

import db
import workflow

logger = logging.getLogger("mplads_ai")

# ---------------------------------------------------------------------------
# JWT configuration
# ---------------------------------------------------------------------------

JWT_ALGORITHM = "HS256"
JWT_EXPIRES_MINUTES = int(os.environ.get("JWT_EXPIRES_MINUTES", "480"))  # 8h demo session

_DEV_FALLBACK_SECRET = "dev-only-insecure-secret-set-JWT_SECRET_KEY-in-backend-.env"
JWT_SECRET = os.environ.get("JWT_SECRET_KEY") or _DEV_FALLBACK_SECRET

if JWT_SECRET == _DEV_FALLBACK_SECRET:
    logger.warning(
        "JWT_SECRET_KEY is not set — using an insecure development default. "
        "Set JWT_SECRET_KEY in backend/.env before deploying this anywhere "
        "reachable by anyone other than you."
    )

# ---------------------------------------------------------------------------
# Password hashing — PBKDF2-HMAC-SHA256, stdlib only.
# Stored format: "<salt_hex>$<hash_hex>"
# ---------------------------------------------------------------------------

PBKDF2_ITERATIONS = 260_000


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt if salt is not None else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, _ = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
    except (ValueError, AttributeError):
        return False
    candidate = hash_password(password, salt)
    # Constant-time comparison — avoids leaking hash-match info via timing.
    return hmac.compare_digest(candidate, stored)


# ---------------------------------------------------------------------------
# Demo users — one account per role in workflow.ROLES. Identifiers are
# drawn from data/sample_projects.csv so that, once that CSV (or any
# dataset containing the same names) is loaded, each non-admin demo account
# actually has visible project(s) scoped to it. Passwords are intentionally
# simple and printed in the README — this is a demo login, not a production
# credential store.
# ---------------------------------------------------------------------------

DEMO_USERS = [
    {
        "username": "mp_demo",
        "password": "MpDemo@123",
        "role": "mp",
        "display_name": "Ramesh Chandra Yadav (MP)",
        "identifier": "Ramesh Chandra Yadav",
    },
    {
        "username": "district_demo",
        "password": "DistrictDemo@123",
        "role": "district",
        "display_name": "Lucknow District Authority",
        "identifier": "Lucknow",
    },
    {
        "username": "state_demo",
        "password": "StateDemo@123",
        "role": "state",
        "display_name": "Uttar Pradesh Nodal Authority",
        "identifier": "Uttar Pradesh",
    },
    {
        "username": "admin_demo",
        "password": "AdminDemo@123",
        "role": "admin",
        "display_name": "Ministry / Admin",
        "identifier": None,
    },
]


def seed_demo_users() -> None:
    """Idempotent: inserts each demo account only if its username doesn't
    already exist. Safe to call on every startup."""
    for u in DEMO_USERS:
        if db.get_user(u["username"]) is None:
            db.insert_user(
                username=u["username"],
                password_hash=hash_password(u["password"]),
                role=u["role"],
                display_name=u["display_name"],
                identifier=u["identifier"],
            )
            logger.info("Seeded demo user '%s' (role=%s).", u["username"], u["role"])


def _role_label(role_id: str) -> str:
    match = next((r for r in workflow.ROLES if r["id"] == role_id), None)
    return match["label"] if match else role_id


def authenticate(username: str, password: str) -> Optional[dict]:
    """Returns the stored user row if username/password match, else None.
    Never distinguishes "unknown user" from "wrong password" to the caller
    — both just fail authentication."""
    user = db.get_user((username or "").strip())
    if not user or not verify_password(password or "", user["password_hash"]):
        return None
    return user


def user_public_view(user: dict) -> dict:
    return {
        "username": user["username"],
        "role": user["role"],
        "role_label": _role_label(user["role"]),
        "display_name": user.get("display_name"),
        "identifier": user.get("identifier"),
    }


def create_access_token(user: dict) -> str:
    now = datetime.utcnow()
    payload = {
        "sub": user["username"],
        "role": user["role"],
        "identifier": user.get("identifier"),
        "display_name": user.get("display_name"),
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRES_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        return None
    return parts[1].strip()


def _payload_to_user(payload: dict) -> dict:
    return {
        "username": payload["sub"],
        "role": payload["role"],
        "role_label": _role_label(payload["role"]),
        "identifier": payload.get("identifier"),
        "display_name": payload.get("display_name"),
    }


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Required-auth dependency — 401s if there's no valid Bearer token.
    Use on every route that writes data or exposes anything role-scoped."""
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated. Please log in.")
    return _payload_to_user(_decode_token(token))


def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Same as get_current_user, but returns None instead of raising when
    no token is present — for routes that should still work for an
    anonymous/no-login caller (e.g. local API testing) but must PREFER the
    server-verified identity over any client-supplied role/identifier the
    moment one is available."""
    token = _extract_bearer_token(authorization)
    if not token:
        return None
    try:
        return _payload_to_user(_decode_token(token))
    except HTTPException:
        return None


def require_role(*allowed_roles: str):
    """Dependency factory for simple, role-based endpoint protection (SIH-
    demo scope: 4 fixed roles, no granular permission system). Always
    requires a valid login first — an anonymous caller gets a 401 from
    get_current_user, never a 403 — and then 403s if the logged-in user's
    role isn't one of allowed_roles. See workflow.py's CAN_* sets for the
    actual per-action role lists used across the API, so the "who can do
    what" story lives in one place.

    Usage: current_user: dict = Depends(auth.require_role("admin"))
    """

    def _dependency(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Role '{current_user['role_label']}' is not permitted to "
                    "perform this action."
                ),
            )
        return current_user

    return _dependency
