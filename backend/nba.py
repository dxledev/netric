from datetime import datetime
import re
import unicodedata

import pandas as pd
from fastapi import HTTPException
from nba_api.stats.static import players

from database import fetch_queue_collection, player_cache_collection

player_cache = player_cache_collection
fetch_queue = fetch_queue_collection
SUMMARY_VERSION = 12
ACTIVE_PLAYER_MATCHES_ONLY = True

SUMMARY_REQUIRED_FIELDS = (
    "playoff_season_game_logs",
    "available_playoff_game_log_seasons",
    "playin_season_game_logs",
    "available_playin_game_log_seasons",
)


def to_int(value, default=0):
    if pd.isna(value):
        return default

    return int(float(value))


def to_float(value, default=0.0):
    if pd.isna(value):
        return default

    return float(value)


def normalize_search_query(value: str):
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    without_diacritics = "".join(char for char in normalized if not unicodedata.combining(char))

    return (
        without_diacritics
        .replace("’", "'")
        .replace("`", "'")
        .strip()
    )


def build_search_variants(value: str):
    base_query = str(value or "").strip()
    normalized_query = normalize_search_query(base_query)
    candidates = [base_query, normalized_query]
    unique_candidates = []

    for candidate in candidates:
        if candidate and candidate not in unique_candidates:
            unique_candidates.append(candidate)

    return [re.escape(candidate) for candidate in unique_candidates]


def build_efficiency_metrics(fgm, fg3m, fga, fta, pts):
    if fga > 0:
        efg = (fgm + 0.5 * fg3m) / fga
    else:
        efg = 0.0

    tsa = fga + 0.44 * fta
    if tsa > 0:
        ts = pts / (2 * tsa)
    else:
        ts = 0.0

    return round(efg, 3), round(ts, 3)


def sort_season_ids(season_ids):
    return sorted(season_ids, reverse=True)


def build_season_stats(row):
    season_fgm = to_float(row["FGM"])
    season_fg3m = to_float(row["FG3M"])
    season_fga = to_float(row["FGA"])
    season_fta = to_float(row["FTA"])
    season_pts = to_float(row["PTS"])
    efg_pct, ts_pct = build_efficiency_metrics(
        season_fgm,
        season_fg3m,
        season_fga,
        season_fta,
        season_pts,
    )

    return {
        "gp": to_int(row["GP"]),
        "min_total": to_float(row["MIN"]),
        "pts": season_pts,
        "ast": to_float(row["AST"]),
        "reb": to_float(row["REB"]),
        "stl": to_float(row["STL"]),
        "blk": to_float(row["BLK"]),
        "tov": to_float(row["TOV"]),
        "pf": to_float(row["PF"]),
        "fgm": season_fgm,
        "fga": season_fga,
        "fg_pct": to_float(row["FG_PCT"]),
        "three_pm": season_fg3m,
        "three_pa": to_float(row["FG3A"]),
        "fg3_pct": to_float(row["FG3_PCT"]),
        "ftm": to_float(row["FTM"]),
        "fta": season_fta,
        "ft_pct": to_float(row["FT_PCT"]),
        "efg_pct": efg_pct,
        "ts_pct": ts_pct,
        "fg2pm": season_fgm - season_fg3m,
        "fg2pa": season_fga - to_float(row["FG3A"]),
    }


def build_season_stats_by_season(career_stats: pd.DataFrame):
    season_stats_by_season = {}

    for _, row in career_stats.iterrows():
        season_id = str(row["SEASON_ID"])
        season_stats_by_season[season_id] = build_season_stats(row)

    return season_stats_by_season


def parse_minutes(value):
    if pd.isna(value):
        return 0.0

    raw_value = str(value or "").strip()
    if not raw_value:
        return 0.0

    if ":" in raw_value:
        minutes, seconds = raw_value.split(":", 1)
        return to_float(minutes) + (to_float(seconds) / 60)

    return to_float(raw_value)


