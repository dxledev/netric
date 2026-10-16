"""Offline tests for game-scoped ShotChartDetail refresh jobs."""

import importlib
import os
import sys
import types
import unittest
from unittest.mock import Mock, patch


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


class MemoryCollection:
    def __init__(self):
        self.documents = {}
        self.updates = []
        self.replacements = []

    def find_one(self, query, projection=None):
        if "_id" in query:
            return self.documents.get(query["_id"])
        for document in self.documents.values():
            if all(document.get(key) == value for key, value in query.items()):
                return document
        return None

    def find(self, query=None, projection=None):
        query = query or {}
        return [
            document
            for document in self.documents.values()
            if all(document.get(key) == value for key, value in query.items())
        ]

    def update_one(self, query, update, upsert=False):
        self.updates.append((query.copy(), update, upsert))
        inserted = None
        if upsert and query["_id"] not in self.documents:
            self.documents[query["_id"]] = update["$setOnInsert"].copy()
            inserted = query["_id"]
        document = self.documents.get(query["_id"])
        if document is not None:
            for field, value in update.get("$max", {}).items():
                document[field] = max(document.get(field, value), value)
        return types.SimpleNamespace(upserted_id=inserted)

    def replace_one(self, query, document, upsert=False):
        self.replacements.append((query, document, upsert))

    def clear(self):
        self.documents.clear()
        self.updates.clear()
        self.replacements.clear()


_db_stub = types.ModuleType("database")
_db_stub.player_cache_collection = MemoryCollection()
_db_stub.fetch_queue_collection = MemoryCollection()
_db_stub.shot_chart_cache_collection = MemoryCollection()
sys.modules["database"] = _db_stub

fetch_service = importlib.import_module("services.fetch_service")
shot_service = importlib.import_module("services.shot_service")
game_shots = importlib.import_module("services.game_shots")


def reset_collections():
    _db_stub.player_cache_collection.clear()
    _db_stub.fetch_queue_collection.clear()
    _db_stub.shot_chart_cache_collection.clear()


def shot_row(player_id, game_id, event_id, made=0):
    return {
        "PLAYER_ID": player_id,
        "GAME_ID": game_id,
        "GAME_EVENT_ID": event_id,
        "LOC_X": "12",
        "LOC_Y": "80",
        "SHOT_MADE_FLAG": made,
        "SHOT_ATTEMPTED_FLAG": 1,
    }


