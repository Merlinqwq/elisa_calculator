# ELISA Analysis Tool: step-by-step user guide

You do **not** need to understand curve fitting to use the tool. You do need your plate notes: which wells are blanks, which are standards, what concentration you put in each standard, which wells hold each unknown sample, and how much each unknown was diluted. The reader's Excel file contains OD readings; it cannot tell the app those assay details.

## 1. Open the working app

Double-click `start_elisa_tool.cmd` in this project folder. Keep its command window open. In Chrome, use **http://127.0.0.1:8765/**.

If Chrome's address bar shows a path ending in `web/index.html`, you opened the page as a file. The plate grid may appear, but import and analysis will not work. Click the local address in the yellow banner instead.

## 2. Import the Excel readings

Under **Step 1 Import Reader Plate**, click **Choose Plate Reader .xlsx** and select the plate reader file. The grid shows rows A–H and columns 1–12. A number in a well is its OD reading. A dash means empty. `OVRFLW` means the reader saturated; the tool will flag it rather than guess a number. Overflow can occur in **any** well, or nowhere.

The Excel file may contain only part of a plate. It needs labeled rows (A–H) and numbered well columns (1–12), but it does not need all eight rows or all twelve columns. The app places each reading at its labeled position and leaves positions absent from the file empty.

If the workbook has more than one plate-shaped sheet, choose the sheet with **OD readings**, then click **Import Selected Sheet**. A trailing `450` wavelength marker is not a well column.

Click a row or column header to select that entire row or column. **Select all** selects the plate and **Invert** switches selected and unselected wells. **Clear** removes the selection highlight without changing assignments.

## 3. Mark your blanks (if you used blanks)

Drag across the blank wells to select them. Hold **Ctrl** while clicking or dragging to add wells that are not next to the first selection. Choose **Blank**, then click **Assign Selected Wells**. You can click **Preview Assignment** first if you want to review or edit each row. All included numeric blanks make one mean for the entire plate.

If your assay has no blank wells to subtract, skip this step and leave **Blank Subtraction Policy** set to **None (Raw OD)** later.

## 4. Mark your standards

Select the standard wells by dragging. Choose **Standard (Calibrator)** and enter:

| Box | What to enter |
| --- | --- |
| **Standard curve ID** | A name for this set of standards, such as `standard1`. The matching unknowns must use the **same** ID. |
| **Concentration Units** | The unit of the standard concentrations, such as `ng/mL`. |
| **Concentrations (comma-separated)** | The actual concentrations **in the assay wells**, in the order you want assigned. Example: `0, 1, 2, 4, 8`. These values come from your plate setup, not the OD file. |
| **Replicates per Level** | How many wells received each concentration. Example: `2` for duplicates. For just one concentration, every selected well receives it automatically. |
| **Replicate direction** | **Across rows** or **Down columns**. This controls the order in which selected wells are grouped into replicates. |

Click **Assign Selected Wells** to apply the values immediately. This also creates the named standard curve, so there is no separate add-curve step. **Preview Assignment** remains available when you want to check or edit each well before committing.

**Small example:** Suppose your duplicate standards occupy A1–B5: rows A and B, columns 1–5. Select the rectangle from A1 to B5. Enter `0, 1, 2, 4, 8`, set replicates to `2`, and choose **Down columns**. The preview should show:

| Wells | Concentration |
| --- | ---: |
| A1, B1 | 0 |
| A2, B2 | 1 |
| A3, B3 | 2 |
| A4, B4 | 4 |
| A5, B5 | 8 |

This is only an example; use your **real** plate layout and concentrations. Each curve needs at least **three different usable standard concentrations**. The app fits 3PL at three levels and 4PL at four or more levels. The 3PL bottom is fixed at zero after blank correction. If a standard well overflows, a valid replicate at the same level can still be used, but the overflow is flagged.

## 5. Mark your unknown samples

Select the wells for one or more unknowns. Choose **Unknown Sample** and enter:

- **Assigned Standard Curve:** choose a curve whose standard wells you already assigned. The Unknown assignment button stays unavailable until you assign standards; choose **Standard (Calibrator)** and enter their concentrations first.
- **Sample Name / Prefix:** your sample name. The default groups all selected wells as one sample. To create several groups, change **Replicates per Sample**; the app then numbers them, such as `Sample1`, `Sample2`.
- **Replicates per Sample:** `2` for duplicates, `3` for triplicates, and so on.
- **Dilution factor:** `1` if undiluted; `10` if you diluted the original sample 1:10 before loading the well.
- **Replicate direction:** how replicate wells run across the selection.

Click **Assign Selected Wells** to apply them immediately. Use **Preview Assignment** if you want to check each well's sample name, standard curve, group, and dilution or edit an irregular well first. If unknowns use another standard curve, assign those standards under another ID, then choose it from the dropdown.

## 6. Choose analysis settings and run

Under **Step 3 Calibration Analysis & Report**:

