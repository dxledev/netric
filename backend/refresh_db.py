from datetime import UTC, datetime

from database import fetch_queue_collection, player_cache_collection
from services.cache_status import has_complete_cached_season_logs
from services.fetch_service import (
    get_latest_cached_game_date,
    get_latest_remote_game_date,
)
from services.player_pool import get_tracked_players

player_cache = player_cache_collection
fetch_queue = fetch_queue_collection


def build_refresh_job(player_id, name):
    return {
        "player_id": player_id,
        "name": name,
        "refresh": True,
        "queued_at": datetime.now(UTC),
    }


def is_already_queued(player_id):
    return fetch_queue.find_one({"player_id": player_id}) is not None


def find_cached_player(player_id):
    return player_cache.find_one(
        {"player_id": player_id},
        {
            "data.game_log": 1,
            "data.season_game_logs": 1,
            "data.career_stats": 1,
        },
    )


def cached_player_has_games(cached_player):
    if not cached_player:
        return False

    data = cached_player.get("data", {})

    if data.get("game_log"):
        return True

    for season in data.get("career_stats", []):
        try:
            if float(season.get("GP") or 0) > 0:
                return True
        except (TypeError, ValueError):
            continue

    return False


def should_refresh_player(player_id):
    cached_player = find_cached_player(player_id)

    if not has_complete_cached_season_logs(cached_player):
        return True

    cached_latest_game = get_latest_cached_game_date(cached_player)

    if cached_latest_game is None:
        return True

    remote_latest_game = get_latest_remote_game_date(player_id)
    if remote_latest_game is None:
        if cached_player_has_games(cached_player):
            raise ValueError(
                "Remote latest game date unavailable for player with cached games"
            )
        return False

    return remote_latest_game > cached_latest_game


def refresh_all_players():
    tracked_players = get_tracked_players()

    queued_count = 0
    skipped_count = 0
    failed_count = 0
    forced_queue_count = 0

    for player in tracked_players:
        player_id = player["id"]
        name = player["full_name"]

        if is_already_queued(player_id):
            skipped_count += 1
            continue

        try:
            if not should_refresh_player(player_id):
                skipped_count += 1
                continue
        except Exception as exc:
            failed_count += 1
            print(f"Refresh check failed for {player_id}: {exc}")
            fetch_queue.insert_one(build_refresh_job(player_id, name))
            queued_count += 1
            forced_queue_count += 1
            continue

        fetch_queue.insert_one(build_refresh_job(player_id, name))
        queued_count += 1

    print(
        f"Queued {queued_count} tracked players for refresh. "
        f"Skipped {skipped_count}. Failed checks {failed_count}. "
        f"Forced queued after failed checks {forced_queue_count}."
    )


if __name__ == "__main__":
    refresh_all_players()
