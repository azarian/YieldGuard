"""Tests for ResponseFormatter — pure transformation, no I/O."""

import pytest
from datetime import date

from api.py.analysis_service import ResponseFormatter, build_system_config


class TestResponseFormat:
    def test_returns_required_top_level_keys(self, sample_result):
        result = ResponseFormatter.format(sample_result, price_per_kwh=0.48, currency="ILS")
        assert "summary" in result
        assert "daily" in result
        assert "events" in result
        assert "monetary" in result
        assert "analyzed_at" in result

    def test_summary_matches_input(self, sample_result, sample_summary):
        result = ResponseFormatter.format(sample_result, 0.48, "ILS")
        s = result["summary"]
        assert s["current_sr"] == sample_summary.current_sr
        assert s["current_loss_pct"] == sample_summary.current_loss_pct
        assert s["n_days"] == sample_summary.n_days
        assert s["n_cleaning_events"] == sample_summary.n_cleaning_events

    def test_daily_truncated_to_90_days(self, sample_result):
        result = ResponseFormatter.format(sample_result, 0.48, "ILS")
        assert len(result["daily"]) <= 90

    def test_daily_record_fields(self, sample_result):
        result = ResponseFormatter.format(sample_result, 0.48, "ILS")
        if result["daily"]:
            record = result["daily"][0]
            assert "date" in record
            assert "soiling_ratio" in record
            assert "actual_kwh" in record
            assert "clean_kwh" in record
            assert "lost_kwh" in record
            assert "classification" in record
            assert "cleaning" in record

    def test_events_classified_by_rain(self, sample_result):
        result = ResponseFormatter.format(sample_result, 0.48, "ILS")
        events = result["events"]
        assert len(events) == 2
        assert events[0]["type"] == "rain"
        assert events[0]["rain_mm"] == 8.5
        assert events[1]["type"] == "manual"

    def test_monetary_with_price(self, sample_result):
        result = ResponseFormatter.format(sample_result, 0.48, "ILS")
        m = result["monetary"]
        assert m["currency"] == "ILS"
        assert m["currency_symbol"] == "₪"
        assert m["currency_per_kwh"] == 0.48
        assert m["total_lost_money"] > 0
        assert m["avg_daily_loss"] >= 0

    def test_monetary_with_zero_price(self, sample_result):
        result = ResponseFormatter.format(sample_result, 0, "ILS")
        m = result["monetary"]
        assert m["currency_per_kwh"] == 0
        assert m["avg_daily_loss"] == 0

    def test_monetary_with_none_price(self, sample_result):
        result = ResponseFormatter.format(sample_result, None, "USD")
        m = result["monetary"]
        assert m["currency_per_kwh"] == 0
        assert m["currency_symbol"] == "$"


class TestFormatRecommendations:
    def test_critical_when_high_loss(self, sample_summary):
        summary = sample_summary
        object.__setattr__(summary, "current_loss_pct", 12.0)
        object.__setattr__(summary, "current_sr", 0.88)

        recs = ResponseFormatter.format_recommendations("sys-123", summary)
        assert len(recs) >= 1
        assert recs[0]["severity"] == "critical"
        assert recs[0]["type"] == "cleaning"
        assert recs[0]["system_id"] == "sys-123"

    def test_warning_when_moderate_loss(self, sample_summary):
        summary = sample_summary
        object.__setattr__(summary, "current_loss_pct", 7.0)
        object.__setattr__(summary, "current_sr", 0.93)

        recs = ResponseFormatter.format_recommendations("sys-123", summary)
        assert len(recs) >= 1
        assert recs[0]["severity"] == "warning"

    def test_no_recs_when_clean(self, sample_summary):
        summary = sample_summary
        object.__setattr__(summary, "current_loss_pct", 2.0)
        object.__setattr__(summary, "avg_summer_rate", -0.1)

        recs = ResponseFormatter.format_recommendations("sys-123", summary)
        assert len(recs) == 0

    def test_seasonal_rec_when_high_summer_rate(self, sample_summary):
        summary = sample_summary
        object.__setattr__(summary, "current_loss_pct", 2.0)
        object.__setattr__(summary, "avg_summer_rate", -0.5)

        recs = ResponseFormatter.format_recommendations("sys-123", summary)
        seasonal = [r for r in recs if r["type"] == "seasonal"]
        assert len(seasonal) == 1


class TestBuildSystemConfig:
    def test_maps_db_row_to_config(self, sample_system_row):
        config = build_system_config(sample_system_row, "Asia/Jerusalem")
        assert config.lat == 31.332182
        assert config.lon == 34.896813
        assert config.kwp == 15.84
        assert config.tz == "Asia/Jerusalem"
        assert config.alt == 350
        assert config.tilt == 20
        assert config.azimuth == 180
        assert config.install_date == "2019-11-03"
        assert config.price == 0.48

    def test_defaults_when_missing_optional_fields(self):
        row = {
            "latitude": 32.0,
            "longitude": 34.0,
            "peak_power_kwp": 10.0,
            "tilt": None,
            "azimuth": None,
            "altitude": None,
            "installation_date": None,
            "electricity_price_per_kwh": None,
        }
        config = build_system_config(row, "UTC")
        assert config.tilt == 32.0  # defaults to abs(lat)
        assert config.azimuth == 180
        assert config.alt == 0
        assert config.install_date == "2020-01-01"
        assert config.price == 0.48
