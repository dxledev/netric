"""ShotChartDetail cache and backfill helpers."""

import os
import time
import math
import requests
from collections import Counter, defaultdict
from datetime import UTC, datetime

from database import fetch_queue_collection, player_cache_collection, shot_chart_cache_collection
from services.fetch_service import (
    ShotChartPayloadError,
    fetch_shot_chart_by_season,
    parse_game_date,
)

SOURCE = "nba_api.stats.endpoints.ShotChartDetail"
CACHE_VERSION = 1
SHOT_CHART_REQUEST_DELAY_SECONDS = float(os.getenv("SHOT_CHART_REQUEST_DELAY_SECONDS", "3"))
SCOPE_FIELDS = {
    "Regular Season": "season_game_logs",
    "Playoffs": "playoff_season_game_logs",
    "PlayIn": "playin_season_game_logs",
}


class ShotChartValidationError(ValueError):
    """The endpoint response or cached FGA/FGM snapshot is incomplete/malformed."""


def utc_now():
    return datetime.now(UTC)


def normalize_game_id(value):
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    # Avoid turning integer-like float values into IDs ending in .0.
    if raw.endswith(".0") and raw[:-2].isdigit():
        raw = raw[:-2]
    return raw.zfill(10)


def _finite_number(value, field, row_index):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ShotChartValidationError(f"ShotChartDetail row {row_index} has invalid {field}") from exc
    if not math.isfinite(number):
        raise ShotChartValidationError(f"ShotChartDetail row {row_index} has non-finite {field}")
    return number


def is_supported_season(season_id):
    try:
        return int(str(season_id).split("-", 1)[0]) >= 1996
    except (TypeError, ValueError):
        return False


def cache_id(player_id, season_id, season_type):
    return f"shotchart:{int(player_id)}:{season_id}:{season_type}"


def queue_id(season_id, season_type, player_id=None):
    scope = "all" if player_id is None else str(int(player_id))
    return f"shot-chart-refresh:{season_id}:{season_type}:{scope}"


def game_queue_id(season_id, season_type, player_id, game_id):
    return (
        f"shot-chart-game-refresh:{season_id}:{season_type}:"
        f"{int(player_id)}:{normalize_game_id(game_id)}"
    )


def discover_cached_seasons():
    """Map each (season, scope) to cached players and their raw game rows."""
    found = defaultdict(dict)
    projection = {"player_id": 1}
    projection.update({f"data.{field}": 1 for field in SCOPE_FIELDS.values()})
    for document in player_cache_collection.find({}, projection):
        try:
            player_id = int(document["player_id"])
        except (KeyError, TypeError, ValueError):
            continue
        data = document.get("data")
        if not isinstance(data, dict):
            continue
        for season_type, field in SCOPE_FIELDS.items():
            logs = data.get(field)
            if not isinstance(logs, dict):
                continue
            for season_id, games in logs.items():
                if not isinstance(games, list) or not games:
                    continue
                found[(str(season_id), season_type)][player_id] = games
    return found


def _game_expectations(games):
    expected = {}
    for index, game in enumerate(games):
        if not isinstance(game, dict):
            raise ShotChartValidationError(f"Cached game log row {index} is malformed")
        game_id = normalize_game_id(game.get("Game_ID", game.get("GAME_ID", game.get("game_id"))))
        if game_id is None:
            raise ShotChartValidationError(f"Cached game log row {index} has no game id")
        if game_id in expected:
            raise ShotChartValidationError(f"Cached game log has duplicate game id {game_id}")
        raw_fga = game.get("FGA", game.get("fga"))
        raw_fgm = game.get("FGM", game.get("fgm"))
        try:
            fga_number = float(raw_fga)
            fgm_number = float(raw_fgm)
        except (TypeError, ValueError, OverflowError):
            raise ShotChartValidationError(f"Invalid FGA/FGM in cached game log for game {game_id}")
        if not fga_number.is_integer() or not fgm_number.is_integer():
            raise ShotChartValidationError(f"Invalid FGA/FGM in cached game log for game {game_id}")
        fga = int(fga_number)
        fgm = int(fgm_number)
        if fga < 0 or fgm < 0 or fgm > fga:
            raise ShotChartValidationError(f"Invalid FGA/FGM in cached game log for game {game_id}")
        expected[game_id] = {"fga": fga, "fgm": fgm}
    return expected


