from services.season_policy import get_playoff_log_season_ids, select_season_ids_for_storage


def get_active_cached_season_ids(cached_player):
    if not cached_player:
        return []

    data = cached_player.get("data", {})
    career_stats = data.get("career_stats", [])
    active_season_ids = []

    for season in career_stats:
        games_played = season.get("GP")
        season_id = season.get("SEASON_ID")

        if season_id is None:
            continue

        try:
            if float(games_played or 0) <= 0:
                continue
        except (TypeError, ValueError):
            continue

        active_season_ids.append(str(season_id))

    return sorted(set(active_season_ids), reverse=True)


def get_active_cached_playoff_season_ids(cached_player):
    if not cached_player:
        return []

    data = cached_player.get("data", {})
    playoff_career_stats = data.get("playoff_career_stats", [])
    active_season_ids = []

    for season in playoff_career_stats:
        games_played = season.get("GP")
        season_id = season.get("SEASON_ID")

        if season_id is None:
            continue

        try:
            if float(games_played or 0) <= 0:
                continue
        except (TypeError, ValueError):
            continue

        active_season_ids.append(str(season_id))

    return sorted(set(active_season_ids), reverse=True)


def has_complete_log_set(expected_season_ids, season_game_logs, fallback_game_log):
    if not expected_season_ids:
        return True

    if not isinstance(season_game_logs, dict):
        return len(expected_season_ids) == 1 and bool(fallback_game_log)

    available_season_ids = {
        str(season_id)
        for season_id, season_games in season_game_logs.items()
        if isinstance(season_games, list)
    }

    return set(expected_season_ids).issubset(available_season_ids)


def get_missing_log_season_ids(expected_season_ids, season_game_logs, fallback_game_log):
    if not expected_season_ids:
        return []

    if not isinstance(season_game_logs, dict):
        if len(expected_season_ids) == 1 and bool(fallback_game_log):
            return []
        return expected_season_ids

    available_season_ids = {
        str(season_id)
        for season_id, season_games in season_game_logs.items()
        if isinstance(season_games, list)
    }

    return [
        season_id
        for season_id in expected_season_ids
        if season_id not in available_season_ids
    ]


def get_missing_cached_log_season_ids(cached_player, use_storage_policy=True):
    if not cached_player:
        return {
            "season_game_logs": [],
            "playoff_season_game_logs": [],
            "playin_season_game_logs": [],
        }

    data = cached_player.get("data", {})
    active_season_ids = get_active_cached_season_ids(cached_player)
    expected_season_ids = (
        select_season_ids_for_storage(active_season_ids)
        if use_storage_policy
        else active_season_ids
    )

    playoff_active_season_ids = get_active_cached_playoff_season_ids(cached_player)
    expected_playoff_season_ids = (
        get_playoff_log_season_ids(
            select_season_ids_for_storage(playoff_active_season_ids),
            expected_season_ids,
        )
        if use_storage_policy
        else playoff_active_season_ids
    )

    return {
        "season_game_logs": get_missing_log_season_ids(
            expected_season_ids,
            data.get("season_game_logs"),
            data.get("game_log"),
        ),
        "playoff_season_game_logs": get_missing_log_season_ids(
            expected_playoff_season_ids,
            data.get("playoff_season_game_logs"),
            data.get("playoff_game_log"),
        ),
        "playin_season_game_logs": get_missing_log_season_ids(
            expected_season_ids,
            data.get("playin_season_game_logs"),
            data.get("playin_game_log"),
        ),
    }


def has_all_cached_stat_season_logs(cached_player):
    missing_log_season_ids = get_missing_cached_log_season_ids(
        cached_player,
        use_storage_policy=False,
    )

    return all(not season_ids for season_ids in missing_log_season_ids.values())


def has_complete_cached_season_logs(cached_player):
    if not cached_player:
        return False

    data = cached_player.get("data", {})
    active_season_ids = get_active_cached_season_ids(cached_player)
    expected_season_ids = select_season_ids_for_storage(active_season_ids)
    regular_complete = has_complete_log_set(
        expected_season_ids,
        data.get("season_game_logs"),
        data.get("game_log"),
    )

    playoff_active_season_ids = get_active_cached_playoff_season_ids(cached_player)
    expected_playoff_season_ids = get_playoff_log_season_ids(
        select_season_ids_for_storage(playoff_active_season_ids),
        expected_season_ids,
    )
    playoff_complete = has_complete_log_set(
        expected_playoff_season_ids,
        data.get("playoff_season_game_logs"),
        data.get("playoff_game_log"),
    )
    playin_complete = has_complete_log_set(
        expected_season_ids,
        data.get("playin_season_game_logs"),
        data.get("playin_game_log"),
    )

    return regular_complete and playoff_complete and playin_complete
