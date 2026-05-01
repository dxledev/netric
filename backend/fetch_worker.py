import os
from datetime import UTC, datetime, timedelta

from database import fetch_queue_collection, player_cache_collection
from nba import SUMMARY_VERSION, build_player_summary_from_data
from services.cache_status import get_missing_cached_log_season_ids
from services.fetch_service import (
    fetch_missing_game_logs_by_season,
    fetch_player_data,
    merge_cached_player_data,
)

player_cache = player_cache_collection
fetch_queue = fetch_queue_collection

MAX_PER_RUN = int(os.getenv("FETCH_WORKER_MAX_PER_RUN", "5"))
RETRY_DELAY_SECONDS = int(os.getenv("FETCH_WORKER_RETRY_DELAY_SECONDS", "900"))


def utc_now():
    return datetime.now(UTC)


def next_retry_at():
    return utc_now() + timedelta(seconds=RETRY_DELAY_SECONDS)


def find_next_job():
    now = utc_now()
    return fetch_queue.find_one(
        {
            "$or": [
                {"next_attempt_at": {"$exists": False}},
                {"next_attempt_at": None},
                {"next_attempt_at": {"$lte": now}},
            ]
        },
        sort=[("queued_at", 1), ("_id", 1)],
    )


def store_player_data(player_id, data):
    cached_player = player_cache.find_one({"player_id": player_id}, {"data": 1})
    data = merge_cached_player_data((cached_player or {}).get("data"), data)
    summary = build_player_summary_from_data(player_id, data)

    player_cache.update_one(
        {"player_id": player_id},
        {
            "$set": {
                "player_id": player_id,
                "data": data,
                "summary": summary,
                "summary_version": SUMMARY_VERSION,
                "last_updated": utc_now(),
            }
        },
        upsert=True,
    )


def summarize_missing_log_failures(failures):
    failure_labels = [
        f"{failure['field']}:{failure['season_id']}"
        for failure in failures[:10]
    ]
    remaining_count = len(failures) - len(failure_labels)
    suffix = f", +{remaining_count} more" if remaining_count > 0 else ""
    return f"Missing game-log repair failed for {', '.join(failure_labels)}{suffix}"


def fetch_repair_data(player_id):
    cached_player = player_cache.find_one({"player_id": player_id}, {"data": 1})
    cached_data = (cached_player or {}).get("data")

    if not isinstance(cached_data, dict):
        return fetch_player_data(player_id), [], False

    missing_log_season_ids = get_missing_cached_log_season_ids(
        cached_player,
        use_storage_policy=False,
    )

    if all(not season_ids for season_ids in missing_log_season_ids.values()):
        return None, [], False

    fetched_data, failures, has_more = fetch_missing_game_logs_by_season(
        player_id,
        missing_log_season_ids,
    )

    return merge_cached_player_data(cached_data, fetched_data), failures, has_more


def mark_job_failed(job, error):
    attempts = int(job.get("attempts", 0)) + 1
    fetch_queue.update_one(
        {"_id": job["_id"]},
        {
            "$set": {
                "attempts": attempts,
                "last_error": str(error),
                "last_attempted_at": utc_now(),
                "next_attempt_at": next_retry_at(),
            }
        },
    )


def run_queue():
    print("Worker started.")

    processed = 0

    while processed < MAX_PER_RUN:
        job = find_next_job()
        if not job:
            break

        player_id = job["player_id"]
        print("Fetching player_id:", player_id)

        try:
            if job.get("repair_missing_logs"):
                data, failures, has_more = fetch_repair_data(player_id)
            else:
                data = fetch_player_data(player_id)
                failures = []
                has_more = False

            if data is not None:
                store_player_data(player_id, data)
            print("Stored:", player_id)

            if failures:
                raise Exception(summarize_missing_log_failures(failures))

            if has_more:
                mark_job_failed(job, "Missing game-log repair batch incomplete")
                processed += 1
                continue

            fetch_queue.delete_one({"_id": job["_id"]})

        except Exception as e:
            print("Fetch failed:", e)
            mark_job_failed(job, e)

        processed += 1

    print(f"Processed {processed} players this run.")
    return processed


if __name__ == "__main__":
    run_queue()
