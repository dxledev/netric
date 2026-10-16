"""Offline tests for the ShotChartDetail fetch, cache, and route helpers.

Importing ``database`` normally opens Mongo connections at module import time.
Install lightweight collection stubs first so this suite never connects to or
mutates a database.
"""

import importlib
import os
import sys
import types
import unittest
from copy import deepcopy
from unittest.mock import Mock, patch


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


class MemoryCollection:
    def __init__(self):
        self.documents = {}
        self.replacements = []
        self.updates = []

    def find_one(self, query, projection=None):
        if "_id" in query:
            return self.documents.get(query["_id"])
        for document in self.documents.values():
            if all(document.get(key) == value for key, value in query.items()):
                return document
        return None

    def replace_one(self, query, document, upsert=False):
        self.replacements.append(document.copy())
        self.documents[query["_id"]] = document.copy()

    def update_one(self, query, update, upsert=False):
        self.updates.append((query.copy(), deepcopy(update), upsert))
        inserted = None
        if upsert and query["_id"] not in self.documents:
            if isinstance(update, list):
                self.documents[query["_id"]] = {"_id": query["_id"]}
            else:
                self.documents[query["_id"]] = update.get("$setOnInsert", {"_id": query["_id"]}).copy()
            inserted = query["_id"]
        document = self.documents.get(query["_id"])
        if document is not None:
            if isinstance(update, list):
                for stage in update:
                    evaluated = {
                        key: self._evaluate(value, document)
                        for key, value in stage.get("$set", {}).items()
                    }
                    for key, value in evaluated.items():
                        self._set_path(document, key, value)
            else:
                document.update(update.get("$set", {}))
                for key, value in update.get("$max", {}).items():
                    document[key] = max(document.get(key, value), value)
        return types.SimpleNamespace(upserted_id=inserted)

    @staticmethod
    def _get_path(document, path):
        value = document
        for part in path.split("."):
            if not isinstance(value, dict) or part not in value:
                return None
            value = value[part]
        return value

    @staticmethod
    def _set_path(document, path, value):
        parts = path.split(".")
        target = document
        for part in parts[:-1]:
            target = target.setdefault(part, {})
        target[parts[-1]] = value

    @classmethod
    def _evaluate(cls, expression, document, variables=None):
        variables = variables or {}
        if isinstance(expression, str):
            if expression.startswith("$$"):
                variable, _, path = expression[2:].partition(".")
                value = variables.get(variable)
                return cls._get_path(value, path) if path else value
            if expression.startswith("$"):
                return cls._get_path(document, expression[1:])
            return expression
        if isinstance(expression, list):
            return [cls._evaluate(value, document, variables) for value in expression]
        if not isinstance(expression, dict):
            return expression
        if "$literal" in expression:
            return deepcopy(expression["$literal"])
        if "$ifNull" in expression:
            first, fallback = expression["$ifNull"]
            value = cls._evaluate(first, document, variables)
            return value if value is not None else cls._evaluate(fallback, document, variables)
        if "$mergeObjects" in expression:
            result = {}
            for value in expression["$mergeObjects"]:
                item = cls._evaluate(value, document, variables)
                if isinstance(item, dict):
                    result.update(item)
            return result
        if "$setUnion" in expression:
            result = []
            for values in expression["$setUnion"]:
                for value in cls._evaluate(values, document, variables) or []:
                    if value not in result:
                        result.append(value)
            return result
        if "$objectToArray" in expression:
            value = cls._evaluate(expression["$objectToArray"], document, variables) or {}
            return [{"k": key, "v": item} for key, item in value.items()]
        if "$map" in expression:
            spec = expression["$map"]
            values = cls._evaluate(spec["input"], document, variables) or []
            return [
                cls._evaluate(
                    spec["in"], document, {**variables, spec.get("as", "this"): value}
                )
                for value in values
            ]
        if "$size" in expression:
            return len(cls._evaluate(expression["$size"], document, variables))
        if "$sum" in expression:
            value = cls._evaluate(expression["$sum"], document, variables)
            return sum(value) if isinstance(value, list) else value
        return {
            key: cls._evaluate(value, document, variables)
            for key, value in expression.items()
        }

    def find(self, query=None, projection=None):
        query = query or {}
        found = []
        for document in self.documents.values():
            matches = True
            for key, value in query.items():
                actual = document.get(key)
                if isinstance(value, dict) and "$in" in value:
                    matches = actual in value["$in"]
                else:
                    matches = actual == value
                if not matches:
                    break
            if matches:
                found.append(document)
        return found

    def clear(self):
        self.documents.clear()
        self.replacements.clear()
        self.updates.clear()


