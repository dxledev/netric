from pathlib import Path
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from models import AuthRequest, ChangePasswordRequest, PlayerCommentReplyRequest, PlayerCommentRequest, UserProfileRequest
from auth import (
    register_user,
    login_user,
    change_user_password,
    get_user_profile,
    update_user_profile,
    get_user_favorites,
    get_user_notifications,
    add_favorite_player,
    remove_favorite_player,
    get_player_comments,
    get_player_reply_thread,
    get_trending_player_comments,
    add_player_comment,
    add_player_comment_reply,
    add_player_nested_reply,
    delete_player_comment,
    delete_player_comment_reply,
    toggle_player_comment_like,
    toggle_player_comment_reply_like
)

from database import fetch_queue_collection, player_cache_collection

app = FastAPI()
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"

def normalize_origin(origin: str) -> str:
    return origin.strip().rstrip("/")

default_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://ec2-52-9-241-242.us-west-1.compute.amazonaws.com",
    "https://ec2-52-9-241-242.us-west-1.compute.amazonaws.com",
    "http://52.9.241.242",
    "https://52.9.241.242",
]
raw_cors_origins = os.getenv("CORS_ORIGINS", "")
configured_origins = [normalize_origin(origin) for origin in raw_cors_origins.split(",") if origin.strip()]
cors_origins = sorted(
    {
        normalize_origin(origin)
        for origin in [*default_cors_origins, *configured_origins]
        if origin.strip()
    }
)

# Mongo collections
player_cache = player_cache_collection
fetch_queue = fetch_queue_collection

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from nba import search_player_stats, search_player_matches, build_player_summary

@app.get("/search/players/{name}")
@app.get("/api/search/players/{name}")
def search_player(name: str):
    return search_player_stats(name)


@app.get("/search/players/matches/{name}")
@app.get("/api/search/players/matches/{name}")
def search_player_name_matches(name: str, limit: int = 25):
    return search_player_matches(name, limit)

# ---------------------------
# AUTH
# ---------------------------

@app.post("/register")
@app.post("/api/register")
def register(data: AuthRequest):
    return register_user(data)

@app.post("/login")
@app.post("/api/login")
def login(data: AuthRequest):
    return login_user(data)

@app.post("/change-password")
@app.post("/api/change-password")
def change_password(data: ChangePasswordRequest, authorization: str = Header(None)):
    return change_user_password(data, authorization)

@app.get("/profile")
@app.get("/api/profile")
def profile(authorization: str = Header(None)):
    return get_user_profile(authorization)

@app.put("/profile")
@app.put("/api/profile")
def save_profile(data: UserProfileRequest, authorization: str = Header(None)):
    return update_user_profile(data, authorization)

# ---------------------------
# FAVORITES
# ---------------------------

@app.get("/favorites")
@app.get("/api/favorites")
def favorites(authorization: str = Header(None)):
    return get_user_favorites(authorization)


@app.get("/profile/notifications")
@app.get("/api/profile/notifications")
def profile_notifications(authorization: str = Header(None)):
    return get_user_notifications(authorization)

@app.post("/favorite/players")
@app.post("/api/favorite/players")
def favorite_player(data: dict, authorization: str = Header(None)):
    return add_favorite_player(data, authorization)

@app.delete("/favorites/player/{player_id}")
@app.delete("/api/favorites/player/{player_id}")
def delete_favorite_player(player_id: int, authorization: str = Header(None)):
    return remove_favorite_player(player_id, authorization)

# ---------------------------
# SUMMARY (CACHE ONLY)
# ---------------------------

@app.get("/player/{player_id}/summary")
@app.get("/api/player/{player_id}/summary")
def get_player_summary(player_id: int):
    cached = player_cache.find_one({"player_id": player_id})

    if not cached:
        fetch_queue.update_one(
            {"player_id": player_id},
            {"$set": {"player_id": player_id}},
            upsert=True
        )
        raise HTTPException(
            status_code=404,
            detail="Player not cached yet. Fetch scheduled."
        )

    return build_player_summary(player_id)


