import os
import json
import time
from datetime import UTC, datetime

from refresh_db import refresh_all_players, refresh_all_teams
from fetch_worker import run_queue
from refresh_audit import run_refresh_audit_from_env
from services.shot_service import queue_current_season_shots
from services.team_service import get_current_season


def main():
    started_at = datetime.now(UTC)
    print(f"Nightly refresh started at {started_at.isoformat()}.", flush=True)
    result = {"started_at": started_at.isoformat(), "errors": []}
    try:
        result["players"] = refresh_all_players()
    except Exception as error:
        print(f"Player refresh scheduling failed: {error}")
        result["errors"].append(f"Player scheduling: {error}")

    try:
        scheduled = (result.get("players") or {}).get("shot_charts_scheduled")
        result["shot_charts_scheduled"] = scheduled if scheduled is not None else queue_current_season_shots(get_current_season())
    except Exception as error:
        print(f"Shot-chart scheduling failed: {error}", flush=True)
        result["errors"].append(f"Shot-chart scheduling: {error}")

    try:
        refresh_all_teams()
    except Exception as error:
        print(f"Team refresh scheduling failed: {error}")
        result["errors"].append(f"Team scheduling: {error}")

    total_processed = 0
    deadline = time.monotonic() + float(os.getenv("NIGHTLY_QUEUE_BUDGET_SECONDS", "1200"))

    while time.monotonic() < deadline:
        processed = run_queue(attempted_before=started_at, deadline=deadline)
        total_processed += processed

        if processed == 0:
            break

    print(f"Nightly refresh finished. Total attempted: {total_processed}; remaining work stays queued.", flush=True)
    try:
        result["shot_charts_after_processing"] = queue_current_season_shots(get_current_season())
    except Exception as error:
        result["errors"].append(f"Final shot-chart check: {error}")
    result["jobs_attempted"] = total_processed
    result["finished_at"] = datetime.now(UTC).isoformat()
    print("Nightly refresh result: " + json.dumps(result), flush=True)
    if os.getenv("NBA_REFRESH_AUDIT_PLAYER_IDS", "").strip():
        run_refresh_audit_from_env()
    return result


if __name__ == "__main__":
    main()
