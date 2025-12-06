"""Shared utilities for Warcraft Logs timestamp generation."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Sequence

API_BASE_URL = "https://www.warcraftlogs.com:443/v1"


def parse_hhmmss(time_str: str) -> int:
    """Convert an HH:MM:SS string to integer seconds."""
    parts = time_str.strip().split(":")
    if len(parts) != 3:
        raise ValueError(f"Time '{time_str}' must be in HH:MM:SS format")
    try:
        hours, minutes, seconds = (int(part) for part in parts)
    except ValueError as exc:
        raise ValueError(f"Time '{time_str}' must contain integers") from exc
    if not (0 <= minutes < 60 and 0 <= seconds < 60):
        raise ValueError("Minutes and seconds must be between 0 and 59")
    if hours < 0:
        raise ValueError("Hours must be non-negative")
    return hours * 3600 + minutes * 60 + seconds


def format_hhmmss(seconds: float) -> str:
    """Format seconds as HH:MM:SS (rounded to the nearest second)."""
    total_seconds = max(0, int(round(seconds)))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def fetch_report_fights(report_id: str, api_key: str) -> Dict[str, Any]:
    """Fetch the fights payload for a report."""
    endpoint = f"/report/fights/{urllib.parse.quote(report_id)}"
    url = f"{API_BASE_URL}{endpoint}?api_key={urllib.parse.quote(api_key)}"
    request = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            f"API request failed with status {exc.code}: {exc.reason}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"API request failed: {exc.reason}") from exc


def _boss_percentage(fight: Dict[str, Any]) -> Optional[float]:
    """Extract a fight-level percentage from the fight payload."""
    for key in ("fightPercentage", "bossPercentage", "enemyNPCPercentage"):
        value = fight.get(key)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
    return None


def build_boss_fight_rows(
    fights: Sequence[Dict[str, Any]], vod_start_seconds: int
) -> List[Dict[str, Any]]:
    """Prepare enriched fight data for CLI and the web UI."""
    boss_fights = [fight for fight in fights if fight.get("boss", 0)]
    if not boss_fights:
        raise ValueError("Report contains no boss fights")

    boss_fights.sort(key=lambda fight: fight.get("start_time", 0))
    first_start_seconds = boss_fights[0]["start_time"] / 1000.0
    video_offset = vod_start_seconds - first_start_seconds

    entries: List[Dict[str, Any]] = []
    for idx, fight in enumerate(boss_fights, start=1):
        start_seconds = fight["start_time"] / 1000.0
        video_seconds = start_seconds + video_offset
        duration_ms = fight.get("end_time", fight["start_time"]) - fight["start_time"]
        duration_seconds = max(0.0, duration_ms / 1000.0)

        boss_hp_left = _boss_percentage(fight)
        boss_progress = 100.0 - boss_hp_left if boss_hp_left is not None else None

        entries.append(
            {
                "pull": idx,
                "boss_name": fight.get("name", "Unknown Boss"),
                "kill": bool(fight.get("kill")),
                "result": "KILL" if fight.get("kill") else "Wipe",
                "timestamp": format_hhmmss(video_seconds),
                "video_seconds": max(0.0, video_seconds),
                "boss_hp_left": boss_hp_left,
                "boss_progress": boss_progress,
                "duration_seconds": duration_seconds,
                "duration_text": format_duration(duration_seconds),
            }
        )
    return entries


def format_duration(seconds: float) -> str:
    """Format durations as MM:SS."""
    total_seconds = max(0, int(round(seconds)))
    minutes = total_seconds // 60
    secs = total_seconds % 60
    return f"{minutes:02d}:{secs:02d}"
