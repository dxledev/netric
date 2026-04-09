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


primary_uri = build_primary_uri()
stats_uri = os.getenv("MONGO_STATS_URI", "").strip() or primary_uri
stats_db_name = os.getenv("MONGO_STATS_DB", "netric_stats").strip() or "netric_stats"

client = _connect_with_retry(primary_uri, "primary")
stats_client = _connect_with_retry(stats_uri, "stats")

db = client["netric"]
stats_db = stats_client[stats_db_name]

users_collection = db["users"]
player_cache_collection = stats_db["player_cache"]
fetch_queue_collection = stats_db["fetch_queue"]
