"""Queue and run local ShotChartDetail cache backfills."""

import argparse
from datetime import UTC, datetime
import os
from pathlib import Path
import subprocess
import sys

from database import fetch_queue_collection, shot_chart_cache_collection, stats_client
from services.shot_service import (
    discover_cached_seasons,
    queue_shot_chart_job,
    scope_coverage_counts,
)


def _is_loopback_address(address):
    if not address:
        return False
    host = address[0] if isinstance(address, tuple) else str(address).split(":", 1)[0]
    return host in {"localhost", "127.0.0.1", "::1"}


def _require_local_database(allow_remote):
    address = getattr(stats_client, "address", None)
    if not allow_remote and not _is_loopback_address(address):
        raise RuntimeError(
            f"Refusing shot-chart mutation: MongoDB address {address!r} is not local; "
            "pass --allow-remote to override."
        )


def _status(discovered):
    counts = scope_coverage_counts(discovered)
    pending = fetch_queue_collection.count_documents({"job_type": "shot_chart_refresh"})
    failed = fetch_queue_collection.count_documents(
        {
            "job_type": "shot_chart_refresh",
            "$or": [{"attempts": {"$gt": 0}}, {"last_error": {"$exists": True}}],
        }
    )
    shot_stats = list(
        shot_chart_cache_collection.aggregate(
            [
                {"$match": {"season": {"$gte": "1996-97"}}},
                {"$group": {"_id": None, "total_shots": {"$sum": "$shot_count"}}},
            ]
        )
    )
    total_shots = int(shot_stats[0]["total_shots"]) if shot_stats else 0
    print(
        "Shot chart cache status: "
        f"{counts['covered_players']} covered and {counts['missing_players']} missing player/scope entries "
        f"across {counts['scopes']} scopes; "
        f"{counts['covered_scopes']} covered, {counts['missing_scopes']} need backfill."
    )
    supported_docs = shot_chart_cache_collection.count_documents(
        {"season": {"$gte": "1996-97"}}
    )
    print(f"Stored supported shot chart documents: {supported_docs}; shots: {total_shots}")
    print(f"Pending shot chart jobs: {pending}; failed/retried jobs: {failed}")


def _launch_background(argv):
    _require_local_database(False)
    log_dir = Path(__file__).resolve().parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    pid_path = log_dir / "shot-chart-backfill.pid"
    if pid_path.exists():
        try:
            existing_pid = int(pid_path.read_text().strip())
            if existing_pid <= 1:
                raise ValueError("invalid PID")
            os.kill(existing_pid, 0)
        except (ValueError, ProcessLookupError):
            pass
        except PermissionError:
            raise RuntimeError(f"A shot-chart backfill may already be running as PID {existing_pid}")
        else:
            raise RuntimeError(
                f"Shot-chart backfill is already running as PID {existing_pid}; "
                f"inspect {pid_path} and its log before starting another."
            )

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    log_path = log_dir / f"shot-chart-backfill-{stamp}.log"
    child_args = [arg for arg in argv if arg != "--background"]
    command = [sys.executable, "-u", str(Path(__file__).resolve()), *child_args]
    with log_path.open("a", encoding="utf-8") as log_file:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    pid_path.write_text(f"{process.pid}\n", encoding="utf-8")
    print(f"Started shot-chart backfill as PID {process.pid}.")
    print(f"Log: {log_path}")
    print(f"PID file: {pid_path}")


def _clear_pidfile_if_current():
    pid_path = Path(__file__).resolve().parent / "logs" / "shot-chart-backfill.pid"
    try:
        if int(pid_path.read_text().strip()) == os.getpid():
            pid_path.unlink()
    except (FileNotFoundError, ValueError):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", action="store_true", help="show coverage without queueing jobs")
    parser.add_argument("--force", action="store_true", help="refresh every discovered scope")
    parser.add_argument("--season", help="limit queueing to one season id, e.g. 2024-25")
    parser.add_argument("--player-id", type=int, help="limit queueing to one cached player")
    queue_mode = parser.add_mutually_exclusive_group()
    queue_mode.add_argument("--per-player", action="store_true", help="queue one request per cached player (the default)")
    queue_mode.add_argument("--all-players", action="store_true", help="queue one request for all players in each season scope")
    parser.add_argument("--run", action="store_true", help="run queued shot-chart jobs")
    parser.add_argument("--background", action="store_true", help="run --run in a detached process")
    parser.add_argument("--allow-remote", action="store_true", help="allow mutations on a non-local MongoDB")
    args = parser.parse_args()
    if args.all_players and args.player_id is not None:
        parser.error("--player-id cannot be combined with --all-players")
    if args.background and not args.run:
        parser.error("--background requires --run")
    if args.background and args.status:
        parser.error("--background cannot be combined with --status")
    if args.background:
        _launch_background(sys.argv[1:])
        return

    discovered = discover_cached_seasons()
    if args.status:
        _status(discovered)
        return

    _require_local_database(args.allow_remote)
    queued = 0
    skipped_unsupported = 0
    for season, season_type in sorted(
        discovered,
        key=lambda item: (int(item[0].split("-", 1)[0]) if _supported(item[0]) else -1, item[1]),
        reverse=True,
    ):
        if args.season and season != args.season:
            continue
        if not _supported(season):
            skipped_unsupported += 1
            continue
        players = discovered[(season, season_type)]
        if args.all_players:
            if queue_shot_chart_job(
                season, season_type, force=args.force, players=players
            ):
                queued += 1
            continue
        player_ids = [args.player_id] if args.player_id is not None else sorted(players)
        for player_id in player_ids:
            if player_id not in players:
                continue
            if queue_shot_chart_job(
                season,
                season_type,
                player_id=player_id,
                force=args.force,
                players={player_id: players[player_id]},
            ):
                queued += 1
    print(
        f"Queued {queued} season/scope shot chart jobs; "
        f"skipped {skipped_unsupported} unsupported pre-1996-97 scopes."
    )

    if args.run:
        from fetch_worker import run_queue

        job_filter = {}
        if args.season:
            job_filter["season"] = args.season
        if args.player_id is not None:
            job_filter["player_id"] = args.player_id
        worker_filter = job_filter or None
        queue_filter = {"job_type": "shot_chart_refresh", **job_filter}
        while True:
            processed = run_queue(
                job_type="shot_chart_refresh", job_filter=worker_filter
            )
            if not processed:
                break
        remaining = fetch_queue_collection.count_documents(queue_filter)
        if remaining:
            print(f"Shot chart backfill stopped with {remaining} pending/failed jobs:")
            for pending_job in fetch_queue_collection.find(queue_filter).limit(20):
                label = ":".join(
                    str(pending_job.get(key, ""))
                    for key in ("season", "season_type", "player_id")
                )
                error = str(pending_job.get("last_error", "no error recorded"))[:500]
                print(f"  {label}: {error}")
            _clear_pidfile_if_current()
            sys.exit(1)
        _clear_pidfile_if_current()


def _supported(season):
    try:
        return int(str(season).split("-", 1)[0]) >= 1996
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    main()
