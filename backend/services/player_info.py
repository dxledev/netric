"""Nightly, lightweight checks for current player identity and stat corrections."""

import os
import math
from datetime import UTC, datetime

import pandas as pd
from nba_api.stats.endpoints import commonallplayers, commonplayerinfo, leaguedashplayerstats

from database import fetch_queue_collection, player_cache_collection
from services.fetch_service import run_with_retries
from services.player_pool import get_tracked_players
from services.team_service import get_current_season

player_cache = player_cache_collection
fetch_queue = fetch_queue_collection
NBA_API_TIMEOUT_SECONDS = int(os.getenv("NBA_API_TIMEOUT_SECONDS", "60"))

PLAYER_INFO_FIELDS = (
    "PERSON_ID", "DISPLAY_FIRST_LAST", "ROSTERSTATUS", "FROM_YEAR", "TO_YEAR",
    "PLAYERCODE", "TEAM_ID", "TEAM_CITY", "TEAM_NAME", "TEAM_ABBREVIATION", "TEAM_CODE",
)
STAT_FIELDS = ("GP", "MIN", "PTS", "AST", "REB", "STL", "BLK", "TOV", "PF", "FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA")


def utc_now():
    return datetime.now(UTC)


def _value(value):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _season_year(value):
    try:
        return int(str(value).split("-", 1)[0])
    except (TypeError, ValueError):
        return -1


def _has_games(row):
    try:
        return float(row.get("GP") or 0) > 0
    except (TypeError, ValueError):
        return False


def normalize_player_info(row):
    if build_current_team(row) is None:
        return None
    info = {field: _value(row.get(field)) for field in PLAYER_INFO_FIELDS if field in row}
    if info.get("PERSON_ID") is None:
        return None
    try:
        info["PERSON_ID"] = int(info["PERSON_ID"])
        for field in ("TEAM_ID", "ROSTERSTATUS", "FROM_YEAR", "TO_YEAR"):
            if info.get(field) not in (None, ""):
                info[field] = int(info[field])
            elif field in info:
                info[field] = None
    except (TypeError, ValueError, OverflowError):
        return None
    return info


def build_current_team(player_info):
    if not isinstance(player_info, dict) or player_info.get("TEAM_ID") in (None, ""):
        return None
    try:
        numeric_id = float(player_info["TEAM_ID"])
        if not math.isfinite(numeric_id) or not numeric_id.is_integer() or numeric_id < 0:
            return None
        team_id = int(numeric_id)
    except (TypeError, ValueError, OverflowError):
        return None
    city = str(player_info.get("TEAM_CITY") or "").strip()
    name = str(player_info.get("TEAM_NAME") or "").strip()
    abbreviation = str(player_info.get("TEAM_ABBREVIATION") or "").strip()
    if team_id > 0 and (not name or not abbreviation):
        return None
    if team_id == 0 and (city or name or abbreviation):
        return None
    if city and name and not name.lower().startswith(city.lower()):
        name = f"{city} {name}"
    return {
        "id": team_id,
        "name": name or city,
        "abbreviation": abbreviation,
    }


def fetch_common_player_info(player_id):
    """Fetch detailed biographical fields for a player whose profile changed."""
    response = run_with_retries(
        lambda: commonplayerinfo.CommonPlayerInfo(
            player_id=int(player_id), timeout=NBA_API_TIMEOUT_SECONDS
        )
    )
    frame = response.get_data_frames()[0]
    return [
        {key: _value(value) for key, value in row.items()}
        for row in frame.to_dict("records")
    ] if not frame.empty else []


