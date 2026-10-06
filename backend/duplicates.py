"""Conservative, explainable duplicate candidates for the local hackathon MVP."""
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
import math
import re
from report_visibility import is_demo_report

STOPWORDS = {"the", "a", "an", "and", "with", "is", "are", "of", "in", "on", "to", "for", "visible", "image", "shows", "road", "surface"}


def tokens(text):
    return set(re.findall(r"[a-z0-9]+", text.lower())) - STOPWORDS


def distance_meters(lat1, lon1, lat2, lon2):
    lat1, lat2 = math.radians(lat1), math.radians(lat2)
    dlat = lat2 - lat1
    dlon = math.radians(lon2 - lon1)
    value = math.sin(dlat / 2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon / 2)**2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(value)))


def coordinates(report):
    lat, lon = report.get("latitude"), report.get("longitude")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180:
        return lat, lon
    return None


def sector(location):
    match = re.fullmatch(r"\s*sector\s+(\d+)\s*,\s*chandigarh\s*", location, re.I)
    return match.group(1) if match else None


def find_duplicates(incident, candidates, now=None):
    now = now or datetime.now(timezone.utc)
    matches = []
    analysis = incident["analysis"]
    for candidate in candidates:
        if is_demo_report(incident) != is_demo_report(candidate):
            continue
        other = candidate.get("analysis", {})
        created = candidate.get("created_at")
        if not isinstance(created, datetime):
            continue
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if not now - timedelta(days=30) <= created <= now or candidate.get("status") not in ("OPEN", "IN_PROGRESS") or candidate.get("duplicate_of"):
            continue
        if other.get("category") != analysis["category"] or analysis["category"] == "OTHER":
            continue
        first, second = coordinates(incident), coordinates(candidate)
        distance = None
        if first and second:
            distance = distance_meters(*first, *second)
            if distance > 100:
                continue
            location_reason = f"GPS locations are {round(distance)} m apart"
        elif not first and not second and sector(incident.get("location", "")) and sector(incident["location"]) == sector(candidate.get("location", "")):
            location_reason = "Same sector; exact distance is unknown"
        else:
            continue
        left = tokens(analysis["problem"] + " " + analysis["visible_evidence"])
        right = tokens(other.get("problem", "") + " " + other.get("visible_evidence", ""))
        similarity = len(left & right) / len(left | right) if left | right else 0
        title_similarity = SequenceMatcher(None, analysis["problem"].lower(), other.get("problem", "").lower()).ratio()
        # Require both substantial wording overlap and a similar problem title.
        if similarity < 0.45 or title_similarity < 0.65:
            continue
        matches.append({"id": candidate["id"], "problem": other["problem"],
                        "location": candidate.get("location", ""),
                        "reason": f"{location_reason}; same category and similar problem/evidence",
                        "distance_meters": round(distance) if distance is not None else None,
                        "text_similarity": round(similarity, 2)})
    matches.sort(key=lambda match: (-match["text_similarity"], match["distance_meters"] if match["distance_meters"] is not None else float("inf")))
    return matches[:3]
