"""Offline checks for live player-team synchronization."""

import importlib
import os
import sys
import types
import unittest
from unittest.mock import patch

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _get_path(doc, path):
    value = doc
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


class MemoryCollection:
    def __init__(self):
        self.docs = []

    def find(self, query=None, projection=None):
        return list(self.docs)

    def find_one(self, query, projection=None):
        return next((d for d in self.docs if _get_path(d, "player_id") == query.get("player_id")), None)

    def insert_one(self, doc):
        self.docs.append(dict(doc))

    def update_one(self, query, update, upsert=False):
        doc = self.find_one(query)
        if doc is None:
            return types.SimpleNamespace(matched_count=0)
        for path, value in update.get("$set", {}).items():
            cursor = doc
            parts = path.split(".")
            for part in parts[:-1]:
                cursor = cursor.setdefault(part, {})
            cursor[parts[-1]] = value
        return types.SimpleNamespace(matched_count=1)

    def count_documents(self, query):
        return sum(1 for doc in self.docs if all(_get_path(doc, k) is not None for k in query if not k.startswith("$")))


db = types.ModuleType("database")
db.player_cache_collection = MemoryCollection()
db.fetch_queue_collection = MemoryCollection()
db.stats_client = types.SimpleNamespace(address=("127.0.0.1", 27017))
sys.modules["database"] = db
team_service = types.ModuleType("services.team_service")
team_service.get_current_season = lambda: "2026-27"
sys.modules["services.team_service"] = team_service

sync = importlib.import_module("sync_player_info")


class SyncPlayerInfoTests(unittest.TestCase):
    def setUp(self):
        db.player_cache_collection.docs.clear()
        db.fetch_queue_collection.docs.clear()

    def test_team_sync_preserves_history_missing_bulk_data_and_registers_rookie(self):
        history = [{"SEASON_ID": "2024-25", "PTS": 1200, "TEAM_ID": 1610612747}]
        db.player_cache_collection.docs.extend([
            {"player_id": 10, "data": {"name": "Veteran", "current_team": {"id": 1, "name": "Old Club", "abbreviation": "OLD"}, "career_stats": history}},
            {"player_id": 20, "data": {"name": "Missing", "current_team": {"id": 2, "name": "Keep Club", "abbreviation": "KEEP"}, "career_stats": history}},
        ])
        snapshot = {
            10: {"PERSON_ID": 10, "DISPLAY_FIRST_LAST": "Veteran New", "TEAM_ID": 3,
                 "TEAM_CITY": "New", "TEAM_NAME": "Wolves", "TEAM_ABBREVIATION": "NW"},
        }
        with patch.object(sync, "get_current_season", return_value="2026-27"), \
             patch.object(sync, "fetch_player_info_snapshot", return_value=snapshot), \
             patch.object(sync, "_roster_players", return_value=[{"id": 10, "full_name": "Veteran"}, {"id": 30, "full_name": "Rookie"}]), \
             patch("nba.build_player_summary_from_data", return_value={"team": "new"}), \
             patch("nba.SUMMARY_VERSION", 18):
            counts = sync.synchronize()

        veteran = db.player_cache_collection.find_one({"player_id": 10})
        missing = db.player_cache_collection.find_one({"player_id": 20})
        self.assertEqual(veteran["data"]["current_team"], {"id": 3, "name": "New Wolves", "abbreviation": "NW"})
        self.assertEqual(veteran["data"]["name"], "Veteran New")
        self.assertEqual(veteran["data"]["career_stats"], history)
        self.assertEqual(veteran["summary"], {"team": "new"})
        self.assertEqual(missing["data"]["current_team"]["name"], "Keep Club")
        self.assertEqual(missing["data"]["career_stats"], history)
        self.assertEqual(counts["changed"], 1)
        self.assertEqual(counts["missing_info"], 1)
        rookie_job = db.fetch_queue_collection.find_one({"player_id": 30})
        self.assertTrue(rookie_job["refresh_stats"])
        self.assertEqual(rookie_job["name"], "Rookie")
        self.assertEqual(counts["new_players_queued"], 1)

    def test_profile_check_enqueue_is_deduplicated(self):
        self.assertTrue(sync.enqueue_player_info_refresh(42, "Player", None))
        self.assertFalse(sync.enqueue_player_info_refresh(42, "Player", None))
        self.assertEqual(len(db.fetch_queue_collection.docs), 1)


if __name__ == "__main__":
    unittest.main()
