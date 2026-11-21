"""AlgoArena first attempt: news + price features, Ridge model, validation, submission.

Run in the same folder as sessions.py and the provided ins_*/oos_* parquet files:
    python algoarena_first_attempt.py

Or use the companion Colab notebook, which downloads the provided data first.
"""

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import Ridge
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

SEED = 42
ALPHAS = (0.1, 1.0, 10.0, 100.0)
NUMERIC_WEIGHT = 0.35


def _feature_row(row):
    """Only use information available by the CLOSE of bar 49."""
    close = np.asarray(row["close"], dtype=float)[:50]
    high = np.asarray(row["high"], dtype=float)[:50]
    low = np.asarray(row["low"], dtype=float)[:50]
    opened = np.asarray(row["open"], dtype=float)[:50]
    if len(close) != 50:
        raise ValueError(f"Expected 50 observed price bars, got {len(close)}")

    close = np.maximum(close, 1e-9)
    log_price = np.log(close)
    log_r = np.diff(log_price)
    x = []
    for horizon in (1, 2, 3, 5, 10, 20, 49):
        x.append(log_price[-1] - log_price[-1 - horizon])

    for window in (5, 10, 20, 49):
        r = log_r[-window:]
        x.extend((np.mean(r), np.std(r), np.min(r), np.max(r)))

    for window in (5, 10, 20, 50):
        h = high[-window:]
        l = low[-window:]
        o = opened[-window:]
        c = close[-window:]
        x.extend((
            np.mean((h - l) / np.maximum(c, 1e-9)),
            np.mean((c - o) / np.maximum(o, 1e-9)),
            (close[-1] - np.min(l)) / max(np.max(h) - np.min(l), 1e-9),
        ))

    headlines = [str(h) for h in row["headlines"]]
    bars = [int(b) for b in row["headline_bars"]]
    if len(headlines) != len(bars):
        raise ValueError("headlines and headline_bars must have equal lengths")
    x.extend((len(headlines), sum(b >= 35 for b in bars), sum(b >= 45 for b in bars)))
    x.extend((sum(b >= 50 - window for b in bars) for window in (5, 10, 20, 50)))

    all_news = " ".join(headlines).strip() or "no_headline"
    late_news = " ".join(h for h, b in zip(headlines, bars) if b >= 35).strip() or "no_recent_headline"
    return np.clip(np.nan_to_num(np.array(x, dtype=float), nan=0, posinf=0, neginf=0), -100, 100), all_news, late_news


class Features:
    """Train TF-IDF and numeric scaling only on the training portion."""

    def __init__(self):
        self.scaler = StandardScaler()
        self.all_vectorizer = TfidfVectorizer(
            ngram_range=(1, 2), min_df=2, max_features=16000,
            sublinear_tf=True, strip_accents="unicode",
        )
        self.recent_vectorizer = TfidfVectorizer(
            ngram_range=(1, 2), min_df=2, max_features=8000,
            sublinear_tf=True, strip_accents="unicode",
        )

    @staticmethod
    def unpack(rows):
        features, all_news, recent_news = zip(*(_feature_row(row) for row in rows))
        return np.vstack(features), list(all_news), list(recent_news)

    def fit_transform(self, rows):
        numeric, news, recent = self.unpack(rows)
        numeric = self.scaler.fit_transform(numeric)
        all_words = self.all_vectorizer.fit_transform(news)
        recent_words = self.recent_vectorizer.fit_transform(recent)
        return hstack((csr_matrix(numeric * NUMERIC_WEIGHT), all_words, recent_words), format="csr")

    def transform(self, rows):
        numeric, news, recent = self.unpack(rows)
        numeric = self.scaler.transform(numeric)
        all_words = self.all_vectorizer.transform(news)
        recent_words = self.recent_vectorizer.transform(recent)
        return hstack((csr_matrix(numeric * NUMERIC_WEIGHT), all_words, recent_words), format="csr")