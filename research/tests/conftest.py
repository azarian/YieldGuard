"""Shared test fixtures."""

import sys
import os

# Add research/ to path so tests can import our modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
