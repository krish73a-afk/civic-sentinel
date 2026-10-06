"""Counts across all saved reports, independent of the report-list page size."""
from collections import Counter


def summarize_reports(reports):
    status = Counter({"OPEN": 0, "IN_PROGRESS": 0, "RESOLVED": 0, "UNKNOWN": 0})
    priority = Counter({"HIGH": 0, "MEDIUM": 0, "LOW": 0, "UNKNOWN": 0})
    category = Counter({name: 0 for name in ("ROAD", "WASTE", "TRAFFIC", "STREETLIGHT", "DRAINAGE", "PEDESTRIAN", "CYCLING", "OTHER")})
    total = duplicate_count = 0
    for report in reports:
        total += 1
        current = report.get("status", "UNKNOWN")
        status[current if current in status else "UNKNOWN"] += 1
        analysis = report.get("analysis") or {}
        current = analysis.get("priority", "UNKNOWN")
        priority[current if current in priority else "UNKNOWN"] += 1
        current = analysis.get("category", "OTHER")
        category[current if current in category else "OTHER"] += 1
        duplicate_count += bool(report.get("duplicate_of"))
    return {"total": total, "by_status": dict(status), "by_priority": dict(priority),
            "by_category": dict(category), "possible_duplicates": duplicate_count}
