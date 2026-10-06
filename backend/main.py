
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Depends
from starlette.concurrency import run_in_threadpool
from datetime import datetime, timezone
from uuid import uuid4
from functools import lru_cache
from threading import Lock
import logging
from security import require_user, require_editor, can_edit, auth_mode
from duplicates import find_duplicates
from dashboard import summarize_reports
from report_visibility import is_demo_report
from photos import prepare_photo, store_photo, photo_metadata, photo_path
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from google import genai
from google.genai import types

from dotenv import load_dotenv
from pydantic import BaseModel

from typing import Literal
from pathlib import Path

import os


# =====================================
# 1. LOAD API KEY
# =====================================

BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")


# =====================================
# 2. INITIALIZE FASTAPI
# =====================================

app = FastAPI(
    title="Civic Sentinel API",
    description="AI-powered civic issue detection",
    version="1.0"
)


# =====================================
# 3. ENABLE CORS
# =====================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CIVIC_ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)


# =====================================
# 4. DEFINE AI RESPONSE STRUCTURE
# =====================================

class CivicAnalysis(BaseModel):

    problem: str

    category: Literal[
        "ROAD",
        "WASTE",
        "TRAFFIC",
        "STREETLIGHT",
        "DRAINAGE",
        "PEDESTRIAN",
        "CYCLING",
        "OTHER"
    ]

    visible_evidence: str

    suggested_action: str

    priority: Literal[
        "LOW",
        "MEDIUM",
        "HIGH"
    ]


class IncidentInput(BaseModel):
    analysis: CivicAnalysis
    location: str
    description: str = ""
    latitude: float | None = None
    longitude: float | None = None


_firebase_initialization_lock = Lock()
_photo_update_lock = Lock()


@lru_cache(maxsize=1)
def incident_database():
    # Separate requests can miss the cache concurrently on first startup.
    with _firebase_initialization_lock:
        return initialize_incident_database()


def initialize_incident_database():
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
        project = os.getenv("FIREBASE_PROJECT_ID")
        credential_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not project and not credential_path:
            raise ValueError("Firebase configuration is missing")
        try:
            firebase_app = firebase_admin.get_app("civic-sentinel")
        except ValueError:
            credential = credentials.Certificate(credential_path) if credential_path else credentials.ApplicationDefault()
            firebase_app = firebase_admin.initialize_app(
                credential, {"projectId": project} if project else None, name="civic-sentinel"
            )
        return firestore.client(app=firebase_app)
    except Exception:
        logging.exception("Firestore initialization failed")
        raise HTTPException(503, "Firestore is not configured. Follow FIREBASE_SETUP.md and restart the backend.")


def normalize_incident_id(incident_id):
    from uuid import UUID
    try:
        return str(UUID(incident_id))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, "Invalid incident ID.")


def validate_incident_details(location, description, latitude, longitude):
    if not location.strip() or len(location) > 500 or len(description) > 5000:
        raise HTTPException(422, "Provide a location (up to 500 characters) and a description up to 5000 characters.")
    if (latitude is None) != (longitude is None):
        raise HTTPException(422, "Provide both GPS coordinates.")
    if latitude is not None and not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise HTTPException(422, "Invalid GPS coordinates.")


def save_incident(incident_id: str, incident: IncidentInput, user: dict):
    incident_id = normalize_incident_id(incident_id)
    validate_incident_details(incident.location, incident.description, incident.latitude, incident.longitude)
    db = incident_database()
    try:
        from firebase_admin import firestore
        from google.api_core.exceptions import AlreadyExists
        document = db.collection("incidents").document(incident_id)
        existing = document.get()
        if existing.exists:
            payload = existing.to_dict()
            require_editor(payload, user)
        else:
            payload = incident.model_dump()
            payload["created_by"] = user["uid"]
            payload["photo"] = photo_metadata(incident_id)
            payload.update({"status": "OPEN", "created_at": datetime.now(timezone.utc)})
            try:
                recent = db.collection("incidents").order_by(
                    "created_at", direction=firestore.Query.DESCENDING
                ).limit(250).stream()
                candidates = [dict(doc.to_dict(), id=doc.id) for doc in recent if doc.id != incident_id]
                matches = find_duplicates(payload, candidates)
                payload.update({"duplicate_check": "COMPLETED", "duplicate_matches": matches,
                                "duplicate_of": matches[0]["id"] if matches else None})
            except Exception:
                logging.exception("Duplicate check failed; preserving report")
                payload.update({"duplicate_check": "UNAVAILABLE", "duplicate_matches": [], "duplicate_of": None})
            try:
                document.create(payload)
            except AlreadyExists:
                payload = document.get().to_dict()
                require_editor(payload, user)
        return {"success": True, "incident_id": incident_id,
                "duplicate_check": payload.get("duplicate_check", "NOT_CHECKED"),
                "duplicate_matches": payload.get("duplicate_matches", []),
                "duplicate_of": payload.get("duplicate_of"),
                "photo": payload.get("photo")}
    except HTTPException:
        raise
    except Exception:
        logging.exception("Firestore save failed")
        raise HTTPException(503, "Could not save to Firestore. Check the Firebase configuration and retry.")


