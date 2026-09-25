"""ELISA analysis pipeline. Accepts plain records and layout; no UI dependency."""

from __future__ import annotations

import math
from collections import defaultdict
from statistics import mean, stdev

from .curve import fit_curve, invert_in_working_range
from .model import normalize_layout


def _stats(values):
    if not values:
        return None, None, None
    avg = mean(values)
    sd = stdev(values) if len(values) >= 2 else None
    cv = abs(sd / avg * 100) if sd is not None and avg != 0 else None
    return avg, sd, cv


def analyze(imported: dict, raw_layout: dict) -> dict:
    layout, errors = normalize_layout(raw_layout)
    if errors:
        raise ValueError("; ".join(errors))
    settings, annotations, curve_defs = layout["settings"], layout["annotations"], layout["curves"]
    wells = []
    for imported_well in imported["wells"]:
        well = imported_well["well"]
        annotation = annotations.get(well, {"role": "ignore", "include": False, "exclusion_reason": "",
                                            "curve_id": "", "sample_id": "",
                                            "replicate_group": "", "nominal_concentration": None,
                                            "dilution_factor": None})
        row = dict(imported_well) | annotation
        row.update({"corrected_od": None, "well_concentration": None,
                    "well_adjusted_concentration": None,
                    "result_status": "not_assigned", "flags": []})
        if row["role"] != "ignore":
            row["result_status"] = "pending"
            if not row["include"]:
                row["result_status"] = "excluded"
                row["flags"].append("Excluded: " + row["exclusion_reason"])
            elif row["measurement_status"] != "numeric":
                row["result_status"] = row["measurement_status"]
                row["flags"].append(f"Assigned {row['role']} has {row['measurement_status']} reading.")
        wells.append(row)
    by_well = {w["well"]: w for w in wells}
    global_errors = []
    for row in wells:
        if row["role"] in {"standard", "unknown"} and row["curve_id"] and row["curve_id"] not in curve_defs:
            message = f"{row['well']}: curve {row['curve_id']} is not defined."
            row["flags"].append(message)
            global_errors.append(message)
    included_blanks = [w for w in wells if w["role"] == "blank" and w["include"] and w["measurement_status"] == "numeric"]
    blank_means = {}
    if settings["blank_policy"] == "pooled":
        if included_blanks:
            blank_means["*"] = mean(w["raw_od"] for w in included_blanks)
        else:
            global_errors.append("Pooled blank correction requires at least one included numeric blank.")
    curve_errors = defaultdict(list)
    for row in wells:
        if row["measurement_status"] != "numeric":
            continue
        policy = settings["blank_policy"]
        if policy == "none":
            correction = 0.0
        elif policy == "pooled":
            correction = blank_means.get("*")
        else:
            correction = blank_means.get("*")
        if correction is not None:
            row["corrected_od"] = row["raw_od"] - correction
            if row["corrected_od"] < 0:
                row["flags"].append("Negative corrected OD retained; no clamping.")
        elif row["role"] in {"standard", "unknown"} and row["include"]:
            row["flags"].append("Required blank correction unavailable.")

    curve_ids = set(curve_defs) | {w["curve_id"] for w in wells if w["role"] in {"standard", "unknown"} and w["curve_id"]}
    curves = []
    observed_positive = {}
    for cid in sorted(curve_ids):
        definition = curve_defs.get(cid, {"units": "concentration units"})
        standard_rows = [w for w in wells if w["role"] == "standard" and w["curve_id"] == cid]
        usable = [w for w in standard_rows if w["include"] and w["corrected_od"] is not None and
                  w["measurement_status"] == "numeric" and w["nominal_concentration"] is not None]
        curve = fit_curve(usable, cid, definition["units"], settings)
        if cid not in curve_defs:
            curve_errors[cid].append("Curve ID is referenced but has no curve definition or units.")
        if curve_errors[cid]:
            curve["status"] = "invalid"
            curve["qc_status"] = "fail"
            curve["flags"].extend(curve_errors[cid])
        curve["blank_mean_od"] = (0.0 if settings["blank_policy"] == "none" else blank_means.get("*"))
        curves.append(curve)
        observed_positive[cid] = [w["corrected_od"] for w in usable if w["nominal_concentration"] > 0]
        for detail in curve["standard_details"]:
            row = by_well[detail["well"]]
            row["standard_predicted_od"] = detail["predicted_od"]
            row["standard_residual_od"] = detail["residual_od"]
            row["standard_recovery_pct"] = detail["recovery_pct"]
            row["result_status"] = "standard_used" if curve["status"] == "valid" else "standard_curve_invalid"
        for row in standard_rows:
            if row["result_status"] == "pending":
                row["result_status"] = "standard_not_used"
    curve_map = {curve["curve_id"]: curve for curve in curves}

    standards_qc = []
    for cid in sorted(curve_ids):
        levels = sorted({w["nominal_concentration"] for w in wells if w["role"] == "standard" and
                         w["curve_id"] == cid and w["nominal_concentration"] is not None})
        details = {d["well"]: d for d in curve_map[cid]["standard_details"]}
        for level in levels:
            rows = [w for w in wells if w["role"] == "standard" and w["curve_id"] == cid and
                    w["nominal_concentration"] == level]
            values = [w["corrected_od"] for w in rows if w["include"] and w["corrected_od"] is not None
                      and w["measurement_status"] == "numeric"]
            avg, sd, cv = _stats(values)
            standards_qc.append({
                "curve_id": cid, "nominal_concentration": level,
                "n_assigned": len(rows), "n_usable": len(values),
                "wells": ", ".join(w["well"] for w in rows),
                "statuses": ", ".join(f"{w['well']}:{w['measurement_status']}" for w in rows),
                "readings": ", ".join(f"{w['well']}:{w['raw_value']}" for w in rows),
                "mean_corrected_od": avg, "sd_corrected_od": sd, "cv_pct": cv,
                "back_calculated": ", ".join(f"{w['well']}:{details[w['well']]['back_calculated_concentration']:.6g}" if
                                               details[w["well"]]["back_calculated_concentration"] is not None else
                                               f"{w['well']}:undefined" for w in rows if w["well"] in details),
                "recovery_pct": ", ".join(f"{w['well']}:{details[w['well']]['recovery_pct']:.4g}" if
                                           details[w["well"]]["recovery_pct"] is not None else
                                           f"{w['well']}:n/a" for w in rows if w["well"] in details),
                "residual_od": ", ".join(f"{w['well']}:{details[w['well']]['residual_od']:.6g}" for w in rows if w["well"] in details),
                "flags": "; ".join(f"{w['well']}: {'; '.join(w['flags'])}" for w in rows if w["flags"]),
            })

    groups = defaultdict(list)
    for row in wells:
        if row["role"] == "unknown":
            group_name = row["replicate_group"] or row["sample_id"] or row["well"]
            groups[(row["sample_id"], group_name)].append(row)
    unknown_results = []
    for (sample_id, group_name), rows in sorted(groups.items()):
        included = [r for r in rows if r["include"]]
        links = {(r["curve_id"], r["dilution_factor"]) for r in included}
        flags = []
        mixed = len(links) > 1
        if mixed:
            flags.append("Sample group mixes curves or dilution factors; split explicitly.")
        curve_id, dilution = next(iter(links)) if len(links) == 1 else ("", None)
        curve = curve_map.get(curve_id)
        if curve is None and not mixed:
            flags.append("Assigned curve is missing.")
        elif curve is not None and curve["status"] != "valid":
            flags.append("Assigned curve is invalid; see curve QC.")
        if not included:
            flags.append("No included replicates.")
        per_well = []
        for row in included:
            if mixed:
                own_curve = curve_map.get(row["curve_id"])
                if row["measurement_status"] != "numeric":
                    row["result_status"] = row["measurement_status"]
                elif row["corrected_od"] is None:
                    row["result_status"] = "blank_correction_unavailable"
                elif own_curve is None or own_curve["status"] != "valid" or not observed_positive.get(row["curve_id"]):
                    row["result_status"] = "invalid_curve"
                else:
                    concentration, status = invert_in_working_range(row["corrected_od"], own_curve,
                                                                    observed_positive[row["curve_id"]])
                    row["well_concentration"] = concentration
                    row["well_adjusted_concentration"] = (concentration * row["dilution_factor"]
                                                          if concentration is not None else None)
                    row["result_status"] = status
                row["flags"].append("Mixed sample group; well result only. Split group for a sample result.")
            elif row["measurement_status"] != "numeric":
                row["result_status"] = row["measurement_status"]
            elif row["corrected_od"] is None:
                row["result_status"] = "blank_correction_unavailable"
            elif curve is None or curve["status"] != "valid" or row["curve_id"] != curve_id:
                row["result_status"] = "invalid_curve"
            elif not observed_positive.get(curve_id):
                row["result_status"] = "invalid_curve"
            else:
                concentration, status = invert_in_working_range(row["corrected_od"], curve,
                                                                observed_positive[curve_id])
                row["well_concentration"] = concentration
                row["well_adjusted_concentration"] = (concentration * row["dilution_factor"]
                                                      if concentration is not None else None)
                row["result_status"] = status
                if status != "ok":
                    row["flags"].append(status.replace("_", " "))
            if row["well_concentration"] is not None:
                per_well.append(row["well_concentration"])
            else:
                flags.append(f"{row['well']}: {row['result_status']}.")
        od_values = [r["corrected_od"] for r in included if r["corrected_od"] is not None] if not mixed else []
        mean_od, sd_od, cv_od = _stats(od_values)
        all_valid = bool(included) and len(per_well) == len(included) and not flags
        method_a = method_b = None
        status_b = "not_calculated"
        if all_valid:
            method_a = mean(per_well)
            method_b, status_b = invert_in_working_range(mean_od, curve, observed_positive[curve_id])
            if method_b is None:
                flags.append(f"Mean OD inversion failed: {status_b}.")
        primary = (method_a if settings["primary_method"] == "A" else method_b) if all_valid else None
        _, sd_conc, cv_conc = _stats(per_well) if not mixed else (None, None, None)
        if cv_od is not None and cv_od > settings["cv_warning_pct"]:
            flags.append(f"OD CV {cv_od:.1f}% exceeds warning threshold.")
        if cv_conc is not None and cv_conc > settings["cv_warning_pct"]:
            flags.append(f"Concentration CV {cv_conc:.1f}% exceeds warning threshold.")
        qc_warning = curve is not None and curve["qc_status"] == "fail"
        if qc_warning:
            flags.append("Assigned curve failed standard QC; inspect curve diagnostics before using this concentration.")
        unknown_results.append({
            "sample_id": sample_id, "replicate_group": group_name, "curve_id": curve_id,
            "units": curve["units"] if curve else None, "dilution_factor": dilution,
            "n_assigned": len(rows), "n": len(included), "n_valid": len(per_well),
            "wells": ", ".join(r["well"] for r in rows), "mean_corrected_od": mean_od,
            "sd_corrected_od": sd_od, "cv_corrected_od_pct": cv_od,
            "method_a_measured_concentration": method_a,
            "method_b_measured_concentration": method_b,
            "primary_method": settings["primary_method"],
            "primary_measured_concentration": primary,
            "dilution_adjusted_concentration": primary * dilution if primary is not None and dilution is not None else None,
            "partial_valid_mean_concentration": mean(per_well) if per_well and not all_valid and not mixed else None,
            "sd_concentration_method_a": sd_conc,
            "cv_concentration_method_a_pct": cv_conc,
            "status": ("quantified_qc_warning" if qc_warning else "quantified") if primary is not None else "unquantifiable",
            "flags": flags,
        })
    for row in wells:
        if row["result_status"] == "pending":
            row["result_status"] = "not_calculated"
    return {
        "filename": imported["filename"], "sheet": imported["sheet"],
        "settings": settings, "curves": curves, "unknown_results": unknown_results,
        "well_results": wells, "standards_qc": standards_qc,
        "errors": global_errors, "blank_means": blank_means,
    }
