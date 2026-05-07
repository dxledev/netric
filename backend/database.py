import os
import time
from urllib.parse import quote_plus

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

connect_timeout_ms = int(os.getenv("MONGO_CONNECT_TIMEOUT_MS", "5000"))
server_selection_timeout_ms = int(
    os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "15000")
)
init_retries = int(os.getenv("MONGO_INIT_RETRIES", "12"))
retry_delay_seconds = float(os.getenv("MONGO_INIT_RETRY_DELAY_SECONDS", "10"))


def build_primary_uri():
    user = os.environ["MONGO_USER"]
    pw = quote_plus(os.environ["MONGO_PASS"])
    cluster = os.environ["MONGO_CLUSTER"]

    return f"mongodb+srv://{user}:{pw}@{cluster}/netric?retryWrites=true&w=majority"


def get_primary_uri():
    configured_uri = os.getenv("MONGO_URI", "").strip()

    if configured_uri:
        return configured_uri

    required_vars = ("MONGO_USER", "MONGO_PASS", "MONGO_CLUSTER")

    if all(os.getenv(var) for var in required_vars):
        return build_primary_uri()

    return ""


def _connect_with_retry(uri: str, label: str):
    last_error = None

    for attempt in range(1, init_retries + 1):
        try:
            client = MongoClient(
                uri,
                connectTimeoutMS=connect_timeout_ms,
                serverSelectionTimeoutMS=server_selection_timeout_ms,
            )
            client.admin.command("ping")
            print(f"MongoDB ({label}) connected on attempt {attempt}.")
            return client
        except Exception as exc:
            last_error = exc
            print(
                f"MongoDB ({label}) connection attempt {attempt}/{init_retries} failed: {exc}"
            )
            if attempt == init_retries:
                break
            time.sleep(retry_delay_seconds)

    raise last_error


primary_uri = get_primary_uri()
stats_uri = os.getenv("MONGO_STATS_URI", "").strip() or primary_uri or "mongodb://127.0.0.1:27017"
stats_db_name = os.getenv("MONGO_STATS_DB", "netric_stats").strip() or "netric_stats"
auth_uri = os.getenv("MONGO_AUTH_URI", "").strip() or stats_uri
auth_db_name = os.getenv("MONGO_AUTH_DB", stats_db_name).strip() or stats_db_name

stats_client = _connect_with_retry(stats_uri, "stats")
auth_client = stats_client if auth_uri == stats_uri else _connect_with_retry(auth_uri, "auth")

stats_db = stats_client[stats_db_name]
auth_db = auth_client[auth_db_name]

users_collection = auth_db["users"]
player_comments_collection = auth_db["player_comments"]
player_cache_collection = stats_db["player_cache"]
team_cache_collection = stats_db["team_cache"]
game_cache_collection = stats_db["game_cache"]
standings_cache_collection = stats_db["standings_cache"]
fetch_queue_collection = stats_db["fetch_queue"]
