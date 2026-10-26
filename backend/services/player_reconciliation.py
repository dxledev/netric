"""Reconcile live season appearances with cached games before nightly refreshes."""

import math

from nba_api.stats.endpoints import leaguegamelog

from database import player_cache_collection
from services.fetch_service import NBA_API_TIMEOUT_SECONDS, iter_cached_game_logs, run_with_retries
from services.player_info import STAT_FIELDS, enqueue_refresh, fetch_season_totals_snapshot
from services.team_service import get_current_season


def fetch_current_season_games(season):
    games = []
    failures = []
    for season_type in ("Regular Season", "PlayIn", "Playoffs"):
        try:
            response = run_with_retries(
                lambda: leaguegamelog.LeagueGameLog(
                    season=season,
                    player_or_team_abbreviation="P",
                    season_type_all_star=season_type,
                    timeout=NBA_API_TIMEOUT_SECONDS,
                )
            )
            rows = response.get_data_frames()[0].to_dict("records")
            games.extend({**row, "_season_type": season_type} for row in rows)
        except Exception as exc:
            failures.append(season_type)
            print(f"Season game reconciliation unavailable for {season} {season_type}: {exc}")
    return games, failures


def refresh_current_season_from_bulk(games, season, totals=None):
    """Store complete regular-season logs and verified official totals in bulk.

    Reject incomplete/inconsistent snapshots and multi-team seasons; those
    players retain their cached data and use the individual refresh queue.
    """
    from datetime import UTC, datetime
    from nba import SUMMARY_VERSION, build_player_summary_from_data

    if totals is None:
        totals = fetch_season_totals_snapshot(season, "Regular Season")
    grouped = {}
    for game in games:
        if game.get("_season_type", "Regular Season") == "Regular Season":
            grouped.setdefault(int(game["PLAYER_ID"]), {})[str(game["GAME_ID"])] = game
    counts = {"checked": len(grouped), "updated": 0, "unchanged": 0, "deferred": 0}
    for player_id, by_id in grouped.items():
        logs = sorted(by_id.values(), key=lambda row: (row["GAME_DATE"], row["GAME_ID"]), reverse=True)
        stats = totals.get(player_id)
        cached = player_cache_collection.find_one({"player_id": player_id}) or {}
        existing = cached.get("data") or {}
        existing_ids = {
            str(row.get("GAME_ID") or row.get("Game_ID") or row.get("game_id"))
            for row in existing.get("season_game_logs", {}).get(season, [])
        }
        valid = (
            stats is not None
            and int(stats.get("GP") or 0) == len(logs)
            and len({row["TEAM_ID"] for row in logs}) == 1
            and int(stats.get("TEAM_ID") or 0) == int(logs[0]["TEAM_ID"])
            and existing_ids.issubset(by_id)
            and all(
                abs(sum(float(row.get(field) or 0) for row in logs) - float(stats.get(field) or 0)) < 1e-6
                for field in STAT_FIELDS if field not in {"GP", "MIN"}
            )
        )
        if not valid:
            enqueue_refresh(player_id, logs[0].get("PLAYER_NAME", ""))
            counts["deferred"] += 1
            continue
        # Use the same raw schema as PlayerGameLog, retaining every historical
        # season and metadata field. None percentages become zero on display.
        clean_logs = [{
            **{key: (None if isinstance(value, float) and math.isnan(value) else value)
               for key, value in row.items() if key != "_season_type"},
            "Game_ID": str(row["GAME_ID"]), "Player_ID": player_id,
        } for row in logs]
        season_row = {
            **{key: (None if isinstance(value, float) and math.isnan(value) else value)
               for key, value in stats.items()},
            "SEASON_ID": season, "LEAGUE_ID": "00", "PLAYER_ID": player_id,
        }
        career = [row for row in existing.get("career_stats", []) if str(row.get("SEASON_ID")) != season]
        data = {
            **existing,
            "player_id": player_id,
            "name": logs[0].get("PLAYER_NAME") or existing.get("name"),
            "career_stats": career + [season_row],
            "season_game_logs": {**existing.get("season_game_logs", {}), season: clean_logs},
            "game_log": clean_logs,
            "season_game_log": clean_logs,
        }
        if not data.get("current_team"):
            data["current_team"] = {
                "id": int(logs[0]["TEAM_ID"]), "name": logs[0].get("TEAM_NAME", ""),
                "abbreviation": logs[0].get("TEAM_ABBREVIATION", ""),
            }
        if data == existing:
            counts["unchanged"] += 1
            continue
        summary = build_player_summary_from_data(player_id, data)
        player_cache_collection.update_one({"player_id": player_id}, {"$set": {
            "player_id": player_id, "data": data, "summary": summary,
            "summary_version": SUMMARY_VERSION, "last_updated": datetime.now(UTC),
        }}, upsert=True)
        counts["updated"] += 1
    print(f"Current-season bulk refresh: {counts}", flush=True)
    return counts


def reconcile_current_season_players(tracked_players, games=None, season=None, refresh_bulk=False):
    """Queue uncached roster players and every player with missing appearances.

    Live game rows also discover players absent from both the packaged player
    list and the roster endpoint. A stats refresh takes precedence over an old
    historical-log repair, while retaining its retry schedule and worker lock.
    """
    season = season or get_current_season()
    failures = []
    if games is None:
        games, failures = fetch_current_season_games(season)

    bulk_result = None
    if refresh_bulk and "Regular Season" not in failures:
        try:
            bulk_result = refresh_current_season_from_bulk(games, season)
        except Exception as exc:
            print(f"Current-season bulk refresh unavailable; using individual queue: {exc}", flush=True)

    players = {int(player["id"]): dict(player) for player in tracked_players}
    appearances = {}
    for game in games:
        player_id = int(game["PLAYER_ID"])
        game_id = str(game["GAME_ID"])
        appearances.setdefault(player_id, set()).add(game_id)
        players.setdefault(player_id, {
            "id": player_id, "full_name": str(game.get("PLAYER_NAME") or ""),
        })

    counts = {
        "season": season,
        "bulk_refresh": bulk_result,
        "players_checked": len(players),
        "players_with_games": len(appearances),
        "uncached_players": 0,
        "players_missing_games": 0,
        "missing_games": 0,
        "new_jobs": 0,
        "existing_jobs_ensured": 0,
        "failed_sources": failures,
    }
    for player_id, player in players.items():
        cached = player_cache_collection.find_one({"player_id": player_id}, {
            "data.game_log": 1, "data.season_game_log": 1,
            "data.season_game_logs": 1, "data.playoff_game_log": 1,
            "data.playoff_season_game_log": 1, "data.playoff_season_game_logs": 1,
            "data.playin_game_log": 1, "data.playin_season_game_log": 1,
            "data.playin_season_game_logs": 1,
        })
        cached_ids = {
            str(game.get("GAME_ID") or game.get("Game_ID") or game.get("game_id"))
            for game in iter_cached_game_logs((cached or {}).get("data") or {})
            if isinstance(game, dict)
        }
        missing = appearances.get(player_id, set()) - cached_ids
        if cached is not None and not missing:
            continue
        counts["uncached_players"] += cached is None
        counts["players_missing_games"] += bool(missing)
        counts["missing_games"] += len(missing)
        if enqueue_refresh(player_id, player.get("full_name", "")):
            counts["new_jobs"] += 1
        else:
            counts["existing_jobs_ensured"] += 1

    print(f"Current-season game reconciliation: {counts}", flush=True)
    return counts