@app.post("/incidents/{incident_id}")
def retry_save_incident(incident_id: str, incident: IncidentInput, user: dict = Depends(require_user)):
    incident_id = normalize_incident_id(incident_id)
    return save_incident(incident_id, incident, user)


class StatusUpdate(BaseModel):
    status: Literal["OPEN", "IN_PROGRESS", "RESOLVED"]


@app.patch("/incidents/{incident_id}/status")
def update_incident_status(incident_id: str, update: StatusUpdate, user: dict = Depends(require_user)):
    incident_id = normalize_incident_id(incident_id)
    database = incident_database()
    try:
        document = database.collection("incidents").document(incident_id)
        snapshot = document.get()
        if not snapshot.exists:
            raise HTTPException(404, "Report not found.")
        current = snapshot.to_dict()
        require_editor(current, user)
        if current.get("status") == update.status:
            return {"success": True, "status": update.status,
                    "updated_at": current.get("updated_at"), "resolved_at": current.get("resolved_at")}
        timestamp = datetime.now(timezone.utc)
        changes = {"status": update.status, "updated_at": timestamp,
                   "resolved_at": timestamp if update.status == "RESOLVED" else None}
        document.update(changes)
        return {"success": True, **changes}
    except HTTPException:
        raise
    except Exception:
        logging.exception("Incident status update failed")
        raise HTTPException(503, "Could not save the status change. Please retry.")


@app.get("/incidents/{incident_id}/photo")
def get_incident_photo(incident_id: str, user: dict = Depends(require_user)):
    incident_id = normalize_incident_id(incident_id)
    target = photo_path(incident_id)
    try:
        document = incident_database().collection("incidents").document(incident_id).get()
    except HTTPException:
        raise
    except Exception:
        logging.exception("Evidence photo lookup failed")
        raise HTTPException(503, "Could not load evidence photo. Please retry.")
    if not document.exists or not document.to_dict().get("photo") or not target.is_file():
        raise HTTPException(404, "No evidence photo is available for this report.")
    return FileResponse(target, media_type="image/jpeg", headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"})


@app.post("/incidents/{incident_id}/photo")
async def attach_incident_photo(incident_id: str, image: UploadFile = File(...), user: dict = Depends(require_user)):
    incident_id = normalize_incident_id(incident_id)
    photo_path(incident_id)
    if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "Only JPG, PNG and WebP images are supported.")
    data = await image.read(10 * 1024 * 1024 + 1)
    prepared = await run_in_threadpool(prepare_photo, data)
    def attach():
        # Serialize replacements so a failed database write cannot lose earlier evidence.
        with _photo_update_lock:
            previous = None
            replaced = False
            target = photo_path(incident_id)
            try:
                document = incident_database().collection("incidents").document(incident_id)
                snapshot = document.get()
                if not snapshot.exists:
                    raise HTTPException(404, "Report not found. Save the report before adding its photo.")
                require_editor(snapshot.to_dict(), user)
                previous = target.read_bytes() if target.is_file() else None
                metadata = store_photo(incident_id, prepared)
                replaced = True
                document.update({"photo": metadata})
                return {"success": True, "photo": metadata}
            except HTTPException:
                raise
            except Exception:
                if replaced:
                    try:
                        if previous is not None:
                            store_photo(incident_id, previous)
                        else:
                            target.unlink(missing_ok=True)
                    except Exception:
                        logging.exception("Could not restore previous evidence after failed update")
                logging.exception("Evidence photo attachment failed")
                raise HTTPException(503, "Could not save evidence photo. Please retry.")
    return await run_in_threadpool(attach)


@app.get("/dashboard/summary")
def dashboard_summary(include_demo: bool = False, user: dict = Depends(require_user)):
    database = incident_database()
    try:
        # The dashboard totals are not limited to the latest 50 report cards.
        all_reports = [doc.to_dict() for doc in database.collection("incidents").stream()]
        reports = all_reports if include_demo else [report for report in all_reports if not is_demo_report(report)]
        return {"success": True, "include_demo": include_demo,
                "hidden_demo_count": 0 if include_demo else len(all_reports) - len(reports),
                **summarize_reports(reports),
                "generated_at": datetime.now(timezone.utc)}
    except Exception:
        logging.exception("Dashboard summary failed")
        raise HTTPException(503, "Could not load dashboard totals. Please refresh.")


@app.get("/incidents")
def list_incidents(limit: int = Query(50, ge=1, le=100), include_demo: bool = False, user: dict = Depends(require_user)):
    db = incident_database()
    try:
        from firebase_admin import firestore
        documents = db.collection("incidents").order_by(
            "created_at", direction=firestore.Query.DESCENDING
        ).stream()
        incidents = []
        for doc in documents:
            report = dict(doc.to_dict(), id=doc.id)
            if include_demo or not is_demo_report(report):
                report["can_edit"] = can_edit(report, user)
                report.pop("created_by", None)
                incidents.append(report)
                if len(incidents) == limit:
                    break
        return {"success": True, "incidents": incidents, "include_demo": include_demo}
    except Exception:
        logging.exception("Firestore listing failed")
        raise HTTPException(503, "Could not load saved reports from Firestore.")