def _cached_scope_players(season_id, season_type, player_id=None):
    if player_id is not None:
        player_id = int(player_id)
        field = SCOPE_FIELDS[season_type]
        document = player_cache_collection.find_one(
            {"player_id": player_id},
            {f"data.{field}.{season_id}": 1},
        ) or {}
        data = document.get("data")
        logs = data.get(field) if isinstance(data, dict) else None
        games = logs.get(str(season_id)) if isinstance(logs, dict) else None
        return {player_id: games} if isinstance(games, list) and games else {}
    return discover_cached_seasons().get((str(season_id), season_type), {})


def _expectations_cover(cached_expectations, expected):
    return isinstance(cached_expectations, dict) and all(
        cached_expectations.get(game_id) == totals
        for game_id, totals in expected.items()
    )


def is_scope_covered(season_id, season_type, players=None):
    players = players if players is not None else _cached_scope_players(season_id, season_type)
    for player_id, games in players.items():
        try:
            expected = _game_expectations(games)
        except ShotChartValidationError:
            return False
        cached = shot_chart_cache_collection.find_one(
            {"_id": cache_id(player_id, season_id, season_type)},
            {"cache_version": 1, "game_expectations": 1, "source": 1},
        )
        if (
            not cached
            or cached.get("cache_version") != CACHE_VERSION
            or cached.get("source") != SOURCE
            or not _expectations_cover(cached.get("game_expectations"), expected)
        ):
            return False
    return bool(players)


def scope_coverage_counts(discovered):
    """Return covered/missing scope and player counts with one cache scan."""
    eligible = {
        (season, season_type): players
        for (season, season_type), players in discovered.items()
        if is_supported_season(season)
    }
    ids = [
        cache_id(player_id, season, season_type)
        for (season, season_type), players in eligible.items()
        for player_id in players
    ]
    cached_by_id = {
        document["_id"]: document
        for document in shot_chart_cache_collection.find(
            {"_id": {"$in": ids}},
            {"cache_version": 1, "game_expectations": 1, "source": 1},
        )
    } if ids else {}
    counts = Counter()
    for (season, season_type), players in eligible.items():
        scope_covered = True
        for player_id, games in players.items():
            try:
                expected = _game_expectations(games)
            except ShotChartValidationError:
                counts["missing_players"] += 1
                scope_covered = False
                continue
            cached = cached_by_id.get(cache_id(player_id, season, season_type))
            covered = bool(
                cached
                and cached.get("cache_version") == CACHE_VERSION
                and cached.get("source") == SOURCE
                and _expectations_cover(cached.get("game_expectations"), expected)
            )
            counts["covered_players" if covered else "missing_players"] += 1
            scope_covered = scope_covered and covered
        counts["covered_scopes" if scope_covered else "missing_scopes"] += 1
        counts["scopes"] += 1
    return counts


def _validate_shot_rows(rows):
    grouped = defaultdict(list)
    counts = Counter()
    made_counts = Counter()
    seen_events = set()
    for row_index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ShotChartValidationError(f"ShotChartDetail row {row_index} is malformed")
        try:
            row_player_id = int(row["PLAYER_ID"])
            game_id = normalize_game_id(row["GAME_ID"])
            made = _finite_number(row["SHOT_MADE_FLAG"], "SHOT_MADE_FLAG", row_index)
            attempted = _finite_number(
                row["SHOT_ATTEMPTED_FLAG"], "SHOT_ATTEMPTED_FLAG", row_index
            )
            _finite_number(row["LOC_X"], "LOC_X", row_index)
            _finite_number(row["LOC_Y"], "LOC_Y", row_index)
        except (KeyError, TypeError, ValueError) as exc:
            raise ShotChartValidationError(
                f"ShotChartDetail row {row_index} is missing or has invalid required fields"
            ) from exc
        if game_id is None:
            raise ShotChartValidationError(f"ShotChartDetail row {row_index} has an empty GAME_ID")
        if made not in (0, 1):
            raise ShotChartValidationError(f"ShotChartDetail row {row_index} has invalid SHOT_MADE_FLAG")
        if attempted != 1:
            raise ShotChartValidationError(f"ShotChartDetail row {row_index} is not a shot attempt")
        if row.get("GAME_EVENT_ID") is None:
            raise ShotChartValidationError(f"ShotChartDetail row {row_index} lacks GAME_EVENT_ID")
        event_id = str(row["GAME_EVENT_ID"]).strip()
        try:
            event_number = float(event_id)
            if math.isfinite(event_number) and event_number.is_integer():
                event_id = str(int(event_number))
        except ValueError:
            pass
        if not event_id:
            raise ShotChartValidationError(f"ShotChartDetail row {row_index} has empty GAME_EVENT_ID")
        event_key = (row_player_id, game_id, event_id)
        if event_key in seen_events:
            raise ShotChartValidationError(
                f"Duplicate ShotChartDetail event for player {row_player_id}, "
                f"game {game_id}, event {event_id}"
            )
        seen_events.add(event_key)
        grouped[row_player_id].append(row)
        counts[(row_player_id, game_id)] += 1
        made_counts[(row_player_id, game_id)] += int(made)
    return grouped, counts, made_counts


