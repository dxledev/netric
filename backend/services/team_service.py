import os
import time
from datetime import UTC, datetime

import pandas as pd
from fastapi import HTTPException
from nba_api.stats.endpoints import (
    commonteamroster,
    leaguedashplayerstats,
    leaguedashteamstats,
    leaguestandings,
    playoffpicture,
    teamgamelog,
)
from nba_api.stats.static import teams

from database import standings_cache_collection, team_cache_collection

team_cache = team_cache_collection
standings_cache = standings_cache_collection

TEAM_SUMMARY_VERSION = 1
STANDINGS_SUMMARY_VERSION = 1
NBA_API_TIMEOUT_SECONDS = int(os.getenv("NBA_API_TIMEOUT_SECONDS", "60"))
NBA_API_RETRY_ATTEMPTS = int(os.getenv("NBA_API_RETRY_ATTEMPTS", "3"))
NBA_API_RETRY_DELAY_SECONDS = float(os.getenv("NBA_API_RETRY_DELAY_SECONDS", "2"))

TEAM_ABBREVIATION_BY_ID = {
    int(team["id"]): team["abbreviation"]
    for team in teams.get_teams()
}
TEAM_STATIC_BY_ID = {
    int(team["id"]): team
    for team in teams.get_teams()
}


def utc_now():
    return datetime.now(UTC)


def get_current_season():
    configured_season = os.getenv("NBA_SEASON", "").strip()
    if configured_season:
        return configured_season

    now = datetime.now()
    start_year = now.year if now.month >= 10 else now.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def get_season_id_for_playoff_picture(season):
    start_year = str(season).split("-")[0]
    return f"2{start_year}"


def run_with_retries(fetch_fn):
    last_error = None

    for attempt in range(1, NBA_API_RETRY_ATTEMPTS + 1):
        try:
            return fetch_fn()
        except Exception as error:
            last_error = error
            if attempt == NBA_API_RETRY_ATTEMPTS:
                break
            time.sleep(NBA_API_RETRY_DELAY_SECONDS * attempt)

    raise last_error


def to_int(value, default=0):
    if value is None or pd.isna(value):
        return default
    return int(float(value))


def to_float(value, default=0.0):
    if value is None or pd.isna(value):
        return default
    return float(value)


def get_value(row, *keys, default=None):
    for key in keys:
        if key in row and row[key] is not None and not pd.isna(row[key]):
            return row[key]
    return default


def normalize_record(value):
    raw_value = str(value or "").strip()
    return raw_value if raw_value else "0-0"


def parse_streak(value):
    raw_value = str(value or "").strip()
    if not raw_value:
        return ""
    return raw_value.upper().replace(" ", "")


def build_team_identity(team_id):
    team = TEAM_STATIC_BY_ID.get(int(team_id), {})
    return {
        "team_id": int(team_id),
        "name": team.get("full_name") or "",
        "city": team.get("city") or "",
        "nickname": team.get("nickname") or "",
        "abbreviation": team.get("abbreviation") or "",
        "conference": "",
    }


def normalize_team_stats(row, opponent_row=None):
    games_played = max(to_float(row.get("GP")), 1.0)
    has_opponent_row = opponent_row is not None

    return {
        "gp": to_int(row.get("GP")),
        "pts": round(to_float(row.get("PTS")) / games_played, 1),
        "fg_pct": to_float(row.get("FG_PCT")),
        "fg3_pct": to_float(row.get("FG3_PCT")),
        "ft_pct": to_float(row.get("FT_PCT")),
        "ast": round(to_float(row.get("AST")) / games_played, 1),
        "tov": round(to_float(row.get("TOV")) / games_played, 1),
        "oppg": round(to_float(opponent_row.get("PTS")) / games_played, 1) if has_opponent_row else 0.0,
        "ofg_pct": to_float(opponent_row.get("FG_PCT")) if has_opponent_row else 0.0,
        "o3fg_pct": to_float(opponent_row.get("FG3_PCT")) if has_opponent_row else 0.0,
        "blk": round(to_float(row.get("BLK")) / games_played, 1),
        "stl": round(to_float(row.get("STL")) / games_played, 1),
        "reb": round(to_float(row.get("REB")) / games_played, 1),
    }