class GameShotFetchTests(unittest.TestCase):
    def setUp(self):
        reset_collections()
        shot_service.SHOT_CHART_REQUEST_DELAY_SECONDS = 0
        self.game_id = "0022501164"
        self.cache_key = shot_service.cache_id(7, "2025-26", "Regular Season")
        self.games = [
            {"Game_ID": self.game_id, "FGA": 2, "FGM": 1},
            {"Game_ID": "0022501165", "FGA": 1, "FGM": 0},
        ]
        _db_stub.player_cache_collection.documents["player-7"] = {
            "player_id": 7,
            "data": {"season_game_logs": {"2025-26": self.games}},
        }

    def test_endpoint_includes_optional_game_filter(self):
        headers = list(shot_row(7, self.game_id, 1).keys())
        response = types.SimpleNamespace(
            get_request=lambda: None,
            shot_chart_detail=types.SimpleNamespace(
                get_dict=lambda: {"headers": headers, "data": [[7, self.game_id, 1, "12", "80", 1, 1]]}
            ),
        )
        with patch.object(fetch_service.shotchartdetail, "ShotChartDetail", return_value=response) as endpoint:
            fetch_service.fetch_shot_chart_by_season(
                7, "2025-26", game_id=self.game_id
            )
        self.assertEqual(
            endpoint.call_args.kwargs["game_id_nullable"], self.game_id
        )

    def test_game_job_queue_has_distinct_identity_and_preserves_existing_schedule(self):
        self.assertTrue(
            shot_service.queue_game_shot_job(
                "2025-26", "Regular Season", 7, self.game_id
            )
        )
        key = shot_service.game_queue_id("2025-26", "Regular Season", 7, self.game_id)
        self.assertNotEqual(key, shot_service.queue_id("2025-26", "Regular Season", 7))
        self.assertEqual(key, "shot-chart-game-refresh:2025-26:Regular Season:7:0022501164")
        queued = _db_stub.fetch_queue_collection.documents[key]
        self.assertEqual(queued["job_type"], "shot_chart_refresh")
        self.assertEqual(queued["game_id"], self.game_id)
        self.assertEqual(queued["priority"], 100)

        locked = {**queued, "locked_by": "worker-1", "next_attempt_at": "retry"}
        _db_stub.fetch_queue_collection.documents[key] = locked
        self.assertFalse(
            shot_service.queue_game_shot_job(
                "2025-26", "Regular Season", 7, self.game_id
            )
        )
        self.assertEqual(_db_stub.fetch_queue_collection.documents[key], locked)

    def test_processing_updates_only_requested_game_with_literal_rows(self):
        old_game_rows = [shot_row(7, "0022501165", 99)]
        _db_stub.shot_chart_cache_collection.documents[self.cache_key] = {
            "_id": self.cache_key,
            "shots_by_game": {"0022501165": old_game_rows},
        }
        rows = [
            shot_row(7, self.game_id, 1, made=1),
            shot_row(7, self.game_id, 2, made=0),
        ]
        with patch.object(shot_service, "fetch_shot_chart_by_season", return_value=rows) as fetch, \
             patch.object(_db_stub.shot_chart_cache_collection, "update_one") as update:
            update.return_value = types.SimpleNamespace(upserted_id=None)
            result = shot_service.process_shot_chart_job(
                {
                    "season": "2025-26",
                    "season_type": "Regular Season",
                    "player_id": 7,
                    "game_id": self.game_id,
                }
            )

        self.assertEqual(result, 1)
        fetch.assert_called_once_with(7, "2025-26", "Regular Season", game_id=self.game_id)
        query, pipeline = update.call_args.args
        upsert = update.call_args.kwargs["upsert"]
        self.assertEqual(query, {"_id": self.cache_key})
        self.assertTrue(upsert)
        first_stage = pipeline[0]["$set"]
        self.assertEqual(first_stage[f"shots_by_game.{self.game_id}"], {"$literal": rows})
        self.assertEqual(
            first_stage[f"game_expectations.{self.game_id}"],
            {"$literal": {"fga": 2, "fgm": 1}},
        )
        self.assertEqual(
            first_stage["covered_game_ids"]["$setUnion"],
            [{"$ifNull": ["$covered_game_ids", []]}, [self.game_id]],
        )
        self.assertIn("$objectToArray", pipeline[1]["$set"]["shot_count"]["$sum"]["$map"]["input"])
        self.assertEqual(_db_stub.shot_chart_cache_collection.replacements, [])
        self.assertEqual(
            _db_stub.shot_chart_cache_collection.documents[self.cache_key]["shots_by_game"]["0022501165"],
            old_game_rows,
        )

    def test_wrong_game_or_incomplete_rows_never_write_cache(self):
        existing = {"_id": self.cache_key, "shots_by_game": {"keep": [{"raw": True}]}}
        _db_stub.shot_chart_cache_collection.documents[self.cache_key] = existing
        for rows in (
            [shot_row(7, "0022509999", 1), shot_row(7, "0022509999", 2, made=1)],
            [shot_row(7, self.game_id, 1, made=0), shot_row(7, self.game_id, 2, made=0)],
            [shot_row(8, self.game_id, 1, made=1), shot_row(8, self.game_id, 2, made=0)],
        ):
            with self.subTest(rows=rows), patch.object(
                shot_service, "fetch_shot_chart_by_season", return_value=rows
            ), patch.object(_db_stub.shot_chart_cache_collection, "update_one") as update:
                with self.assertRaises(shot_service.ShotChartValidationError):
                    shot_service.process_shot_chart_job(
                        {
                            "season": "2025-26",
                            "season_type": "Regular Season",
                            "player_id": 7,
                            "game_id": self.game_id,
                        }
                    )
                update.assert_not_called()
                self.assertEqual(_db_stub.shot_chart_cache_collection.documents[self.cache_key], existing)

    def test_zero_attempt_game_can_be_cached_and_then_skips_endpoint(self):
        self.games[0].update(FGA=0, FGM=0)
        with patch.object(shot_service, "fetch_shot_chart_by_season", return_value=[]) as fetch, \
             patch.object(_db_stub.shot_chart_cache_collection, "update_one") as update:
            update.return_value = types.SimpleNamespace(upserted_id=None)
            self.assertEqual(
                shot_service.process_shot_chart_job(
                    {
                        "season": "2025-26",
                        "season_type": "Regular Season",
                        "player_id": 7,
                        "game_id": self.game_id,
                    }
                ),
                1,
            )
        fetch.assert_called_once()
        pipeline = update.call_args.args[1]
        self.assertEqual(pipeline[0]["$set"][f"shots_by_game.{self.game_id}"], {"$literal": []})

        _db_stub.shot_chart_cache_collection.documents[self.cache_key] = {
            "_id": self.cache_key,
            "source": shot_service.SOURCE,
            "cache_version": shot_service.CACHE_VERSION,
            "shots_by_game": {self.game_id: []},
            "game_expectations": {self.game_id: {"fga": 0, "fgm": 0}},
        }
        with patch.object(shot_service, "fetch_shot_chart_by_season") as fetch:
            self.assertEqual(
                shot_service.process_shot_chart_job(
                    {
                        "season": "2025-26",
                        "season_type": "Regular Season",
                        "player_id": 7,
                        "game_id": self.game_id,
                    }
                ),
                0,
            )
        fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
