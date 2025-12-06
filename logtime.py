#!/usr/bin/env python3
"""Generate VOD timestamps for Warcraft Logs bosses."""

from __future__ import annotations

import argparse
import sys
from logtime_utils import (
    build_boss_fight_rows,
    fetch_report_fights,
    parse_hhmmss,
)


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate boss pull timestamps for a Warcraft Logs report",
    )
    parser.add_argument("report_id", help="Warcraft Logs report ID")
    parser.add_argument("api_key", help="Warcraft Logs API key")
    parser.add_argument(
        "vod_start",
        help="Video timestamp for the first pull in HH:MM:SS",
    )
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)
    try:
        vod_start_seconds = parse_hhmmss(args.vod_start)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    try:
        report_data = fetch_report_fights(args.report_id, args.api_key)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    fights = report_data.get("fights", [])
    try:
        fight_rows = build_boss_fight_rows(fights, vod_start_seconds)
    except (KeyError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    for row in fight_rows:
        line = (
            f"{row['timestamp']} - {row['boss_name']} - "
            f"Pull #{row['pull']} - ({row['result']})"
        )
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