_db_stub = types.ModuleType("database")
_db_stub.player_cache_collection = MemoryCollection()
_db_stub.fetch_queue_collection = MemoryCollection()
_db_stub.shot_chart_cache_collection = MemoryCollection()
sys.modules["database"] = _db_stub

# The imports under test retain these offline collection instances.
fetch_service = importlib.import_module("services.fetch_service")
shot_service = importlib.import_module("services.shot_service")
game_shots = importlib.import_module("services.game_shots")


def reset_collections():
    _db_stub.player_cache_collection.clear()
    _db_stub.fetch_queue_collection.clear()
    _db_stub.shot_chart_cache_collection.clear()


def shot_row(player_id, game_id, event_id, x=0, y=0, made=0, attempted=1):
    return {
        "PLAYER_ID": player_id,
        "GAME_ID": game_id,
        "GAME_EVENT_ID": event_id,
        "LOC_X": x,
        "LOC_Y": y,
        "SHOT_MADE_FLAG": made,
        "SHOT_ATTEMPTED_FLAG": attempted,
    }


class FetchShotChartTests(unittest.TestCase):
    def test_fetch_uses_fga_and_retains_raw_named_coordinates(self):
        headers = list(shot_row(7, "0022500001", 1).keys()) + ["SHOT_ZONE_BASIC"]
        raw = [7, "0022500001", 1, "-23", "144", 1, 1, "Above the Break 3"]
        response = types.SimpleNamespace(
            get_request=lambda: None,
            shot_chart_detail=types.SimpleNamespace(
                get_dict=lambda: {"headers": headers, "data": [raw]}
            )
        )
        with patch.object(fetch_service.shotchartdetail, "ShotChartDetail", return_value=response) as endpoint:
            result = fetch_service.fetch_shot_chart_by_season(7, "2025-26", "Playoffs")

        endpoint.assert_called_once_with(
            team_id=0,
            player_id=7,
            season_nullable="2025-26",
            season_type_all_star="Playoffs",
            context_measure_simple="FGA",
            timeout=fetch_service.NBA_API_TIMEOUT_SECONDS,
            get_request=False,
        )
        self.assertEqual(result[0]["LOC_X"], "-23")
        self.assertEqual(result[0]["LOC_Y"], "144")
        self.assertEqual(result[0]["SHOT_ZONE_BASIC"], "Above the Break 3")

    def test_fetch_rejects_missing_coordinate_column_and_malformed_rows(self):
        required = ["PLAYER_ID", "GAME_ID", "GAME_EVENT_ID", "LOC_X", "LOC_Y",
                    "SHOT_MADE_FLAG", "SHOT_ATTEMPTED_FLAG"]
        cases = [
            {"headers": [h for h in required if h != "LOC_X"], "data": []},
            {"headers": required, "data": [[7, "0022500001"]]},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                response = types.SimpleNamespace(
                    get_request=lambda: None,
                    shot_chart_detail=types.SimpleNamespace(get_dict=lambda: payload)
                )
                with patch.object(fetch_service.shotchartdetail, "ShotChartDetail", return_value=response):
                    with self.assertRaises(ValueError):
                        fetch_service.fetch_shot_chart_by_season(7, "2025-26")

    def test_empty_server_error_reports_http_status(self):
        response = types.SimpleNamespace(
            get_request=Mock(side_effect=ValueError("empty response")),
            nba_response=types.SimpleNamespace(_status_code=500),
        )
        with patch.object(fetch_service.shotchartdetail, "ShotChartDetail", return_value=response), \
             patch.object(fetch_service, "NBA_API_RETRY_ATTEMPTS", 1):
            with self.assertRaisesRegex(fetch_service.ShotChartPayloadError, "HTTP 500"):
                fetch_service.fetch_shot_chart_by_season(7, "2025-26")


class ShotChartJobTests(unittest.TestCase):
    def setUp(self):
        reset_collections()
        shot_service.SHOT_CHART_REQUEST_DELAY_SECONDS = 0
        self.player_doc = {
            "player_id": 7,
            "data": {
                "season_game_logs": {
                    "2025-26": [
                        {"Game_ID": "0022500001", "FGA": 2, "FGM": 1},
                        {"Game_ID": "0022500002", "FGA": 0, "FGM": 0},
                    ]
                }
            },
        }
        _db_stub.player_cache_collection.documents["player-7"] = self.player_doc

    def test_all_player_requests_map_calendar_months_to_nba_season_months(self):
        games = [
            {"GAME_DATE": "2025-10-22"},
            {"GAME_DATE": "2026-01-08"},
            {"GAME_DATE": "2026-04-01"},
        ]
        with patch.object(shot_service, "fetch_shot_chart_by_season", return_value=[]) as fetch:
            rows, request_count = shot_service._fetch_job_shots(
                None, "2025-26", "Regular Season", {7: games}
            )
        self.assertEqual(rows, [])
        self.assertEqual(request_count, 3)
        self.assertEqual(
            [call.kwargs["month"] for call in fetch.call_args_list],
            [1, 4, 7],
        )

    def test_bubble_calendar_months_map_to_nba_season_months(self):
        games = [
            {"GAME_DATE": "2020-07-30"},
            {"GAME_DATE": "2020-08-02"},
        ]
        with patch.object(shot_service, "fetch_shot_chart_by_season", return_value=[]) as fetch:
            shot_service._fetch_job_shots(None, "2019-20", "Regular Season", {7: games})
        self.assertEqual(
            [call.kwargs["month"] for call in fetch.call_args_list],
            [10, 11],
        )

    def run_job_with(self, rows):
        with patch.object(shot_service, "fetch_shot_chart_by_season", return_value=rows):
            return shot_service.process_shot_chart_job(
                {"season": "2025-26", "season_type": "Regular Season", "player_id": 7}
            )

    def test_saves_positive_and_zero_attempt_games_after_matching_fga_and_fgm(self):
        key = shot_service.cache_id(7, "2025-26", "Regular Season")
        old_shots = [{"GAME_ID": "0022400999", "LOC_X": "old", "LOC_Y": "raw"}]
        _db_stub.shot_chart_cache_collection.documents[key] = {
            "_id": key,
            "shots_by_game": {"0022400999": old_shots},
            "game_expectations": {"0022400999": {"fga": 1, "fgm": 0}},
            "covered_game_ids": ["0022400999"],
        }
        rows = [
            shot_row(7, "0022500001", 10, x=13, y=50, made=1),
            # Same position is valid when it is a distinct NBA event.
            shot_row(7, "0022500001", 11, x=13, y=50, made=0),
        ]
        self.assertEqual(self.run_job_with(rows), 1)
        doc = _db_stub.shot_chart_cache_collection.documents[key]
        self.assertEqual(doc["shots_by_game"]["0022500001"], rows)
        self.assertEqual(doc["shots_by_game"]["0022500002"], [])
        self.assertEqual(doc["game_expectations"]["0022500001"], {"fga": 2, "fgm": 1})
        self.assertEqual(doc["shots_by_game"]["0022400999"], old_shots)
        self.assertEqual(doc["game_expectations"]["0022400999"], {"fga": 1, "fgm": 0})
        self.assertEqual(doc["covered_game_ids"], ["0022400999", "0022500001", "0022500002"])
        self.assertEqual(doc["shot_count"], 3)
        self.assertEqual(_db_stub.shot_chart_cache_collection.replacements, [])
        cache_updates = _db_stub.shot_chart_cache_collection.updates
        self.assertEqual(len(cache_updates), 1)
        update_query, pipeline, upsert = cache_updates[0]
        self.assertEqual(update_query, {"_id": key})
        self.assertTrue(upsert)
        merge_set = pipeline[0]["$set"]
        self.assertEqual(
            merge_set["shots_by_game"]["$mergeObjects"][1]["$literal"]["0022500001"],
            rows,
        )
        self.assertEqual(
            merge_set["game_expectations"]["$mergeObjects"][1]["$literal"]["0022500001"],
            {"fga": 2, "fgm": 1},
        )

    def test_count_or_make_mismatch_does_not_overwrite_healthy_snapshot(self):
        cache_key = shot_service.cache_id(7, "2025-26", "Regular Season")
        healthy = {"_id": cache_key, "shots_by_game": {"preserve": [{"raw": True}]}}
        _db_stub.shot_chart_cache_collection.documents[cache_key] = healthy.copy()

        for rows in (
            [shot_row(7, "0022500001", 1, made=1)],  # FGA mismatch
            [shot_row(7, "0022500001", 1, made=0), shot_row(7, "0022500001", 2, made=0)],  # FGM mismatch
        ):
            with self.subTest(rows=rows):
                with self.assertRaises(ValueError):
                    self.run_job_with(rows)
                self.assertEqual(_db_stub.shot_chart_cache_collection.documents[cache_key], healthy)
                self.assertEqual(_db_stub.shot_chart_cache_collection.replacements, [])
                self.assertEqual(_db_stub.shot_chart_cache_collection.updates, [])

    def test_rejects_bad_flags_coordinates_and_duplicate_event_ids(self):
        invalid_rows = (
            [shot_row(7, "0022500001", 1, x="NaN"), shot_row(7, "0022500001", 2, made=1)],
            [shot_row(7, "0022500001", 1, attempted=0), shot_row(7, "0022500001", 2, made=1)],
            [shot_row(7, "0022500001", 1, made=2), shot_row(7, "0022500001", 2, made=1)],
            [shot_row(7, "0022500001", 1, made=1), shot_row(7, "0022500001", "1", made=0)],
        )
        for rows in invalid_rows:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                self.run_job_with(rows)


class GameShotsRouteTests(unittest.TestCase):
    def setUp(self):
        reset_collections()
        self.player = {
            "player_id": 7,
            "data": {
                "season_game_logs": {
                    "2025-26": [{"Game_ID": "0022500001", "FGA": 1, "FGM": 1}]
                },
                "playoff_season_game_logs": {
                    "2025-26": [{"Game_ID": "0022500010", "FGA": 1, "FGM": 0}]
                },
            },
        }
        _db_stub.player_cache_collection.documents["player-7"] = self.player

    def test_ready_returns_cached_raw_data_without_queueing(self):
        shots = [shot_row(7, "0022500001", 3, x="-10", y="22", made=1)]
        key = shot_service.cache_id(7, "2025-26", "Regular Season")
        _db_stub.shot_chart_cache_collection.documents[key] = {
            "_id": key,
            "source": shot_service.SOURCE,
            "cache_version": shot_service.CACHE_VERSION,
            "covered_game_ids": ["0022500001"],
            "game_expectations": {"0022500001": {"fga": 1, "fgm": 1}},
            "shots_by_game": {"0022500001": shots},
        }
        result = game_shots.get_cached_game_shots(7, "0022500001")
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["shots"], shots)
        self.assertEqual(_db_stub.fetch_queue_collection.updates, [])

    def test_missing_snapshot_queues_scoped_pending_job(self):
        queued = []
        with patch.object(game_shots, "queue_game_shot_job", side_effect=lambda *a, **kw: queued.append((a, kw))):
            result = game_shots.get_cached_game_shots(7, "0022500001")
        self.assertEqual(result["status"], "pending")
        self.assertEqual(queued, [(('2025-26', 'Regular Season', 7, '0022500001'), {"priority": 100})])
        self.assertEqual(result["fetch_status"], "queued")

    def test_pending_response_distinguishes_fetching_and_retry_wait(self):
        from datetime import UTC, datetime, timedelta
        key = shot_service.game_queue_id("2025-26", "Regular Season", 7, "0022500001")
        future = datetime.now(UTC) + timedelta(minutes=5)
        for fields, expected in (
            ({"locked_until": future}, "fetching"),
            ({"next_attempt_at": future.replace(tzinfo=None), "attempts": 2}, "retrying"),
        ):
            with self.subTest(expected=expected):
                _db_stub.fetch_queue_collection.documents[key] = {"_id": key, **fields}
                result = game_shots.get_cached_game_shots(7, "0022500001")
                self.assertEqual(result["fetch_status"], expected)
                self.assertEqual(_db_stub.fetch_queue_collection.documents[key]["priority"], 100)
                for field, value in fields.items():
                    self.assertEqual(_db_stub.fetch_queue_collection.documents[key][field], value)

    def test_playoff_game_uses_separate_scope_and_snapshot(self):
        shots = [shot_row(7, "0022500010", 2, made=0)]
        key = shot_service.cache_id(7, "2025-26", "Playoffs")
        _db_stub.shot_chart_cache_collection.documents[key] = {
            "_id": key,
            "source": shot_service.SOURCE,
            "cache_version": shot_service.CACHE_VERSION,
            "covered_game_ids": ["0022500010"],
            "game_expectations": {"0022500010": {"fga": 1, "fgm": 0}},
            "shots_by_game": {"0022500010": shots},
        }
        result = game_shots.get_cached_game_shots(7, "0022500010")
        self.assertEqual(result["season_type"], "Playoffs")
        self.assertEqual(result["shots"], shots)

    def test_unsupported_season_does_not_queue_and_unknown_game_is_404(self):
        self.player["data"]["season_game_logs"]["1995-96"] = [
            {"Game_ID": "0029500001", "FGA": 1, "FGM": 0}
        ]
        with patch.object(game_shots, "queue_game_shot_job") as queue:
            result = game_shots.get_cached_game_shots(7, "0029500001")
            self.assertEqual(result["status"], "unavailable")
            queue.assert_not_called()
        with self.assertRaises(HTTPException) as raised:
            game_shots.get_cached_game_shots(7, "0099999999")
        self.assertEqual(raised.exception.status_code, 404)


