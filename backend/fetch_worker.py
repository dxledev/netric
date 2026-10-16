import os
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from database import fetch_queue_collection, player_cache_collection
from nba import SUMMARY_VERSION, build_player_summary_from_data
from services.cache_status import get_missing_cached_log_season_ids
from services.fetch_service import (
    fetch_missing_game_logs_by_season,
    fetch_player_data,
    merge_cached_player_data,
    merge_player_info_data,
)
from services.player_info import build_current_team, fetch_common_player_info, normalize_player_info
from services.shot_service import process_shot_chart_job
from nba_api.stats.static import teams
from pymongo import ReturnDocument
from services.team_service import (
    BBR_REQUEST_DELAY_SECONDS,
    BasketballReferenceRateLimit,
    get_current_season,
    refresh_all_teams,
    store_bbr_team_detail,
    store_local_cached_team_detail,
    store_nba_team_detail,
)

player_cache = player_cache_collection
fetch_queue = fetch_queue_collection

MAX_PER_RUN = int(os.getenv("FETCH_WORKER_MAX_PER_RUN", "5"))
RETRY_DELAY_SECONDS = int(os.getenv("FETCH_WORKER_RETRY_DELAY_SECONDS", "900"))
WORKER_LOCK_SECONDS = int(os.getenv("FETCH_WORKER_LOCK_SECONDS", "1800"))
PLAYER_INFO_REQUEST_DELAY_SECONDS = float(os.getenv("PLAYER_INFO_REQUEST_DELAY_SECONDS", "3"))
SHOT_CHART_MAX_RETRY_DELAY_SECONDS = int(os.getenv("SHOT_CHART_MAX_RETRY_DELAY_SECONDS", "21600"))


def utc_now():
    return datetime.now(UTC)


def next_retry_at(delay_seconds=RETRY_DELAY_SECONDS):
    return utc_now() + timedelta(seconds=delay_seconds)


