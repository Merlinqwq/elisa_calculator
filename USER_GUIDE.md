# ELISA Analysis Tool: step-by-step user guide

You do **not** need to understand curve fitting to use the tool. You do need your plate notes: which wells are blanks, which are standards, what concentration you put in each standard, which wells hold each unknown sample, and how much each unknown was diluted. The reader's Excel file contains OD readings; it cannot tell the app those assay details.

## 1. Open the working app

Double-click `start_elisa_tool.cmd` in this project folder. Keep its command window open. In Chrome, use **http://127.0.0.1:8765/**.

If Chrome's address bar shows a path ending in `web/index.html`, you opened the page as a file. The plate grid may appear, but import and analysis will not work. Click the local address in the yellow banner instead.

## 2. Import the Excel readings

Under **1. Import plate**, click **Choose file** and select the plate reader `.xlsx` file. The grid shows rows A–H and columns 1–12. A number in a well is its OD reading. A dash means empty. `OVRFLW` means the reader saturated; the tool will flag it rather than guess a number. Overflow can occur in **any** well, or nowhere.

The Excel file may contain only part of a plate. It needs labeled rows (A–H) and numbered well columns (1–12), but it does not need all eight rows or all twelve columns. The app places each reading at its labeled position and leaves positions absent from the file empty.

If the workbook has more than one plate-shaped sheet, choose the sheet with **OD readings**. A trailing `450` wavelength marker is not a well column.

## 3. Mark your blanks (if you used blanks)

Drag across the blank wells to select them. Hold **Ctrl** while clicking or dragging to add wells that are not next to the first selection. Choose **Blank**, then click **Assign selected wells**. You can click **Preview assignment** first if you want to review or edit each row. All included numeric blanks make one mean for the entire plate.

If your assay has no blank wells to subtract, skip this step and leave **Blank correction** set to **None** later.

## 4. Mark your standards

Select the standard wells by dragging. Choose **Standard** and enter:

| Box | What to enter |
| --- | --- |
| **Standard curve ID** | A name for this set of standards, such as `standard1`. The matching unknowns must use the **same** ID. |
| **Units** | The unit of the standard concentrations, such as `ng/mL`. |
| **Concentrations, ordered comma-separated** | The actual concentrations **in the assay wells**, in the order you want assigned. Example: `0, 1, 2, 4, 8`. These values come from your plate setup, not the OD file. |
| **Replicate wells per level** | How many wells received each concentration. Example: `2` for duplicates. For just one concentration, every selected well receives it automatically. |
| **Replicate direction** | **Across rows** or **Down columns**. This controls the order in which selected wells are grouped into replicates. |

Click **Assign selected wells** to apply the values immediately. This also creates the named standard curve, so there is no separate add-curve step. **Preview assignment** remains available when you want to check or edit each well before committing.

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

Select the wells for one or more unknowns. Choose **Unknown** and enter:

- **Standard curve:** choose a curve whose standard wells you already assigned. The Unknown assignment button stays unavailable until you assign standards; choose **Standard** and enter their concentrations first.
- **Sample name or prefix:** your sample name. The default groups all selected wells as one sample. To create several groups, change **Replicate wells per sample**; the app then numbers them, such as `Sample1`, `Sample2`.
- **Replicate wells per sample:** `2` for duplicates, `3` for triplicates, and so on.
- **Dilution factor:** `1` if undiluted; `10` if you diluted the original sample 1:10 before loading the well.
- **Replicate direction:** how replicate wells run across the selection.

Click **Assign selected wells** to apply them immediately. Use **Preview assignment** if you want to check each well's sample name, standard curve, group, and dilution or edit an irregular well first. If unknowns use another standard curve, assign those standards under another ID, then choose it from the dropdown.

## 6. Choose analysis settings and run

Under **3. Analyze and export**:

