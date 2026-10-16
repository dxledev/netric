from nba_api.stats.endpoints import commonallplayers
from nba_api.stats.static import players


def normalize_player_record(player_id, full_name):
    return {
        "id": int(player_id),
        "full_name": str(full_name).strip(),
    }


def get_current_active_players():
    return [
        normalize_player_record(player["id"], player["full_name"])
        for player in players.get_active_players()
    ]


def get_active_players_for_season(season_id: str):
    season_players = commonallplayers.CommonAllPlayers(
        league_id="00",
        season=season_id,
        is_only_current_season=1,
        timeout=30,
    ).get_data_frames()[0]

    if season_players.empty:
        return []

    normalized_players = []

    for _, player in season_players.iterrows():
        player_id = player.get("PERSON_ID")
        full_name = player.get("DISPLAY_FIRST_LAST")

        if not player_id or not full_name:
            continue

        normalized_players.append(normalize_player_record(player_id, full_name))

    return normalized_players


def _previous_season_id(current_season_id):
    try:
        start_year = int(str(current_season_id).split("-", 1)[0]) - 1
    except (TypeError, ValueError):
        return None
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def get_tracked_players(previous_season_id: str | None = None):
    # Import locally to keep the player pool independent of team-service startup
    # and to honor the same NBA_SEASON override used by the rest of the backend.
    from services.team_service import get_current_season

    current_season_id = get_current_season()
    previous_season_id = previous_season_id or _previous_season_id(current_season_id)
    players_by_id = {
        player["id"]: player
        for player in get_current_active_players()
    }

    # Current and prior live rosters capture rookies and recently-active players
    # that may be absent from nba_api's packaged static player list.
    for season_id in (current_season_id, previous_season_id):
        if not season_id:
            continue
        try:
            season_players = get_active_players_for_season(season_id)
        except Exception as exc:
            print(f"Player roster unavailable for {season_id}: {exc}")
            continue
        for player in season_players:
            players_by_id.setdefault(player["id"], player)

    return list(players_by_id.values())
