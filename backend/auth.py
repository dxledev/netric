import os
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from fastapi import HTTPException, Header
from jose import jwt
from passlib.context import CryptContext
from database import player_comments_collection, users_collection

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_email_from_authorization(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = authorization.replace("Bearer ", "", 1)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    return payload["sub"]


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


def serialize_player_comment(comment, current_email=None):
    created_at = comment.get("created_at")
    author_email = comment.get("email")

    return {
        "id": str(comment.get("_id")),
        "player_id": comment.get("player_id"),
        "text": comment.get("text", ""),
        "username": comment.get("username") or "Netric User",
        "profile_image": comment.get("profile_image"),
        "created_at": format_comment_timestamp(created_at),
        "can_delete": bool(current_email and author_email == current_email),
    }

def register_user(data):
    pw_bytes = data.password.encode("utf-8")
    if len(pw_bytes) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 bytes or less.")

    if users_collection.find_one({"email": data.email}):
        raise HTTPException(status_code=400, detail="Email already exists")

    hashed_pw = pwd_context.hash(data.password)

    users_collection.insert_one({
        "email": data.email,
        "password_hash": hashed_pw,
        "favorites": {
            "players": [],
            "teams": [],
            "stats": []
        }
    })

    return {"message": "User created"}


def login_user(data):
    pw_bytes = data.password.encode("utf-8")
    if len(pw_bytes) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 bytes or less.")

    user = users_collection.find_one({"email": data.email})

    if not user or not pwd_context.verify(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = jwt.encode(
        {
            "sub": data.email,
            "exp": datetime.now(timezone.utc) + timedelta(hours=24)
        },
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return {"access_token": token}

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


def get_player_comments(player_id: int, authorization: str = Header(None)):
    current_email = get_optional_email_from_authorization(authorization)
    comments = player_comments_collection.find(
        {"player_id": player_id}
    ).sort("created_at", -1).limit(100)

    return {"comments": [serialize_player_comment(comment, current_email) for comment in comments]}


def add_player_comment(player_id: int, data, authorization: str):
    email = get_email_from_authorization(authorization)
    text = data.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")

    if len(text) > 600:
        raise HTTPException(status_code=400, detail="Comment must be 600 characters or less")

    username = (data.username or "").strip() or email.split("@")[0] or "Netric User"
    profile_image = data.profile_image if data.profile_image else None
    created_at = datetime.now(timezone.utc)
    result = player_comments_collection.insert_one({
        "player_id": player_id,
        "email": email,
        "text": text,
        "username": username[:80],
        "profile_image": profile_image,
        "created_at": created_at,
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
        }, email)
    }


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