def _validate_player_counts(player_id, expected, counts, made_counts):
    for game_id, totals in expected.items():
        fga = totals["fga"]
        actual = counts[(player_id, game_id)]
        if actual != fga:
            raise ShotChartValidationError(
                f"Incomplete ShotChartDetail for player {player_id}, game {game_id}: "
                f"expected {fga} shots, received {actual}"
            )
        expected_fgm = totals["fgm"]
        actual_fgm = made_counts[(player_id, game_id)]
        if actual_fgm != expected_fgm:
            raise ShotChartValidationError(
                f"Incomplete ShotChartDetail makes for player {player_id}, game {game_id}: "
                f"expected {expected_fgm}, received {actual_fgm}"
            )


def _cached_game_is_valid(player_id, season_id, season_type, game_id, expected):
    cached = shot_chart_cache_collection.find_one(
        {"_id": cache_id(player_id, season_id, season_type)},
        {
            f"shots_by_game.{game_id}": 1,
            f"game_expectations.{game_id}": 1,
            "cache_version": 1,
            "source": 1,
        },
    ) or {}
    shots = cached.get("shots_by_game", {}).get(game_id)
    if (
        cached.get("cache_version") != CACHE_VERSION
        or cached.get("source") != SOURCE
        or cached.get("game_expectations", {}).get(game_id) != expected
        or not isinstance(shots, list)
    ):
        return False
    try:
        grouped, counts, made_counts = _validate_shot_rows(shots)
        if any(pid != int(player_id) for pid in grouped):
            return False
        if any(gid != game_id for _, gid in counts):
            return False
        _validate_player_counts(int(player_id), {game_id: expected}, counts, made_counts)
    except ShotChartValidationError:
        return False
    return True


def _is_remote_or_validation_error(error):
    return isinstance(
        error,
        (requests.exceptions.RequestException, ShotChartPayloadError, ShotChartValidationError),
    )


def _queue_individual_fallbacks(season_id, season_type, players, force=False):
    return sum(
        queue_shot_chart_job(
            season_id,
            season_type,
            player_id=player_id,
            force=force,
            players={player_id: games},
        )
        for player_id, games in players.items()
    )


def _nba_month_from_calendar_month(calendar_month):
    """Translate calendar months to ShotChartDetail's NBA season month index."""
    return ((int(calendar_month) - 10) % 12) + 1


def _fetch_job_shots(player_id, season_id, season_type, players):
    if player_id is not None or season_type != "Regular Season":
        return fetch_shot_chart_by_season(
            int(player_id) if player_id is not None else 0,
            season_id,
            season_type,
        ), 1

    month_first_dates = {}
    for games in players.values():
        for game in games:
            if not isinstance(game, dict):
                return fetch_shot_chart_by_season(0, season_id, season_type), 1
            game_date = parse_game_date(game.get("GAME_DATE", game.get("game_date")))
            if game_date is None:
                return fetch_shot_chart_by_season(0, season_id, season_type), 1
            month_first_dates[game_date.month] = min(
                game_date,
                month_first_dates.get(game_date.month, game_date),
            )
    if not month_first_dates:
        return fetch_shot_chart_by_season(0, season_id, season_type), 1

    all_rows = []
    calendar_months = sorted(
        month_first_dates, key=lambda item: month_first_dates[item]
    )
    for index, calendar_month in enumerate(calendar_months):
        if index and SHOT_CHART_REQUEST_DELAY_SECONDS > 0:
            time.sleep(SHOT_CHART_REQUEST_DELAY_SECONDS)
        nba_month = _nba_month_from_calendar_month(calendar_month)
        first_date = month_first_dates[calendar_month]
        print(
            f"ShotChartDetail {season_id} Regular Season request {index + 1}/"
            f"{len(calendar_months)}: NBA month {nba_month}, calendar month "
            f"{first_date.strftime('%B %Y')} (from {first_date.isoformat()})."
        )
        all_rows.extend(
            fetch_shot_chart_by_season(0, season_id, season_type, month=nba_month)
        )
    return all_rows, len(month_first_dates)


