"""Recognize explicitly labeled demo records, preserving all saved data."""
def is_demo_report(report):
    analysis = report.get("analysis") or {}
    return report.get("is_demo") is True or str(analysis.get("problem", "")).startswith(("DEMO TEST —", "SETUP TEST —"))
