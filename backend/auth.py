import os
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from fastapi import HTTPException, Header
from jose import jwt
from passlib.context import CryptContext
from database import player_cache_collection, player_comments_collection, users_collection

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def normalize_email(email: str):
    return str(email or "").strip().lower()


def get_default_username(email: str):
    return normalize_email(email).split("@")[0] or "Netric User"


def serialize_user_profile(user, email: str):
    username = (user or {}).get("username") or get_default_username(email)

    return {
        "email": email,
        "username": username,
        "profile_image": (user or {}).get("profile_image"),
        "has_profile": bool((user or {}).get("username") or (user or {}).get("profile_image")),
    }


def get_email_from_authorization(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = authorization.replace("Bearer ", "", 1)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    return normalize_email(payload["sub"])


def get_optional_email_from_authorization(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        return None

    return get_email_from_authorization(authorization)


def format_comment_timestamp(created_at):
    if not hasattr(created_at, "isoformat"):
        return created_at

    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    return created_at.isoformat()


def get_comment_sort_value(created_at):
    if not hasattr(created_at, "timestamp"):
        return 0

    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    return created_at.timestamp()


def sorted_replies(replies):
    return sorted(
        replies if isinstance(replies, list) else [],
        key=lambda reply: get_comment_sort_value(reply.get("created_at"))
    )


def serialize_player_comment(comment, current_email=None, author_profile=None):
    created_at = comment.get("created_at")
    author_email = comment.get("email")
    author_profile = author_profile or {}
    username = author_profile.get("username") or comment.get("username") or "Netric User"
    profile_image = (
        author_profile["profile_image"]
        if "profile_image" in author_profile
        else comment.get("profile_image")
    )
    liked_by = comment.get("liked_by") if isinstance(comment.get("liked_by"), list) else []
    replies = comment.get("replies") if isinstance(comment.get("replies"), list) else []

    return {
        "id": str(comment.get("_id")),
        "player_id": comment.get("player_id"),
        "text": comment.get("text", ""),
        "username": username,
        "profile_image": profile_image,
        "created_at": format_comment_timestamp(created_at),
        "like_count": len(liked_by),
        "liked_by_current_user": bool(current_email and current_email in liked_by),
        "replies": [
            serialize_player_comment_reply(reply, current_email)
            for reply in sorted_replies(replies)
        ],
        "can_delete": bool(current_email and author_email == current_email),
    }


def serialize_player_comment_reply(reply, current_email=None, include_replies=False):
    author_email = reply.get("email")
    liked_by = reply.get("liked_by") if isinstance(reply.get("liked_by"), list) else []
    replies = reply.get("replies") if isinstance(reply.get("replies"), list) else []

    serialized_reply = {
        "id": str(reply.get("_id")),
        "text": reply.get("text", ""),
        "username": reply.get("username") or "Netric User",
        "profile_image": reply.get("profile_image"),
        "created_at": format_comment_timestamp(reply.get("created_at")),
        "like_count": len(liked_by),
        "liked_by_current_user": bool(current_email and current_email in liked_by),
        "reply_count": len(replies),
        "can_delete": bool(current_email and author_email == current_email),
    }

    if include_replies:
        serialized_reply["replies"] = [
            serialize_player_comment_reply(child_reply, current_email, include_replies=True)
            for child_reply in sorted_replies(replies)
        ]

    return serialized_reply


def find_reply_by_id(replies, reply_id):
    for reply in replies if isinstance(replies, list) else []:
        if reply.get("_id") == reply_id:
            return reply

        found_reply = find_reply_by_id(reply.get("replies"), reply_id)

        if found_reply:
            return found_reply

    return None


def remove_reply_by_id(replies, reply_id, email):
    if not isinstance(replies, list):
        return False

    for index, reply in enumerate(replies):
        if reply.get("_id") == reply_id:
            if reply.get("email") != email:
                raise HTTPException(status_code=403, detail="You can only delete your own replies")

            replies.pop(index)
            return True

        if remove_reply_by_id(reply.get("replies"), reply_id, email):
            return True

    return False


def refresh_reply_profiles(replies, email, username, profile_image):
    changed = False

    for reply in replies if isinstance(replies, list) else []:
        if normalize_email(reply.get("email")) == email:
            reply["username"] = username
            reply["profile_image"] = profile_image
            changed = True

        if refresh_reply_profiles(reply.get("replies"), email, username, profile_image):
            changed = True

    return changed


def collect_reply_actor_emails(replies, current_email, actor_emails):
    for reply in replies if isinstance(replies, list) else []:
        reply_email = normalize_email(reply.get("email"))

        if reply_email and reply_email != current_email:
            actor_emails.add(reply_email)

        for liker_email in reply.get("liked_by") or []:
            liker_email = normalize_email(liker_email)

            if liker_email and liker_email != current_email:
                actor_emails.add(liker_email)

        collect_reply_actor_emails(reply.get("replies"), current_email, actor_emails)


def collect_reply_notifications(replies, current_email, actor_profiles, player_id, player_name, comment_id, comment_text, parent_email, notifications):
    for reply in replies if isinstance(replies, list) else []:
        reply_email = normalize_email(reply.get("email"))
        reply_id = str(reply.get("_id"))

        if reply_email == current_email:
            reply_liked_by = [
                normalize_email(liker_email)
                for liker_email in (reply.get("liked_by") or [])
                if normalize_email(liker_email) and normalize_email(liker_email) != current_email
            ]

            for index, liker_email in enumerate(reply_liked_by[:5]):
                actor_profile = actor_profiles.get(liker_email) or {}
                notifications.append({
                    "id": f"reply-like:{comment_id}:{reply_id}:{liker_email}",
                    "type": "reply_like",
                    "actor_username": actor_profile.get("username") or get_default_username(liker_email),
                    "actor_profile_image": actor_profile.get("profile_image"),
                    "player_id": player_id,
                    "player_name": player_name,
                    "comment_id": comment_id,
                    "reply_id": reply_id,
                    "comment_text": comment_text,
                    "reply_text": reply.get("text", ""),
                    "created_at": serialize_notification_timestamp(reply.get("created_at")),
                    "sort_at": get_notification_sort_value(reply.get("created_at")),
                    "overflow_count": max(0, len(reply_liked_by) - 5) if index == 4 else 0,
                })

        elif reply_email and parent_email == current_email:
            actor_profile = actor_profiles.get(reply_email) or {}
            notifications.append({
                "id": f"reply:{comment_id}:{reply_id}",
                "type": "comment_reply",
                "actor_username": actor_profile.get("username") or reply.get("username") or get_default_username(reply_email),
                "actor_profile_image": actor_profile.get("profile_image") if "profile_image" in actor_profile else reply.get("profile_image"),
                "player_id": player_id,
                "player_name": player_name,
                "comment_id": comment_id,
                "reply_id": reply_id,
                "comment_text": comment_text,
                "reply_text": reply.get("text", ""),
                "created_at": serialize_notification_timestamp(reply.get("created_at")),
                "sort_at": get_notification_sort_value(reply.get("created_at")),
            })

        collect_reply_notifications(
            reply.get("replies"),
            current_email,
            actor_profiles,
            player_id,
            player_name,
            comment_id,
            comment_text,
            reply_email,
            notifications
        )



def get_author_profiles_for_comments(comments):
    emails = sorted({
        normalize_email(comment.get("email"))
        for comment in comments
        if comment.get("email")
    })

    if not emails:
        return {}

    users = users_collection.find(
        {"email": {"$in": emails}},
        {"_id": 0, "email": 1, "username": 1, "profile_image": 1}
    )

    return {
        normalize_email(user.get("email")): {
            "username": user.get("username"),
            "profile_image": user.get("profile_image"),
        }
        for user in users
        if user.get("email")
    }


def get_profiles_by_email(emails):
    normalized_emails = sorted({
        normalize_email(email)
        for email in emails
        if email
    })

    if not normalized_emails:
        return {}

    users = users_collection.find(
        {"email": {"$in": normalized_emails}},
        {"_id": 0, "email": 1, "username": 1, "profile_image": 1}
    )

    return {
        normalize_email(user.get("email")): {
            "username": user.get("username") or get_default_username(user.get("email")),
            "profile_image": user.get("profile_image"),
        }
        for user in users
        if user.get("email")
    }


def get_cached_player_name(player_id: int):
    cached_player = player_cache_collection.find_one(
        {"player_id": player_id},
        {"_id": 0, "name": 1, "data.name": 1, "data.common_player_info": 1, "data.player_info": 1}
    )

    if not cached_player:
        return None

    if cached_player.get("name"):
        return cached_player["name"]

    if cached_player.get("data", {}).get("name"):
        return cached_player["data"]["name"]

    player_info_candidates = [
        cached_player.get("data", {}).get("common_player_info"),
        cached_player.get("data", {}).get("player_info"),
    ]

    for player_info in player_info_candidates:
        if not isinstance(player_info, list) or not player_info:
            continue

        player_name = (
            player_info[0].get("DISPLAY_FIRST_LAST") or
            player_info[0].get("DISPLAY_NAME") or
            player_info[0].get("PLAYER_NAME")
        )

        if player_name:
            return player_name

    return None

def register_user(data):
    email = normalize_email(data.email)
    pw_bytes = data.password.encode("utf-8")
    if len(pw_bytes) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 bytes or less.")

    if users_collection.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")

    hashed_pw = pwd_context.hash(data.password)

    users_collection.insert_one({
        "email": email,
        "password_hash": hashed_pw,
        "favorites": {
            "players": [],
            "teams": [],
            "stats": []
        }
    })

    return {"message": "User created"}


def login_user(data):
    email = normalize_email(data.email)
    pw_bytes = data.password.encode("utf-8")
    if len(pw_bytes) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 bytes or less.")

    user = users_collection.find_one({"email": email})

    if not user or not pwd_context.verify(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = jwt.encode(
        {
            "sub": email,
            "exp": datetime.now(timezone.utc) + timedelta(hours=24)
        },
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return {"access_token": token}


def get_user_profile(authorization: str = Header(None)):
    email = get_email_from_authorization(authorization)
    user = users_collection.find_one(
        {"email": email},
        {"_id": 0, "email": 1, "username": 1, "profile_image": 1}
    )

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return serialize_user_profile(user, email)


def update_user_profile(data, authorization: str = Header(None)):
    email = get_email_from_authorization(authorization)
    username = (data.username or "").strip()

    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be blank")

    if len(username) > 80:
        raise HTTPException(status_code=400, detail="Username must be 80 characters or less")

    profile_image = data.profile_image if data.profile_image else None
    result = users_collection.update_one(
        {"email": email},
        {
            "$set": {
                "username": username,
                "profile_image": profile_image,
            }
        }
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    player_comments_collection.update_many(
        {"email": email},
        {
            "$set": {
                "username": username,
                "profile_image": profile_image,
            }
        }
    )
    player_comments_collection.update_many(
        {"replies.email": email},
        {
            "$set": {
                "replies.$[reply].username": username,
                "replies.$[reply].profile_image": profile_image,
            }
        },
        array_filters=[{"reply.email": email}]
    )
    for comment in player_comments_collection.find(
        {"replies.0": {"$exists": True}},
        {"replies": 1}
    ):
        replies = comment.get("replies") if isinstance(comment.get("replies"), list) else []

        if refresh_reply_profiles(replies, email, username, profile_image):
            player_comments_collection.update_one(
                {"_id": comment["_id"]},
                {"$set": {"replies": replies}}
            )

    return serialize_user_profile({
        "username": username,
        "profile_image": profile_image,
    }, email)

def change_user_password(data, authorization: str = Header(None)):
    current_pw_bytes = data.current_password.encode("utf-8")
    new_pw_bytes = data.new_password.encode("utf-8")

    if len(current_pw_bytes) > 72 or len(new_pw_bytes) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 bytes or less.")

    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")

    email = get_email_from_authorization(authorization)
    user = users_collection.find_one({"email": email})

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not pwd_context.verify(data.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    users_collection.update_one(
        {"email": email},
        {"$set": {"password_hash": pwd_context.hash(data.new_password)}}
    )

    return {"message": "Password updated"}


def get_user_favorites(authorization: str = Header(None)):
    email = get_email_from_authorization(authorization)

    user = users_collection.find_one(
        {"email": email},
        {"_id": 0, "favorites": 1}
    )

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user["favorites"]


def serialize_notification_timestamp(created_at):
    return format_comment_timestamp(created_at) if created_at else None


def get_notification_sort_value(created_at):
    if not hasattr(created_at, "timestamp"):
        return 0

    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    return created_at.timestamp()


def get_user_notifications(authorization: str = Header(None)):
    email = get_email_from_authorization(authorization)
    comments = list(player_comments_collection.find(
        {
            "$or": [
                {"email": email, "liked_by.0": {"$exists": True}},
                {"email": email, "replies.0": {"$exists": True}},
                {"replies.0": {"$exists": True}},
            ]
        },
        {
            "_id": 1,
            "player_id": 1,
            "text": 1,
            "email": 1,
            "liked_by": 1,
            "replies": 1,
            "created_at": 1,
        }
    ).sort("created_at", -1).limit(100))
    actor_emails = set()

    for comment in comments:
        for liker_email in comment.get("liked_by") or []:
            liker_email = normalize_email(liker_email)

            if liker_email and liker_email != email:
                actor_emails.add(liker_email)

        collect_reply_actor_emails(comment.get("replies"), email, actor_emails)

    actor_profiles = get_profiles_by_email(actor_emails)
    notifications = []

    for comment in comments:
        comment_id = str(comment.get("_id"))
        player_id = comment.get("player_id")
        player_name = get_cached_player_name(player_id) or "this player"
        comment_text = comment.get("text", "")
        liked_by = (
            [
                normalize_email(liker_email)
                for liker_email in (comment.get("liked_by") or [])
                if normalize_email(liker_email) and normalize_email(liker_email) != email
            ]
            if normalize_email(comment.get("email")) == email
            else []
        )

        for index, liker_email in enumerate(liked_by[:5]):
            actor_profile = actor_profiles.get(liker_email) or {}
            notifications.append({
                "id": f"like:{comment_id}:{liker_email}",
                "type": "comment_like",
                "actor_username": actor_profile.get("username") or get_default_username(liker_email),
                "actor_profile_image": actor_profile.get("profile_image"),
                "player_id": player_id,
                "player_name": player_name,
                "comment_id": comment_id,
                "comment_text": comment_text,
                "created_at": serialize_notification_timestamp(comment.get("created_at")),
                "sort_at": get_notification_sort_value(comment.get("created_at")),
                "overflow_count": max(0, len(liked_by) - 5) if index == 4 else 0,
            })

        collect_reply_notifications(
            comment.get("replies"),
            email,
            actor_profiles,
            player_id,
            player_name,
            comment_id,
            comment_text,
            normalize_email(comment.get("email")),
            notifications
        )

    notifications.sort(key=lambda notification: notification.get("sort_at"), reverse=True)

    for notification in notifications:
        notification.pop("sort_at", None)

    return {
        "count": len(notifications),
        "notifications": notifications[:50],
    }

def add_favorite_player(data, authorization: str):
    email = get_email_from_authorization(authorization)

    users_collection.update_one(
        {"email": email},
        {
            "$addToSet": {
                "favorites.players": {
                    "id": data["id"],
                    "name": data["name"]
                }
            }
        }
    )

    return {"message": "Player favorited"}

def add_favorite_team(data, authorization: str):
    email = get_email_from_authorization(authorization)
    team_id = data.get("id", data.get("team_id"))

    if team_id is None:
        raise HTTPException(status_code=400, detail="Team id is required")

    users_collection.update_one(
        {"email": email},
        {
            "$addToSet": {
                "favorites.teams": {
                    "id": int(team_id),
                    "name": data.get("name"),
                    "abbreviation": data.get("abbreviation"),
                    "city": data.get("city"),
                    "nickname": data.get("nickname")
                }
            }
        }
    )

    return {"message": "Team favorited"}

def remove_favorite_player(player_id: int, authorization: str):
    email = get_email_from_authorization(authorization)

    result = users_collection.update_one(
        {"email": email},
        {
            "$pull": {
                "favorites.players": { "id": player_id }
            }
        }
    )

    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Player not found in favorites")

    return {"message": "Player removed"}

def remove_favorite_team(team_id: int, authorization: str):
    email = get_email_from_authorization(authorization)

    result = users_collection.update_one(
        {"email": email},
        {
            "$pull": {
                "favorites.teams": { "id": team_id }
            }
        }
    )

    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Team not found in favorites")

    return {"message": "Team removed"}


def get_player_comments(player_id: int, authorization: str = Header(None)):
    current_email = get_optional_email_from_authorization(authorization)
    comments = list(player_comments_collection.find(
        {"player_id": player_id}
    ).sort("created_at", -1).limit(100))
    author_profiles = get_author_profiles_for_comments(comments)

    return {
        "comments": [
            serialize_player_comment(
                comment,
                current_email,
                author_profiles.get(normalize_email(comment.get("email")))
            )
            for comment in comments
        ]
    }


def get_trending_player_comments(hours: int = 24, limit: int = 6):
    bounded_hours = max(1, min(int(hours or 24), 168))
    bounded_limit = max(1, min(int(limit or 6), 20))
    since = datetime.now(timezone.utc) - timedelta(hours=bounded_hours)

    recent_players = list(player_comments_collection.aggregate([
        {"$match": {"created_at": {"$gte": since}}},
        {"$group": {"_id": "$player_id", "comment_count": {"$sum": 1}}},
        {"$sort": {"comment_count": -1, "_id": 1}},
        {"$limit": bounded_limit},
    ]))

    trending_players = recent_players
    recent_player_ids = {
        player.get("_id")
        for player in recent_players
        if player.get("_id")
    }

    if len(trending_players) < bounded_limit:
        all_time_players = list(player_comments_collection.aggregate([
            {"$group": {"_id": "$player_id", "comment_count": {"$sum": 1}}},
            {"$sort": {"comment_count": -1, "_id": 1}},
            {"$limit": bounded_limit + len(recent_player_ids)},
        ]))
        fill_players = [
            player
            for player in all_time_players
            if player.get("_id") and player.get("_id") not in recent_player_ids
        ]
        trending_players = (
            trending_players + fill_players[:bounded_limit - len(trending_players)]
        )

    players = []

    for player in trending_players:
        player_id = player.get("_id")

        if not player_id:
            continue

        player_name = get_cached_player_name(player_id)

        if not player_name:
            continue

        players.append({
            "id": player_id,
            "name": player_name,
            "comment_count": player.get("comment_count", 0),
        })

    return {
        "players": players,
        "hours": bounded_hours,
    }


def add_player_comment(player_id: int, data, authorization: str):
    email = get_email_from_authorization(authorization)
    text = data.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")

    if len(text) > 600:
        raise HTTPException(status_code=400, detail="Comment must be 600 characters or less")

    user = users_collection.find_one(
        {"email": email},
        {"_id": 0, "username": 1, "profile_image": 1}
    ) or {}
    username = (
        user.get("username") or
        (data.username or "").strip() or
        get_default_username(email)
    )
    profile_image = user.get("profile_image") or (data.profile_image if data.profile_image else None)
    created_at = datetime.now(timezone.utc)
    result = player_comments_collection.insert_one({
        "player_id": player_id,
        "email": email,
        "text": text,
        "username": username[:80],
        "profile_image": profile_image,
        "created_at": created_at,
        "liked_by": [],
        "replies": [],
    })

    return {
        "comment": serialize_player_comment({
            "_id": result.inserted_id,
            "player_id": player_id,
            "text": text,
            "username": username[:80],
            "profile_image": profile_image,
            "created_at": created_at,
            "email": email,
            "liked_by": [],
            "replies": [],
        }, email)
    }


def add_player_comment_reply(player_id: int, comment_id: str, data, authorization: str):
    email = get_email_from_authorization(authorization)
    text = data.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="Reply cannot be empty")

    if len(text) > 600:
        raise HTTPException(status_code=400, detail="Reply must be 600 characters or less")

    try:
        object_id = ObjectId(comment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid comment id")

    user = users_collection.find_one(
        {"email": email},
        {"_id": 0, "username": 1, "profile_image": 1}
    ) or {}
    username = (
        user.get("username") or
        (data.username or "").strip() or
        get_default_username(email)
    )
    profile_image = user.get("profile_image") or (data.profile_image if data.profile_image else None)
    created_at = datetime.now(timezone.utc)
    reply = {
        "_id": ObjectId(),
        "email": email,
        "text": text,
        "username": username[:80],
        "profile_image": profile_image,
        "created_at": created_at,
        "liked_by": [],
        "replies": [],
    }

    result = player_comments_collection.update_one(
        {"_id": object_id, "player_id": player_id},
        {"$push": {"replies": reply}}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Comment not found")

    return {"reply": serialize_player_comment_reply(reply, email)}


def add_player_nested_reply(player_id: int, comment_id: str, reply_id: str, data, authorization: str):
    email = get_email_from_authorization(authorization)
    text = data.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="Reply cannot be empty")

    if len(text) > 600:
        raise HTTPException(status_code=400, detail="Reply must be 600 characters or less")

    try:
        object_id = ObjectId(comment_id)
        reply_object_id = ObjectId(reply_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reply id")

    comment = player_comments_collection.find_one(
        {"_id": object_id, "player_id": player_id},
        {"replies": 1}
    )

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    parent_reply = find_reply_by_id(comment.get("replies"), reply_object_id)

    if not parent_reply:
        raise HTTPException(status_code=404, detail="Reply not found")

    user = users_collection.find_one(
        {"email": email},
        {"_id": 0, "username": 1, "profile_image": 1}
    ) or {}
    username = (
        user.get("username") or
        (data.username or "").strip() or
        get_default_username(email)
    )
    profile_image = user.get("profile_image") or (data.profile_image if data.profile_image else None)
    created_at = datetime.now(timezone.utc)
    reply = {
        "_id": ObjectId(),
        "email": email,
        "text": text,
        "username": username[:80],
        "profile_image": profile_image,
        "created_at": created_at,
        "liked_by": [],
        "replies": [],
    }
    parent_replies = parent_reply.get("replies")

    if not isinstance(parent_replies, list):
        parent_reply["replies"] = []

    parent_reply["replies"].append(reply)
    player_comments_collection.update_one(
        {"_id": object_id, "player_id": player_id},
        {"$set": {"replies": comment.get("replies") or []}}
    )

    return {"reply": serialize_player_comment_reply(reply, email)}


def get_player_reply_thread(player_id: int, comment_id: str, reply_id: str, authorization: str = Header(None)):
    current_email = get_optional_email_from_authorization(authorization)

    try:
        object_id = ObjectId(comment_id)
        reply_object_id = ObjectId(reply_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reply id")

    comment = player_comments_collection.find_one(
        {"_id": object_id, "player_id": player_id},
        {"_id": 1, "player_id": 1, "text": 1, "username": 1, "profile_image": 1, "email": 1, "created_at": 1, "replies": 1}
    )

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    reply = find_reply_by_id(comment.get("replies"), reply_object_id)

    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")

    author_profiles = get_author_profiles_for_comments([comment])

    return {
        "player_id": player_id,
        "player_name": get_cached_player_name(player_id) or "this player",
        "comment": serialize_player_comment(
            {**comment, "replies": []},
            current_email,
            author_profiles.get(normalize_email(comment.get("email")))
        ),
        "reply": serialize_player_comment_reply(reply, current_email, include_replies=True),
        "replies": [
            serialize_player_comment_reply(comment_reply, current_email, include_replies=True)
            for comment_reply in sorted_replies(comment.get("replies"))
        ],
    }


def toggle_player_comment_like(player_id: int, comment_id: str, authorization: str):
    email = get_email_from_authorization(authorization)

    try:
        object_id = ObjectId(comment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid comment id")

    comment = player_comments_collection.find_one(
        {"_id": object_id, "player_id": player_id},
        {"liked_by": 1}
    )

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    liked_by = comment.get("liked_by") if isinstance(comment.get("liked_by"), list) else []
    is_liked = email in liked_by
    update = {"$pull": {"liked_by": email}} if is_liked else {"$addToSet": {"liked_by": email}}
    player_comments_collection.update_one({"_id": object_id}, update)
    next_like_count = len(liked_by) - 1 if is_liked else len(liked_by) + 1

    return {
        "liked": not is_liked,
        "like_count": max(0, next_like_count),
    }


def toggle_player_comment_reply_like(player_id: int, comment_id: str, reply_id: str, authorization: str):
    email = get_email_from_authorization(authorization)

    try:
        object_id = ObjectId(comment_id)
        reply_object_id = ObjectId(reply_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reply id")

    comment = player_comments_collection.find_one(
        {"_id": object_id, "player_id": player_id},
        {"replies": 1}
    )

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    reply = find_reply_by_id(comment.get("replies"), reply_object_id)

    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")

    liked_by = reply.get("liked_by") if isinstance(reply.get("liked_by"), list) else []
    is_liked = email in liked_by

    if is_liked:
        reply["liked_by"] = [liker_email for liker_email in liked_by if liker_email != email]
    else:
        reply["liked_by"] = [*liked_by, email]

    player_comments_collection.update_one(
        {"_id": object_id, "player_id": player_id},
        {"$set": {"replies": comment.get("replies") or []}}
    )
    next_like_count = len(liked_by) - 1 if is_liked else len(liked_by) + 1

    return {
        "liked": not is_liked,
        "like_count": max(0, next_like_count),
    }


def delete_player_comment_reply(player_id: int, comment_id: str, reply_id: str, authorization: str):
    email = get_email_from_authorization(authorization)

    try:
        object_id = ObjectId(comment_id)
        reply_object_id = ObjectId(reply_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reply id")

    comment = player_comments_collection.find_one(
        {"_id": object_id, "player_id": player_id},
        {"replies": 1}
    )

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    replies = comment.get("replies") if isinstance(comment.get("replies"), list) else []

    if not remove_reply_by_id(replies, reply_object_id, email):
        raise HTTPException(status_code=404, detail="Reply not found")
    
    player_comments_collection.update_one(
        {"_id": object_id, "player_id": player_id},
        {"$set": {"replies": replies}}
    )

    return {"message": "Reply deleted"}


def delete_player_comment(player_id: int, comment_id: str, authorization: str):
    email = get_email_from_authorization(authorization)

    try:
        object_id = ObjectId(comment_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid comment id")

    comment = player_comments_collection.find_one({
        "_id": object_id,
        "player_id": player_id,
    })

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if comment.get("email") != email:
        raise HTTPException(status_code=403, detail="You can only delete your own comments")

    player_comments_collection.delete_one({"_id": object_id})

    return {"message": "Comment deleted"}