1. Choose **Blank Subtraction Policy**: **None (Raw OD)** or **Subtract Global Plate Blank Mean**. Use the correction specified by your assay protocol.
2. Leave **Primary Quantification Method** at **Method A** for the default: calculate a concentration from each usable replicate, then average those concentrations. Method **B** calculates a concentration from the mean replicate OD. The report shows both when available. Older saved layouts are converted when loaded so the calculation you chose before stays the same.
3. Leave the QC thresholds at their defaults unless your lab has a reason to change them. **Replicate CV% Warning Limit** compares replicate OD readings at the same standard concentration: sample standard deviation ÷ absolute mean OD × 100. Its threshold also warns for unknown sample replicate OD and calculated concentration. **Min Standard OD Spread** is the highest minus lowest corrected OD across all usable standard wells assigned to one curve. Hover over or focus a **?** beside a setting to read its explanation. These are software checks, not validated detection limits.
4. Click **Run Analysis & Curve Fitting**. The app automatically chooses 3PL or 4PL from the number of usable standard concentrations.

## 7. Read the results

Results use five tabs:

| Tab | What it shows |
| --- | --- |
| **Concentration Plate** | The main grid follows the plate's row and column positions. Unknown cells show individual well concentration multiplied by that well's dilution factor. `REF` identifies a standard. `0` means below the lowest tested positive standard, **not** a measured zero. Use the switch button to view blank-corrected OD instead. |
| **Standard Curves** | Each curve's numeric 3PL or 4PL equation, fitted parameters, plot, tested range, and fit/QC flags. **FIT OK** means the numerical fit met the fit checks. A QC failure remains visible here even when unknown concentrations are calculated. |
| **Unknown Samples** | One summary per sample group. **Primary Measured** is the concentration in the diluted assay well; **Dilution-Adjusted** estimates the original sample concentration. |
| **Calibrator Recovery & Levels** | Standard replicate counts, OD variation, back-calculated concentrations, recovery percentages, residuals, and flags. |
| **96-Well Full Audit** | Original readings, assignments, corrected OD, individual well concentrations, dilution-adjusted concentrations, and flags. |

When fitted parameters exist, a failed standard curve QC or fit check does not automatically hide unknown concentrations. Computed results are highlighted in amber, carry diagnostic tooltips, and receive the sample status **quantified_qc_warning**. Review the associated curve flags before interpreting them. A **NO FIT** result means a concentration could not be fitted or calculated.

Units come from the selected standard curve. The grid and Unknown Samples tab do not put a unit next to each concentration, so check the curve definitions if curves use different units. The detailed workbook includes units.

An included unknown replicate that is empty, overflow, invalid, or outside the tested range makes the **whole sample's primary result blank**. Other valid wells remain visible. Do not exclude a problem well just to force a number; exclude it only when you have a real experimental reason, and record that reason.

## 8. Fix a mistake

Select one or more wells, then click **Edit Wells in Table**. Each selected well has its own row, so you can change their assignments together and click **Save Selected Wells** once. You can also choose a role and parameters, then click **Assign Selected Wells** to change the selected wells together without opening a preview. Choose **unassigned** in a table row to clear that well's assignment; its OD reading stays on the plate. If you uncheck **Include** for an assigned well, enter an **Exclusion reason**. For a single well, **Clear [well name] Assignment** is a shortcut. Click **Run Analysis & Curve Fitting** after a change. **Undo edit** reverses the whole last save or clearing action; click it again to undo earlier edits. **Clear** only removes the selection highlight. **Clear Current Layout** erases annotations, standard curves, settings, and results for the loaded plate; **Undo edit** can restore the layout. It does not delete a JSON file you downloaded.

## 9. Save your work

- **Download Analysis Workbook (.xlsx)** saves the report. Its first sheet is the concentration plate; amber cells need QC review. Numeric concentrations remain numeric when a fitted curve has warning flags, and cell comments explain the flags. Later sheets contain summary, samples, every well, standards/QC, standard curve fits and plots, and settings.
- **Export Layout JSON** saves the well assignments and analysis settings. This is the file to reuse with a later plate reader export.

For a later run, upload the new `.xlsx` first, then choose **Load Layout JSON**. Review the preview and any warnings about wells whose reading status changed, then click **Apply Saved Layout** and rerun analysis. The JSON carries annotations; it does **not** replace the new OD readings.

After downloading an updated version of the tool, stop the running Python server with **Ctrl+C**, start it again, and refresh the browser. Save your layout first, then reimport the workbook and layout after refreshing. This makes the server use the updated calculation code.

## If something does not work

| What you see | What to check |
| --- | --- |
| Yellow warning at the top, import disabled | Use `http://127.0.0.1:8765/`, not a `file://` path. Start the server with `start_elisa_tool.cmd` if needed. |
| Standard assignment says the count does not match | With multiple concentrations, number of concentrations × replicates per level must cover the selected wells (a partial final level is allowed). Check the selection and replicate direction. |
| Curve says invalid | Check the standard concentrations and units, at least three different usable levels, blank correction, overflow wells, and fit flags. |
| Unknown concentration is blank | Check that its standard curve exists and has fitted parameters, all included replicates are numeric and in range, and no included well has overflow. A curve QC warning alone does not suppress an available concentration. |
| Unknown concentration is amber | Open **Standard Curves** and inspect the fit/QC flags; hover over the result cell for details. A displayed number can still carry a curve warning. |
| Saved layout warns that wells changed | Check those well locations against the new reader export before applying the layout. |

If you are unsure what a field means for **your** assay, stop before committing an assignment and check the plate notes. The tool cannot infer sample identity or standard concentrations from OD values alone.