@app.get("/player/{player_id}/comments")
@app.get("/api/player/{player_id}/comments")
def player_comments(player_id: int, authorization: str = Header(None)):
    return get_player_comments(player_id, authorization)


@app.get("/player/comments/trending")
@app.get("/api/player/comments/trending")
def trending_player_comments(hours: int = 24, limit: int = 6):
    return get_trending_player_comments(hours, limit)


@app.post("/player/{player_id}/comments")
@app.post("/api/player/{player_id}/comments")
def create_player_comment(player_id: int, data: PlayerCommentRequest, authorization: str = Header(None)):
    return add_player_comment(player_id, data, authorization)


@app.post("/player/{player_id}/comments/{comment_id}/like")
@app.post("/api/player/{player_id}/comments/{comment_id}/like")
def like_player_comment(player_id: int, comment_id: str, authorization: str = Header(None)):
    return toggle_player_comment_like(player_id, comment_id, authorization)


@app.post("/player/{player_id}/comments/{comment_id}/replies")
@app.post("/api/player/{player_id}/comments/{comment_id}/replies")
def create_player_comment_reply(
    player_id: int,
    comment_id: str,
    data: PlayerCommentReplyRequest,
    authorization: str = Header(None)
):
    return add_player_comment_reply(player_id, comment_id, data, authorization)


@app.post("/player/{player_id}/comments/{comment_id}/replies/{reply_id}/like")
@app.post("/api/player/{player_id}/comments/{comment_id}/replies/{reply_id}/like")
def like_player_comment_reply(player_id: int, comment_id: str, reply_id: str, authorization: str = Header(None)):
    return toggle_player_comment_reply_like(player_id, comment_id, reply_id, authorization)


@app.get("/player/{player_id}/comments/{comment_id}/replies/{reply_id}/thread")
@app.get("/api/player/{player_id}/comments/{comment_id}/replies/{reply_id}/thread")
def player_comment_reply_thread(player_id: int, comment_id: str, reply_id: str, authorization: str = Header(None)):
    return get_player_reply_thread(player_id, comment_id, reply_id, authorization)


@app.post("/player/{player_id}/comments/{comment_id}/replies/{reply_id}/replies")
@app.post("/api/player/{player_id}/comments/{comment_id}/replies/{reply_id}/replies")
def create_player_nested_reply(
    player_id: int,
    comment_id: str,
    reply_id: str,
    data: PlayerCommentReplyRequest,
    authorization: str = Header(None)
):
    return add_player_nested_reply(player_id, comment_id, reply_id, data, authorization)


@app.delete("/player/{player_id}/comments/{comment_id}/replies/{reply_id}")
@app.delete("/api/player/{player_id}/comments/{comment_id}/replies/{reply_id}")
def remove_player_comment_reply(player_id: int, comment_id: str, reply_id: str, authorization: str = Header(None)):
    return delete_player_comment_reply(player_id, comment_id, reply_id, authorization)


@app.delete("/player/{player_id}/comments/{comment_id}")
@app.delete("/api/player/{player_id}/comments/{comment_id}")
def remove_player_comment(player_id: int, comment_id: str, authorization: str = Header(None)):
    return delete_player_comment(player_id, comment_id, authorization)

# ---------------------------
# DEBUG
# ---------------------------

@app.delete("/debug/clear-player-cache/{player_id}")
def clear_player_cache(player_id: int):
    player_cache.delete_one({"player_id": player_id})
    return {"message": "Cache cleared"}


@app.get("/{full_path:path}")
def serve_frontend(full_path: str):
    if not frontend_dist.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found.")

    requested_path = (frontend_dist / full_path).resolve()

    if full_path and requested_path.is_file() and requested_path.is_relative_to(frontend_dist):
        return FileResponse(requested_path)

    return FileResponse(frontend_dist / "index.html")
