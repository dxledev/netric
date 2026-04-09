import time
from database import fetch_queue_collection, player_cache_collection
from services.cache_status import has_complete_cached_season_logs
from services.player_pool import get_tracked_players

fetch_queue = fetch_queue_collection
player_cache = player_cache_collection

def seed_active_players():
    tracked_players = get_tracked_players()

    total = 0
    queued = 0
    skipped = 0

    for player in tracked_players:
        total += 1
        player_id = player["id"]
        name = player["full_name"]
        cached_player = player_cache.find_one(
            {"player_id": player_id},
            {
                "data.game_log": 1,
                "data.season_game_logs": 1,
                "data.career_stats": 1,
            },
        )

        if cached_player and has_complete_cached_season_logs(cached_player):
            skipped += 1
            continue

        if fetch_queue.find_one({"player_id": player_id}):
            skipped += 1
            continue

        fetch_queue.insert_one(
            {
                "player_id": player_id,
                "name": name,
            }
        )

        queued += 1
        print(f"Queued: {name}")

        time.sleep(1)

    print("----- DONE -----")
    print(f"Total tracked players: {total}")
    print(f"Queued: {queued}")
    print(f"Skipped (complete cache or already queued): {skipped}")

if __name__ == "__main__":
    seed_active_players()