# =====================================
# 5. HOME ROUTE
# =====================================

@app.get("/")
def home():

    return {
        "project": "Civic Sentinel",
        "status": "online",
        "version": "1.0"
    }


# =====================================
# 6. IMAGE ANALYSIS ENDPOINT
# =====================================

@app.post("/analyze")
async def analyze_image(

    image: UploadFile = File(...),

    location: str = Form(""),

    description: str = Form(""),

    latitude: float | None = Form(None),

    longitude: float | None = Form(None),

    user: dict = Depends(require_user)

):

    validate_incident_details(location, description, latitude, longitude)
    print("New analysis request received!", flush=True)

    # Check the uploaded image type

    allowed_types = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ]

    if image.content_type not in allowed_types:

        raise HTTPException(
            status_code=400,
            detail="Only JPG, PNG and WebP images are allowed."
        )

    # Read the image with a 10 MB limit

    image_bytes = await image.read(
        10 * 1024 * 1024 + 1
    )

    if len(image_bytes) > 10 * 1024 * 1024:

        raise HTTPException(
            status_code=413,
            detail="Image must be smaller than 10 MB."
        )

    if not image_bytes:

        raise HTTPException(
            status_code=400,
            detail="The uploaded image is empty."
        )


    prepared_photo = await run_in_threadpool(prepare_photo, image_bytes)

    # =================================
    # 7. CHECK GEMINI API KEY
    # =================================

    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:

        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is missing."
        )


    # =================================
    # 8. SEND IMAGE TO GEMINI
    # =================================

    try:

        print("Connecting to Gemini...", flush=True)

        client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=60000)
        )

        prompt = f"""
        You are Civic Sentinel, an AI civic
        infrastructure analysis assistant.

        Analyze the uploaded photograph.

        USER INFORMATION:

        Location: {location}

        Description: {description}

        YOUR TASK:

        1. Identify the main visible civic problem.

        2. Classify the problem using one of
           the permitted categories.

        3. Describe the visible evidence.

        4. Suggest an appropriate civic action.

        5. Estimate a preliminary priority.

        IMPORTANT RULES:

        Only report what the image supports.

        Treat the user's description and location
        as unverified information.

        Do not invent measurements or
        emergency conditions.

        If the image is unclear, mention
        that uncertainty.
        """

        response = await run_in_threadpool(

            client.models.generate_content,

            model="gemini-3.5-flash-lite",

            contents=[

                prompt,

                types.Part.from_bytes(
                    data=prepared_photo,
                    mime_type="image/jpeg"
                )

            ],

            config=types.GenerateContentConfig(

                response_mime_type="application/json",

                response_schema=CivicAnalysis

            )

        )


        # =================================
        # 9. VALIDATE THE RESPONSE
        # =================================

        if not response.text:

            raise ValueError(
                "Gemini returned an empty response."
            )

        result = CivicAnalysis.model_validate_json(
            response.text
        )

        print(
            "AI analysis completed!",
            flush=True
        )


        # =================================
        # 10. RETURN THE RESULT
        # =================================

        incident_id = str(uuid4())
        incident = IncidentInput(analysis=result, location=location, description=description,
                                 latitude=latitude, longitude=longitude)
        saved = False
        save_error = None
        save_result = {}
        photo_saved = False
        photo_error = None
        try:
            await run_in_threadpool(store_photo, incident_id, prepared_photo)
            photo_saved = True
        except Exception:
            logging.exception("Local photo storage failed")
            photo_error = "Analysis complete, but evidence photo could not be stored. Please retry."
        try:
            save_result = await run_in_threadpool(save_incident, incident_id, incident, user)
            saved = True
        except HTTPException as error:
            save_error = error.detail

        return {
            "incident_id": incident_id,
            "saved": saved,
            "save_error": save_error,
            "photo_saved": photo_saved,
            "photo_error": photo_error,
            "photo": save_result.get("photo"),
            "duplicate_check": save_result.get("duplicate_check", "NOT_CHECKED"),
            "duplicate_matches": save_result.get("duplicate_matches", []),
            "duplicate_of": save_result.get("duplicate_of"),

            "success": True,

            "location": location,

            "description": description,

            "analysis": result.model_dump()

        }


    # =================================
    # 11. HANDLE ERRORS
    # =================================

    except Exception as error:

        logging.error("AI analysis failed (%s)", type(error).__name__)

        raise HTTPException(
            status_code=502,
            detail="AI analysis could not complete. Please retry in a moment."
        )


@app.get("/auth/config")
def auth_configuration():
    return {"mode": auth_mode(), "firebase": {
        "apiKey": os.getenv("FIREBASE_WEB_API_KEY", ""),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
        "projectId": os.getenv("FIREBASE_PROJECT_ID", ""),
        "appId": os.getenv("FIREBASE_WEB_APP_ID", "")}}


@app.get("/auth/me")
def current_user(user: dict = Depends(require_user)):
    return user