def normalize_last_game(game):
    if not game:
        return None

    return {
        "game_id": str(get_value(game, "Game_ID", "GAME_ID", default="") or ""),
        "score": to_int(get_value(game, "PTS", default=0)),
        "date": str(get_value(game, "GAME_DATE", default="") or ""),
        "matchup": str(get_value(game, "MATCHUP", default="") or ""),
        "outcome": str(get_value(game, "WL", default="") or ""),
    }


def calculate_ts_pct(row):
    pts = to_float(row.get("PTS"))
    fga = to_float(row.get("FGA"))
    fta = to_float(row.get("FTA"))
    attempts = fga + 0.44 * fta
    return round(pts / (2 * attempts), 3) if attempts > 0 else 0.0


def normalize_player_totals(row):
    games_played = max(to_float(row.get("GP")), 1.0)
    pts = to_float(row.get("PTS"))
    reb = to_float(row.get("REB"))
    ast = to_float(row.get("AST"))

    return {
        "gp": to_int(row.get("GP")),
        "pts_total": pts,
        "reb_total": reb,
        "ast_total": ast,
        "fgm": to_float(row.get("FGM")),
        "fga": to_float(row.get("FGA")),
        "fta": to_float(row.get("FTA")),
        "pts": round(pts / games_played, 1),
        "reb": round(reb / games_played, 1),
        "ast": round(ast / games_played, 1),
        "ts_pct": calculate_ts_pct(row),
    }


def fetch_team_player_stats(team_id, season, season_type):
    try:
        stats = run_with_retries(
            lambda: leaguedashplayerstats.LeagueDashPlayerStats(
                team_id_nullable=str(team_id),
                season=season,
                season_type_all_star=season_type,
                per_mode_detailed="Totals",
                timeout=NBA_API_TIMEOUT_SECONDS,
            )
        )
    except KeyError as error:
        if str(error).strip("'") == "resultSet":
            return {}
        raise

    frame = stats.get_data_frames()[0]
    return {
        int(row["PLAYER_ID"]): normalize_player_totals(row)
        for _, row in frame.iterrows()
    }


def fetch_all_player_stats_by_team(season, season_type):
    try:
        stats = run_with_retries(
            lambda: leaguedashplayerstats.LeagueDashPlayerStats(
                season=season,
                season_type_all_star=season_type,
                per_mode_detailed="Totals",
                timeout=NBA_API_TIMEOUT_SECONDS,
            )
        )
    except KeyError as error:
        if str(error).strip("'") == "resultSet":
            return {}
        raise

    stats_by_team = {}
    for _, row in stats.get_data_frames()[0].iterrows():
        team_id = to_int(row.get("TEAM_ID"))
        player_id = to_int(row.get("PLAYER_ID"))
        if not team_id or not player_id:
            continue
        stats_by_team.setdefault(team_id, {})[player_id] = normalize_player_totals(row)

    return stats_by_team


def fetch_all_player_stats(season):
    return {
        "regular": fetch_all_player_stats_by_team(season, "Regular Season"),
        "postseason": fetch_all_player_stats_by_team(season, "Playoffs"),
        "playin": fetch_all_player_stats_by_team(season, "PlayIn"),
    }