def fetch_player_info_snapshot():
    response = run_with_retries(
        lambda: commonallplayers.CommonAllPlayers(
            league_id="00",
            season=get_current_season(),
            is_only_current_season=0,
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )
    frame = response.get_data_frames()[0]
    result = {}
    for row in frame.to_dict("records"):
        info = normalize_player_info(row)
        if info:
            result[info["PERSON_ID"]] = info
    return result


def fetch_season_totals_snapshot(season, season_type):
    response = run_with_retries(
        lambda: leaguedashplayerstats.LeagueDashPlayerStats(
            league_id_nullable="00",
            season=season,
            season_type_all_star=season_type,
            per_mode_detailed="Totals",
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )
    frame = response.get_data_frames()[0]
    result = {}
    for row in frame.to_dict("records"):
        player_id = row.get("PLAYER_ID")
        if player_id is None:
            continue
        result[int(player_id)] = {key: _value(value) for key, value in row.items()}
    return result


def fetch_season_stats_snapshot(season, season_type):
    return {
        player_id: {field: row.get(field) for field in STAT_FIELDS}
        for player_id, row in fetch_season_totals_snapshot(season, season_type).items()
    }


def stats_match_cached(cached_player, remote_stats, season, field="career_stats"):
    """Compare current-season totals, tolerating equivalent numeric encodings."""
    if not remote_stats:
        return True
    data = (cached_player or {}).get("data", {})
    seasons = data.get(field) or []
    season_rows = [row for row in seasons if str(row.get("SEASON_ID")) == str(season)]
    if not season_rows:
        return False
    # CareerStats can return a TOTAL row plus team rows. Prefer TOTAL; otherwise
    # sum team rows so a mid-season trade does not look like a correction.
    total_rows = [row for row in season_rows if str(row.get("TEAM_ABBREVIATION") or "").upper() == "TOT"]
    rows = total_rows[:1] or season_rows
    for field, expected in remote_stats.items():
        actual_key = "FG3M" if field == "FG3M" else field
        values = []
        for row in rows:
            try:
                values.append(float(row.get(actual_key) or 0))
            except (TypeError, ValueError):
                return False
        try:
            expected_value = float(expected or 0)
        except (TypeError, ValueError):
            return False
        actual = values[0] if total_rows else sum(values)
        tolerance = 1.1 if field == "MIN" else 1e-6
        if abs(actual - expected_value) > tolerance:
            return False
    return True


def _already_queued(player_id, job_type=None):
    query = {"player_id": int(player_id)}
    if job_type:
        query["job_type"] = job_type
    else:
        query["job_type"] = {"$nin": ["shot_chart_refresh", "player_info_refresh"]}
    return fetch_queue.find_one(query) is not None


def enqueue_refresh(player_id, name):
    if _already_queued(player_id):
        fetch_queue.update_one(
            {"player_id": int(player_id), "job_type": {"$nin": ["shot_chart_refresh", "player_info_refresh"]}},
            {"$set": {"refresh_stats": True}, "$unset": {"repair_missing_logs": ""}},
        )
        return False
    fetch_queue.insert_one({
        "player_id": int(player_id), "name": name, "refresh": True,
        "queued_at": utc_now(), "refresh_stats": True,
    })
    return True


def enqueue_player_info_refresh(player_id, name, info):
    """Queue one detailed-profile check, preserving any existing queued work."""
    if _already_queued(player_id, "player_info_refresh"):
        return False
    fetch_queue.insert_one({
        "job_type": "player_info_refresh", "player_id": int(player_id),
        "name": name, "player_info": info, "refresh_profile_details": True,
        "refresh": True, "queued_at": utc_now(),
    })
    return True


def refresh_player_info_and_stats(tracked_players=None, recent_only=False):
    """Queue live metadata changes and current-season stat corrections in bulk."""
    tracked_players = tracked_players if tracked_players is not None else get_tracked_players()
    try:
        info_snapshot = fetch_player_info_snapshot()
    except Exception as exc:
        print(f"Bulk player metadata unavailable; individual profile checks will continue: {exc}")
        info_snapshot = {}
    season = get_current_season()
    stats_seasons = {season, f"{int(season.split('-')[0]) - 1}-{str(int(season.split('-')[0]))[-2:]}"}
    cached_players = {}
    for player in tracked_players:
        cached = player_cache.find_one(
            {"player_id": int(player["id"])},
            {"data.player_info": 1, "data.current_team": 1, "data.career_stats": 1, "data.playoff_career_stats": 1},
        )
        if cached:
            cached_players[int(player["id"])] = cached
            for field in ("career_stats", "playoff_career_stats"):
                season_ids = [
                    str(row["SEASON_ID"])
                    for row in (cached.get("data", {}).get(field) or [])
                    if _has_games(row) and row.get("SEASON_ID")
                ]
                if season_ids and not recent_only:
                    stats_seasons.add(max(season_ids, key=_season_year))
    stats_snapshot = {}
    for stat_season in stats_seasons:
        for season_type in ("Regular Season", "Playoffs"):
            try:
                stats_snapshot[(stat_season, season_type)] = fetch_season_stats_snapshot(stat_season, season_type)
            except Exception as exc:
                print(f"{season_type} stat snapshot unavailable for {stat_season}: {exc}")
    counts = {"info_checks_queued": 0, "stats_queued": 0, "missing_remote_info": 0}

    for player in tracked_players:
        player_id = int(player["id"])
        remote_info = info_snapshot.get(player_id)
        if remote_info is None:
            counts["missing_remote_info"] += 1
        cached = cached_players.get(player_id)
        if not cached:
            continue  # The normal refresh path creates the initial player cache.

        data = cached.get("data", {})
        # Bulk team data misses biographical changes such as jersey, position,
        # height, and weight. Queue one CommonPlayerInfo check for every cached
        # player so those fields are compared nightly too.
        if enqueue_player_info_refresh(player_id, player.get("full_name", ""), remote_info):
            counts["info_checks_queued"] += 1

        stats_changed = False
        for season_type, field in (("Regular Season", "career_stats"), ("Playoffs", "playoff_career_stats")):
            cached_rows = (data.get(field) or [])
            target_seasons = [
                str(row.get("SEASON_ID")) for row in cached_rows
                if _has_games(row) and row.get("SEASON_ID")
            ]
            current_stats = stats_snapshot.get((season, season_type), {}).get(player_id)
            if current_stats and _has_games(current_stats):
                # Promote the active season as soon as its bulk stats show games,
                # even when the cached career endpoint has not added that season.
                target_season = season
                remote_stats = current_stats
            else:
                # Ignore preseason rows with GP=0 and keep checking the newest
                # season already represented in the cache for corrections.
                target_season = max(target_seasons, key=_season_year) if target_seasons else season
                remote_stats = stats_snapshot.get((target_season, season_type), {}).get(player_id)
                if remote_stats is None and target_season == season:
                    fallback_seasons = sorted(
                        (stat_season for stat_season in stats_seasons if stat_season != season),
                        key=_season_year,
                        reverse=True,
                    )
                    for fallback_season in fallback_seasons:
                        fallback_stats = stats_snapshot.get((fallback_season, season_type), {}).get(player_id)
                        if fallback_stats is not None:
                            target_season = fallback_season
                            remote_stats = fallback_stats
                            break
            if remote_stats and _has_games(remote_stats) and not stats_match_cached(cached, remote_stats, target_season, field):
                stats_changed = True
                break
        if stats_changed:
            if enqueue_refresh(player_id, player.get("full_name", "")):
                counts["stats_queued"] += 1

    print(
        "Player freshness check: "
        f"profile checks queued {counts['info_checks_queued']}, stat corrections queued {counts['stats_queued']}, "
        f"missing remote metadata {counts['missing_remote_info']}."
    )
    return counts