def build_season_stats_from_game_logs(games):
    if not games:
        return None

    totals = {
        "gp": len(games),
        "min_total": 0.0,
        "pts": 0.0,
        "ast": 0.0,
        "reb": 0.0,
        "stl": 0.0,
        "blk": 0.0,
        "tov": 0.0,
        "pf": 0.0,
        "fgm": 0.0,
        "fga": 0.0,
        "three_pm": 0.0,
        "three_pa": 0.0,
        "ftm": 0.0,
        "fta": 0.0,
    }

    for game in games:
        totals["min_total"] += parse_minutes(game.get("min"))
        totals["pts"] += to_float(game.get("pts"))
        totals["ast"] += to_float(game.get("ast"))
        totals["reb"] += to_float(game.get("reb"))
        totals["stl"] += to_float(game.get("stl"))
        totals["blk"] += to_float(game.get("blk"))
        totals["tov"] += to_float(game.get("tov"))
        totals["pf"] += to_float(game.get("pf"))
        totals["fgm"] += to_float(game.get("fgm"))
        totals["fga"] += to_float(game.get("fga"))
        totals["three_pm"] += to_float(game.get("three_pm"))
        totals["three_pa"] += to_float(game.get("three_pa"))
        totals["ftm"] += to_float(game.get("ftm"))
        totals["fta"] += to_float(game.get("fta"))

    fgm = totals["fgm"]
    fga = totals["fga"]
    three_pm = totals["three_pm"]
    three_pa = totals["three_pa"]
    ftm = totals["ftm"]
    fta = totals["fta"]
    pts = totals["pts"]
    efg_pct, ts_pct = build_efficiency_metrics(fgm, three_pm, fga, fta, pts)

    return {
        **totals,
        "fg_pct": round(fgm / fga, 3) if fga > 0 else 0.0,
        "fg3_pct": round(three_pm / three_pa, 3) if three_pa > 0 else 0.0,
        "ft_pct": round(ftm / fta, 3) if fta > 0 else 0.0,
        "efg_pct": efg_pct,
        "ts_pct": ts_pct,
        "fg2pm": fgm - three_pm,
        "fg2pa": fga - three_pa,
    }


def add_missing_stats_from_game_logs(season_stats_by_season, season_game_logs):
    for season_id, games in season_game_logs.items():
        if str(season_id) in season_stats_by_season or not games:
            continue

        season_stats = build_season_stats_from_game_logs(games)
        if season_stats:
            season_stats_by_season[str(season_id)] = season_stats

    return season_stats_by_season


def combine_season_game_logs(*season_game_log_sets):
    combined_logs = {}

    for season_game_logs in season_game_log_sets:
        for season_id, games in season_game_logs.items():
            if not games:
                continue

            combined_logs.setdefault(str(season_id), []).extend(games)

    return combined_logs


def get_game_value(game, *keys, default=None):
    for key in keys:
        value = game.get(key)
        if value is not None and not pd.isna(value):
            return value

    return default