def fetch_team_players(team_id, season, player_stats=None):
    roster = run_with_retries(
        lambda: commonteamroster.CommonTeamRoster(
            team_id=team_id,
            season=season,
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )
    roster_frame = roster.get_data_frames()[0]
    regular_stats = (
        player_stats.get("regular", {}).get(int(team_id), {})
        if player_stats
        else fetch_team_player_stats(team_id, season, "Regular Season")
    )
    playoff_stats = (
        player_stats.get("postseason", {}).get(int(team_id), {})
        if player_stats
        else fetch_team_player_stats(team_id, season, "Playoffs")
    )
    playin_stats = (
        player_stats.get("playin", {}).get(int(team_id), {})
        if player_stats
        else fetch_team_player_stats(team_id, season, "PlayIn")
    )

    players = []
    for _, row in roster_frame.iterrows():
        player_id = int(row["PLAYER_ID"])
        players.append(
            {
                "player_id": player_id,
                "name": str(row.get("PLAYER") or ""),
                "jersey_number": str(row.get("NUM") or ""),
                "position": str(row.get("POSITION") or ""),
                "regular": regular_stats.get(player_id, {"pts": 0.0, "reb": 0.0, "ast": 0.0, "ts_pct": 0.0}),
                "postseason": playoff_stats.get(player_id, {"pts": 0.0, "reb": 0.0, "ast": 0.0, "ts_pct": 0.0}),
                "playin": playin_stats.get(player_id, {"pts": 0.0, "reb": 0.0, "ast": 0.0, "ts_pct": 0.0}),
            }
        )

    return players


def normalize_standing_row(row):
    team_id = to_int(get_value(row, "TeamID", "TEAM_ID", "TEAM_ID", default=0))
    wins = to_int(get_value(row, "WINS", "W", default=0))
    losses = to_int(get_value(row, "LOSSES", "L", default=0))
    conference = str(get_value(row, "Conference", "CONFERENCE", default="") or "")
    playoff_rank = to_int(get_value(row, "PlayoffRank", "RANK", default=0))
    clinch_indicator = str(get_value(row, "ClinchIndicator", "CLINCHED_PLAYOFFS", default="") or "")
    team_name = str(get_value(row, "TeamName", "TEAM", default="") or "")
    city = str(get_value(row, "TeamCity", default="") or "")

    return {
        "team_id": team_id,
        "name": f"{city} {team_name}".strip() if city else team_name,
        "abbreviation": TEAM_ABBREVIATION_BY_ID.get(team_id, ""),
        "conference": conference,
        "rank": playoff_rank,
        "standing_label": f"{playoff_rank}{ordinal_suffix(playoff_rank)} {'EC' if conference == 'East' else 'WC'}",
        "wins": wins,
        "losses": losses,
        "record": f"{wins}-{losses}",
        "win_pct": to_float(get_value(row, "WinPCT", "PCT", default=0)),
        "games_back": str(get_value(row, "ConferenceGamesBack", "GB", default="0") or "0"),
        "l10": normalize_record(get_value(row, "L10", default="")),
        "streak": parse_streak(get_value(row, "strCurrentStreak", "CurrentStreak", default="")),
        "home_record": normalize_record(get_value(row, "HOME", default="")),
        "away_record": normalize_record(get_value(row, "ROAD", "AWAY", default="")),
        "ppg": to_float(get_value(row, "PointsPG", default=0)),
        "oppg": to_float(get_value(row, "OppPointsPG", default=0)),
        "postseason_eligible": playoff_rank <= 10,
        "clinched_playoffs": bool(clinch_indicator) and clinch_indicator not in {"0", "-"},
    }


def ordinal_suffix(value):
    if 10 <= value % 100 <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")


def fetch_standings(season=None):
    season = season or get_current_season()
    standings = run_with_retries(
        lambda: leaguestandings.LeagueStandings(
            season=season,
            season_type="Regular Season",
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )
    frame = standings.get_data_frames()[0]
    rows = [normalize_standing_row(row) for _, row in frame.iterrows()]
    rows = sorted(rows, key=lambda row: (row["conference"], row["rank"]))

    return {
        "summary_version": STANDINGS_SUMMARY_VERSION,
        "season": season,
        "updated_at": utc_now(),
        "east": [row for row in rows if row["conference"] == "East"],
        "west": [row for row in rows if row["conference"] == "West"],
        "playoffs": fetch_playoff_picture(season),
    }


def fetch_playoff_picture(season):
    try:
        picture = run_with_retries(
            lambda: playoffpicture.PlayoffPicture(
                season_id=get_season_id_for_playoff_picture(season),
                timeout=NBA_API_TIMEOUT_SECONDS,
            )
        )
        frames = picture.get_data_frames()
    except Exception:
        return {"rounds": []}

    round_one = []
    playoff_frames = [
        frame
        for frame in frames
        if {"HIGH_SEED_TEAM", "LOW_SEED_TEAM"}.issubset(set(frame.columns))
    ]

    for frame in playoff_frames:
        for _, row in frame.iterrows():
            high_seed = str(row.get("HIGH_SEED_TEAM") or "")
            low_seed = str(row.get("LOW_SEED_TEAM") or "")
            if not high_seed or not low_seed:
                continue
            round_one.append(
                {
                    "round": "Round One",
                    "conference": str(row.get("CONFERENCE") or ""),
                    "higher_seed": high_seed,
                    "lower_seed": low_seed,
                    "series_score": f"{to_int(row.get('HIGH_SEED_SERIES_W'))}-{to_int(row.get('HIGH_SEED_SERIES_L'))}",
                }
            )

    return {
        "rounds": [
            {"name": "Round One", "series": round_one},
            {"name": "Conf. Semis", "series": []},
            {"name": "Conf. Finals", "series": []},
            {"name": "Finals", "series": []},
        ]
    }


def store_standings(season=None):
    summary = fetch_standings(season)
    standings_cache.update_one(
        {"season": summary["season"]},
        {"$set": summary},
        upsert=True,
    )
    return summary


def get_cached_standings(season=None):
    season = season or get_current_season()
    cached = standings_cache.find_one({"season": season}, {"_id": 0})
    if cached:
        return cached

    return store_standings(season)


def fetch_all_team_stats(season):
    base = run_with_retries(
        lambda: leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            season_type_all_star="Regular Season",
            per_mode_detailed="Totals",
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )
    opponent = run_with_retries(
        lambda: leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            season_type_all_star="Regular Season",
            measure_type_detailed_defense="Opponent",
            per_mode_detailed="Totals",
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )

    base_rows = {
        int(row["TEAM_ID"]): row
        for _, row in base.get_data_frames()[0].iterrows()
    }
    opponent_rows = {
        int(row["TEAM_ID"]): row
        for _, row in opponent.get_data_frames()[0].iterrows()
    }

    return base_rows, opponent_rows


def fetch_team_summary(team_id, season=None, standings=None, team_stats=None, player_stats=None):
    season = season or get_current_season()
    standings = standings or fetch_standings(season)
    base_rows, opponent_rows = team_stats or fetch_all_team_stats(season)
    team_id = int(team_id)
    team_identity = build_team_identity(team_id)
    standing = next(
        (
            row
            for row in [*standings.get("east", []), *standings.get("west", [])]
            if int(row.get("team_id")) == team_id
        ),
        None,
    )
    if standing:
        team_identity["conference"] = standing["conference"]
        team_identity["name"] = standing["name"] or team_identity["name"]

    gamelog = run_with_retries(
        lambda: teamgamelog.TeamGameLog(
            team_id=team_id,
            season=season,
            season_type_all_star="Regular Season",
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )
    games = gamelog.get_data_frames()[0].to_dict("records")

    return {
        "summary_version": TEAM_SUMMARY_VERSION,
        "season": season,
        "team": team_identity,
        "stats": normalize_team_stats(base_rows.get(team_id, {}), opponent_rows.get(team_id, {})),
        "last_game": normalize_last_game(games[0] if games else None),
        "players": fetch_team_players(team_id, season, player_stats),
        "record": standing["record"] if standing else "",
        "win_streak": standing["streak"] if standing else "",
        "standing": standing["standing_label"] if standing else "",
        "standing_rank": standing["rank"] if standing else None,
        "conference": standing["conference"] if standing else team_identity.get("conference", ""),
        "updated_at": utc_now(),
    }


def store_team_summary(team_id, season=None, standings=None, team_stats=None, player_stats=None):
    summary = fetch_team_summary(team_id, season, standings, team_stats, player_stats)
    team_cache.update_one(
        {"team_id": int(team_id), "season": summary["season"]},
        {"$set": {"team_id": int(team_id), **summary}},
        upsert=True,
    )
    return summary


def refresh_all_teams(season=None):
    season = season or get_current_season()
    standings = store_standings(season)
    team_stats = fetch_all_team_stats(season)
    player_stats = fetch_all_player_stats(season)
    refreshed = 0

    for team in teams.get_teams():
        store_team_summary(int(team["id"]), season, standings, team_stats, player_stats)
        refreshed += 1

    return refreshed


def get_cached_team_summary(team_id, season=None):
    season = season or get_current_season()
    cached = team_cache.find_one({"team_id": int(team_id), "season": season}, {"_id": 0})
    if cached:
        return cached

    raise HTTPException(status_code=404, detail="Team not cached yet.")


def list_teams():
    return {
        "teams": sorted(
            [
                {
                    "team_id": int(team["id"]),
                    "name": team["full_name"],
                    "abbreviation": team["abbreviation"],
                    "city": team["city"],
                    "nickname": team["nickname"],
                }
                for team in teams.get_teams()
            ],
            key=lambda team: team["name"],
        )
    }
