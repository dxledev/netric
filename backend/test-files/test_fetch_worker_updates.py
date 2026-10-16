"""Offline regression tests for player refresh processing in fetch_worker."""

import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class MemoryCollection:
    def __init__(self):
        self.documents = {}
        self.updates = []

    def find_one(self, query, projection=None):
        for document in self.documents.values():
            if all(document.get(key) == value for key, value in query.items()):
                return document
        return None

    def update_one(self, query, update, upsert=False):
        if not isinstance(upsert, bool):
            raise TypeError("upsert must be a bool")
        self.updates.append((query.copy(), update.copy(), upsert))
        document = self.find_one(query)
        if document is None:
            if not upsert:
                return types.SimpleNamespace(matched_count=0, upserted_id=None)
            document = dict(query)
            self.documents[str(query.get("player_id", query.get("_id")))] = document
        for key, value in update.get("$set", {}).items():
            target = document
            parts = key.split(".")
            for part in parts[:-1]:
                target = target.setdefault(part, {})
            target[parts[-1]] = value
        for key in update.get("$unset", {}):
            document.pop(key, None)
        return types.SimpleNamespace(matched_count=1, upserted_id=None)

    def find_one_and_update(self, query, update, sort=None, return_document=None):
        return None

    def clear(self):
        self.documents.clear()
        self.updates.clear()


def _fresh_info(player_id=42):
    return {
        "PERSON_ID": player_id,
        "DISPLAY_FIRST_LAST": "Fresh Name",
        "ROSTERSTATUS": 1,
        "FROM_YEAR": 2018,
        "TO_YEAR": 2026,
        "PLAYERCODE": "fresh-name",
        "TEAM_ID": 1610612755,
        "TEAM_CITY": "Philadelphia",
        "TEAM_NAME": "76ers",
        "TEAM_ABBREVIATION": "PHI",
        "TEAM_CODE": "phi",
        "JERSEY": "23",
        "POSITION": "Guard",
    }


def _build_current_team(info):
    try:
        team_id = int(info["TEAM_ID"])
    except (KeyError, TypeError, ValueError):
        return None
    if team_id <= 0 or not info.get("TEAM_NAME") or not info.get("TEAM_ABBREVIATION"):
        return None
    return {
        "id": team_id,
        "name": f"{info.get('TEAM_CITY', '')} {info['TEAM_NAME']}".strip(),
        "abbreviation": info["TEAM_ABBREVIATION"],
    }


def _normalize_info(info):
    team = _build_current_team(info)
    if team is None:
        return None
    return {
        key: info[key]
        for key in (
            "PERSON_ID", "DISPLAY_FIRST_LAST", "ROSTERSTATUS", "FROM_YEAR",
            "TO_YEAR", "PLAYERCODE", "TEAM_ID", "TEAM_CITY", "TEAM_NAME",
            "TEAM_ABBREVIATION", "TEAM_CODE",
        )
        if key in info
    }


def _merge_player_info_data(cached_data, info):
    merged = dict(cached_data or {})
    if isinstance(info, dict):
        merged["player_info"] = dict(info)
        merged["current_team"] = _build_current_team(info)
    return merged


def _merge_cached_player_data(existing, fetched):
    merged = dict(existing or {})
    merged.update(fetched or {})
    return merged


_database = types.ModuleType("database")
_database.player_cache_collection = MemoryCollection()
_database.fetch_queue_collection = MemoryCollection()

_nba = types.ModuleType("nba")
_nba.SUMMARY_VERSION = 7
_nba.summary_calls = []


def _build_summary(player_id, data):
    _nba.summary_calls.append((player_id, data.copy()))
    return {"player_id": player_id, "name": data.get("name")}


_nba.build_player_summary_from_data = _build_summary

_cache_status = types.ModuleType("services.cache_status")
_cache_status.get_missing_cached_log_season_ids = lambda *args, **kwargs: {}

_fetch_service = types.ModuleType("services.fetch_service")
_fetch_service.fetch_missing_game_logs_by_season = lambda *args, **kwargs: ({}, [], False)
_fetch_service.fetch_player_data = lambda player_id: {"name": f"Player {player_id}"}
_fetch_service.merge_cached_player_data = _merge_cached_player_data
_fetch_service.merge_player_info_data = _merge_player_info_data

_player_info = types.ModuleType("services.player_info")
_player_info.build_current_team = _build_current_team
_player_info.fetch_common_player_info = lambda player_id: [_fresh_info(player_id)]
_player_info.normalize_player_info = _normalize_info

_shot_service = types.ModuleType("services.shot_service")
_shot_service.process_shot_chart_job = lambda job: 0

