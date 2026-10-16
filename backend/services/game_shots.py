"""Serve cached ShotChartDetail data and schedule missing player seasons."""

from datetime import UTC, datetime

from fastapi import HTTPException

from database import fetch_queue_collection, player_cache_collection, shot_chart_cache_collection
from services.shot_service import (
    SOURCE,
    SCOPE_FIELDS,
    _cached_game_is_valid,
    cache_id,
    game_queue_id,
    is_supported_season,
    normalize_game_id,
    queue_game_shot_job,
)


def get_cached_game_shots(player_id, game_id, season=None):
    game_id = normalize_game_id(game_id)
    if not game_id or len(game_id) != 10 or not game_id.isdigit():
        raise HTTPException(status_code=422, detail="A ten-digit NBA game ID is required.")

    player = player_cache_collection.find_one(
        {"player_id": player_id},
        {f"data.{field}": 1 for field in SCOPE_FIELDS.values()},
    )
    if not player:
        raise HTTPException(status_code=404, detail="Player not cached yet.")

    for season_type, field in SCOPE_FIELDS.items():
        logs = player.get("data", {}).get(field, {})
        for season_id, games in logs.items():
            if season and season != season_id:
                continue
            for game in games:
                stored_game_id = normalize_game_id(
                    game.get("Game_ID") or game.get("GAME_ID") or game.get("game_id")
                )
                if stored_game_id != game_id:
                    continue

                result = {
                    "player_id": player_id,
                    "game_id": game_id,
                    "season": season_id,
                    "season_type": season_type,
                    "source": SOURCE,
                    "shots": [],
                }
                if not is_supported_season(season_id):
                    return {**result, "status": "unavailable"}

                expected_fga = int(game.get("FGA", game.get("fga", 0)) or 0)
                expected_fgm = int(game.get("FGM", game.get("fgm", 0)) or 0)
                expected = {"fga": expected_fga, "fgm": expected_fgm}
                if _cached_game_is_valid(player_id, season_id, season_type, game_id, expected):
                    cached = shot_chart_cache_collection.find_one(
                        {"_id": cache_id(player_id, season_id, season_type)},
                        {f"shots_by_game.{game_id}": 1},
                    ) or {}
                    shots = cached.get("shots_by_game", {}).get(game_id, [])
                    return {**result, "status": "ready", "shots": shots}

                queue_game_shot_job(season_id, season_type, player_id, game_id, priority=100)
                job = fetch_queue_collection.find_one(
                    {"_id": game_queue_id(season_id, season_type, player_id, game_id)},
                    {"locked_until": 1, "next_attempt_at": 1, "attempts": 1},
                ) or {}
                now = datetime.now(UTC)
                locked_until = job.get("locked_until")
                retry_at = job.get("next_attempt_at")
                if locked_until and locked_until.replace(tzinfo=UTC) > now:
                    fetch_status = "fetching"
                elif retry_at and retry_at.replace(tzinfo=UTC) > now:
                    fetch_status = "retrying"
                else:
                    fetch_status = "queued"
                return {
                    **result,
                    "status": "pending",
                    "fetch_status": fetch_status,
                    "retry_at": retry_at.replace(tzinfo=UTC).isoformat() if retry_at else None,
                }

    raise HTTPException(status_code=404, detail="Game not found in this player's cached logs.")