def find_next_job(job_type=None, job_filter=None):
    now = utc_now()
    ready_filter = {
        "$and": [
            {
                "$or": [
                    {"next_attempt_at": {"$exists": False}},
                    {"next_attempt_at": None},
                    {"next_attempt_at": {"$lte": now}},
                ]
            },
            {
                "$or": [
                    {"locked_until": {"$exists": False}},
                    {"locked_until": None},
                    {"locked_until": {"$lte": now}},
                ]
            },
        ]
    }
    claim_update = {
        "$set": {
            "locked_at": now,
            "locked_until": now + timedelta(seconds=WORKER_LOCK_SECONDS),
            "claim_token": uuid4().hex,
        }
    }
    if job_type is not None:
        filtered_query = {**ready_filter, **(job_filter or {}), "job_type": job_type}
        if job_type == "shot_chart_refresh":
            requested_job = fetch_queue.find_one_and_update(
                {**filtered_query, "priority": {"$gt": 0}},
                claim_update,
                sort=[("priority", -1), ("attempts", 1), ("queued_at", 1), ("_id", 1)],
                return_document=ReturnDocument.AFTER,
            )
            if requested_job:
                return requested_job
        if job_type == "shot_chart_refresh" and "player_id" not in (job_filter or {}):
            batch_job = fetch_queue.find_one_and_update(
                {**filtered_query, "player_id": {"$exists": False}},
                claim_update,
                sort=[("season", -1), ("queued_at", 1), ("_id", 1)],
                return_document=ReturnDocument.AFTER,
            )
            if batch_job:
                return batch_job
        return fetch_queue.find_one_and_update(
            filtered_query,
            claim_update,
            sort=([("priority", -1), ("attempts", 1), ("queued_at", 1), ("_id", 1)]
                  if job_type == "shot_chart_refresh"
                  else [("queued_at", 1), ("_id", 1)]),
            return_document=ReturnDocument.AFTER,
        )

    team_job = fetch_queue.find_one_and_update(
        {
            **ready_filter,
            "job_type": {"$in": ["team_refresh", "team_detail_refresh"]},
        },
        claim_update,
        sort=[("queued_at", 1), ("_id", 1)],
        return_document=ReturnDocument.AFTER,
    )
    if team_job:
        return team_job

    player_job = fetch_queue.find_one_and_update(
        {
            **ready_filter,
            "player_id": {"$exists": True},
            "job_type": {"$ne": "shot_chart_refresh"},
        },
        claim_update,
        sort=[("queued_at", 1), ("_id", 1)],
        return_document=ReturnDocument.AFTER,
    )
    if player_job:
        return player_job

    requested_shots = fetch_queue.find_one_and_update(
        {**ready_filter, "job_type": "shot_chart_refresh", "priority": {"$gt": 0}},
        claim_update,
        sort=[("priority", -1), ("attempts", 1), ("queued_at", 1), ("_id", 1)],
        return_document=ReturnDocument.AFTER,
    )
    if requested_shots:
        return requested_shots

    return fetch_queue.find_one_and_update(
        ready_filter,
        claim_update,
        sort=[("queued_at", 1), ("_id", 1)],
        return_document=ReturnDocument.AFTER,
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


def mark_job_failed(job, error, retry_delay_seconds=None):
    attempts = int(job.get("attempts", 0)) + 1
    delay = retry_delay_seconds if retry_delay_seconds is not None else RETRY_DELAY_SECONDS
    if job.get("job_type") == "shot_chart_refresh":
        delay = min(
            SHOT_CHART_MAX_RETRY_DELAY_SECONDS,
            delay * (2 ** min(attempts - 1, 16)),
        )
    fetch_queue.update_one(
        {"_id": job["_id"], "claim_token": job.get("claim_token")},
        {
            "$set": {
                "attempts": attempts,
                "last_error": str(error),
                "last_attempted_at": utc_now(),
                "next_attempt_at": next_retry_at(delay),
            },
            "$unset": {"locked_at": "", "locked_until": "", "claim_token": ""},
        },
    )


def process_team_refresh_job(job):
    season = job.get("season") or get_current_season()
    refreshed_count = refresh_all_teams(season)
    queue_team_detail_jobs(season)
    print(f"Stored team snapshot for {refreshed_count} teams.")


def queue_team_detail_jobs(season=None):
    now = utc_now()
    queued_count = 0
    for index, team in enumerate(teams.get_teams()):
        team_id = int(team["id"])
        job_filter = {
            "job_type": "team_detail_refresh",
            "team_id": team_id,
            "season": season,
        }
        if fetch_queue.find_one(job_filter):
            continue
        fetch_queue.insert_one(
            {
                **job_filter,
                "name": team["full_name"],
                "refresh": True,
                "queued_at": now,
                "next_attempt_at": now + timedelta(seconds=index * BBR_REQUEST_DELAY_SECONDS),
            }
        )
        queued_count += 1
    print(f"Queued {queued_count} team detail refresh jobs.")


def process_team_detail_refresh_job(job):
    team_id = int(job["team_id"])
    season = job.get("season")
    print("Fetching team detail:", team_id)
    try:
        detail = store_bbr_team_detail(team_id, season)
    except BasketballReferenceRateLimit as error:
        print(f"Basketball Reference limited team detail for {team_id}; falling back to NBA API: {error}")
        try:
            detail = store_nba_team_detail(team_id, season)
        except Exception as fallback_error:
            print(f"NBA API team detail failed for {team_id}; falling back to local player cache: {fallback_error}")
            detail = store_local_cached_team_detail(team_id, season)
    print(f"Stored team detail: {team_id} ({len(detail.get('players', []))} players)")
    time.sleep(BBR_REQUEST_DELAY_SECONDS)


def process_player_job(job):
    player_id = job["player_id"]
    print("Fetching player_id:", player_id)

    if job.get("repair_missing_logs") and not job.get("refresh_stats"):
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
        return False

    return True


def process_player_info_job(job):
    player_id = int(job["player_id"])
    try:
        details = fetch_common_player_info(player_id)
    finally:
        if PLAYER_INFO_REQUEST_DELAY_SECONDS > 0:
            time.sleep(PLAYER_INFO_REQUEST_DELAY_SECONDS)
    if not details or int(details[0].get("PERSON_ID") or 0) != player_id:
        raise ValueError(f"Player info response is missing player {player_id}")
    current_team = build_current_team(details[0])
    if current_team is None:
        raise ValueError(f"Player info response has no current team for player {player_id}")

    cached = player_cache.find_one({"player_id": player_id}, {"data": 1})
    if not cached or not isinstance(cached.get("data"), dict):
        raise ValueError(f"Player {player_id} must be cached before updating their profile")
    existing_data = cached["data"]
    data = merge_player_info_data(existing_data, job.get("player_info"))
    fresh_info = normalize_player_info(details[0])
    if fresh_info:
        data["player_info"] = {**(data.get("player_info") or {}), **fresh_info}
    data["current_team"] = current_team
    data["common_player_info"] = details
    name = str(details[0].get("DISPLAY_FIRST_LAST") or "").strip()
    if name:
        data["name"] = name
    changed = data != existing_data
    data["info_checked_at"] = utc_now()
    if changed:
        store_player_data(player_id, data)
    else:
        player_cache.update_one(
            {"player_id": player_id},
            {"$set": {"data.info_checked_at": data["info_checked_at"]}},
        )
    print(f"Player info checked: {player_id}; changed: {changed}", flush=True)


def run_queue(job_type=None, job_filter=None):
    print("Worker started.")

    processed = 0

    while processed < MAX_PER_RUN:
        job = find_next_job(job_type=job_type, job_filter=job_filter)
        if not job:
            break

        try:
            if job.get("job_type") == "shot_chart_refresh":
                print(
                    "Fetching shot chart:", job.get("player_id", "all"),
                    job["season"], job["season_type"], flush=True,
                )
                stored_count = process_shot_chart_job(job)
                print(f"Stored shot chart snapshots: {stored_count}", flush=True)
            elif job.get("job_type") == "player_info_refresh":
                process_player_info_job(job)
            elif job.get("job_type") == "team_refresh":
                print("Fetching team refresh.")
                process_team_refresh_job(job)
            elif job.get("job_type") == "team_detail_refresh":
                process_team_detail_refresh_job(job)
            else:
                completed = process_player_job(job)
                if not completed:
                    processed += 1
                    continue

            fetch_queue.delete_one({
                "_id": job["_id"], "claim_token": job.get("claim_token"),
                "refresh_stats": job.get("refresh_stats"),
            })

        except BasketballReferenceRateLimit as e:
            print("Fetch failed:", e)
            mark_job_failed(job, e, retry_delay_seconds=e.retry_after)
        except Exception as e:
            print("Fetch failed:", e)
            mark_job_failed(job, e)

        processed += 1

    print(f"Processed {processed} jobs this run.")
    return processed


if __name__ == "__main__":
    run_queue()
