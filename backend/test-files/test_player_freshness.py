"""Offline tests for the nightly player metadata and correction checks."""

import importlib
import os
import sys
import types
import unittest
from datetime import datetime
from unittest.mock import patch


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


class MemoryCollection:
    def __init__(self):
        self.docs = []

    def find_one(self, query, projection=None):
        for doc in self.docs:
            if self._matches(doc, query):
                return doc
        return None

    def insert_one(self, doc):
        self.docs.append(dict(doc))

    def update_one(self, query, update, upsert=False):
        doc = next((item for item in self.docs if self._matches(item, query)), None)
        if doc is None:
            if upsert:
                doc = {}
                self.docs.append(doc)
            else:
                return types.SimpleNamespace(matched_count=0)
        for key, value in update.get("$set", {}).items():
            doc[key] = value
        for key in update.get("$unset", {}):
            doc.pop(key, None)
        return types.SimpleNamespace(matched_count=1)

    @staticmethod
    def _matches(doc, query):
        for key, expected in query.items():
            actual = doc.get(key)
            if isinstance(expected, dict):
                if "$nin" in expected and actual in expected["$nin"]:
                    return False
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                if "$in" in expected and actual not in expected["$in"]:
                    return False
            elif actual != expected:
                return False
        return True


_db_stub = types.ModuleType("database")
_db_stub.player_cache_collection = MemoryCollection()
_db_stub.fetch_queue_collection = MemoryCollection()
_db_stub.game_cache_collection = MemoryCollection()
_db_stub.team_cache_collection = MemoryCollection()
_db_stub.standings_cache_collection = MemoryCollection()
sys.modules["database"] = _db_stub

player_info = importlib.import_module("services.player_info")
fetch_service = importlib.import_module("services.fetch_service")
refresh_db = importlib.import_module("refresh_db")
player_pool = importlib.import_module("services.player_pool")


