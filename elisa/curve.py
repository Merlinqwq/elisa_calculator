"""Three- and four-parameter logistic fitting and inversion."""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
from scipy.optimize import least_squares
from scipy.special import expit

EQUATION = "y = bottom + (top - bottom) * x^slope / (EC50^slope + x^slope); x=0 gives bottom"
EQUATION_3PL = "y = top * x^slope / (EC50^slope + x^slope); bottom = 0 after blank correction"


def four_pl(x, bottom: float, top: float, ec50: float, slope: float):
    values = np.asarray(x, dtype=float)
    z = np.zeros_like(values)
    positive = values > 0
    z[positive] = expit(slope * (np.log(values[positive]) - math.log(ec50)))
    result = bottom + (top - bottom) * z
    return float(result) if result.ndim == 0 else result


def inverse_four_pl(y: float, params: dict) -> float | None:
    bottom, top, ec50, slope = (params[k] for k in ("bottom", "top", "ec50", "slope"))
    if not all(math.isfinite(v) for v in (y, bottom, top, ec50, slope)) or top == bottom:
        return None
    fraction = (y - bottom) / (top - bottom)
    if not 0 < fraction < 1:
        return None
    try:
        x = ec50 * math.exp(math.log(fraction / (1 - fraction)) / slope)
    except (OverflowError, ValueError, ZeroDivisionError):
        return None
    return x if math.isfinite(x) else None