def queue_shot_chart_job(
    season_id, season_type, player_id=None, force=False, queued_at=None, players=None,
    priority=0,
):
    if season_type not in SCOPE_FIELDS:
        raise ValueError(f"Unsupported season type: {season_type}")
    if not is_supported_season(season_id):
        return False
    if player_id is not None and int(player_id) == 0:
        player_id = None
    players = players if players is not None else _cached_scope_players(season_id, season_type, player_id)
    if not players or (not force and is_scope_covered(season_id, season_type, players)):
        return False
    now = queued_at or utc_now()
    job = {
        "_id": queue_id(season_id, season_type, player_id),
        "job_type": "shot_chart_refresh",
        "season": str(season_id),
        "season_type": season_type,
        "queued_at": now,
        "attempts": 0,
    }
    if player_id is not None:
        job["player_id"] = int(player_id)
    update = {"$setOnInsert": job, "$max": {"priority": int(priority)}}
    if force:
        update["$set"] = {"force": True}
    result = fetch_queue_collection.update_one({"_id": job["_id"]}, update, upsert=True)
    return result.upserted_id is not None


def _cached_game_log(season_id, season_type, player_id, game_id):
    players = _cached_scope_players(season_id, season_type, player_id)
    games = players.get(int(player_id), [])
    normalized_id = normalize_game_id(game_id)
    for game in games:
        if not isinstance(game, dict):
            continue
        candidate_id = normalize_game_id(
            game.get("Game_ID", game.get("GAME_ID", game.get("game_id")))
        )
        if candidate_id == normalized_id:
            return game
    return None


def queue_game_shot_job(season_id, season_type, player_id, game_id, priority=100):
    if season_type not in SCOPE_FIELDS:
        raise ValueError(f"Unsupported season type: {season_type}")
    if not is_supported_season(season_id):
        return False
    player_id = int(player_id)
    game_id = normalize_game_id(game_id)
    if not game_id or not game_id.isdigit() or len(game_id) != 10:
        return False
    game = _cached_game_log(season_id, season_type, player_id, game_id)
    if not game:
        return False
    expected = _game_expectations([game])[game_id]
    if _cached_game_is_valid(player_id, season_id, season_type, game_id, expected):
        return False

    now = utc_now()
    job = {
        "_id": game_queue_id(season_id, season_type, player_id, game_id),
        "job_type": "shot_chart_refresh",
        "season": str(season_id),
        "season_type": season_type,
        "player_id": player_id,
        "game_id": game_id,
        "queued_at": now,
        "attempts": 0,
    }
    result = fetch_queue_collection.update_one(
        {"_id": job["_id"]},
        {"$setOnInsert": job, "$max": {"priority": int(priority)}},
        upsert=True,
    )
    return result.upserted_id is not None


def queue_player_game_shots(player_id, data, season_id):
    """Ensure every recorded appearance has verified shots or a queued job."""
    counts = {"games_checked": 0, "queued": 0, "already_queued": 0, "already_cached": 0, "failed": 0}
    for season_type, field in SCOPE_FIELDS.items():
        games = (data.get(field) or {}).get(str(season_id), [])
        seen = set()
        for game in games:
            game_id = normalize_game_id(game.get("Game_ID") or game.get("GAME_ID") or game.get("game_id"))
            if game_id in seen:
                continue
            seen.add(game_id)
            counts["games_checked"] += 1
            try:
                if not game_id or not game_id.isdigit() or len(game_id) != 10:
                    raise ValueError("Missing or invalid game ID")
                if queue_game_shot_job(season_id, season_type, player_id, game_id, priority=50):
                    counts["queued"] += 1
                elif fetch_queue_collection.find_one({"_id": game_queue_id(season_id, season_type, player_id, game_id)}):
                    counts["already_queued"] += 1
                else:
                    counts["already_cached"] += 1
            except Exception as exc:
                counts["failed"] += 1
                print(f"Shot-chart scheduling failed for {player_id} {game_id}: {exc}", flush=True)
    return counts