def normalize_game_log(game_log: pd.DataFrame):
    if game_log.empty:
        return []

    prepared_log = game_log.copy()
    if "GAME_DATE" not in prepared_log and "game_date" in prepared_log:
        prepared_log["GAME_DATE"] = prepared_log["game_date"]
    if "GAME_DATE" not in prepared_log and "date" in prepared_log:
        prepared_log["GAME_DATE"] = prepared_log["date"]

    prepared_log["GAME_DATE"] = pd.to_datetime(prepared_log["GAME_DATE"], errors="coerce")
    prepared_log = prepared_log.sort_values("GAME_DATE", ascending=False)

    normalized_games = []

    for _, game in prepared_log.iterrows():
        pts = to_int(get_game_value(game, "PTS", "pts"))
        ast = to_int(get_game_value(game, "AST", "ast"))
        reb = to_int(get_game_value(game, "REB", "reb"))
        fgm = to_int(get_game_value(game, "FGM", "fgm"))
        fg3m = to_int(get_game_value(game, "FG3M", "three_pm"))
        fga = to_int(get_game_value(game, "FGA", "fga"))
        fta = to_int(get_game_value(game, "FTA", "fta"))
        ftm = to_int(get_game_value(game, "FTM", "ftm"))
        efg_pct, ts_pct = build_efficiency_metrics(fgm, fg3m, fga, fta, pts)

        game_date = game.get("GAME_DATE")
        formatted_date = game_date.strftime("%m/%d") if not pd.isna(game_date) else ""
        iso_date = game_date.strftime("%Y-%m-%d") if not pd.isna(game_date) else ""

        normalized_games.append(
            {
                "game_id": str(get_game_value(game, "Game_ID", "GAME_ID", "game_id", default="") or ""),
                "matchup": get_game_value(game, "MATCHUP", "matchup", default="") or "",
                "date": formatted_date,
                "game_date": iso_date,
                "result": get_game_value(game, "WL", "result", default="") or "",
                "min": str(get_game_value(game, "MIN", "min", default="") or ""),
                "pts": pts,
                "ast": ast,
                "reb": reb,
                "stl": to_int(get_game_value(game, "STL", "stl")),
                "blk": to_int(get_game_value(game, "BLK", "blk")),
                "tov": to_int(get_game_value(game, "TOV", "tov")),
                "pf": to_int(get_game_value(game, "PF", "pf")),
                "plus_minus": to_int(get_game_value(game, "PLUS_MINUS", "plus_minus")),
                "fgm": fgm,
                "fga": fga,
                "fg_pct": to_float(get_game_value(game, "FG_PCT", "fg_pct")),
                "three_pm": fg3m,
                "three_pa": to_int(get_game_value(game, "FG3A", "three_pa")),
                "fg3_pct": to_float(get_game_value(game, "FG3_PCT", "fg3_pct")),
                "ftm": ftm,
                "fta": fta,
                "ft_pct": to_float(get_game_value(game, "FT_PCT", "ft_pct")),
                "efg_pct": efg_pct,
                "ts_pct": ts_pct,
            }
        )

    return normalized_games


def normalize_season_game_log_mapping(raw_logs_by_season):
    normalized_logs = {}

    for season_id in sort_season_ids(raw_logs_by_season.keys()):
        normalized_games = normalize_game_log(pd.DataFrame(raw_logs_by_season[season_id]))
        if normalized_games:
            normalized_logs[str(season_id)] = normalized_games

    return normalized_logs


def has_raw_games(raw_games):
    if isinstance(raw_games, list):
        return len(raw_games) > 0

    return False


def get_raw_log_season_ids(raw_logs_by_season):
    if not isinstance(raw_logs_by_season, dict):
        return set()

    return {
        str(season_id)
        for season_id, raw_games in raw_logs_by_season.items()
        if has_raw_games(raw_games)
    }


def get_active_stat_season_ids(raw_stats):
    if not isinstance(raw_stats, list):
        return set()

    active_seasons = set()

    for season in raw_stats:
        if not isinstance(season, dict):
            continue

        try:
            games_played = float(season.get("GP") or 0)
        except (TypeError, ValueError):
            games_played = 0

        season_id = season.get("SEASON_ID")
        if games_played > 0 and season_id is not None:
            active_seasons.add(str(season_id))

    return active_seasons


def has_all_season_ids(summary, field_name, expected_season_ids):
    if not expected_season_ids:
        return True

    available_season_ids = {
        str(season_id)
        for season_id in summary.get(field_name, [])
    }

    return expected_season_ids.issubset(available_season_ids)


def cached_summary_matches_postseason_data(summary, data):
    playoff_log_season_ids = get_raw_log_season_ids(data.get("playoff_season_game_logs"))
    playin_log_season_ids = get_raw_log_season_ids(data.get("playin_season_game_logs"))
    playoff_stat_season_ids = get_active_stat_season_ids(data.get("playoff_career_stats"))
    postseason_stat_season_ids = playoff_stat_season_ids | playoff_log_season_ids | playin_log_season_ids

    return (
        has_all_season_ids(summary, "available_playoff_game_log_seasons", playoff_log_season_ids)
        and has_all_season_ids(summary, "available_playin_game_log_seasons", playin_log_season_ids)
        and has_all_season_ids(summary, "available_playoff_stat_seasons", postseason_stat_season_ids)
    )


def build_season_game_logs(career_stats: pd.DataFrame, data: dict):
    raw_logs_by_season = data.get("season_game_logs")

    if isinstance(raw_logs_by_season, dict) and raw_logs_by_season:
        return normalize_season_game_log_mapping(raw_logs_by_season)

    latest_season_id = str(career_stats.iloc[0]["SEASON_ID"])
    raw_game_log = data.get("season_game_log") or data.get("game_log") or []
    normalized_games = normalize_game_log(pd.DataFrame(raw_game_log))
    return {latest_season_id: normalized_games} if normalized_games else {}