class CoverageAndQueueTests(unittest.TestCase):
    def setUp(self):
        reset_collections()
        shot_service.SHOT_CHART_REQUEST_DELAY_SECONDS = 0
        self.games = [{"Game_ID": "0022500001", "FGA": 2, "FGM": 1}]
        _db_stub.player_cache_collection.documents["player-7"] = {
            "player_id": 7,
            "data": {"season_game_logs": {"2025-26": self.games}},
        }
        self.key = shot_service.cache_id(7, "2025-26", "Regular Season")
        self.cache_doc = {
            "_id": self.key,
            "source": shot_service.SOURCE,
            "cache_version": shot_service.CACHE_VERSION,
            "game_expectations": {
                "0022500001": {"fga": 2, "fgm": 1},
                "0022400999": {"fga": 1, "fgm": 0},
            },
        }

    def test_coverage_invalidates_corrected_fga_fgm_and_wrong_version(self):
        _db_stub.shot_chart_cache_collection.documents[self.key] = self.cache_doc.copy()
        discovered = shot_service.discover_cached_seasons()
        self.assertEqual(shot_service.scope_coverage_counts(discovered)["covered_players"], 1)

        for corrected in (
            {"fga": 3, "fgm": 1},
            {"fga": 2, "fgm": 2},
        ):
            with self.subTest(corrected=corrected):
                self.games[0]["FGA"] = corrected["fga"]
                self.games[0]["FGM"] = corrected["fgm"]
                counts = shot_service.scope_coverage_counts(
                    shot_service.discover_cached_seasons()
                )
                self.assertEqual(counts["missing_players"], 1)
                self.assertFalse(
                    shot_service.is_scope_covered(
                        "2025-26", "Regular Season", {7: self.games}
                    )
                )
                self.games[0].update(FGA=2, FGM=1)

        bad_version = self.cache_doc.copy()
        bad_version["cache_version"] = shot_service.CACHE_VERSION + 1
        _db_stub.shot_chart_cache_collection.documents[self.key] = bad_version
        counts = shot_service.scope_coverage_counts(shot_service.discover_cached_seasons())
        self.assertEqual(counts["missing_players"], 1)
        self.assertFalse(
            shot_service.is_scope_covered("2025-26", "Regular Season", {7: self.games})
        )

    def test_queue_dedup_leaves_existing_retry_and_lock_fields_intact(self):
        key = shot_service.queue_id("2025-26", "Regular Season", 7)
        existing = {
            "_id": key,
            "job_type": "shot_chart_refresh",
            "attempts": 4,
            "locked_by": "worker-a",
            "locked_at": "keep-lock",
            "next_attempt_at": "keep-retry-time",
            "priority": 0,
        }
        _db_stub.fetch_queue_collection.documents[key] = existing.copy()

        inserted = shot_service.queue_shot_chart_job(
            "2025-26", "Regular Season", player_id=7, queued_at="new-time"
        )
        self.assertFalse(inserted)
        self.assertEqual(_db_stub.fetch_queue_collection.documents[key], existing)

        shot_service.queue_shot_chart_job(
            "2025-26", "Regular Season", player_id=7, force=True, priority=100,
        )
        promoted = _db_stub.fetch_queue_collection.documents[key]
        self.assertEqual(promoted, {**existing, "priority": 100, "force": True})

    def test_all_player_remote_or_validation_failure_falls_back_only_for_missing_players(self):
        player8 = {
            "player_id": 8,
            "data": {"season_game_logs": {"2025-26": [
                {"Game_ID": "0022500008", "FGA": 1, "FGM": 0}
            ]}},
        }
        _db_stub.player_cache_collection.documents["player-8"] = player8
        healthy_shot = shot_row(7, "0022500001", 5, made=1)
        healthy = {
            "_id": self.key,
            "player_id": 7,
            "season": "2025-26",
            "season_type": "Regular Season",
            "source": shot_service.SOURCE,
            "cache_version": shot_service.CACHE_VERSION,
            "shots_by_game": {"0022500001": [healthy_shot]},
            "game_expectations": {"0022500001": {"fga": 2, "fgm": 1}},
        }
        # Correct the fixture to two shots, matching the cached log.
        healthy["shots_by_game"]["0022500001"].append(
            shot_row(7, "0022500001", 6, made=0)
        )
        _db_stub.shot_chart_cache_collection.documents[self.key] = healthy.copy()
        before = healthy.copy()

        for failure in (shot_service.requests.exceptions.Timeout("offline"), [healthy_shot]):
            with self.subTest(failure=failure):
                if isinstance(failure, BaseException):
                    fetch = patch.object(shot_service, "fetch_shot_chart_by_season", side_effect=failure)
                else:
                    fetch = patch.object(shot_service, "fetch_shot_chart_by_season", return_value=failure)
                with fetch:
                    result = shot_service.process_shot_chart_job(
                        {"season": "2025-26", "season_type": "Regular Season"}
                    )
                self.assertEqual(result, 0)
                self.assertEqual(
                    _db_stub.shot_chart_cache_collection.documents[self.key], before
                )
                expected_queue = shot_service.queue_id(
                    "2025-26", "Regular Season", 8
                )
                self.assertIn(expected_queue, _db_stub.fetch_queue_collection.documents)
                self.assertNotIn(
                    shot_service.queue_id("2025-26", "Regular Season", 7),
                    _db_stub.fetch_queue_collection.documents,
                )
                _db_stub.fetch_queue_collection.clear()

    def test_all_player_partial_result_stores_complete_player_and_retries_only_incomplete(self):
        games8 = [{"Game_ID": "0022500008", "FGA": 2, "FGM": 1}]
        _db_stub.player_cache_collection.documents["player-8"] = {
            "player_id": 8,
            "data": {"season_game_logs": {"2025-26": games8}},
        }
        # Player 8 already has a complete prior snapshot. The incomplete new
        # response must leave it intact while scheduling an explicit retry.
        key8 = shot_service.cache_id(8, "2025-26", "Regular Season")
        old8 = {
            "_id": key8,
            "player_id": 8,
            "season": "2025-26",
            "season_type": "Regular Season",
            "source": shot_service.SOURCE,
            "cache_version": shot_service.CACHE_VERSION,
            "shots_by_game": {
                "0022500008": [
                    shot_row(8, "0022500008", 80, made=1),
                    shot_row(8, "0022500008", 81, made=0),
                ]
            },
            "game_expectations": {"0022500008": {"fga": 2, "fgm": 1}},
        }
        _db_stub.shot_chart_cache_collection.documents[key8] = old8.copy()

        rows = [
            shot_row(7, "0022500001", 70, made=1),
            shot_row(7, "0022500001", 71, made=0),
            shot_row(8, "0022500008", 80, made=1),  # one attempt missing for player 8
        ]
        with patch.object(shot_service, "fetch_shot_chart_by_season", return_value=rows):
            written = shot_service.process_shot_chart_job(
                {"season": "2025-26", "season_type": "Regular Season", "force": True}
            )

        self.assertEqual(written, 1)
        key7 = shot_service.cache_id(7, "2025-26", "Regular Season")
        self.assertEqual(
            _db_stub.shot_chart_cache_collection.documents[key7]["shots_by_game"]["0022500001"],
            rows[:2],
        )
        self.assertEqual(_db_stub.shot_chart_cache_collection.documents[key8], old8)
        queued = _db_stub.fetch_queue_collection.documents
        self.assertEqual(list(queued), [shot_service.queue_id("2025-26", "Regular Season", 8)])
        self.assertTrue(queued[shot_service.queue_id("2025-26", "Regular Season", 8)]["force"])

    def test_global_duplicate_events_reject_all_rows_before_any_write(self):
        old = {
            self.key: {"_id": self.key, "shots_by_game": {"preserve": [{"x": 1}]}},
        }
        _db_stub.shot_chart_cache_collection.documents.update(old)
        duplicate_rows = [
            shot_row(7, "0022500001", 77, made=1),
            shot_row(7, "0022500001", "77.0", made=0),
        ]
        with patch.object(
            shot_service, "fetch_shot_chart_by_season", return_value=duplicate_rows
        ):
            written = shot_service.process_shot_chart_job(
                {"season": "2025-26", "season_type": "Regular Season", "force": True}
            )
        self.assertEqual(written, 0)
        self.assertEqual(_db_stub.shot_chart_cache_collection.replacements, [])
        self.assertEqual(_db_stub.shot_chart_cache_collection.updates, [])
        self.assertEqual(_db_stub.shot_chart_cache_collection.documents, old)
        self.assertEqual(
            list(_db_stub.fetch_queue_collection.documents),
            [shot_service.queue_id("2025-26", "Regular Season", 7)],
        )

    def test_per_player_remote_failure_propagates(self):
        failures = (
            (shot_service.requests.exceptions.Timeout("offline"), None),
            (None, [shot_row(7, "0022500001", 1)]),  # incomplete FGA/FGM response
        )
        for error, rows in failures:
            with self.subTest(error=error, rows=rows):
                with patch.object(
                    shot_service,
                    "fetch_shot_chart_by_season",
                    side_effect=error,
                    return_value=rows,
                ):
                    with self.assertRaises((shot_service.requests.exceptions.Timeout, ValueError)):
                        shot_service.process_shot_chart_job(
                            {
                                "season": "2025-26",
                                "season_type": "Regular Season",
                                "player_id": 7,
                            }
                        )


from fastapi import HTTPException


if __name__ == "__main__":
    unittest.main()