def queue_current_season_shots(season_id):
    counts = {"games_checked": 0, "queued": 0, "already_queued": 0, "already_cached": 0, "failed": 0}
    projection = {"player_id": 1, **{f"data.{field}.{season_id}": 1 for field in SCOPE_FIELDS.values()}}
    for player in player_cache_collection.find({}, projection):
        result = queue_player_game_shots(player["player_id"], player.get("data") or {}, season_id)
        for field in counts:
            counts[field] += result[field]
    print(f"Current-season shot-chart queue: {counts}", flush=True)
    return counts


def _process_game_shot_job(job):
    season_id = str(job["season"])
    season_type = job["season_type"]
    player_id = int(job["player_id"])
    game_id = normalize_game_id(job.get("game_id"))
    if not is_supported_season(season_id) or not game_id:
        return 0

    game = _cached_game_log(season_id, season_type, player_id, game_id)
    if not game:
        return 0
    expected = _game_expectations([game])[game_id]
    if _cached_game_is_valid(player_id, season_id, season_type, game_id, expected):
        return 0

    request_made = False
    try:
        request_made = True
        rows = fetch_shot_chart_by_season(
            player_id, season_id, season_type, game_id=game_id
        )
        grouped, counts, made_counts = _validate_shot_rows(rows)
        if any(pid != player_id for pid in grouped):
            raise ShotChartValidationError(
                f"ShotChartDetail returned rows for another player while fetching {player_id}"
            )
        if any(gid != game_id for _, gid in counts):
            raise ShotChartValidationError(
                f"ShotChartDetail returned rows for another game while fetching {game_id}"
            )
        _validate_player_counts(player_id, {game_id: expected}, counts, made_counts)

        now = utc_now()
        cache_key = cache_id(player_id, season_id, season_type)
        update_pipeline = [
            {
                "$set": {
                    "_id": cache_key,
                    "player_id": player_id,
                    "season": season_id,
                    "season_type": season_type,
                    "source": SOURCE,
                    "cache_version": CACHE_VERSION,
                    "fetched_at": now,
                    f"shots_by_game.{game_id}": {"$literal": rows},
                    f"game_expectations.{game_id}": {"$literal": expected},
                    "covered_game_ids": {
                        "$setUnion": [
                            {"$ifNull": ["$covered_game_ids", []]},
                            [game_id],
                        ]
                    },
                }
            },
            {
                "$set": {
                    "shot_count": {
                        "$sum": {
                            "$map": {
                                "input": {
                                    "$objectToArray": {
                                        "$ifNull": ["$shots_by_game", {}]
                                    }
                                },
                                "as": "game",
                                "in": {"$size": "$$game.v"},
                            }
                        }
                    }
                }
            },
        ]
        shot_chart_cache_collection.update_one(
            {"_id": cache_key}, update_pipeline, upsert=True
        )
        return 1
    finally:
        if request_made and SHOT_CHART_REQUEST_DELAY_SECONDS > 0:
            time.sleep(SHOT_CHART_REQUEST_DELAY_SECONDS)