def build_playoff_season_game_logs(playoff_career_stats: pd.DataFrame, data: dict):
    raw_logs_by_season = data.get("playoff_season_game_logs")

    if isinstance(raw_logs_by_season, dict) and raw_logs_by_season:
        return normalize_season_game_log_mapping(raw_logs_by_season)

    if playoff_career_stats.empty:
        return {}

    latest_season_id = str(playoff_career_stats.iloc[0]["SEASON_ID"])
    raw_game_log = data.get("playoff_season_game_log") or data.get("playoff_game_log") or []
    normalized_games = normalize_game_log(pd.DataFrame(raw_game_log))
    return {latest_season_id: normalized_games} if normalized_games else {}


def build_playin_season_game_logs(data: dict):
    raw_logs_by_season = data.get("playin_season_game_logs")

    if isinstance(raw_logs_by_season, dict) and raw_logs_by_season:
        return normalize_season_game_log_mapping(raw_logs_by_season)

    return {}


def build_player_summary_from_data(player_id: int, data: dict):
    if "career_stats" not in data:
        raise HTTPException(status_code=404, detail="Invalid cache format")

    career_stats = pd.DataFrame(data["career_stats"])

    if career_stats.empty:
        raise HTTPException(status_code=404, detail="Career stats unavailable")

    career_stats = career_stats[career_stats["GP"] > 0]
    career_stats = career_stats.sort_values("SEASON_ID", ascending=False)

    if career_stats.empty:
        raise HTTPException(status_code=404, detail="Season stats unavailable")

    latest = career_stats.iloc[0]
    latest_season_id = str(latest["SEASON_ID"])
    season_game_logs = build_season_game_logs(career_stats, data)
    normalized_games = season_game_logs.get(latest_season_id, [])
    team_name = str(latest.get("TEAM_NAME") or "").strip()
    team_abbreviation = str(latest.get("TEAM_ABBREVIATION") or "").strip()
    team_id = to_int(latest.get("TEAM_ID"), default=0)

    season_stats_by_season = build_season_stats_by_season(career_stats)
    season_stats = season_stats_by_season.get(latest_season_id, build_season_stats(latest))
    playoff_career_stats = pd.DataFrame(data.get("playoff_career_stats", []))
    if not playoff_career_stats.empty and "GP" in playoff_career_stats:
        playoff_career_stats = playoff_career_stats[playoff_career_stats["GP"] > 0]
    if not playoff_career_stats.empty and "SEASON_ID" in playoff_career_stats:
        playoff_career_stats = playoff_career_stats.sort_values("SEASON_ID", ascending=False)

    playoff_season_game_logs = build_playoff_season_game_logs(playoff_career_stats, data)
    playin_season_game_logs = build_playin_season_game_logs(data)
    playoff_season_stats_by_season = add_missing_stats_from_game_logs(
        build_season_stats_by_season(playoff_career_stats)
        if not playoff_career_stats.empty
        else {},
        combine_season_game_logs(playin_season_game_logs, playoff_season_game_logs),
    )
    playoff_latest_season_id = sort_season_ids(playoff_season_stats_by_season.keys())[0] if playoff_season_stats_by_season else None
    playoff_season_stats = (
        playoff_season_stats_by_season.get(playoff_latest_season_id)
        if playoff_latest_season_id
        else None
    )
    normalized_playoff_games = (
        playoff_season_game_logs.get(playoff_latest_season_id, [])
        if playoff_latest_season_id
        else []
    )
    playin_latest_season_id = (
        str(sort_season_ids(playin_season_game_logs.keys())[0])
        if playin_season_game_logs
        else None
    )
    normalized_playin_games = (
        playin_season_game_logs.get(playin_latest_season_id, [])
        if playin_latest_season_id
        else []
    )
    normalized_postseason_games = (
        combine_season_game_logs(playin_season_game_logs, playoff_season_game_logs).get(playoff_latest_season_id, [])
        if playoff_latest_season_id
        else []
    )

    last_game = normalized_games[0] if normalized_games else None
    playoff_last_game = normalized_postseason_games[0] if normalized_postseason_games else None
    playin_last_game = normalized_playin_games[0] if normalized_playin_games else None

    return {
        "player_id": int(player_id),
        "summary_version": SUMMARY_VERSION,
        "name": data["name"],
        "team": {
            "id": team_id,
            "name": team_name,
            "abbreviation": team_abbreviation,
        },
        "season": latest_season_id,
        "season_stats": season_stats,
        "season_stats_by_season": season_stats_by_season,
        "available_stat_seasons": sort_season_ids(season_stats_by_season.keys()),
        "last_game": last_game,
        "last_5_games": normalized_games[:5],
        "season_game_log": normalized_games,
        "season_game_logs": season_game_logs,
        "available_game_log_seasons": sort_season_ids(season_game_logs.keys()),
        "playoff_season": playoff_latest_season_id,
        "playoff_season_stats": playoff_season_stats,
        "playoff_season_stats_by_season": playoff_season_stats_by_season,
        "available_playoff_stat_seasons": sort_season_ids(playoff_season_stats_by_season.keys()),
        "playoff_last_game": playoff_last_game,
        "playoff_last_5_games": normalized_postseason_games[:5],
        "playoff_season_game_log": normalized_playoff_games,
        "playoff_season_game_logs": playoff_season_game_logs,
        "available_playoff_game_log_seasons": sort_season_ids(playoff_season_game_logs.keys()),
        "playin_season": playin_latest_season_id,
        "playin_last_game": playin_last_game,
        "playin_last_5_games": normalized_playin_games[:5],
        "playin_season_game_log": normalized_playin_games,
        "playin_season_game_logs": playin_season_game_logs,
        "available_playin_game_log_seasons": sort_season_ids(playin_season_game_logs.keys()),
        "headshot_url": f"https://cdn.nba.com/headshots/nba/latest/1040x760/{player_id}.png",
    }


