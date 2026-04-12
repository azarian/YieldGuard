"""Tests for compute_coverage_hash — deterministic hashing of data_coverage rows."""

import pytest
from api.py.analysis_service import compute_coverage_hash


class TestComputeCoverageHash:
    def test_empty_rows_returns_consistent_hash(self):
        h1 = compute_coverage_hash([])
        h2 = compute_coverage_hash([])
        assert h1 == h2
        assert len(h1) == 16  # truncated sha256

    def test_same_rows_same_hash(self):
        rows = [
            {"period_start": "2024-01-01", "period_end": "2024-01-07", "status": "fetched"},
            {"period_start": "2024-01-08", "period_end": "2024-01-14", "status": "fetched"},
        ]
        assert compute_coverage_hash(rows) == compute_coverage_hash(rows)

    def test_different_rows_different_hash(self):
        rows_a = [
            {"period_start": "2024-01-01", "period_end": "2024-01-07", "status": "fetched"},
        ]
        rows_b = [
            {"period_start": "2024-01-01", "period_end": "2024-01-07", "status": "fetched"},
            {"period_start": "2024-01-08", "period_end": "2024-01-14", "status": "fetched"},
        ]
        assert compute_coverage_hash(rows_a) != compute_coverage_hash(rows_b)

    def test_order_independent(self):
        """Hash should be the same regardless of input row order."""
        rows_a = [
            {"period_start": "2024-01-08", "period_end": "2024-01-14", "status": "fetched"},
            {"period_start": "2024-01-01", "period_end": "2024-01-07", "status": "fetched"},
        ]
        rows_b = [
            {"period_start": "2024-01-01", "period_end": "2024-01-07", "status": "fetched"},
            {"period_start": "2024-01-08", "period_end": "2024-01-14", "status": "fetched"},
        ]
        assert compute_coverage_hash(rows_a) == compute_coverage_hash(rows_b)

    def test_status_change_changes_hash(self):
        """Adding new data (changing missing → fetched) should change the hash."""
        rows_a = [
            {"period_start": "2024-01-01", "period_end": "2024-01-07", "status": "missing"},
        ]
        rows_b = [
            {"period_start": "2024-01-01", "period_end": "2024-01-07", "status": "fetched"},
        ]
        assert compute_coverage_hash(rows_a) != compute_coverage_hash(rows_b)

    def test_new_period_changes_hash(self):
        """Syncing a new date range should change the hash."""
        before = [
            {"period_start": "2024-01-01", "period_end": "2024-01-07", "status": "fetched"},
        ]
        after = [
            {"period_start": "2024-01-01", "period_end": "2024-01-07", "status": "fetched"},
            {"period_start": "2024-01-08", "period_end": "2024-01-14", "status": "fetched"},
        ]
        assert compute_coverage_hash(before) != compute_coverage_hash(after)

    def test_handles_missing_fields_gracefully(self):
        """Rows with missing fields should not crash."""
        rows = [{"period_start": "2024-01-01"}, {}]
        h = compute_coverage_hash(rows)
        assert isinstance(h, str)
        assert len(h) == 16

    def test_empty_vs_nonempty_different(self):
        assert compute_coverage_hash([]) != compute_coverage_hash(
            [{"period_start": "2024-01-01", "period_end": "2024-01-01", "status": "fetched"}]
        )
