"""Analysis algorithms: clear-day detection, soiling estimation, cleaning detection."""

from .clear_day import ClearDayDetector, CurveMatchDetector
from .cleaning import detect_cleaning, classify_event
from .soiling import compute_soiling, build_daily
