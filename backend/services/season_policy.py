import os


DEFAULT_MAX_SEASONS_TO_STORE = 2


def get_max_seasons_to_store():
    raw_value = os.getenv("NBA_MAX_SEASONS_TO_STORE", str(DEFAULT_MAX_SEASONS_TO_STORE))

    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_MAX_SEASONS_TO_STORE

    return parsed if parsed > 0 else DEFAULT_MAX_SEASONS_TO_STORE


def get_explicit_seasons_to_store():
    raw_value = os.getenv("NBA_SEASON_IDS_TO_STORE", "")
    if not raw_value:
        return []

    explicit = []
    seen = set()

    for season_id in raw_value.split(","):
        cleaned = season_id.strip()
        if not cleaned or cleaned in seen:
            continue
        explicit.append(cleaned)
        seen.add(cleaned)

    return explicit


def select_season_ids_for_storage(season_ids):
    normalized = [str(season_id).strip() for season_id in season_ids if str(season_id).strip()]
    if not normalized:
        return []

    explicit_seasons = get_explicit_seasons_to_store()
    if explicit_seasons:
        selected = [season_id for season_id in explicit_seasons if season_id in normalized]
        if selected:
            return selected

    return normalized[:get_max_seasons_to_store()]