class PlayerFreshnessTests(unittest.TestCase):
    def setUp(self):
        _db_stub.player_cache_collection.docs.clear()
        _db_stub.fetch_queue_collection.docs.clear()

    def test_live_team_is_normalized_and_free_agent_team_zero_is_preserved(self):
        info = player_info.normalize_player_info({
            "PERSON_ID": 42, "DISPLAY_FIRST_LAST": "Example Player",
            "TEAM_ID": 0, "TEAM_ABBREVIATION": "", "TEAM_NAME": "",
            "ROSTERSTATUS": 0,
        })
        self.assertEqual(info["PERSON_ID"], 42)
        self.assertEqual(player_info.build_current_team(info), {
            "id": 0, "name": "", "abbreviation": "",
        })

    def test_invalid_team_ids_and_incomplete_positive_team_rows_are_rejected(self):
        base = {"PERSON_ID": 42, "TEAM_NAME": "Example Team", "TEAM_ABBREVIATION": "EX"}
        for invalid_id in ("", "not-a-number", -1, 1.5):
            with self.subTest(team_id=invalid_id):
                self.assertIsNone(player_info.normalize_player_info({**base, "TEAM_ID": invalid_id}))
        self.assertIsNone(player_info.normalize_player_info({
            "PERSON_ID": 42, "TEAM_ID": 123, "TEAM_NAME": "Example Team",
            "TEAM_ABBREVIATION": "",
        }))
        self.assertIsNone(player_info.normalize_player_info({
            "PERSON_ID": 42, "TEAM_ID": 123, "TEAM_NAME": "",
            "TEAM_ABBREVIATION": "EX",
        }))

    def test_corrupt_bulk_rows_are_skipped_without_losing_valid_rows(self):
        rows = [
            {"PERSON_ID": 41, "TEAM_ID": "bad", "TEAM_NAME": "Broken", "TEAM_ABBREVIATION": "BRK"},
            {"PERSON_ID": 42, "TEAM_ID": "123", "TEAM_CITY": "Example", "TEAM_NAME": "Team", "TEAM_ABBREVIATION": "EX"},
            {"PERSON_ID": 43, "TEAM_ID": 0, "TEAM_CITY": "", "TEAM_NAME": "", "TEAM_ABBREVIATION": ""},
        ]
        response = types.SimpleNamespace(
            get_data_frames=lambda: [__import__("pandas").DataFrame(rows)]
        )
        with patch.object(player_info.commonallplayers, "CommonAllPlayers", return_value=response):
            snapshot = player_info.fetch_player_info_snapshot()
        self.assertEqual(set(snapshot), {42, 43})
        self.assertEqual(snapshot[42]["TEAM_ID"], 123)
        self.assertEqual(snapshot[43]["TEAM_ID"], 0)

    def test_metadata_job_contains_live_row_and_requests_profile_enrichment(self):
        queued = player_info.enqueue_player_info_refresh(42, "Example Player", {
            "PERSON_ID": 42, "TEAM_ID": 1610612755,
            "TEAM_NAME": "Philadelphia 76ers", "TEAM_ABBREVIATION": "PHI",
        })
        self.assertTrue(queued)
        job = _db_stub.fetch_queue_collection.docs[0]
        self.assertEqual(job["job_type"], "player_info_refresh")
        self.assertTrue(job["refresh_profile_details"])
        self.assertEqual(job["player_info"]["TEAM_ABBREVIATION"], "PHI")

    def test_merge_player_info_keeps_history_and_sets_authoritative_team(self):
        merged = fetch_service.merge_player_info_data(
            {"career_stats": [{"SEASON_ID": "2025-26"}], "name": "Player"},
            {"PERSON_ID": 42, "TEAM_ID": 1610612755,
             "TEAM_NAME": "Philadelphia 76ers", "TEAM_ABBREVIATION": "PHI"},
        )
        self.assertEqual(merged["career_stats"][0]["SEASON_ID"], "2025-26")
        self.assertEqual(merged["current_team"]["abbreviation"], "PHI")

    def test_live_common_player_info_supplies_missing_packaged_player_name(self):
        import pandas as pd

        response = types.SimpleNamespace(
            get_data_frames=lambda: [pd.DataFrame([{
                "PERSON_ID": 2026001, "DISPLAY_FIRST_LAST": "New Rookie",
            }])]
        )
        with patch.object(fetch_service.players, "find_player_by_id", return_value=None), \
             patch.object(fetch_service.commonplayerinfo, "CommonPlayerInfo", return_value=response) as endpoint:
            name = fetch_service.get_player_name(2026001)

        endpoint.assert_called_once()
        self.assertEqual(name, "New Rookie")

    def test_live_player_name_rejects_wrong_person_id_or_blank_name(self):
        import pandas as pd

        responses = [
            pd.DataFrame([{"PERSON_ID": 7, "DISPLAY_FIRST_LAST": "Someone Else"}]),
            pd.DataFrame([{"PERSON_ID": 2026001, "DISPLAY_FIRST_LAST": "  "}]),
        ]
        with patch.object(fetch_service.players, "find_player_by_id", return_value=None), \
             patch.object(
                 fetch_service.commonplayerinfo,
                 "CommonPlayerInfo",
                 side_effect=[types.SimpleNamespace(get_data_frames=lambda frame=frame: [frame]) for frame in responses],
             ):
            for _ in responses:
                with self.assertRaises(ValueError):
                    fetch_service.get_player_name(2026001)

    def test_rookie_fetch_uses_live_name_and_fetches_2026_27_logs(self):
        import pandas as pd

        response = types.SimpleNamespace(
            get_data_frames=lambda: [pd.DataFrame([{
                "PERSON_ID": 2026001, "DISPLAY_FIRST_LAST": "New Rookie",
            }])]
        )
        regular_career = pd.DataFrame([{"SEASON_ID": "2026-27", "GP": 1}])
        playoff_career = pd.DataFrame(columns=["SEASON_ID", "GP"])
        career = types.SimpleNamespace(
            season_totals_regular_season=types.SimpleNamespace(get_data_frame=lambda: regular_career),
            season_totals_post_season=types.SimpleNamespace(get_data_frame=lambda: playoff_career),
        )
        requested = []

        def game_logs(player_id, season_ids, season_type_all_star="Regular Season"):
            requested.append((season_ids, season_type_all_star))
            return {season_id: [{"GAME_ID": "rookie-game"}] for season_id in season_ids}

        with patch.object(fetch_service.players, "find_player_by_id", return_value=None), \
             patch.object(fetch_service.commonplayerinfo, "CommonPlayerInfo", return_value=response), \
             patch.object(fetch_service.playercareerstats, "PlayerCareerStats", return_value=career), \
             patch.object(fetch_service, "select_season_ids_for_storage", side_effect=lambda seasons: seasons), \
             patch.object(fetch_service, "fetch_game_logs_by_season", side_effect=game_logs):
            data = fetch_service.fetch_player_data(2026001)

        self.assertEqual(data["name"], "New Rookie")
        self.assertEqual(data["season_game_logs"]["2026-27"][0]["GAME_ID"], "rookie-game")
        self.assertTrue(any(seasons == ["2026-27"] for seasons, _ in requested))

    def test_cached_profile_name_wins_over_stale_fetched_name(self):
        merged = fetch_service.merge_cached_player_data(
            {"name": "Old Rookie Name", "common_player_info": [{"DISPLAY_FIRST_LAST": "Fresh Name"}]},
            {"name": "Stale NBA stats name"},
        )
        self.assertEqual(merged["name"], "Fresh Name")

    def test_current_season_stat_change_is_detected_even_without_date_change(self):
        cached = {"data": {"career_stats": [{
            "SEASON_ID": "2025-26", "TEAM_ABBREVIATION": "TOT",
            "GP": 10, "MIN": 200, "PTS": 100, "AST": 20, "REB": 30,
            "STL": 5, "BLK": 2, "TOV": 8, "FGM": 40, "FGA": 80,
            "FG3M": 10, "FG3A": 30, "FTM": 10, "FTA": 12,
        }]}}
        snapshot = {"GP": 10, "MIN": 200, "PTS": 101, "AST": 20, "REB": 30,
                    "STL": 5, "BLK": 2, "TOV": 8, "FGM": 40, "FGA": 80,
                    "FG3M": 10, "FG3A": 30, "FTM": 10, "FTA": 12}
        self.assertFalse(player_info.stats_match_cached(cached, snapshot, "2025-26"))
        snapshot["PTS"] = 100
        self.assertTrue(player_info.stats_match_cached(cached, snapshot, "2025-26"))

    def test_metadata_outage_still_queues_profile_check_and_stat_correction(self):
        player = {"id": 42, "full_name": "Example Player"}
        _db_stub.player_cache_collection.docs.append({
            "player_id": 42,
            "data": {"career_stats": [{
                "SEASON_ID": "2025-26", "TEAM_ABBREVIATION": "TOT", "GP": 1,
                "MIN": 10, "PTS": 10, "AST": 1, "REB": 2, "STL": 0,
                "BLK": 0, "TOV": 1, "PF": 1, "FGM": 4, "FGA": 8,
                "FG3M": 1, "FG3A": 3, "FTM": 1, "FTA": 2,
            }]},
        })
        changed_stats = {"GP": 1, "MIN": 10, "PTS": 11, "AST": 1, "REB": 2,
                         "STL": 0, "BLK": 0, "TOV": 1, "PF": 1, "FGM": 4,
                         "FGA": 8, "FG3M": 1, "FG3A": 3, "FTM": 1, "FTA": 2}

        def snapshot(season, season_type):
            if season == "2025-26" and season_type == "Regular Season":
                return {42: changed_stats}
            return {}

        with patch.object(player_info, "fetch_player_info_snapshot", side_effect=RuntimeError("bulk unavailable")), \
             patch.object(player_info, "fetch_season_stats_snapshot", side_effect=snapshot), \
             patch.object(player_info, "get_current_season", return_value="2025-26"):
            result = player_info.refresh_player_info_and_stats([player])

        jobs = _db_stub.fetch_queue_collection.docs
        self.assertEqual(result["info_checks_queued"], 1)
        self.assertEqual(result["stats_queued"], 1)
        self.assertEqual({job.get("job_type") for job in jobs}, {"player_info_refresh", None})
        self.assertEqual(len(jobs), 2)

    def test_stat_correction_promotes_existing_repair_job_and_unsets_repair_flag(self):
        _db_stub.fetch_queue_collection.docs.append({
            "player_id": 42, "repair_missing_logs": True, "refresh": True,
        })
        self.assertFalse(player_info.enqueue_refresh(42, "Example Player"))
        job = _db_stub.fetch_queue_collection.docs[0]
        self.assertTrue(job["refresh_stats"])
        self.assertNotIn("repair_missing_logs", job)

    def test_metadata_job_does_not_block_normal_stats_refresh(self):
        player_info.enqueue_player_info_refresh(42, "Example Player", {
            "PERSON_ID": 42, "TEAM_ID": 123, "TEAM_CITY": "Example",
            "TEAM_NAME": "Team", "TEAM_ABBREVIATION": "EX",
        })
        self.assertFalse(refresh_db.is_already_queued(42))
        self.assertTrue(player_info.enqueue_refresh(42, "Example Player"))
        jobs = _db_stub.fetch_queue_collection.docs
        self.assertEqual(len(jobs), 2)
        normal_job = next(job for job in jobs if job.get("job_type") is None)
        self.assertTrue(normal_job["refresh_stats"])

    def test_unsorted_career_rows_use_latest_season_and_prefer_tot_row(self):
        cached = {"data": {"career_stats": [
            {"SEASON_ID": "2022-23", "TEAM_ABBREVIATION": "OLD", "GP": 1, "PTS": 3},
            {"SEASON_ID": "2025-26", "TEAM_ABBREVIATION": "AAA", "GP": 5, "PTS": 40},
            {"SEASON_ID": "2025-26", "TEAM_ABBREVIATION": "BBB", "GP": 5, "PTS": 50},
            {"SEASON_ID": "2025-26", "TEAM_ABBREVIATION": "TOT", "GP": 10, "PTS": 100},
        ]}}
        self.assertTrue(player_info.stats_match_cached(
            cached, {"GP": 10, "PTS": 100}, "2025-26"
        ))
        self.assertFalse(player_info.stats_match_cached(
            cached, {"GP": 10, "PTS": 90}, "2025-26"
        ))

    def test_nightly_check_uses_latest_cached_season_when_rows_are_unsorted(self):
        _db_stub.player_cache_collection.docs.append({
            "player_id": 42,
            "data": {"career_stats": [
                {"SEASON_ID": "2022-23", "TEAM_ABBREVIATION": "OLD", "GP": 1, "PTS": 3},
                {"SEASON_ID": "2025-26", "TEAM_ABBREVIATION": "AAA", "GP": 5, "PTS": 40},
                {"SEASON_ID": "2025-26", "TEAM_ABBREVIATION": "BBB", "GP": 5, "PTS": 50},
                {"SEASON_ID": "2025-26", "TEAM_ABBREVIATION": "TOT", "GP": 10, "PTS": 100},
            ]},
        })
        seasons_compared = []
        original_compare = player_info.stats_match_cached

        def track_compare(cached, remote, season, field="career_stats"):
            seasons_compared.append(season)
            return original_compare(cached, remote, season, field)

        def snapshot(season, season_type):
            if season == "2025-26" and season_type == "Regular Season":
                return {42: {"GP": 10, "PTS": 100}}
            return {}

        with patch.object(player_info, "fetch_player_info_snapshot", return_value={}), \
             patch.object(player_info, "fetch_season_stats_snapshot", side_effect=snapshot), \
             patch.object(player_info, "stats_match_cached", side_effect=track_compare), \
             patch.object(player_info, "get_current_season", return_value="2026-27"):
            player_info.refresh_player_info_and_stats([{"id": 42, "full_name": "Example Player"}])

        self.assertIn("2025-26", seasons_compared)
        self.assertNotIn("2022-23", seasons_compared)
        self.assertFalse(any(job.get("job_type") is None for job in _db_stub.fetch_queue_collection.docs))

    def test_new_season_with_games_queues_stats_refresh_and_preserves_old_logs(self):
        old_logs = {"2025-26": [{"GAME_ID": "old-game"}]}
        _db_stub.player_cache_collection.docs.append({
            "player_id": 42,
            "data": {
                "career_stats": [{"SEASON_ID": "2025-26", "GP": 10, "PTS": 100}],
                "season_game_logs": old_logs,
            },
        })
        new_season_stats = {"GP": 1, "MIN": 20, "PTS": 18}

        def snapshot(season, season_type):
            if season == "2026-27" and season_type == "Regular Season":
                return {42: new_season_stats}
            return {}

        with patch.object(player_info, "fetch_player_info_snapshot", return_value={}), \
             patch.object(player_info, "fetch_season_stats_snapshot", side_effect=snapshot), \
             patch.object(player_info, "get_current_season", return_value="2026-27"):
            player_info.refresh_player_info_and_stats([{"id": 42, "full_name": "Example Player"}])

        normal_job = next(job for job in _db_stub.fetch_queue_collection.docs if job.get("job_type") is None)
        self.assertTrue(normal_job["refresh_stats"])
        cached = {"career_stats": [{"SEASON_ID": "2025-26"}], "season_game_logs": old_logs}
        fetched = {
            "career_stats": [{"SEASON_ID": "2026-27"}],
            "season_game_logs": {"2026-27": [{"GAME_ID": "new-game"}]},
        }
        merged = fetch_service.merge_cached_player_data(cached, fetched)
        self.assertEqual(merged["season_game_logs"]["2025-26"], old_logs["2025-26"])
        self.assertEqual(merged["season_game_logs"]["2026-27"][0]["GAME_ID"], "new-game")

    def test_preseason_zero_game_snapshot_does_not_promote_new_season(self):
        _db_stub.player_cache_collection.docs.append({
            "player_id": 42,
            "data": {"career_stats": [{"SEASON_ID": "2025-26", "GP": 10, "PTS": 100}]},
        })

        def snapshot(season, season_type):
            if season == "2026-27" and season_type == "Regular Season":
                return {42: {"GP": 0, "PTS": 0}}
            if season == "2025-26" and season_type == "Regular Season":
                return {42: {"GP": 10, "PTS": 100}}
            return {}

        with patch.object(player_info, "fetch_player_info_snapshot", return_value={}), \
             patch.object(player_info, "fetch_season_stats_snapshot", side_effect=snapshot), \
             patch.object(player_info, "get_current_season", return_value="2026-27"):
            player_info.refresh_player_info_and_stats([{"id": 42, "full_name": "Example Player"}])

        self.assertFalse(any(job.get("job_type") is None for job in _db_stub.fetch_queue_collection.docs))

    def test_tracked_pool_uses_current_and_previous_live_rosters(self):
        roster_calls = []

        def roster(season):
            roster_calls.append(season)
            if season == "2026-27":
                return [
                    {"id": 10, "full_name": "Veteran Player"},
                    {"id": 20, "full_name": "New Rookie"},
                ]
            return [{"id": 10, "full_name": "Veteran Player"}, {"id": 30, "full_name": "Prior Player"}]

        with patch("services.team_service.get_current_season", return_value="2026-27"), \
             patch.object(player_pool, "get_current_active_players", return_value=[{"id": 10, "full_name": "Veteran Player"}]), \
             patch.object(player_pool, "get_active_players_for_season", side_effect=roster):
            tracked = player_pool.get_tracked_players()

        self.assertEqual(roster_calls, ["2026-27", "2025-26"])
        self.assertEqual({player["id"] for player in tracked}, {10, 20, 30})

    def test_tracked_pool_falls_back_to_previous_roster_and_static_players(self):
        def roster(season):
            if season == "2026-27":
                raise RuntimeError("current roster unavailable")
            return [{"id": 30, "full_name": "Prior Player"}]

        with patch("services.team_service.get_current_season", return_value="2026-27"), \
             patch.object(player_pool, "get_current_active_players", return_value=[{"id": 10, "full_name": "Static Player"}]), \
             patch.object(player_pool, "get_active_players_for_season", side_effect=roster):
            tracked = player_pool.get_tracked_players()

        self.assertEqual({player["id"] for player in tracked}, {10, 30})

    def test_calendar_dates_roll_over_to_same_nba_season(self):
        from services import team_service

        class FixedDateTime(datetime):
            current = datetime(2026, 10, 15)

            @classmethod
            def now(cls, tz=None):
                return cls.current

        expected = [
            (datetime(2026, 10, 15), "2026-27"),
            (datetime(2027, 1, 15), "2026-27"),
            (datetime(2027, 7, 15), "2026-27"),
            (datetime(2025, 12, 15), "2025-26"),
        ]
        for current_date, expected_season in expected:
            with self.subTest(date=current_date), patch.dict(os.environ, {"NBA_SEASON": ""}):
                FixedDateTime.current = current_date
                with patch.object(team_service, "datetime", FixedDateTime):
                    self.assertEqual(team_service.get_current_season(), expected_season)

    def test_summary_prefers_live_current_team_over_override(self):
        import pandas as pd
        import nba

        data = {
            "name": "Player",
            "career_stats": [{
                "SEASON_ID": "2025-26", "GP": 1, "TEAM_NAME": "Old Team",
                "TEAM_ABBREVIATION": "OLD", "TEAM_ID": 1,
                "FGM": 1, "FG3M": 0, "FGA": 2, "FTA": 0, "PTS": 2,
                "AST": 0, "REB": 0, "STL": 0, "BLK": 0, "TOV": 0,
                "PF": 0, "MIN": 10, "FG_PCT": .5, "FG3A": 1,
                "FG3_PCT": 0, "FTM": 0, "FT_PCT": 0,
            }],
            "current_team": {"id": 1610612755, "name": "Philadelphia 76ers", "abbreviation": "PHI"},
        }
        with patch.object(nba, "build_season_game_logs", return_value={}), \
             patch.object(nba, "get_player_team_override", return_value={"id": 1, "name": "Override", "abbreviation": "OLD"}):
            summary = nba.build_player_summary_from_data(999, data)
        self.assertEqual(summary["team"]["abbreviation"], "PHI")


if __name__ == "__main__":
    unittest.main()
