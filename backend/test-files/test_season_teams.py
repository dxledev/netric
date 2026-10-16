"""Offline coverage for player season team selection."""

import importlib
import os
import sys
import types
import unittest


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


class MemoryCollection:
    def find_one(self, *args, **kwargs):
        return None


database_stub = types.ModuleType("database")
database_stub.player_cache_collection = MemoryCollection()
database_stub.fetch_queue_collection = MemoryCollection()
sys.modules["database"] = database_stub

nba = importlib.import_module("nba")


def career_row(season_id, team_id, abbreviation, name=None, games=20):
    return {
        "SEASON_ID": season_id,
        "TEAM_ID": team_id,
        "TEAM_ABBREVIATION": abbreviation,
        "TEAM_NAME": name,
        "GP": games,
        "MIN": 700,
        "PTS": 500,
        "AST": 100,
        "REB": 150,
        "STL": 20,
        "BLK": 10,
        "TOV": 40,
        "PF": 35,
        "FGM": 180,
        "FGA": 350,
        "FG_PCT": 0.514,
        "FG3M": 40,
        "FG3A": 100,
        "FG3_PCT": 0.4,
        "FTM": 100,
        "FTA": 120,
        "FT_PCT": 0.833,
    }


class SeasonTeamSummaryTests(unittest.TestCase):
    def test_current_team_stays_live_and_season_teams_ignore_totals(self):
        data = {
            "name": "Kevin Durant",
            "current_team": {"id": 1610612745, "name": "Houston Rockets", "abbreviation": "HOU"},
            "career_stats": [
                career_row("2017-18", 0, "TOT", "TOT"),
                career_row("2017-18", 1610612745, "HOU", "Houston Rockets"),
                career_row("2016-17", 1610612745, "HOU", "Houston Rockets"),
                career_row("2016-17", 1610612746, "LAC", "Los Angeles Clippers"),
                career_row("2015-16", 1610612760, "OKC"),
            ],
            "season_game_logs": {
                "2016-17": [{"GAME_DATE": "Apr 10, 2017", "MATCHUP": "LAC vs. SAC"}],
            },
        }

        summary = nba.build_player_summary_from_data(201142, data)

        self.assertEqual(summary["team"]["abbreviation"], "HOU")
        self.assertEqual(summary["season_teams"]["2015-16"], {
            "id": 1610612760,
            "name": "Oklahoma City Thunder",
            "abbreviation": "OKC",
        })
        self.assertEqual(summary["season_teams"]["2016-17"]["abbreviation"], "LAC")
        self.assertEqual(summary["season_teams"]["2017-18"]["abbreviation"], "HOU")

    def test_historical_abbreviation_preserves_historical_team_name(self):
        team = nba.get_team_details(1610612760, "SEA", None)

        self.assertEqual(team["name"], "Seattle SuperSonics")
        self.assertEqual(team["abbreviation"], "SEA")


if __name__ == "__main__":
    unittest.main()
