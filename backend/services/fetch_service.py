import os
import time
from datetime import UTC, datetime

from nba_api.stats.endpoints import commonplayerinfo, playercareerstats, playergamelog
from nba_api.stats.endpoints import shotchartdetail
from nba_api.stats.static import players

from database import player_cache_collection
from services.season_policy import get_playoff_log_season_ids, select_season_ids_for_storage

player_cache = player_cache_collection
NBA_API_TIMEOUT_SECONDS = int(os.getenv("NBA_API_TIMEOUT_SECONDS", "60"))
NBA_API_RETRY_ATTEMPTS = int(os.getenv("NBA_API_RETRY_ATTEMPTS", "3"))
NBA_API_RETRY_DELAY_SECONDS = float(os.getenv("NBA_API_RETRY_DELAY_SECONDS", "2"))
FETCH_REPAIR_MAX_SEASONS_PER_JOB = int(
    os.getenv("FETCH_REPAIR_MAX_SEASONS_PER_JOB", "8")
)


class ShotChartPayloadError(ValueError):
    """The NBA endpoint returned a malformed ShotChartDetail dataset."""


def utc_now():
    return datetime.now(UTC)


def parse_game_date(value):
    raw = str(value or "").strip()
    if not raw:
        return None

    # nba_api can return month strings like "APR 10, 2026" while
    # normalized cache formats may use ISO "2026-04-10".
    for date_format in ("%b %d, %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, date_format).date()
        except ValueError:
            continue

    return None


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


def get_active_season_ids(career_df):
    if career_df.empty:
        return []

    active_seasons = career_df[career_df["GP"] > 0]["SEASON_ID"].dropna().astype(str).tolist()
    return sorted(set(active_seasons), reverse=True)


def fetch_game_logs_by_season(
    player_id: int,
    season_ids: list[str],
    season_type_all_star: str = "Regular Season",
):
    season_logs = {}

    for season_id in season_ids:
        try:
            gamelog = run_with_retries(
                lambda: playergamelog.PlayerGameLog(
                    player_id=player_id,
                    season=season_id,
                    season_type_all_star=season_type_all_star,
                    timeout=NBA_API_TIMEOUT_SECONDS,
                )
            )
            season_logs[season_id] = gamelog.get_data_frames()[0].to_dict("records")
        except KeyError as error:
            # PlayIn queries can sporadically return payloads without result sets.
            if season_type_all_star == "PlayIn" and str(error).strip("'") == "resultSet":
                season_logs[season_id] = []
                continue
            raise

    return season_logs


def fetch_shot_chart_by_season(
    player_id: int,
    season_id: str,
    season_type_all_star: str = "Regular Season",
    month: int = 0,
    game_id: str | None = None,
):
    """Return the endpoint's named Shot_Chart_Detail rows as raw dictionaries."""
    params = {
        "team_id": 0,
        "player_id": player_id,
        "season_nullable": season_id,
        "season_type_all_star": season_type_all_star,
        "context_measure_simple": "FGA",
        "timeout": NBA_API_TIMEOUT_SECONDS,
    }
    if month:
        params["month"] = int(month)
    if game_id:
        params["game_id_nullable"] = str(game_id)
    def fetch_response():
        response = shotchartdetail.ShotChartDetail(**params, get_request=False)
        try:
            response.get_request()
        except (KeyError, ValueError) as exc:
            raw_response = getattr(response, "nba_response", None)
            status = getattr(raw_response, "_status_code", None)
            if isinstance(status, int) and status >= 400:
                raise ShotChartPayloadError(
                    f"NBA ShotChartDetail returned HTTP {status}"
                ) from exc
            raise ShotChartPayloadError(
                f"ShotChartDetail response could not be parsed ({type(exc).__name__})"
            ) from exc
        return response

    response = run_with_retries(fetch_response)
    dataset = getattr(response, "shot_chart_detail", None)
    if dataset is None or not hasattr(dataset, "get_dict"):
        raise ShotChartPayloadError("ShotChartDetail response is missing the named shot_chart_detail dataset")
    detail = dataset.get_dict()
    if not isinstance(detail, dict):
        raise ShotChartPayloadError("ShotChartDetail dataset is malformed")
    headers = detail.get("headers")
    rows = detail.get("data")
    if not isinstance(headers, list) or not headers or not isinstance(rows, list):
        raise ShotChartPayloadError("ShotChartDetail dataset has malformed headers or data")
    required_headers = {
        "PLAYER_ID", "GAME_ID", "GAME_EVENT_ID", "LOC_X", "LOC_Y",
        "SHOT_MADE_FLAG", "SHOT_ATTEMPTED_FLAG",
    }
    if not required_headers.issubset(headers):
        raise ShotChartPayloadError(
            "ShotChartDetail dataset is missing required columns: "
            + ", ".join(sorted(required_headers.difference(headers)))
        )
    if any(not isinstance(row, (list, tuple)) or len(row) != len(headers) for row in rows):
        raise ShotChartPayloadError("ShotChartDetail result contains malformed rows")
    return [dict(zip(headers, row)) for row in rows]


def fetch_missing_game_logs_by_season(player_id: int, missing_log_season_ids: dict):
    season_type_by_field = {
        "season_game_logs": "Regular Season",
        "playoff_season_game_logs": "Playoffs",
        "playin_season_game_logs": "PlayIn",
    }
    fetched_data = {}
    failures = []
    attempted_count = 0
    has_more = False

    for field, season_type in season_type_by_field.items():
        fetched_data[field] = {}

        for season_id in missing_log_season_ids.get(field, []):
            if attempted_count >= FETCH_REPAIR_MAX_SEASONS_PER_JOB:
                has_more = True
                continue

            attempted_count += 1

            try:
                fetched_data[field][season_id] = fetch_game_logs_by_season(
                    player_id,
                    [season_id],
                    season_type_all_star=season_type,
                ).get(season_id, [])
            except Exception as exc:
                failures.append(
                    {
                        "field": field,
                        "season_id": season_id,
                        "error": str(exc),
                    }
                )

    return fetched_data, failures, has_more


def get_player_name(player_id: int):
    player_info = players.find_player_by_id(player_id)
    if player_info:
        return player_info["full_name"]

    # Live rosters can include rookies absent from nba_api's packaged list.
    response = run_with_retries(
        lambda: commonplayerinfo.CommonPlayerInfo(
            player_id=player_id,
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )
    rows = response.get_data_frames()[0].to_dict("records")
    if rows and int(rows[0].get("PERSON_ID") or 0) == int(player_id):
        name = str(rows[0].get("DISPLAY_FIRST_LAST") or "").strip()
        if name:
            return name
    raise ValueError("Player not found in the live NBA roster")


def merge_player_info_data(cached_data, player_info):
    """Merge a live CommonAllPlayers row without replacing historical stats."""
    merged = dict(cached_data or {})
    if not isinstance(player_info, dict):
        return merged
    merged["player_info"] = dict(player_info)
    abbreviation = str(player_info.get("TEAM_ABBREVIATION") or "").strip()
    try:
        team_id = int(player_info.get("TEAM_ID"))
    except (TypeError, ValueError):
        team_id = None
    if team_id is not None:
        city = str(player_info.get("TEAM_CITY") or "").strip()
        name = str(player_info.get("TEAM_NAME") or "").strip()
        if city and name and not name.lower().startswith(city.lower()):
            name = f"{city} {name}"
        merged["current_team"] = {
            "id": team_id,
            "name": name or city,
            "abbreviation": abbreviation,
        }
    return merged


def get_latest_remote_game_date_for_type(player_id: int, season_type_all_star: str):
    try:
        gamelog = run_with_retries(
            lambda: playergamelog.PlayerGameLog(
                player_id=player_id,
                season_type_all_star=season_type_all_star,
                timeout=NBA_API_TIMEOUT_SECONDS,
            )
        )
    except KeyError as error:
        if str(error).strip("'") == "resultSet":
            return None
        raise

    game_df = gamelog.get_data_frames()[0]

    if game_df.empty:
        return None

    latest_date = None

    for raw_date in game_df["GAME_DATE"].tolist():
        parsed_date = parse_game_date(raw_date)
        if parsed_date is None:
            continue
        if latest_date is None or parsed_date > latest_date:
            latest_date = parsed_date

    return latest_date


def get_latest_remote_game_date(player_id: int):
    latest_dates = [
        get_latest_remote_game_date_for_type(player_id, season_type)
        for season_type in ("Regular Season", "PlayIn", "Playoffs")
    ]
    available_dates = [game_date for game_date in latest_dates if game_date is not None]
    return max(available_dates) if available_dates else None


def iter_cached_game_logs(data):
    log_fields = (
        "game_log",
        "season_game_log",
        "playoff_game_log",
        "playoff_season_game_log",
        "playin_game_log",
        "playin_season_game_log",
    )
    mapping_fields = (
        "season_game_logs",
        "playoff_season_game_logs",
        "playin_season_game_logs",
    )

    for field in log_fields:
        games = data.get(field)
        if isinstance(games, list):
            yield from games

    for field in mapping_fields:
        logs_by_season = data.get(field)
        if not isinstance(logs_by_season, dict):
            continue

        for games in logs_by_season.values():
            if isinstance(games, list):
                yield from games


def get_latest_cached_game_date(cached_player):
    if not cached_player:
        return None

    data = cached_player.get("data", {})
    latest_date = None

    for game in iter_cached_game_logs(data):
        if not isinstance(game, dict):
            continue

        parsed_date = parse_game_date(game.get("GAME_DATE"))
        if parsed_date is None:
            parsed_date = parse_game_date(game.get("game_date"))
        if parsed_date is None:
            continue

        if latest_date is None or parsed_date > latest_date:
            latest_date = parsed_date

    return latest_date


SEASON_LOG_FIELDS = (
    "season_game_logs",
    "playoff_season_game_logs",
    "playin_season_game_logs",
)


def merge_season_log_maps(existing_logs, fetched_logs):
    merged = {}

    if isinstance(existing_logs, dict):
        merged.update(existing_logs)

    if isinstance(fetched_logs, dict):
        merged.update(fetched_logs)

    return merged


def merge_cached_player_data(existing_data, fetched_data):
    if not isinstance(existing_data, dict):
        return fetched_data

    merged_data = {
        **existing_data,
        **fetched_data,
    }

    for field in SEASON_LOG_FIELDS:
        merged_data[field] = merge_season_log_maps(
            existing_data.get(field),
            fetched_data.get(field),
        )

    profile_rows = merged_data.get("common_player_info") or []
    if profile_rows and isinstance(profile_rows[0], dict):
        current_name = str(profile_rows[0].get("DISPLAY_FIRST_LAST") or "").strip()
        if current_name:
            merged_data["name"] = current_name

    return merged_data


def fetch_player_by_name(name: str):
    results = players.find_players_by_full_name(name)
    if not results:
        return None

    player_id = results[0]["id"]

    career = run_with_retries(
        lambda: playercareerstats.PlayerCareerStats(
            player_id=player_id,
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )
    regular_df = career.season_totals_regular_season.get_data_frame()
    playoff_df = career.season_totals_post_season.get_data_frame()

    season_ids = get_active_season_ids(regular_df)
    season_ids_to_store = select_season_ids_for_storage(season_ids)
    season_logs = fetch_game_logs_by_season(player_id, season_ids_to_store)
    latest_season = season_ids_to_store[0] if season_ids_to_store else None

    playoff_season_ids = get_active_season_ids(playoff_df)
    playoff_season_ids_to_store = select_season_ids_for_storage(playoff_season_ids)
    playoff_log_season_ids_to_store = get_playoff_log_season_ids(
        playoff_season_ids_to_store,
        season_ids_to_store,
    )
    playoff_season_logs = fetch_game_logs_by_season(
        player_id,
        playoff_log_season_ids_to_store,
        season_type_all_star="Playoffs",
    )
    latest_playoff_season = (
        playoff_log_season_ids_to_store[0] if playoff_log_season_ids_to_store else None
    )
    playin_season_logs = fetch_game_logs_by_season(
        player_id,
        season_ids_to_store,
        season_type_all_star="PlayIn",
    )
    latest_playin_season = season_ids_to_store[0] if season_ids_to_store else None

    summary_data = {
        "player_id": player_id,
        "name": results[0]["full_name"],
        "career_stats": regular_df.to_dict(orient="records"),
        "playoff_career_stats": playoff_df.to_dict(orient="records"),
        "game_log": season_logs.get(latest_season, []),
        "season_game_log": season_logs.get(latest_season, []),
        "season_game_logs": season_logs,
        "playoff_game_log": playoff_season_logs.get(latest_playoff_season, []),
        "playoff_season_game_log": playoff_season_logs.get(latest_playoff_season, []),
        "playoff_season_game_logs": playoff_season_logs,
        "playin_game_log": playin_season_logs.get(latest_playin_season, []),
        "playin_season_game_log": playin_season_logs.get(latest_playin_season, []),
        "playin_season_game_logs": playin_season_logs,
    }

    cached_player = player_cache.find_one({"player_id": player_id}, {"data": 1})
    summary_data = merge_cached_player_data(
        (cached_player or {}).get("data"),
        summary_data,
    )

    player_cache.update_one(
        {"player_id": player_id},
        {
            "$set": {
                "player_id": player_id,
                "data": summary_data,
                "last_updated": utc_now()
            }
        },
        upsert=True
    )

    return summary_data

def fetch_player_data(player_id: int):
    name = get_player_name(player_id)

    career = run_with_retries(
        lambda: playercareerstats.PlayerCareerStats(
            player_id=player_id,
            timeout=NBA_API_TIMEOUT_SECONDS,
        )
    )
    career_df = career.season_totals_regular_season.get_data_frame()
    playoff_career_df = career.season_totals_post_season.get_data_frame()

    season_ids = get_active_season_ids(career_df)
    season_ids_to_store = select_season_ids_for_storage(season_ids)
    season_logs = fetch_game_logs_by_season(player_id, season_ids_to_store)
    latest_season = season_ids_to_store[0] if season_ids_to_store else None

    playoff_season_ids = get_active_season_ids(playoff_career_df)
    playoff_season_ids_to_store = select_season_ids_for_storage(playoff_season_ids)
    playoff_log_season_ids_to_store = get_playoff_log_season_ids(
        playoff_season_ids_to_store,
        season_ids_to_store,
    )
    playoff_season_logs = fetch_game_logs_by_season(
        player_id,
        playoff_log_season_ids_to_store,
        season_type_all_star="Playoffs",
    )
    latest_playoff_season = (
        playoff_log_season_ids_to_store[0] if playoff_log_season_ids_to_store else None
    )
    playin_season_logs = fetch_game_logs_by_season(
        player_id,
        season_ids_to_store,
        season_type_all_star="PlayIn",
    )
    latest_playin_season = season_ids_to_store[0] if season_ids_to_store else None

    return {
        "player_id": player_id,
        "name": name,
        "career_stats": career_df.to_dict("records"),
        "playoff_career_stats": playoff_career_df.to_dict("records"),
        "game_log": season_logs.get(latest_season, []),
        "season_game_log": season_logs.get(latest_season, []),
        "season_game_logs": season_logs,
        "playoff_game_log": playoff_season_logs.get(latest_playoff_season, []),
        "playoff_season_game_log": playoff_season_logs.get(latest_playoff_season, []),
        "playoff_season_game_logs": playoff_season_logs,
        "playin_game_log": playin_season_logs.get(latest_playin_season, []),
        "playin_season_game_log": playin_season_logs.get(latest_playin_season, []),
        "playin_season_game_logs": playin_season_logs,
    }
