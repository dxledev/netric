from services.season_policy import select_season_ids_for_storage


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


def has_complete_cached_season_logs(cached_player):
    if not cached_player:
        return False

    data = cached_player.get("data", {})
    active_season_ids = get_active_cached_season_ids(cached_player)
    expected_season_ids = select_season_ids_for_storage(active_season_ids)
    season_game_logs = data.get("season_game_logs")

    if not expected_season_ids:
        return bool(data.get("game_log"))

    if not isinstance(season_game_logs, dict):
        return len(expected_season_ids) == 1 and bool(data.get("game_log"))

    available_season_ids = {
        str(season_id)
        for season_id, season_games in season_game_logs.items()
        if isinstance(season_games, list)
    }

    return set(expected_season_ids).issubset(available_season_ids)
