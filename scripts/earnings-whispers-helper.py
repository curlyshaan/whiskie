#!/usr/bin/env python3
import json
import sys

from earnings import Earnings


def map_release_time(value):
    if value == 1:
        return "pre_market"
    if value == 3:
        return "post_market"
    return "unknown"


def main():
    symbol = (sys.argv[1] if len(sys.argv) > 1 else "").strip().upper()

    if not symbol:
        raise ValueError("Symbol is required")

    lookup = Earnings(symbol)
    company = lookup.getCompanyInfo(full=False)
    dates = lookup.getEarningsDates()
    next_event = dates.get("next") or {}
    release_time = company.get("releaseTime")

    payload = {
        "symbol": symbol,
        "earningsTimeRaw": f"release:{release_time}" if release_time is not None else None,
        "earningsSession": map_release_time(release_time),
        "source": "earnings_whispers",
        "confirmDate": next_event.get("confirm_dt").isoformat() if next_event.get("confirm_dt") else None,
        "releaseTime": release_time,
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
