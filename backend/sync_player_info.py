"""Synchronize cached players with the live NBA player roster and team data."""

import argparse
from datetime import UTC, datetime
import os
from pathlib import Path
import subprocess
import sys

from database import fetch_queue_collection, player_cache_collection, stats_client
from services.player_info import (
    build_current_team,
    enqueue_player_info_refresh,
    enqueue_refresh,
    fetch_player_info_snapshot,
)
from services.team_service import get_current_season


player_cache = player_cache_collection
fetch_queue = fetch_queue_collection


def _is_loopback_address(address):
    if not address:
        return False
    host = address[0] if isinstance(address, tuple) else str(address).split(":", 1)[0]
    return host in {"localhost", "127.0.0.1", "::1"}


def _require_local_database():
    address = getattr(stats_client, "address", None)
    if not _is_loopback_address(address):
        raise RuntimeError(
            f"Refusing player-info mutation: MongoDB address {address!r} is not local."
        )


def _launch_background(argv):
    _require_local_database()
    log_dir = Path(__file__).resolve().parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    pid_path = log_dir / "player-info-sync.pid"
    if pid_path.exists():
        try:
            existing_pid = int(pid_path.read_text().strip())
            if existing_pid <= 1:
                raise ValueError("invalid PID")
            os.kill(existing_pid, 0)
        except (ValueError, ProcessLookupError):
            pass
        except PermissionError:
            raise RuntimeError(f"A player-info sync may already be running as PID {existing_pid}")
        else:
            raise RuntimeError(f"Player-info sync is already running as PID {existing_pid}; inspect {pid_path}.")

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    log_path = log_dir / f"player-info-sync-{stamp}.log"
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
    print(f"Started player-info sync as PID {process.pid}.\nLog: {log_path}\nPID file: {pid_path}")


def _clear_pidfile_if_current():
    pid_path = Path(__file__).resolve().parent / "logs" / "player-info-sync.pid"
    try:
        if int(pid_path.read_text().strip()) == os.getpid():
            pid_path.unlink()
    except (FileNotFoundError, ValueError):
        pass


def _status():
    pending = fetch_queue.count_documents({"job_type": "player_info_refresh"})
    failed = fetch_queue.count_documents({
        "job_type": "player_info_refresh",
        "$or": [{"attempts": {"$gt": 0}}, {"last_error": {"$exists": True}}],
    })
    with_team = player_cache.count_documents({"data.current_team": {"$exists": True}})
    print(
        f"Player info status for {get_current_season()}: {with_team} cached players have current-team metadata; "
        f"{pending} profile checks pending, {failed} failed/retried."
    )


def _roster_players(season):
    from services.player_pool import get_active_players_for_season

    return get_active_players_for_season(season)


def synchronize(player_ids=None):
    """Apply valid bulk identity/team metadata, then queue detailed checks."""
    _require_local_database()
    season = get_current_season()
    selected = set(int(player_id) for player_id in player_ids) if player_ids else None
    try:
        snapshot = fetch_player_info_snapshot()
    except Exception as exc:
        print(f"Bulk player metadata unavailable; cached profile checks will continue: {exc}")
        snapshot = {}

    counts = {"cached": 0, "changed": 0, "checks_queued": 0, "missing_info": 0,
              "new_players_queued": 0, "new_players_cached": 0}
    changes = []
    cached_ids = set()
    for cached in player_cache.find({}, {"player_id": 1, "data": 1}):
        try:
            player_id = int(cached.get("player_id"))
        except (TypeError, ValueError):
            continue
        if selected is not None and player_id not in selected:
            continue
        cached_ids.add(player_id)
        counts["cached"] += 1
        data = cached.get("data") or {}
        remote_info = snapshot.get(player_id)
        if remote_info is None:
            counts["missing_info"] += 1
        else:
            team = build_current_team(remote_info)
            name = str(remote_info.get("DISPLAY_FIRST_LAST") or "").strip()
            current_name = str(data.get("name") or "").strip()
            if team is not None and (team != data.get("current_team") or (name and name != current_name)):
                from nba import SUMMARY_VERSION, build_player_summary_from_data

                previous_team = data.get("current_team")
                updated_data = dict(data)
                updated_data["current_team"] = team
                updated_data["player_info"] = remote_info
                if name:
                    updated_data["name"] = name
                updated_data["info_checked_at"] = datetime.now(UTC)
                summary = build_player_summary_from_data(player_id, updated_data)
                player_cache.update_one(
                    {"_id": cached["_id"]} if "_id" in cached else {"player_id": player_id},
                    {"$set": {
                        "data.current_team": team,
                        "data.player_info": remote_info,
                        "data.info_checked_at": updated_data["info_checked_at"],
                        **({"data.name": name} if name else {}),
                        "summary": summary,
                        "summary_version": SUMMARY_VERSION,
                    }},
                )
                counts["changed"] += 1
                changes.append(f"{player_id} {current_name or '(unnamed)'}: {previous_team} -> {team}")
        player_name = data.get("name") or (remote_info or {}).get("DISPLAY_FIRST_LAST") or ""
        if enqueue_player_info_refresh(player_id, player_name, remote_info):
            counts["checks_queued"] += 1

    try:
        roster = _roster_players(season)
    except Exception as exc:
        print(f"Current-season roster unavailable for {season}; skipping new-player registration: {exc}")
        roster = None
    if roster is not None:
        for player in roster:
            try:
                player_id = int(player["id"])
            except (KeyError, TypeError, ValueError):
                continue
            if selected is not None and player_id not in selected:
                continue
            if player_id in cached_ids:
                continue
            counts["new_players_cached"] += 1
            if enqueue_refresh(player_id, player.get("full_name", "")):
                counts["new_players_queued"] += 1

    print(f"Player info sync for {season}: {counts}")
    for change in changes:
        print(f"Team changed: {change}")
    return counts


def run_queue(player_ids=None):
    _require_local_database()
    from fetch_worker import run_queue as worker_run_queue

    job_filter = {"player_id": {"$in": [int(pid) for pid in player_ids]}} if player_ids else None
    try:
        while worker_run_queue(job_type="player_info_refresh", job_filter=job_filter):
            pass
    finally:
        _clear_pidfile_if_current()


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", action="store_true", help="show profile queue and cache status")
    parser.add_argument("--run", action="store_true", help="process queued player profile checks")
    parser.add_argument("--background", action="store_true", help="run --run in a detached process")
    parser.add_argument("--player-id", type=int, action="append", help="limit sync or queue processing; repeatable")
    args = parser.parse_args(argv)
    if args.background and (not args.run or args.status):
        parser.error("--background requires --run and cannot be combined with --status")
    if args.status:
        _status()
    elif args.background:
        _launch_background(argv)
    elif args.run:
        run_queue(args.player_id)
    else:
        synchronize(args.player_id)


if __name__ == "__main__":
    main()
