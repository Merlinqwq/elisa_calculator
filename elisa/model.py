"""Versioned annotations and settings, separate from measurements."""

from __future__ import annotations

import math

from .importer import ROWS

WELLS = {f"{r}{c}" for r in ROWS for c in range(1, 13)}
ROLES = {"blank", "standard", "unknown", "ignore"}
LAYOUT_VERSION = 2
DEFAULT_SETTINGS = {
    "blank_policy": "none", "primary_method": "A", "cv_warning_pct": 20.0,
    "recovery_min_pct": 80.0, "recovery_max_pct": 120.0,
    "max_rmse_od": 0.15, "min_response_span_od": 0.05,
}


def _finite_number(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def normalize_layout(layout: dict | None) -> tuple[dict, list[str]]:
    errors = []
    if not isinstance(layout, dict):
        errors.append("Layout must be a JSON object.")
        layout = {}
    version = layout.get("version", 1)
    if version not in (1, LAYOUT_VERSION):
        errors.append(f"Unsupported layout version {version}; expected version 1 or {LAYOUT_VERSION}.")
    for key in ("settings", "curves", "annotations"):
        if key in layout and not isinstance(layout[key], dict):
            errors.append(f"Layout {key} must be a JSON object.")
    supplied_settings = layout.get("settings") if isinstance(layout.get("settings"), dict) else {}
    settings = DEFAULT_SETTINGS | supplied_settings
    if version == 1 and settings["primary_method"] in {"A", "B"} and "primary_method" in supplied_settings:
        settings["primary_method"] = "B" if settings["primary_method"] == "A" else "A"
    if settings["blank_policy"] == "grouped":
        settings["blank_policy"] = "pooled"  # Import old layouts using the plate-wide blank.
    if settings["blank_policy"] not in {"none", "pooled"}:
        errors.append("Settings: blank policy must be none or pooled.")
    if settings["primary_method"] not in {"A", "B"}:
        errors.append("Settings: primary method must be A or B.")
    for key in ("cv_warning_pct", "recovery_min_pct", "recovery_max_pct", "max_rmse_od", "min_response_span_od"):
        value = _finite_number(settings.get(key))
        if value is None or value < 0:
            errors.append(f"Settings: {key} must be a finite nonnegative number.")
        else:
            settings[key] = value
    if all(isinstance(settings.get(k), (int, float)) for k in ("recovery_min_pct", "recovery_max_pct")):
        if settings["recovery_min_pct"] > settings["recovery_max_pct"]:
            errors.append("Settings: recovery minimum exceeds maximum.")
    curves = layout.get("curves") if isinstance(layout.get("curves"), dict) else {}
    clean_curves = {}
    for cid, curve in curves.items():
        cid = str(cid).strip()
        if not cid:
            errors.append("Curve ID cannot be blank.")
            continue
        if not isinstance(curve, dict):
            curve = {}
        clean_curves[cid] = {"units": str(curve.get("units") or "concentration units")}
    annotations = layout.get("annotations") if isinstance(layout.get("annotations"), dict) else {}
    clean_annotations = {}
    for well, annotation in annotations.items():
        well = str(well).upper().strip()
        if well not in WELLS:
            errors.append(f"Unknown well {well} in layout.")
            continue
        if not isinstance(annotation, dict):
            errors.append(f"{well}: annotation must be an object.")
            continue
        role = str(annotation.get("role") or "ignore").lower().strip()
        if role not in ROLES:
            errors.append(f"{well}: unsupported role {role}.")
            continue
        raw_include = annotation.get("include", role != "ignore")
        if not isinstance(raw_include, bool):
            errors.append(f"{well}: include must be true or false.")
        include = raw_include if isinstance(raw_include, bool) else False
        if role == "ignore" and include:
            errors.append(f"{well}: ignored well cannot be included.")
        note = str(annotation.get("exclusion_reason") or "").strip()
        if role != "ignore" and not include and not note:
            errors.append(f"{well}: excluded well needs a reason.")
        result = {
            "role": role, "include": include, "exclusion_reason": note,
            "curve_id": str(annotation.get("curve_id") or "").strip(),
            "sample_id": str(annotation.get("sample_id") or "").strip(),
            "replicate_group": str(annotation.get("replicate_group") or "").strip(),
            "nominal_concentration": None, "dilution_factor": None,
        }
        if role == "standard":
            concentration = _finite_number(annotation.get("nominal_concentration"))
            if concentration is None or concentration < 0:
                errors.append(f"{well}: standard concentration must be finite and nonnegative.")
            else:
                result["nominal_concentration"] = concentration
            if not result["curve_id"]:
                errors.append(f"{well}: standard requires a curve ID.")
        if role == "unknown":
            dilution = _finite_number(annotation.get("dilution_factor", 1))
            if dilution is None or dilution <= 0:
                errors.append(f"{well}: dilution factor must be finite and positive.")
            else:
                result["dilution_factor"] = dilution
            for key in ("curve_id", "sample_id"):
                if not result[key]:
                    errors.append(f"{well}: unknown requires {key}.")
        clean_annotations[well] = result
    return {
        "version": LAYOUT_VERSION, "settings": settings, "curves": clean_curves,
        "annotations": clean_annotations,
    }, errors


def layout_status_warnings(wells: list[dict], layout: dict) -> list[str]:
    """Compare saved import status snapshot to the new instrument export."""
    old = layout.get("source_status") if isinstance(layout.get("source_status"), dict) else {}
    current = {w["well"]: w["measurement_status"] for w in wells}
    return [f"{well}: saved {status}, current {current[well]}" for well, status in old.items()
            if well in current and status != current[well]]


def reusable_layout(layout: dict, wells: list[dict]) -> dict:
    normalized, errors = normalize_layout(layout)
    if errors:
        raise ValueError("; ".join(errors))
    normalized["source_status"] = {w["well"]: w["measurement_status"] for w in wells
                                    if w["well"] in normalized["annotations"]}
    return normalized
