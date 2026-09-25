# ELISA Analysis Tool

This local Python app imports a 96-well `.xlsx` reader export, lets you map wells by pointer drag, fits independent 3PL or 4PL standard curves, and produces a report workbook plus a reusable layout JSON. It listens only on `127.0.0.1`; uploaded data stays on the local computer.

For a beginner walkthrough, see [USER_GUIDE.md](USER_GUIDE.md).

## Python requirements

- **Tested platform:** The app has only been tested on **Windows with Python 3.13.5**. macOS, Linux, and other Python versions have not been tested.
- Python with `pip` is required. A virtual environment is optional.
- Install the packages listed in [`requirements.txt`](requirements.txt): NumPy ≥2.0, SciPy ≥1.11, openpyxl ≥3.1, and Matplotlib ≥3.8.

From this folder in PowerShell, install the packages once:

```powershell
python -m pip install -r requirements.txt
```

## Start

On Windows, double-click `start_elisa_tool.cmd` in this folder. It starts the local server and opens the app in your browser. Keep the command window open while using the tool.

Alternatively, from this folder in PowerShell:

```powershell
python -m elisa.server
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/) in a browser. Do not open `web/index.html` directly; the app needs the local Python server for import and analysis. Press Ctrl+C in the server terminal to stop it.

## Plate workflow

1. Upload the reader workbook. The app scans for labeled plate rows A–H and numbered well columns 1–12. The workbook may omit rows or columns, including columns between two supplied well numbers; unprovided positions stay empty in the 96-well view. When multiple sheets look like plates, choose the OD reading sheet. A trailing wavelength value such as `450` is not a well column. Empty, numeric, overflow, and invalid readings are distinct. An ambiguous block within a sheet is rejected rather than guessed.
2. Drag across the grid to select a rectangle; hold Ctrl or ⌘ while dragging to add another region. Pick **Standard**, **Unknown**, **Blank**, or **Ignored**, enter parameters, then click **Assign selected wells**. **Preview assignment** is optional and lets you edit each well before committing. Select one or more wells and use **Edit selected wells in table** to change their assignments together. Clear the selection or undo the latest assignment.
3. Assign standards first: enter a standard curve ID, units, ordered concentration series, replicates per level, and replicate direction. Assigning standard wells creates the curve automatically. A single concentration applies to all selected wells; with multiple levels, a partial final level is allowed. For unknowns, choose a curve with assigned standard wells from the dropdown, enter a sample name or prefix, replicates per sample, and dilution factor. One group keeps the exact name; multiple groups get numbered names. Edit individual names, concentrations, dilutions, exclusions, and groups in the optional preview. Assigned overflow or missing readings are shown as warnings and never treated as numeric.
4. Define curve units, choose plate-wide blank correction and a primary method, then run analysis. Edit assignments or QC settings and rerun. The main result is a concentration plate; detailed QC is collapsible and opens for problems. Download the workbook and layout JSON. Load the JSON against a later reader export to preview annotations and changes in annotated well measurement statuses before applying it. Clear the current layout when starting over.

## Analysis conventions

- Equation: `y = bottom + (top-bottom) * x^slope / (EC50^slope + x^slope)`, with `x=0` giving `bottom`, positive `EC50` and positive slope magnitude. `top < bottom` represents a decreasing response. Zero standards can inform the fit but are excluded from positive-standard recovery percentages and the working interpolation range.
- Individual usable numeric standard wells are fitted by bounded nonlinear least squares. Three **unique** usable concentrations use a 3PL curve with bottom fixed at zero after correction. Four or more use 4PL. Fewer than three fail the count threshold. A numerically nonidentifiable fit cannot produce concentrations. QC warnings remain visible without suppressing a numerically valid curve.
- Default exploratory QC checks an absolute observed response span of at least 0.05 OD, RMSE no greater than 0.15 OD, and each positive standard's back-calculated recovery within 80–120%. A replicate CV above 20% warns without removing data. Thresholds are editable. R² is supplementary.
- Blank correction is none (default) or one global mean of all included numeric blank wells. The same correction is applied to all curves and unknowns. Raw readings remain unchanged and negative corrected OD is retained.
- Unknown inversion is allowed only within the lowest and highest **positive usable standard concentrations**, the fitted responses at those concentrations, and the measured positive-standard OD span. This is an interpolation policy, **not** a validated LLOQ/ULOQ.
- Method A calculates a concentration for each included replicate and averages those concentrations (default). Method B converts the mean included replicate OD once. Both are shown when valid. If any included replicate is missing, invalid, overflow, or out of range, the sample's primary result is blank; valid individual well results remain visible. A reasoned exclusion stays in the audit trail and is omitted from `n` and calculations. The chosen measured concentration is multiplied by the dilution factor to report the original sample concentration. Version 1 saved layouts are converted when loaded so their original calculation is preserved under the new method letter.
- The workbook starts with `Concentration Plate`, then `Summary`, `Unknown Results`, `Well Results`, `Standards & QC`, `Standard Curves`, and `Settings`. The first sheet contains dilution-adjusted concentrations by well and uses `0` as a labeled below-range sentinel. Labeled standard curve plots and fitted numeric equations are in `Standard Curves`. Numeric results are stored at full calculated precision; rounding is only for display.

The software reports exploratory curve QC, not assay validation. It does not estimate validated detection limits, automatically remove outliers, model censored overflow readings, or pool plates.

## AI use disclosure

This tool and its documentation were developed with assistance from OpenAI Codex, including code implementation, debugging, and review. The analysis methods and results should be independently validated against your assay requirements before scientific or clinical use.