_team_service = types.ModuleType("services.team_service")
_team_service.BBR_REQUEST_DELAY_SECONDS = 0
_team_service.BasketballReferenceRateLimit = type("BasketballReferenceRateLimit", (Exception,), {})
_team_service.get_current_season = lambda: "2025-26"
_team_service.refresh_all_teams = lambda season: 0
_team_service.store_bbr_team_detail = lambda team_id, season: {"players": []}
_team_service.store_local_cached_team_detail = lambda team_id, season: {"players": []}
_team_service.store_nba_team_detail = lambda team_id, season: {"players": []}

_pymongo = types.ModuleType("pymongo")
_pymongo.ReturnDocument = types.SimpleNamespace(AFTER=object())

_stubs = {
    "database": _database,
    "nba": _nba,
    "services.cache_status": _cache_status,
    "services.fetch_service": _fetch_service,
    "services.player_info": _player_info,
    "services.shot_service": _shot_service,
    "services.team_service": _team_service,
    "pymongo": _pymongo,
}
_worker_spec = importlib.util.spec_from_file_location(
    "_offline_test_fetch_worker", BACKEND_DIR / "fetch_worker.py"
)
fetch_worker = importlib.util.module_from_spec(_worker_spec)
with patch.dict(sys.modules, _stubs):
    _worker_spec.loader.exec_module(fetch_worker)


def reset_fixtures():
    _database.player_cache_collection.clear()
    _database.fetch_queue_collection.clear()
    _nba.summary_calls.clear()


def _cached_player(data=None):
    return {
        "player_id": 42,
        "name": "Old Name",
        "data": data or {
            "name": "Old Name",
            "player_info": {
                "PERSON_ID": 42,
                "DISPLAY_FIRST_LAST": "Old Name",
                "TEAM_ID": 1610612747,
                "TEAM_CITY": "Los Angeles",
                "TEAM_NAME": "Lakers",
                "TEAM_ABBREVIATION": "LAL",
                "TEAM_CODE": "lal",
            },
            "current_team": {
                "id": 1610612747,
                "name": "Los Angeles Lakers",
                "abbreviation": "LAL",
            },
            "career_stats": [{"SEASON_ID": "2024-25", "PTS": 123}],
            "playoff_career_stats": [{"SEASON_ID": "2024-25", "PTS": 45}],
            "season_game_logs": {"2024-25": [{"Game_ID": "0022400001"}]},
        },
        "summary": {"team": "old"},
        "summary_version": 2,
    }


class PlayerInfoWorkerTests(unittest.TestCase):
    def setUp(self):
        reset_fixtures()
        fetch_worker.PLAYER_INFO_REQUEST_DELAY_SECONDS = 0
        self.cached = _cached_player()
        _database.player_cache_collection.documents["42"] = self.cached

    def test_fresh_common_info_replaces_stale_bulk_team_and_keeps_history(self):
        fresh = _fresh_info()
        with patch.object(fetch_worker, "fetch_common_player_info", return_value=[fresh]):
            fetch_worker.process_player_info_job({
                "player_id": 42,
                "player_info": {
                    "PERSON_ID": 42,
                    "DISPLAY_FIRST_LAST": "Old Name",
                    "TEAM_ID": 1610612747,
                    "TEAM_CITY": "Los Angeles",
                    "TEAM_NAME": "Lakers",
                    "TEAM_ABBREVIATION": "LAL",
                    "TEAM_CODE": "lal",
                },
            })

        saved = _database.player_cache_collection.documents["42"]
        data = saved["data"]
        self.assertEqual(data["current_team"]["abbreviation"], "PHI")
        self.assertEqual(data["current_team"]["id"], 1610612755)
        self.assertEqual(data["name"], "Fresh Name")
        self.assertEqual(data["player_info"]["TEAM_ABBREVIATION"], "PHI")
        self.assertEqual(data["common_player_info"][0]["JERSEY"], "23")
        self.assertEqual(data["career_stats"], self.cached["data"]["career_stats"])
        self.assertEqual(data["playoff_career_stats"], self.cached["data"]["playoff_career_stats"])
        self.assertEqual(data["season_game_logs"], self.cached["data"]["season_game_logs"])
        self.assertEqual(len(_nba.summary_calls), 1)

    def test_identical_profile_only_updates_checked_timestamp_without_summary_rebuild(self):
        fresh = _fresh_info()
        info = _normalize_info(fresh)
        initial_data = {
            "name": "Fresh Name",
            "player_info": info,
            "current_team": _build_current_team(fresh),
            "common_player_info": [fresh],
            "career_stats": [{"SEASON_ID": "2024-25", "PTS": 123}],
        }
        self.cached = _cached_player(initial_data)
        _database.player_cache_collection.documents["42"] = self.cached

        with patch.object(fetch_worker, "fetch_common_player_info", return_value=[fresh]):
            fetch_worker.process_player_info_job({"player_id": 42, "player_info": info})

        saved_data = _database.player_cache_collection.documents["42"]["data"]
        self.assertEqual(len(_nba.summary_calls), 0)
        self.assertNotEqual(saved_data.get("info_checked_at"), None)
        self.assertEqual(saved_data["career_stats"], initial_data["career_stats"])

    def test_invalid_empty_or_incomplete_positive_team_does_not_overwrite_cache(self):
        for invalid in (
            {**_fresh_info(), "TEAM_ID": ""},
            {**_fresh_info(), "TEAM_NAME": "", "TEAM_ABBREVIATION": ""},
        ):
            with self.subTest(info=invalid):
                before = _cached_player()
                _database.player_cache_collection.documents["42"] = before
                updates_before = len(_database.player_cache_collection.updates)
                with patch.object(fetch_worker, "fetch_common_player_info", return_value=[invalid]):
                    with self.assertRaises(ValueError):
                        fetch_worker.process_player_info_job({"player_id": 42})
                self.assertEqual(_database.player_cache_collection.documents["42"], before)
                self.assertEqual(len(_database.player_cache_collection.updates), updates_before)