def search_player_stats(name: str):
    results = []

    for query in build_search_variants(name):
        try:
            results = players.find_players_by_full_name(query)
        except re.error:
            continue

        if results:
            break

    if not results:
        raise HTTPException(status_code=404, detail="Player not found")

    player_id = results[0]["id"]

    cached = player_cache.find_one({"player_id": player_id})

    if cached:
        return build_player_summary(player_id)

    fetch_queue.update_one(
        {"player_id": player_id},
        {"$set": {"player_id": player_id, "name": name}},
        upsert=True
    )

    raise HTTPException(
        status_code=404,
        detail="Player not cached yet. Fetch scheduled."
    )


def search_player_matches(name: str, limit: int = 25):
    if not str(name or "").strip():
        return {"matches": []}

    unique_results = {}

    for query in build_search_variants(name):
        try:
            results = players.find_players_by_full_name(query)
        except re.error:
            continue

        for result in results:
            player_id = int(result.get("id", 0))
            if not player_id or player_id in unique_results:
                continue

            is_active = bool(result.get("is_active"))
            if ACTIVE_PLAYER_MATCHES_ONLY and not is_active:
                continue

            unique_results[player_id] = {
                "player_id": player_id,
                "name": result.get("full_name", "").strip(),
                "is_active": is_active,
            }

        if unique_results:
            break

    matches = list(unique_results.values())[: max(1, min(limit, 100))]
    return {"matches": matches}

def build_player_summary(player_id: int):
    cached = player_cache.find_one({"player_id": player_id})

    if not cached:
        raise HTTPException(status_code=404, detail="Player not cached")

    if "data" not in cached:
        raise HTTPException(status_code=404, detail="Invalid cache format")

    cached_summary = cached.get("summary", {})
    if (
        cached_summary.get("summary_version") == SUMMARY_VERSION and
        all(field in cached_summary for field in SUMMARY_REQUIRED_FIELDS) and
        cached_summary_matches_postseason_data(cached_summary, cached["data"])
    ):
        return cached_summary

    summary = build_player_summary_from_data(player_id, cached["data"])
    player_cache.update_one(
        {"player_id": player_id},
        {"$set": {"summary": summary}},
    )
    return summary
