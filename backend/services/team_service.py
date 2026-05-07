import os
import re
import time
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
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
BBR_REQUEST_DELAY_SECONDS = float(os.getenv("BBR_REQUEST_DELAY_SECONDS", "6"))
BBR_TIMEOUT_SECONDS = int(os.getenv("BBR_TIMEOUT_SECONDS", "30"))
BBR_BASE_URL = "https://www.basketball-reference.com"
BBR_ABBREVIATION_BY_NBA_ABBREVIATION = {
    "BKN": "BRK",
    "CHA": "CHO",
    "PHX": "PHO",
}
TEAM_NAME_ALIASES = {
    "brooklyn nets": "Brooklyn Nets",
    "charlotte hornets": "Charlotte Hornets",
    "la clippers": "Los Angeles Clippers",
    "los angeles clippers": "Los Angeles Clippers",
    "phoenix suns": "Phoenix Suns",
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


def get_bbr_season_year(season=None):
    season = season or get_current_season()
    return int(str(season).split("-")[0]) + 1


class BasketballReferenceRateLimit(Exception):
    def __init__(self, retry_after=None):
        self.retry_after = retry_after
        message = "Basketball Reference rate limit reached"
        if retry_after:
            message = f"{message}; retry after {retry_after} seconds"
        super().__init__(message)


class BBRTableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.current_row = None
        self.current_cell = None
        self.current_key = None
        self.in_thead = False
        self.skip_row = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "thead":
            self.in_thead = True
        elif tag == "tr":
            row_class = attrs.get("class", "")
            self.current_row = {}
            self.skip_row = self.in_thead or "thead" in row_class
        elif tag in {"td", "th"} and self.current_row is not None:
            self.current_key = attrs.get("data-stat")
            self.current_cell = []
            if self.current_key and attrs.get("data-append-csv"):
                self.current_row[f"{self.current_key}_id"] = attrs.get("data-append-csv")

    def handle_data(self, data):
        if self.current_cell is not None:
            self.current_cell.append(data)

    def handle_endtag(self, tag):
        if tag == "thead":
            self.in_thead = False
        elif tag in {"td", "th"} and self.current_row is not None:
            if self.current_key:
                value = " ".join("".join(self.current_cell or []).split())
                self.current_row[self.current_key] = value
            self.current_cell = None
            self.current_key = None
        elif tag == "tr" and self.current_row is not None:
            if not self.skip_row and any(self.current_row.values()):
                self.rows.append(self.current_row)
            self.current_row = None
            self.skip_row = False


def fetch_bbr_html(path):
    url = f"{BBR_BASE_URL}{path}"
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; NetricTeamCache/1.0; +https://example.com)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )

    try:
        with urlopen(request, timeout=BBR_TIMEOUT_SECONDS) as response:
            return response.read().decode("utf-8", errors="replace")
    except HTTPError as error:
        if error.code == 429:
            retry_after = error.headers.get("Retry-After")
            try:
                retry_after = int(retry_after) if retry_after else None
            except ValueError:
                retry_after = None
            raise BasketballReferenceRateLimit(retry_after=retry_after) from error
        raise
    except URLError as error:
        raise RuntimeError(f"Basketball Reference request failed: {error}") from error


def parse_bbr_table(html, table_id):
    match = re.search(
        rf"<table\b[^>]*\bid=[\"']{re.escape(table_id)}[\"'][\s\S]*?</table>",
        html,
        flags=re.IGNORECASE,
    )
    if not match:
        return []

    parser = BBRTableParser()
    parser.feed(match.group(0))
    return parser.rows


def clean_bbr_team_name(value):
    without_markers = str(value or "").replace("*", "")
    without_seed = re.sub(r"\s+\(\d+\)$", "", without_markers)
    return re.sub(r"\s+", " ", without_seed).strip()


def normalize_team_name_key(value):
    return re.sub(r"[^a-z0-9]", "", clean_bbr_team_name(value).lower())


def get_team_id_by_name(name):
    clean_name = clean_bbr_team_name(name)
    aliased_name = TEAM_NAME_ALIASES.get(clean_name.lower(), clean_name)
    target_key = normalize_team_name_key(aliased_name)

    for team in teams.get_teams():
        if normalize_team_name_key(team["full_name"]) == target_key:
            return int(team["id"])

    return None


def get_bbr_abbreviation(nba_abbreviation):
    return BBR_ABBREVIATION_BY_NBA_ABBREVIATION.get(nba_abbreviation, nba_abbreviation)


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


def normalize_bbr_record(value):
    raw_value = str(value or "").strip()
    if not raw_value:
        return "0-0"
    return raw_value.replace(" ", "")


def normalize_bbr_streak(value):
    raw_value = str(value or "").strip().upper()
    if not raw_value:
        return ""
    return raw_value.replace(" ", "")


def parse_bbr_games_back(value):
    raw_value = str(value or "").strip()
    if raw_value in {"", "-", "—"}:
        return "0"
    return raw_value


def build_bbr_team_stats_row(base_row, opponent_row=None):
    opponent_row = opponent_row or {}
    return {
        "gp": to_int(base_row.get("g")),
        "pts": to_float(base_row.get("pts")),
        "fg_pct": to_float(base_row.get("fg_pct")),
        "fg3_pct": to_float(base_row.get("fg3_pct")),
        "ft_pct": to_float(base_row.get("ft_pct")),
        "ast": to_float(base_row.get("ast")),
        "tov": to_float(base_row.get("tov")),
        "oppg": to_float(opponent_row.get("opp_pts")),
        "ofg_pct": to_float(opponent_row.get("opp_fg_pct")),
        "o3fg_pct": to_float(opponent_row.get("opp_fg3_pct")),
        "blk": to_float(base_row.get("blk")),
        "stl": to_float(base_row.get("stl")),
        "reb": to_float(base_row.get("trb")),
    }


def build_bbr_standing_row(row, conference, rank, stats_by_team_id=None):
    team_id = get_team_id_by_name(row.get("team_name"))
    if not team_id:
        return None

    team = TEAM_STATIC_BY_ID.get(team_id, {})
    stats = (stats_by_team_id or {}).get(team_id, {})
    wins = to_int(row.get("wins"))
    losses = to_int(row.get("losses"))

    return {
        "team_id": team_id,
        "name": team.get("full_name") or clean_bbr_team_name(row.get("team_name")),
        "abbreviation": team.get("abbreviation") or "",
        "conference": conference,
        "rank": rank,
        "standing_label": f"{rank}{ordinal_suffix(rank)} {'EC' if conference == 'East' else 'WC'}",
        "wins": wins,
        "losses": losses,
        "record": f"{wins}-{losses}",
        "win_pct": to_float(row.get("win_loss_pct")),
        "games_back": parse_bbr_games_back(row.get("gb")),
        "l10": normalize_bbr_record(row.get("last_ten")) if row.get("last_ten") else "",
        "streak": normalize_bbr_streak(row.get("streak")),
        "home_record": normalize_bbr_record(row.get("home_record")) if row.get("home_record") else "",
        "away_record": normalize_bbr_record(row.get("road_record")) if row.get("road_record") else "",
        "ppg": to_float(row.get("pts_per_g"), to_float(stats.get("pts"))),
        "oppg": to_float(row.get("opp_pts_per_g"), to_float(stats.get("oppg"))),
        "postseason_eligible": rank <= 10,
        "clinched_playoffs": rank <= 8,
    }


def calculate_bbr_ts_pct(row):
    pts = to_float(row.get("pts_per_g"))
    fga = to_float(row.get("fga_per_g"))
    fta = to_float(row.get("fta_per_g"))
    attempts = fga + 0.44 * fta
    return round(pts / (2 * attempts), 3) if attempts > 0 else 0.0


def normalize_bbr_player_stats(row):
    gp = to_int(row.get("games", row.get("g")))
    pts = to_float(row.get("pts_per_g"))
    reb = to_float(row.get("trb_per_g"))
    ast = to_float(row.get("ast_per_g"))
    fga = to_float(row.get("fga_per_g"))
    fta = to_float(row.get("fta_per_g"))

    return {
        "gp": gp,
        "pts_total": round(pts * gp, 1),
        "reb_total": round(reb * gp, 1),
        "ast_total": round(ast * gp, 1),
        "fga": round(fga * gp, 1),
        "fta": round(fta * gp, 1),
        "pts": pts,
        "reb": reb,
        "ast": ast,
        "ts_pct": calculate_bbr_ts_pct(row),
    }


def index_bbr_player_stats(rows):
    indexed = {}
    for row in rows:
        player_key = (
            row.get("player_id")
            or row.get("name_display_id")
            or normalize_team_name_key(row.get("player") or row.get("name_display"))
        )
        player_name_key = normalize_team_name_key(row.get("player") or row.get("name_display"))
        if not player_key:
            continue
        stats = normalize_bbr_player_stats(row)
        indexed[player_key] = stats
        if player_name_key:
            indexed[player_name_key] = stats
    return indexed


def build_bbr_players(roster_rows, regular_rows, postseason_rows):
    regular_stats = index_bbr_player_stats(regular_rows)
    postseason_stats = index_bbr_player_stats(postseason_rows)
    players = []

    for row in roster_rows:
        player_key = row.get("player_id") or normalize_team_name_key(row.get("player"))
        name = str(row.get("player") or "").strip()
        if not player_key or not name:
            continue

        empty_stats = {
            "gp": 0,
            "pts_total": 0.0,
            "reb_total": 0.0,
            "ast_total": 0.0,
            "fga": 0.0,
            "fta": 0.0,
            "pts": 0.0,
            "reb": 0.0,
            "ast": 0.0,
            "ts_pct": 0.0,
        }
        players.append(
            {
                "player_id": player_key,
                "name": name,
                "jersey_number": str(row.get("number") or ""),
                "position": str(row.get("pos") or ""),
                "regular": regular_stats.get(player_key, empty_stats),
                "postseason": postseason_stats.get(player_key, empty_stats),
                "playin": empty_stats,
            }
        )

    return players


def build_bbr_last_game(games_rows):
    completed_games = [
        row
        for row in games_rows
        if str(row.get("game_result") or "").strip() in {"W", "L"}
    ]
    if not completed_games:
        return None

    game = completed_games[-1]
    points = to_int(game.get("pts"))
    opponent_points = to_int(game.get("opp_pts"))
    location = "vs" if not str(game.get("game_location") or "").strip() else "@"
    opponent = str(game.get("opp_name") or "").strip()

    return {
        "game_id": str(game.get("date_game") or ""),
        "score": f"{points}-{opponent_points}",
        "date": str(game.get("date_game") or ""),
        "matchup": f"{location} {opponent}".strip(),
        "outcome": str(game.get("game_result") or ""),
    }


def build_bbr_schedule_summary(games_rows):
    completed_games = [
        row
        for row in games_rows
        if str(row.get("game_result") or "").strip() in {"W", "L"}
    ]
    last_ten = completed_games[-10:]
    last_ten_wins = sum(1 for row in last_ten if row.get("game_result") == "W")
    home_games = [row for row in completed_games if not str(row.get("game_location") or "").strip()]
    away_games = [row for row in completed_games if str(row.get("game_location") or "").strip() == "@"]
    home_wins = sum(1 for row in home_games if row.get("game_result") == "W")
    away_wins = sum(1 for row in away_games if row.get("game_result") == "W")

    return {
        "l10": f"{last_ten_wins}-{len(last_ten) - last_ten_wins}" if last_ten else "",
        "streak": normalize_bbr_streak(completed_games[-1].get("game_streak")) if completed_games else "",
        "home_record": f"{home_wins}-{len(home_games) - home_wins}" if home_games else "",
        "away_record": f"{away_wins}-{len(away_games) - away_wins}" if away_games else "",
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


def fetch_playoff_picture_enrichment(season):
    try:
        picture = run_with_retries(
            lambda: playoffpicture.PlayoffPicture(
                season_id=get_season_id_for_playoff_picture(season),
                timeout=NBA_API_TIMEOUT_SECONDS,
            )
        )
        frames = picture.get_data_frames()
    except Exception:
        return {}, {"rounds": [
            {"name": "Round One", "series": []},
            {"name": "Conf. Semis", "series": []},
            {"name": "Conf. Finals", "series": []},
            {"name": "Finals", "series": []},
        ]}

    standings_by_team_id = {}
    for frame in frames:
        columns = set(frame.columns)
        if not {"TEAM_ID", "HOME", "AWAY"}.issubset(columns):
            continue
        for _, row in frame.iterrows():
            team_id = to_int(row.get("TEAM_ID"))
            if not team_id:
                continue
            standings_by_team_id[team_id] = {
                "home_record": normalize_record(row.get("HOME")),
                "away_record": normalize_record(row.get("AWAY")),
                "clinched_playoffs": bool(to_float(row.get("CLINCHED_PLAYOFFS"), 0.0)),
            }

    round_one = []
    for frame in frames:
        columns = set(frame.columns)
        if not {"HIGH_SEED_TEAM", "LOW_SEED_TEAM", "HIGH_SEED_TEAM_ID", "LOW_SEED_TEAM_ID"}.issubset(columns):
            continue
        for _, row in frame.iterrows():
            high_team = str(row.get("HIGH_SEED_TEAM") or "").strip()
            low_team = str(row.get("LOW_SEED_TEAM") or "").strip()
            if not high_team or not low_team:
                continue
            high_wins = to_int(row.get("HIGH_SEED_SERIES_W"))
            high_losses = to_int(row.get("HIGH_SEED_SERIES_L"))
            round_one.append(
                {
                    "round": "Round One",
                    "conference": str(row.get("CONFERENCE") or ""),
                    "higher_seed": f"{to_int(row.get('HIGH_SEED_RANK'))}. {high_team}",
                    "higher_seed_team_id": to_int(row.get("HIGH_SEED_TEAM_ID")),
                    "lower_seed": f"{to_int(row.get('LOW_SEED_RANK'))}. {low_team}",
                    "lower_seed_team_id": to_int(row.get("LOW_SEED_TEAM_ID")),
                    "series_score": f"{high_wins}-{high_losses}",
                }
            )

    return standings_by_team_id, {
        "rounds": [
            {"name": "Round One", "series": round_one},
            {"name": "Conf. Semis", "series": []},
            {"name": "Conf. Finals", "series": []},
            {"name": "Finals", "series": []},
        ]
    }


def fetch_bbr_league_snapshot(season=None):
    season = season or get_current_season()
    bbr_year = get_bbr_season_year(season)
    league_html = fetch_bbr_html(f"/leagues/NBA_{bbr_year}.html")
    standings_html = fetch_bbr_html(f"/leagues/NBA_{bbr_year}_standings.html")
    standings_enrichment, playoffs = fetch_playoff_picture_enrichment(season)

    team_rows = parse_bbr_table(league_html, "per_game-team")
    opponent_rows = parse_bbr_table(league_html, "per_game-opponent")
    opponent_by_name = {
        normalize_team_name_key(row.get("team")): row
        for row in opponent_rows
    }

    stats_by_team_id = {}
    for row in team_rows:
        team_id = get_team_id_by_name(row.get("team"))
        if not team_id:
            continue
        opponent_row = opponent_by_name.get(normalize_team_name_key(row.get("team")))
        stats_by_team_id[team_id] = build_bbr_team_stats_row(row, opponent_row)

    east_rows = []
    west_rows = []
    for conference, table_id, bucket in [
        ("East", "confs_standings_E", east_rows),
        ("West", "confs_standings_W", west_rows),
    ]:
        parsed_rows = parse_bbr_table(standings_html, table_id)
        rank = 1
        for row in parsed_rows:
            standing_row = build_bbr_standing_row(row, conference, rank, stats_by_team_id)
            if not standing_row:
                continue
            standing_row.update({
                key: value
                for key, value in standings_enrichment.get(standing_row["team_id"], {}).items()
                if value not in {None, ""}
            })
            bucket.append(standing_row)
            rank += 1

    standings_summary = {
        "summary_version": STANDINGS_SUMMARY_VERSION,
        "season": season,
        "updated_at": utc_now(),
        "east": east_rows,
        "west": west_rows,
        "playoffs": playoffs,
        "source": "basketball-reference",
    }

    return standings_summary, stats_by_team_id


def preserve_cached_standing_details(standings_summary):
    cached = standings_cache.find_one({"season": standings_summary["season"]}, {"_id": 0})
    if not cached:
        return standings_summary

    cached_rows = {
        int(row["team_id"]): row
        for row in [*cached.get("east", []), *cached.get("west", [])]
        if row.get("team_id")
    }
    preserve_fields = ["l10", "streak", "home_record", "away_record"]

    for conference in ["east", "west"]:
        for row in standings_summary.get(conference, []):
            cached_row = cached_rows.get(int(row.get("team_id", 0)))
            if not cached_row:
                continue
            for field in preserve_fields:
                if not row.get(field) and cached_row.get(field):
                    row[field] = cached_row[field]

    new_rounds = standings_summary.get("playoffs", {}).get("rounds", [])
    has_new_series = any(round_item.get("series") for round_item in new_rounds)
    cached_rounds = cached.get("playoffs", {}).get("rounds", [])
    has_cached_series = any(round_item.get("series") for round_item in cached_rounds)
    if not has_new_series and has_cached_series:
        standings_summary["playoffs"] = cached["playoffs"]

    return standings_summary


def store_bbr_league_snapshot(season=None):
    standings_summary, stats_by_team_id = fetch_bbr_league_snapshot(season)
    standings_summary = preserve_cached_standing_details(standings_summary)
    season = standings_summary["season"]
    standings_cache.update_one(
        {"season": season},
        {"$set": standings_summary},
        upsert=True,
    )

    standings_by_team_id = {
        int(row["team_id"]): row
        for row in [*standings_summary.get("east", []), *standings_summary.get("west", [])]
    }

    updated_count = 0
    for team in teams.get_teams():
        team_id = int(team["id"])
        standing = standings_by_team_id.get(team_id, {})
        stats = stats_by_team_id.get(team_id)
        team_identity = build_team_identity(team_id)
        team_identity["conference"] = standing.get("conference", "")

        set_fields = {
            "team_id": team_id,
            "season": season,
            "summary_version": TEAM_SUMMARY_VERSION,
            "team": team_identity,
            "record": standing.get("record", ""),
            "win_streak": standing.get("streak", ""),
            "standing": standing.get("standing_label", ""),
            "standing_rank": standing.get("rank"),
            "conference": standing.get("conference", ""),
            "updated_at": utc_now(),
            "source": "basketball-reference",
            "seeded_without_live_stats": False,
        }
        if stats:
            set_fields["stats"] = stats

        team_cache.update_one(
            {"team_id": team_id, "season": season},
            {
                "$set": set_fields,
                "$setOnInsert": {
                    "last_game": None,
                    "players": [],
                },
            },
            upsert=True,
        )
        updated_count += 1

    return {"season": season, "teams": updated_count, "standings": standings_summary}


def fetch_bbr_team_detail(team_id, season=None):
    season = season or get_current_season()
    team_id = int(team_id)
    team = TEAM_STATIC_BY_ID.get(team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Unknown team.")

    bbr_year = get_bbr_season_year(season)
    bbr_abbreviation = get_bbr_abbreviation(team["abbreviation"])
    team_html = fetch_bbr_html(f"/teams/{bbr_abbreviation}/{bbr_year}.html")
    games_html = fetch_bbr_html(f"/teams/{bbr_abbreviation}/{bbr_year}_games.html")

    roster_rows = parse_bbr_table(team_html, "roster")
    regular_rows = parse_bbr_table(team_html, "per_game_stats")
    postseason_rows = parse_bbr_table(team_html, "per_game_stats_post")
    games_rows = parse_bbr_table(games_html, "games")

    return {
        "players": build_bbr_players(roster_rows, regular_rows, postseason_rows),
        "last_game": build_bbr_last_game(games_rows),
        "schedule_summary": build_bbr_schedule_summary(games_rows),
    }


def store_bbr_team_detail(team_id, season=None):
    season = season or get_current_season()
    detail = fetch_bbr_team_detail(team_id, season)
    schedule_summary = detail.get("schedule_summary") or {}
    team_cache.update_one(
        {"team_id": int(team_id), "season": season},
        {
            "$set": {
                "players": detail["players"],
                "last_game": detail["last_game"],
                "win_streak": schedule_summary.get("streak", ""),
                "updated_at": utc_now(),
                "source": "basketball-reference",
                "seeded_without_live_stats": False,
            },
            "$setOnInsert": {
                "team_id": int(team_id),
                "season": season,
                "summary_version": TEAM_SUMMARY_VERSION,
                "team": build_team_identity(team_id),
                "stats": {},
                "record": "",
                "standing": "",
                "standing_rank": None,
                "conference": "",
            },
        },
        upsert=True,
    )
    standings_cache.update_one(
        {"season": season, "east.team_id": int(team_id)},
        {
            "$set": {
                "east.$.l10": schedule_summary.get("l10", ""),
                "east.$.streak": schedule_summary.get("streak", ""),
                "east.$.home_record": schedule_summary.get("home_record", ""),
                "east.$.away_record": schedule_summary.get("away_record", ""),
                "updated_at": utc_now(),
            }
        },
    )
    standings_cache.update_one(
        {"season": season, "west.team_id": int(team_id)},
        {
            "$set": {
                "west.$.l10": schedule_summary.get("l10", ""),
                "west.$.streak": schedule_summary.get("streak", ""),
                "west.$.home_record": schedule_summary.get("home_record", ""),
                "west.$.away_record": schedule_summary.get("away_record", ""),
                "updated_at": utc_now(),
            }
        },
    )
    return detail


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

    raise HTTPException(status_code=404, detail="Standings not cached yet.")


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
    return store_bbr_league_snapshot(season)["teams"]


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
