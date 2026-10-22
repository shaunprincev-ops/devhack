# PHC Assist — offline-first anaemia model prototype

This is a static Progressive Web App (PWA) prototype. The existing dashboard, visual design, navigation, local records and export workflow are retained. The anaemia pathway now supports browser-side inference from a trained research model stored in `models/anemia_model.json`.

## What is implemented

- Existing PHC Assist interface and responsive styling preserved.
- Anaemia pathway accepts four CBC red-cell indices: RBC, MCV, MCH and MCHC.
- `train_model.py` trains a logistic-regression baseline from a labelled CSV/XLSX dataset and exports a small JSON model that runs locally in the browser.
- Training script reports held-out test metrics and saves the metrics with the model.
- Service worker caches the model and uses network-first refresh when online, cached model when offline.
- If no trained model is installed, the app refuses to produce a prediction rather than inventing one.
- Skin-image and vitals pathways remain demo-only and do not run AI.

## Important safety limitations

**This is an educational research prototype, not a diagnostic device. Do not use it for real patient care.** The training workflow is not clinical validation. Its default 0.5 model boundary is a software classification boundary only, not a clinically justified referral threshold. A lower model score does not rule out anaemia. Use appropriate laboratory haemoglobin testing and qualified clinician assessment.

The training script deliberately excludes haemoglobin (HGB) and hematocrit/PCV from the predictors because labels in CBC datasets are often defined using haemoglobin; including those variables can cause direct target leakage. It uses RBC, MCV, MCH and MCHC as proxy features, which may still learn dataset-specific patterns. A single-site dataset with around 1,000 records is not enough to establish generalisation to rural PHCs, different age groups, pregnancy, different analysers, or other populations. The saved hold-out metrics are exploratory only; independent external validation, subgroup analysis, calibration, and clinical review would be required before any real-world consideration.

Do not enter real patient information. Records stay in the current browser's `localStorage`, which is not a secure clinical record system.

## Dataset

Use **Raw Hematological Dataset for Anemia Analysis and Classification**, Mendeley Data, version 1, DOI `10.17632/tnswkb4bt8.1`, licensed CC BY 4.0:

https://data.mendeley.com/datasets/tnswkb4bt8/1

The published description lists 1,004 anonymized records and fields including `RBC`, `MCV`, `MCH`, `MCHC`, `HGB`, `PCV/HCT`, and `Decision_Class`. Download the XLSX file from the dataset page yourself and keep the original attribution/licence information. The training script will attempt to identify the target and feature columns. It refuses unfamiliar or numeric target codes rather than guessing their meaning.

## Train the model (Windows + Python)

1. Download the dataset XLSX from the Mendeley page above. Put it in the project folder, for example as `Anemia_Dataset.xlsx`.
2. Open Command Prompt in the project folder.
3. Create and activate a virtual environment (recommended):

   ```bat
   py -m venv .venv
   .venv\Scripts\activate
   ```

4. Install the training dependencies:

   ```bat
   python -m pip install -r requirements.txt
   ```

5. Train the baseline model:

   ```bat
   python train_model.py --data "Anemia_Dataset.xlsx"
   ```

   If automatic target detection fails, use the exact label-column name shown in your spreadsheet:

   ```bat
   python train_model.py --data "Anemia_Dataset.xlsx" --target "Decision_Class"
   ```

6. The script overwrites `models/anemia_model.json` with model coefficients, preprocessing values, dataset information and held-out metrics. Read the printed class counts and metrics. If it stops because it cannot understand the labels, inspect the target values and explicitly normalize the labels in the source dataset; do not arbitrarily map numeric classes.

### What the training metrics mean

The script uses a stratified 80/20 train/test split with a fixed random seed. It reports accuracy, balanced accuracy, sensitivity/recall, specificity, precision, ROC-AUC and the confusion matrix. This is an internal hold-out evaluation on one dataset, not independent clinical validation. Do not describe these figures as expected real-world performance.

## Run the website

From the project folder:

```bat
python -m http.server 8000
```

Open `http://localhost:8000` in Chrome or Edge. Go to **New screening → Anaemia model (CBC)** and enter fictional test values matching the dataset's units. The app will only run inference if `models/anemia_model.json` has `"ready": true` after training.

## Test offline

1. Load the app once while online **after** training, so the model JSON is fetched and cached.
2. Open Chrome DevTools → Network → check **Offline**.
3. Refresh the page. The cached model should still be available; submit a fictional case to test local inference.
4. To test an updated model, leave DevTools online and reload the page once so the service worker refreshes the model cache, then repeat the offline test.

The model calculation itself runs in JavaScript in the browser and does not call an API. The Google Fonts import is optional; system-font fallbacks remain available offline.