def process_shot_chart_job(job):
    """Fetch, fully validate, then atomically merge the relevant snapshots."""
    if job.get("game_id"):
        return _process_game_shot_job(job)
    season_id = str(job["season"])
    season_type = job["season_type"]
    player_id = job.get("player_id")
    if player_id is not None and int(player_id) == 0:
        player_id = None
    request_made = False
    try:
        if not is_supported_season(season_id):
            return 0
        players = _cached_scope_players(season_id, season_type, player_id)
        if not players:
            return 0
        if not job.get("force") and is_scope_covered(season_id, season_type, players):
            return 0

        request_made = True
        try:
            rows, request_count = _fetch_job_shots(
                player_id, season_id, season_type, players
            )
        except Exception as exc:
            if player_id is not None or not _is_remote_or_validation_error(exc):
                raise
            fallback_count = _queue_individual_fallbacks(
                season_id,
                season_type,
                players,
                force=bool(job.get("force")),
            )
            print(
                f"All-player ShotChartDetail failed for {season_id} {season_type}; "
                f"queued {fallback_count} missing player jobs. Reason: {exc}"
            )
            return 0
        try:
            grouped, counts, made_counts = _validate_shot_rows(rows)
        except ShotChartValidationError as exc:
            if player_id is not None:
                raise
            fallback_count = _queue_individual_fallbacks(
                season_id,
                season_type,
                players,
                force=bool(job.get("force")),
            )
            print(
                f"All-player ShotChartDetail validation failed for {season_id} {season_type}; "
                f"queued {fallback_count} missing player jobs. Reason: {exc}"
            )
            return 0

        expected_by_player = {}
        invalid_players = {}
        for pid, games in players.items():
            try:
                expected = _game_expectations(games)
                _validate_player_counts(pid, expected, counts, made_counts)
                expected_by_player[pid] = expected
            except ShotChartValidationError:
                invalid_players[pid] = games
        if player_id is not None and invalid_players:
            pid = next(iter(invalid_players))
            expected = _game_expectations(invalid_players[pid])
            _validate_player_counts(pid, expected, counts, made_counts)

        fallback_count = 0
        if invalid_players:
            fallback_count = _queue_individual_fallbacks(
                season_id,
                season_type,
                invalid_players,
                force=bool(job.get("force")),
            )
        print(
            f"ShotChartDetail {season_id} {season_type}: {len(rows)} endpoint rows; "
            f"{len(expected_by_player)} valid players, {len(invalid_players)} incomplete players "
            f"from {request_count} request(s); "
            f"queued {fallback_count} individual retries."
        )

        now = utc_now()
        writes = []
        for pid, expected in expected_by_player.items():
            covered_ids = sorted(expected)
            player_rows = grouped.get(pid, [])
            by_game = defaultdict(list)
            for row in player_rows:
                by_game[normalize_game_id(row["GAME_ID"])].append(row)
            shots_by_game = {game_id: by_game.get(game_id, []) for game_id in covered_ids}
            # Keep endpoint shots outside the cached game-log snapshot as well.
            for game_id, shots in by_game.items():
                shots_by_game.setdefault(game_id, shots)
            writes.append(
                {
                    "_id": cache_id(pid, season_id, season_type),
                    "player_id": pid,
                    "season": season_id,
                    "season_type": season_type,
                    "source": SOURCE,
                    "cache_version": CACHE_VERSION,
                    "shots_by_game": shots_by_game,
                    "covered_game_ids": covered_ids,
                    "game_expectations": expected,
                    "fetched_at": now,
                }
            )
        for document in writes:
            update_pipeline = [
                {
                    "$set": {
                        "_id": document["_id"],
                        "player_id": document["player_id"],
                        "season": document["season"],
                        "season_type": document["season_type"],
                        "source": document["source"],
                        "cache_version": document["cache_version"],
                        "fetched_at": document["fetched_at"],
                        "shots_by_game": {
                            "$mergeObjects": [
                                {"$ifNull": ["$shots_by_game", {}]},
                                {"$literal": document["shots_by_game"]},
                            ]
                        },
                        "game_expectations": {
                            "$mergeObjects": [
                                {"$ifNull": ["$game_expectations", {}]},
                                {"$literal": document["game_expectations"]},
                            ]
                        },
                        "covered_game_ids": {
                            "$setUnion": [
                                {"$ifNull": ["$covered_game_ids", []]},
                                document["covered_game_ids"],
                            ]
                        },
                    }
                },
                {
                    "$set": {
                        "shot_count": {
                            "$sum": {
                                "$map": {
                                    "input": {
                                        "$objectToArray": {
                                            "$ifNull": ["$shots_by_game", {}]
                                        }
                                    },
                                    "as": "game",
                                    "in": {"$size": "$$game.v"},
                                }
                            }
                        }
                    }
                },
            ]
            shot_chart_cache_collection.update_one(
                {"_id": document["_id"]}, update_pipeline, upsert=True
            )
        return len(writes)
    finally:
        # Each queued job maps to one NBA API request; respect the provider delay on errors too.
        if request_made and SHOT_CHART_REQUEST_DELAY_SECONDS > 0:
            time.sleep(SHOT_CHART_REQUEST_DELAY_SECONDS)
