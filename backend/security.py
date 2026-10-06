"""Firebase token verification and server-enforced report ownership."""
import os
import logging
from pathlib import Path

MODE_FILE = Path(__file__).resolve().parent / ".auth-mode"
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

bearer = HTTPBearer(auto_error=False)

def auth_mode():
    mode = os.getenv("CIVIC_AUTH_MODE", "firebase")
    # This local convenience is explicitly enabled only on the presentation laptop.
    if os.getenv("CIVIC_LOCAL_MODE_SWITCH", "0") == "1":
        try:
            mode = MODE_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            pass
        except (OSError, UnicodeError):
            raise HTTPException(503, "Could not read authentication mode.")
    if mode not in ("firebase", "local_demo"):
        raise HTTPException(503, "Invalid authentication configuration.")
    return mode

def verify_token(token):
    from firebase_admin import auth, get_app
    from main import incident_database
    incident_database()
    return auth.verify_id_token(token, app=get_app("civic-sentinel"), check_revoked=True)

def identity_from_claims(claims):
    uid = claims.get("uid") or claims.get("sub")
    if not isinstance(uid, str) or not uid:
        raise HTTPException(401, "Invalid sign-in token.")
    admins = {value.strip() for value in os.getenv("CIVIC_ADMIN_UIDS", "").split(",") if value.strip()}
    return {"uid": uid, "is_admin": claims.get("admin") is True or uid in admins, "mode": "firebase"}

def require_user(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if auth_mode() == "local_demo":
        # Explicit development mode is restricted to a loopback peer. Never trust forwarded headers.
        if not request.client or request.client.host not in ("127.0.0.1", "::1"):
            raise HTTPException(403, "Local demo mode is available only on this computer.")
        origin = request.headers.get("origin")
        allowed = {value.strip() for value in os.getenv("CIVIC_ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",")}
        if origin and origin not in allowed:
            raise HTTPException(403, "This website cannot use local demo mode.")
        return {"uid": "local-demo", "is_admin": True, "mode": "local_demo"}
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Sign in to use Civic Sentinel.", headers={"WWW-Authenticate": "Bearer"})
    try:
        return identity_from_claims(verify_token(credentials.credentials))
    except HTTPException:
        raise
    except Exception as error:
        from firebase_admin import auth
        invalid = (auth.InvalidIdTokenError, auth.ExpiredIdTokenError, auth.RevokedIdTokenError, auth.UserDisabledError, auth.UserNotFoundError)
        if isinstance(error, invalid) or isinstance(error, ValueError):
            raise HTTPException(401, "Your sign-in has expired or is invalid. Please sign in again.", headers={"WWW-Authenticate": "Bearer"})
        logging.error("Sign-in verification unavailable (%s)", type(error).__name__)
        raise HTTPException(503, "Sign-in verification is temporarily unavailable. Please retry.")

def can_edit(report, user):
    return user["is_admin"] or report.get("created_by") == user["uid"]

def require_editor(report, user):
    if not can_edit(report, user):
        raise HTTPException(403, "Only the report creator or an administrator can change this report.")