class PlayerJobTests(unittest.TestCase):
    def setUp(self):
        reset_fixtures()

    def test_refresh_stats_takes_precedence_over_missing_log_repair(self):
        with patch.object(fetch_worker, "fetch_player_data", return_value={"full": True}) as full_fetch, \
             patch.object(fetch_worker, "fetch_repair_data") as repair_fetch, \
             patch.object(fetch_worker, "store_player_data") as store:
            completed = fetch_worker.process_player_job({
                "player_id": 42,
                "repair_missing_logs": True,
                "refresh_stats": True,
            })

        self.assertTrue(completed)
        full_fetch.assert_called_once_with(42)
        repair_fetch.assert_not_called()
        store.assert_called_once_with(42, {"full": True})


class QueueClaimTests(unittest.TestCase):
    def test_shot_failures_back_off_with_cap_and_preserve_other_jobs(self):
        queue = _database.fetch_queue_collection
        for job_type, attempts, expected in (
            ("shot_chart_refresh", 0, 900),
            ("shot_chart_refresh", 2, 3600),
            ("shot_chart_refresh", 20, 21600),
            ("player_info_refresh", 2, 900),
        ):
            with self.subTest(job_type=job_type, attempts=attempts), \
                 patch.object(fetch_worker, "RETRY_DELAY_SECONDS", 900), \
                 patch.object(fetch_worker, "SHOT_CHART_MAX_RETRY_DELAY_SECONDS", 21600), \
                 patch.object(fetch_worker, "next_retry_at") as retry_at:
                fetch_worker.mark_job_failed(
                    {"_id": "failure", "job_type": job_type, "attempts": attempts, "claim_token": "owner"},
                    ValueError("NBA error"),
                )
                retry_at.assert_called_once_with(expected)
                self.assertEqual(queue.updates[-1][0]["claim_token"], "owner")

    def test_shot_chart_bulk_job_has_priority_query_and_unique_claim_token(self):
        queue = _database.fetch_queue_collection
        tokens = iter(("a" * 32, "b" * 32))
        with patch.object(queue, "find_one_and_update", return_value=None) as claim, \
             patch.object(
                 fetch_worker, "uuid4", side_effect=lambda: types.SimpleNamespace(hex=next(tokens))
             ):
            fetch_worker.find_next_job(job_type="shot_chart_refresh")
            first_calls = claim.call_args_list
            claim.reset_mock()
            fetch_worker.find_next_job(job_type="shot_chart_refresh")

        self.assertEqual(len(first_calls), 3)
        self.assertEqual(first_calls[0].args[0]["priority"], {"$gt": 0})
        batch_query, update = first_calls[1].args[:2]
        self.assertEqual(batch_query["player_id"], {"$exists": False})
        self.assertEqual(first_calls[1].kwargs["sort"][0], ("season", -1))
        self.assertEqual(first_calls[2].kwargs["sort"][:2], [("priority", -1), ("attempts", 1)])
        token = update["$set"]["claim_token"]
        next_token = first_calls[2].args[1]["$set"]["claim_token"]
        self.assertEqual(len(token), 32)
        self.assertEqual(int(token, 16), int("a" * 32, 16))
        self.assertEqual(next_token, token)

        second_claim_token = claim.call_args_list[0].args[1]["$set"]["claim_token"]
        self.assertEqual(int(second_claim_token, 16), int("b" * 32, 16))
        self.assertNotEqual(token, second_claim_token)


if __name__ == "__main__":
    unittest.main()
