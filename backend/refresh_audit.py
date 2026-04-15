import os
from datetime import date

from database import fetch_queue_collection, player_cache_collection
from services.fetch_service import get_latest_cached_game_date, get_latest_remote_game_date

player_cache = player_cache_collection
fetch_queue = fetch_queue_collection
AUDIT_IDS_ENV = "NBA_REFRESH_AUDIT_PLAYER_IDS"


def parse_audit_player_ids(raw_value: str):
    ids = []
    seen = set()

    for token in str(raw_value or "").split(","):
        cleaned = token.strip()
        if not cleaned:
            continue

        try:
            player_id = int(cleaned)
        except ValueError:
            continue

        if player_id <= 0 or player_id in seen:
            continue

        seen.add(player_id)
        ids.append(player_id)

    return ids


def evaluate_refresh_status(cached_latest: date | None, remote_latest: date | None):
    if remote_latest is None:
        return "no_remote_data"

    if cached_latest is None:
        return "missing_cache"

    if remote_latest > cached_latest:
        return "stale"

    return "up_to_date"


def inspect_player(player_id: int):
    cached_player = player_cache.find_one(
        {"player_id": player_id},
        {
            "player_id": 1,
            "name": 1,
            "data.name": 1,
            "data.game_log": 1,
            "data.season_game_logs": 1,
        },
    )

    cached_latest = get_latest_cached_game_date(cached_player)
    remote_latest = get_latest_remote_game_date(player_id)

    queue_doc = fetch_queue.find_one(
        {"player_id": player_id},
        {
            "attempts": 1,
            "next_attempt_at": 1,
            "last_error": 1,
            "last_attempted_at": 1,
            "queued_at": 1,
        },
    )

    status = evaluate_refresh_status(cached_latest, remote_latest)
    return {
        "player_id": player_id,
        "name": (cached_player or {}).get("name")
        or ((cached_player or {}).get("data") or {}).get("name")
        or "",
        "cached_latest": cached_latest.isoformat() if cached_latest else None,
        "remote_latest": remote_latest.isoformat() if remote_latest else None,
        "status": status,
        "queued": bool(queue_doc),
        "queue_attempts": int((queue_doc or {}).get("attempts", 0)),
        "queue_next_attempt_at": (queue_doc or {}).get("next_attempt_at"),
        "queue_last_error": (queue_doc or {}).get("last_error"),
    }


def run_refresh_audit(player_ids: list[int]):
    if not player_ids:
        print(
            f"Refresh audit skipped. Set {AUDIT_IDS_ENV}=<id1,id2,...> to enable player checks."
        )
        return

    print(f"Refresh audit started for {len(player_ids)} players.")

    for player_id in player_ids:
        try:
            result = inspect_player(player_id)
            print(
                " | ".join(
                    [
                        f"player_id={result['player_id']}",
                        f"name={result['name']}",
                        f"status={result['status']}",
                        f"cached_latest={result['cached_latest']}",
                        f"remote_latest={result['remote_latest']}",
                        f"queued={result['queued']}",
                        f"queue_attempts={result['queue_attempts']}",
                    ]
                )
            )
            if result["queue_last_error"]:
                print(f"  queue_last_error={result['queue_last_error']}")
            if result["queue_next_attempt_at"]:
                print(f"  queue_next_attempt_at={result['queue_next_attempt_at']}")
        except Exception as exc:
            print(f"Refresh audit failed for {player_id}: {exc}")

    print("Refresh audit finished.")


def get_failed_queue_player_ids(limit: int = 20):
    docs = fetch_queue.find(
        {
            "$or": [
                {"attempts": {"$gt": 0}},
                {"last_error": {"$exists": True, "$ne": ""}},
            ]
        },
        {"player_id": 1},
    ).sort([("attempts", -1), ("last_attempted_at", -1)]).limit(max(1, int(limit)))

    player_ids = []
    seen = set()

    for doc in docs:
        player_id = int(doc.get("player_id") or 0)
        if player_id <= 0 or player_id in seen:
            continue
        seen.add(player_id)
        player_ids.append(player_id)

    return player_ids


def run_refresh_audit_from_env():
    configured_ids = parse_audit_player_ids(os.getenv(AUDIT_IDS_ENV, ""))
    if configured_ids:
        print(f"Refresh audit source: {AUDIT_IDS_ENV}")
        run_refresh_audit(configured_ids)
        return

    queue_ids = get_failed_queue_player_ids()
    if queue_ids:
        print("Refresh audit source: failed fetch queue")
        run_refresh_audit(queue_ids)
        return

    run_refresh_audit([])


if __name__ == "__main__":
    run_refresh_audit_from_env()
