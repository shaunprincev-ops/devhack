"""Train a research-only anemia-pattern classifier from a labelled CBC dataset.

This script intentionally excludes haemoglobin (HGB) and hematocrit/PCV from
predictor features to reduce direct target leakage when the dataset label was
created from haemoglobin thresholds. The resulting model is exploratory only.
"""
from __future__ import annotations
import argparse, json, re
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, balanced_accuracy_score,
    confusion_matrix, precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

FEATURES = ["RBC", "MCV", "MCH", "MCHC"]
ALIASES = {
    "RBC": ["rbc", "red blood cell count", "red blood cell", "rbc count"],
    "MCV": ["mcv", "mean corpuscular volume"],
    "MCH": ["mch", "mean corpuscular hemoglobin", "mean corpuscular haemoglobin"],
    "MCHC": ["mchc", "mean corpuscular hemoglobin concentration", "mean corpuscular haemoglobin concentration"],
}
TARGET_ALIASES = ["decision_class", "decision class", "anemia_label", "anaemia_label", "anemia", "anaemia", "label", "class", "target"]
NORMAL_WORDS = {"normal", "non-anemic", "non anaemic", "non-anemic", "non anaemic", "no anemia", "no anaemia", "healthy", "not anemic", "not anaemic", "none", "no"}


def norm(s: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s).strip().lower()).strip()


def load_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    if path.suffix.lower() in {".csv", ".txt"}:
        return pd.read_csv(path)
    raise ValueError("Dataset must be .xlsx, .xls, or .csv")


def find_column(columns, aliases):
    by_norm = {norm(c): c for c in columns}
    for alias in aliases:
        if norm(alias) in by_norm:
            return by_norm[norm(alias)]
    for c in columns:
        nc = norm(c)
        if any(norm(alias) in nc for alias in aliases):
            return c
    return None



def map_label(value):
    s = norm(value)
    if not s or s in {"nan", "na", "unknown", "missing"}:
        return np.nan

    if isinstance(value, (int, float, np.integer, np.floating)):
        if value == 0:
            return 0
        if value == 1:
            return 1
        return np.nan

    if s in NORMAL_WORDS or "normal" in s or "non anem" in s or "no anem" in s or "healthy" in s:
        return 0
    if any(word in s for word in ("anem", "mild", "moderate", "severe", "positive", "abnormal")):
        return 1

    return np.nan


def main():
    parser = argparse.ArgumentParser(description="Train PHC Assist exploratory CBC model")
    parser.add_argument("--data", required=True, help="Path to the downloaded dataset (.xlsx or .csv)")
    parser.add_argument("--target", default=None, help="Target column name if automatic detection fails")
    parser.add_argument("--out", default="models/anemia_model.json", help="Output JSON path")
    args = parser.parse_args()

    data_path = Path(args.data)
    df = load_table(data_path)
    target_col = args.target or find_column(df.columns, TARGET_ALIASES)
    if not target_col or target_col not in df.columns:
        raise SystemExit(f"Could not identify target column. Available columns: {list(df.columns)}. Re-run with --target 'exact column name'.")

    feature_cols = {}
    for feature in FEATURES:
        col = find_column(df.columns, ALIASES[feature])
        if col is None:
            raise SystemExit(f"Could not find a {feature} column. Available columns: {list(df.columns)}")
        feature_cols[feature] = col

    X = pd.DataFrame({f: pd.to_numeric(df[c], errors="coerce") for f, c in feature_cols.items()})
    y = df[target_col].map(map_label)
    usable = y.notna() & X.notna().any(axis=1)
    X, y = X.loc[usable].copy(), y.loc[usable].astype(int).copy()
    # Drop rows with all CBC predictor values missing; median imputation handles partial missingness.
    if len(X) < 50 or y.nunique() != 2 or y.value_counts().min() < 10:
        raise SystemExit(f"Not enough usable labelled data for a stratified binary split (n={len(X)}, classes={y.value_counts().to_dict()}). Check the target labels and column names; do not guess numeric class mappings.")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(class_weight="balanced", max_iter=2000, random_state=42)),
    ])
    pipeline.fit(X_train, y_train)
    scores = pipeline.predict_proba(X_test)[:, 1]
    preds = (scores >= 0.5).astype(int)  # Exploratory classifier boundary, NOT a clinical threshold.
    tn, fp, fn, tp = confusion_matrix(y_test, preds, labels=[0, 1]).ravel()
    metrics = {
        "test_n": int(len(y_test)),
        "accuracy": float(accuracy_score(y_test, preds)),
        "balanced_accuracy": float(balanced_accuracy_score(y_test, preds)),
        "sensitivity_recall": float(recall_score(y_test, preds, zero_division=0)),
        "specificity": float(tn / (tn + fp)) if (tn + fp) else None,
        "precision": float(precision_score(y_test, preds, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, scores)) if y_test.nunique() == 2 else None,
        "confusion_matrix": {"true_negative": int(tn), "false_positive": int(fp), "false_negative": int(fn), "true_positive": int(tp)},
    }
    imp = pipeline.named_steps["imputer"]
    scaler = pipeline.named_steps["scaler"]
    clf = pipeline.named_steps["classifier"]
    out = {
        "ready": True,
        "model_type": "standardized_logistic_regression",
        "model_version": "research-baseline-1",
        "features": FEATURES,
        "impute_medians": [float(v) for v in imp.statistics_],
        "means": [float(v) for v in scaler.mean_],
        "scales": [float(v) if float(v) != 0 else 1.0 for v in scaler.scale_],
        "coefficients": [float(v) for v in clf.coef_[0]],
        "intercept": float(clf.intercept_[0]),
        "decision_boundary": 0.5,
        "threshold_note": "0.5 is a default binary-model boundary for this research demonstration, not a clinical referral threshold.",
        "dataset": {
            "filename": data_path.name,
            "target_column": str(target_col),
            "source": "Raw Hematological Dataset for Anemia Analysis and Classification, Mendeley Data, DOI 10.17632/tnswkb4bt8.1, CC BY 4.0",
            "rows_used": int(len(X)),
            "training_rows": int(len(X_train)),
            "held_out_test_rows": int(len(X_test)),
            "features_used": FEATURES,
            "features_excluded_to_reduce_target_leakage": ["HGB/hemoglobin", "PCV/HCT/hematocrit", "age", "gender"],
            "split": "stratified 80/20 hold-out, random_state=42",
        },
        "held_out_test_metrics": metrics,
        "clinical_status": "UNVALIDATED RESEARCH PROTOTYPE — NOT FOR PATIENT CARE",
        "disclaimer": "This model is trained on a small, single-site dataset and may not generalize. Its score is not a calibrated clinical probability. It does not diagnose or rule out anaemia and must not determine treatment or referral. Use laboratory haemoglobin measurement and clinician assessment.",
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({"saved_model": str(out_path), "rows_used": len(X), "class_counts": y.value_counts().sort_index().to_dict(), "held_out_test_metrics": metrics}, indent=2))
    print("IMPORTANT: these are internal hold-out results only, not clinical validation or proof of generalization.")

if __name__ == "__main__":
    main()
