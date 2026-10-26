"""Verify bounded refresh passes and their player/shot-chart result."""

import importlib.util
import io
import json
import sys
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch


class NightlyRefreshTests(unittest.TestCase):
    def test_result_reports_players_and_shots_and_reuses_retry_cutoff(self):
        player_result = {"tracked_players": 627, "reconciliation": {"players_with_games": 400}}
        shots = {"games_checked": 969, "queued": 256, "already_cached": 713, "already_queued": 0, "failed": 0}
        run_queue = Mock(side_effect=[2, 0])
        audit = Mock()
        stubs = {
            "refresh_db": types.SimpleNamespace(refresh_all_players=Mock(return_value=player_result), refresh_all_teams=Mock()),
            "fetch_worker": types.SimpleNamespace(run_queue=run_queue),
            "refresh_audit": types.SimpleNamespace(run_refresh_audit_from_env=audit),
            "services.shot_service": types.SimpleNamespace(queue_current_season_shots=Mock(return_value=shots)),
            "services.team_service": types.SimpleNamespace(get_current_season=lambda: "2026-27"),
        }
        spec = importlib.util.spec_from_file_location("_offline_nightly", Path(__file__).resolve().parents[1] / "nightly_refresh.py")
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, stubs):
            spec.loader.exec_module(module)
        output = io.StringIO()
        with patch.dict(module.os.environ, {"NBA_REFRESH_AUDIT_PLAYER_IDS": "", "NIGHTLY_QUEUE_BUDGET_SECONDS": "20"}), \
             patch.object(module.time, "monotonic", return_value=10), redirect_stdout(output):
            result = module.main()
        self.assertEqual(result["players"], player_result)
        self.assertEqual(result["shot_charts_scheduled"]["queued"], 256)
        self.assertEqual(result["shot_charts_after_processing"]["games_checked"], 969)
        self.assertEqual(result["jobs_attempted"], 2)
        self.assertEqual(run_queue.call_count, 2)
        self.assertEqual(run_queue.call_args_list[0].kwargs, run_queue.call_args_list[1].kwargs)
        self.assertEqual(run_queue.call_args.kwargs["deadline"], 30)
        audit.assert_not_called()
        report = next(line.split(": ", 1)[1] for line in output.getvalue().splitlines() if line.startswith("Nightly refresh result:"))
        self.assertEqual(json.loads(report), result)


if __name__ == "__main__":
    unittest.main()