1. Choose **Blank correction**: **None** or **Subtract global plate blank mean**. Use the correction specified by your assay protocol.
2. Leave **Primary sample method** at **A** for the default: calculate a concentration from each usable replicate, then average those concentrations. Method **B** calculates a concentration from the mean replicate OD. The report shows both when valid. Older saved layouts are converted when loaded so the calculation you chose before stays the same.
3. Leave the QC thresholds at their defaults unless your lab has a reason to change them. **CV%** compares replicate OD readings at the same standard concentration: sample standard deviation ÷ absolute mean OD × 100. Its threshold also warns for unknown sample replicate OD and calculated concentration. **Minimum standard OD spread** is the highest minus lowest corrected OD across all usable standard wells assigned to one curve; it is not a difference between replicate concentrations. These are software checks, not validated detection limits.
4. Click **Run analysis**.

## 7. Read the results

- **Concentration plate:** The main grid follows the plate's row and column positions. Unknown cells show individual well concentration multiplied by that well's dilution factor. `REF` identifies a standard. `0` means below the lowest tested standard, **not** a measured zero.
- **Fitted equations:** Each curve's actual 3PL or 4PL equation appears below the grid, with its fitted parameter values. **FIT OK** means the numerical fit worked; **QC FAIL** means a standard QC threshold failed. Concentrations from that curve stay visible but are highlighted for review.
- **QC and detailed results:** This section stays collapsed when there are no issues and opens when a curve or sample needs attention. It contains curve plots, sample results, standard QC, and all 96 well records. **Primary measured** is the concentration in the diluted assay well; **Dilution-adjusted** estimates the original sample concentration.

An included unknown replicate that is empty, overflow, invalid, or outside the tested range makes the **whole sample's primary result blank**. Other valid wells remain visible. Do not exclude a problem well just to force a number; exclude it only when you have a real experimental reason, and record that reason.

## 8. Fix a mistake

Select one or more wells, then click **Edit selected wells in table**. Each selected well has its own row, so you can change their assignments together and click **Save selected wells** once. Choose **unassigned** in a row to clear that well's assignment; its OD reading stays on the plate. If you uncheck **Include** for an assigned well, enter an **Exclusion reason**. For a single well, **Clear [well name] assignment** is a shortcut. Click **Run analysis** after a change. **Undo edit** reverses the whole last save or clearing action. **Clear selection** only removes the yellow selection highlight. **Clear current layout** erases annotations, standard curves, settings, and results for the loaded plate; **Undo edit** can restore the layout. It does not delete a JSON file you downloaded.

## 9. Save your work

- **Download analysis workbook** saves the `.xlsx` report. Its first sheet is the concentration plate; amber cells need QC review. Later sheets contain summary, samples, every well, standards/QC, standard curve fits and plots, and settings.
- **Download layout JSON** saves the well assignments and analysis settings. This is the file to reuse with a later plate reader export.

For a later run, upload the new `.xlsx` first, then choose **Load saved layout JSON**. Review the preview and any warnings about wells whose reading status changed, then apply the layout and rerun analysis. The JSON carries annotations; it does **not** replace the new OD readings.

## If something does not work

| What you see | What to check |
| --- | --- |
| Yellow warning at the top, import disabled | Use `http://127.0.0.1:8765/`, not a `file://` path. Start the server with `start_elisa_tool.cmd` if needed. |
| Standard assignment says the count does not match | With multiple concentrations, number of concentrations × replicates per level must cover the selected wells (a partial final level is allowed). Check the selection and replicate direction. |
| Curve says invalid | Check the standard concentrations and units, at least three different usable levels, blank correction, overflow wells, and fit flags. |
| Unknown concentration is blank | Check that its curve ID exists and is valid, all included replicates are numeric and in range, and no included well has overflow. |
| Saved layout warns that wells changed | Check those well locations against the new reader export before applying the layout. |

If you are unsure what a field means for **your** assay, stop before committing an assignment and check the plate notes. The tool cannot infer sample identity or standard concentrations from OD values alone.