def fit_curve(observations: list[dict], curve_id: str, units: str, settings: dict) -> dict:
    """Observations have nominal_concentration and corrected_od; one per usable standard well."""
    result = {
        "curve_id": curve_id, "units": units, "equation": EQUATION,
        "model_type": None, "fitted_equation": None,
        "fit_status": "not_fit", "qc_status": "not_evaluated", "status": "invalid",
        "flags": [], "parameters": None, "n_wells": len(observations),
        "n_levels": len({o["nominal_concentration"] for o in observations}),
        "range_low": None, "range_high": None, "response_low": None,
        "response_high": None, "rmse_od": None, "r_squared": None,
        "direction": None, "standard_details": [], "level_details": [],
    }
    if result["n_levels"] < 3:
        result["flags"].append("Fewer than three unique usable standard concentrations.")
        return result
    three_pl = result["n_levels"] == 3
    result["model_type"] = "3PL" if three_pl else "4PL"
    result["equation"] = EQUATION_3PL if three_pl else EQUATION
    if result["n_levels"] == 4:
        result["flags"].append("Minimal four-level curve; inspect QC carefully.")
    positive_levels = sorted({float(o["nominal_concentration"]) for o in observations if o["nominal_concentration"] > 0})
    if len(positive_levels) < 2:
        result["flags"].append("At least two positive standard concentrations are required.")
        return result
    result["range_low"], result["range_high"] = positive_levels[0], positive_levels[-1]
    x = np.array([o["nominal_concentration"] for o in observations], dtype=float)
    y = np.array([o["corrected_od"] for o in observations], dtype=float)
    if not np.isfinite(x).all() or not np.isfinite(y).all():
        result["flags"].append("Nonfinite standard data.")
        return result
    observed_span = float(np.max(y) - np.min(y))
    by_level = defaultdict(list)
    for observation in observations:
        by_level[float(observation["nominal_concentration"])].append(float(observation["corrected_od"]))
    means = {level: float(np.mean(values)) for level, values in by_level.items()}
    sorted_levels = sorted(means)
    observed_direction = np.sign(means[sorted_levels[-1]] - means[sorted_levels[0]])
    if observed_direction == 0:
        result["flags"].append("No monotone endpoint response trend.")
        return result
    result["direction"] = "increasing" if observed_direction > 0 else "decreasing"
    spread = max(observed_span, 0.1)
    y_lower = float(np.min(y) - max(1.0, 3 * spread))
    y_upper = float(np.max(y) + max(10.0, 20 * spread))
    if three_pl:
        if observed_direction < 0:
            result["flags"].append("3PL with fixed zero bottom requires an increasing standard response.")
            return result
        lower = np.array([max(1e-12, float(np.min(y)) * .001), math.log(positive_levels[0] / 1000), 0.05])
        upper = np.array([y_upper, math.log(positive_levels[-1] * 1000), 8.0])
    else:
        lower = np.array([y_lower, y_lower, math.log(positive_levels[0] / 1000), 0.05])
        upper = np.array([y_upper, y_upper, math.log(positive_levels[-1] * 1000), 8.0])

    def predict(p):
        zero = np.zeros_like(x)
        positive = x > 0
        zero[positive] = expit(p[-1] * (np.log(x[positive]) - p[-2]))
        return p[0] * zero if three_pl else p[0] + (p[1] - p[0]) * zero

    initial_bottom = means[sorted_levels[0]]
    initial_top = means[sorted_levels[-1]]
    candidates = []
    for slope in (0.5, 1.0, 2.0, 4.0):
        for ec50 in (math.sqrt(positive_levels[0] * positive_levels[-1]),
                     float(np.median(positive_levels))):
            p0 = np.array([max(initial_top, .001), math.log(ec50), slope] if three_pl else
                          [initial_bottom, initial_top, math.log(ec50), slope])
            p0 = np.clip(p0, lower + 1e-9, upper - 1e-9)
            try:
                fitted = least_squares(lambda p: predict(p) - y, p0, bounds=(lower, upper),
                                       max_nfev=5000, x_scale="jac")
                if fitted.success and np.isfinite(fitted.x).all():
                    candidates.append(fitted)
            except (ValueError, FloatingPointError):
                continue
    if not candidates:
        result["flags"].append(f"{result['model_type']} optimization failed to converge.")
        return result
    fitted = min(candidates, key=lambda value: float(np.sum(value.fun ** 2)))
    if three_pl:
        bottom = 0.0
        top, log_ec50, slope = map(float, fitted.x)
    else:
        bottom, top, log_ec50, slope = map(float, fitted.x)
    params = {"bottom": bottom, "top": top, "ec50": math.exp(log_ec50), "slope": slope}
    result["parameters"] = params
    if three_pl:
        result["fitted_equation"] = (f"y = ({top:.17g}) * x^({slope:.17g}) / "
                                     f"(({params['ec50']:.17g})^({slope:.17g}) + x^({slope:.17g}))")
    else:
        result["fitted_equation"] = (f"y = ({bottom:.17g}) + (({top:.17g}) - ({bottom:.17g})) * "
                                     f"x^({slope:.17g}) / (({params['ec50']:.17g})^({slope:.17g}) + x^({slope:.17g}))")
    result["fit_status"] = "converged"
    predicted = predict(fitted.x)
    residuals = y - predicted
    result["rmse_od"] = float(np.sqrt(np.mean(residuals ** 2)))
    ss_total = float(np.sum((y - np.mean(y)) ** 2))
    result["r_squared"] = float(1 - np.sum(residuals ** 2) / ss_total) if ss_total > 0 else None
    result["response_low"] = four_pl(result["range_low"], **params)
    result["response_high"] = four_pl(result["range_high"], **params)
    numerical_errors = []
    if (top - bottom) * observed_direction <= 0:
        numerical_errors.append("Fitted direction disagrees with measured trend.")
    try:
        singular = np.linalg.svd(fitted.jac, compute_uv=False)
        condition = float(singular[0] / singular[-1]) if singular[-1] > 0 else math.inf
    except np.linalg.LinAlgError:
        condition = math.inf
    result["jacobian_condition"] = condition if math.isfinite(condition) else None
    if not math.isfinite(condition) or condition > 1e8:
        numerical_errors.append(f"{result['model_type']} parameters are not numerically identifiable (Jacobian ill-conditioned).")
    closeness = np.minimum((fitted.x - lower) / (upper - lower), (upper - fitted.x) / (upper - lower))
    if np.any(closeness < 1e-4):
        numerical_errors.append(f"A fitted parameter is at a bound; {result['model_type']} is not identifiable.")
    if numerical_errors:
        result["fit_status"] = "nonidentifiable"
        result["flags"].extend(numerical_errors)
    qc_errors = []
    if observed_span < settings["min_response_span_od"]:
        qc_errors.append(f"Observed standard response span {observed_span:.4g} OD is below threshold.")
    if result["rmse_od"] > settings["max_rmse_od"]:
        qc_errors.append(f"Fit RMSE {result['rmse_od']:.4g} OD exceeds threshold.")
    for observation, prediction, residual in zip(observations, predicted, residuals):
        nominal = float(observation["nominal_concentration"])
        recovered = inverse_four_pl(float(observation["corrected_od"]), params) if nominal > 0 else None
        recovery_pct = recovered / nominal * 100 if recovered is not None and nominal > 0 else None
        detail = {
            "well": observation["well"], "nominal_concentration": nominal,
            "corrected_od": float(observation["corrected_od"]),
            "predicted_od": float(prediction), "residual_od": float(residual),
            "back_calculated_concentration": recovered, "recovery_pct": recovery_pct,
        }
        result["standard_details"].append(detail)
        if nominal > 0 and recovered is None:
            qc_errors.append(f"{observation['well']}: positive-standard recovery undefined outside curve asymptotes.")
        elif recovery_pct is not None and not settings["recovery_min_pct"] <= recovery_pct <= settings["recovery_max_pct"]:
            qc_errors.append(f"{observation['well']}: recovery {recovery_pct:.1f}% outside threshold.")
    for level in sorted_levels:
        values = by_level[level]
        sd = float(np.std(values, ddof=1)) if len(values) >= 2 else None
        mean = float(np.mean(values))
        cv = abs(sd / mean * 100) if sd is not None and mean != 0 else None
        result["level_details"].append({
            "curve_id": curve_id, "nominal_concentration": level,
            "n_numeric": len(values), "mean_od": mean, "sd_od": sd, "cv_pct": cv,
        })
        if cv is not None and cv > settings["cv_warning_pct"]:
            result["flags"].append(f"Level {level:g}: replicate OD CV {cv:.1f}% exceeds warning threshold.")
    result["qc_status"] = "fail" if qc_errors else "pass"
    result["flags"].extend(qc_errors)
    result["status"] = "valid" if result["fit_status"] == "converged" else "invalid"
    return result


def invert_in_working_range(y: float, curve: dict, observed_positive_od: list[float]) -> tuple[float | None, str]:
    if curve["status"] != "valid":
        return None, "invalid_curve"
    low_response = min(curve["response_low"], curve["response_high"])
    high_response = max(curve["response_low"], curve["response_high"])
    observed_low, observed_high = min(observed_positive_od), max(observed_positive_od)
    if y < max(low_response, observed_low) - 1e-10:
        return None, "below_response_range" if curve["direction"] == "increasing" else "above_response_range"
    if y > min(high_response, observed_high) + 1e-10:
        return None, "above_response_range" if curve["direction"] == "increasing" else "below_response_range"
    concentration = inverse_four_pl(y, curve["parameters"])
    if concentration is None:
        return None, "outside_invertible_response"
    if concentration < curve["range_low"] * (1 - 1e-10):
        return None, "below_tested_concentration_range"
    if concentration > curve["range_high"] * (1 + 1e-10):
        return None, "above_tested_concentration_range"
    return concentration, "ok"
