import os
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, Header
from jose import jwt
from passlib.context import CryptContext
from database import users_collection

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

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
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    current_pw_bytes = data.current_password.encode("utf-8")
    new_pw_bytes = data.new_password.encode("utf-8")

    if len(current_pw_bytes) > 72 or len(new_pw_bytes) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 bytes or less.")

    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")

    token = authorization.replace("Bearer ", "", 1)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = payload["sub"]
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
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = authorization.replace("Bearer ", "", 1)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = payload["sub"]

    user = users_collection.find_one(
        {"email": email},
        {"_id": 0, "favorites": 1}
    )

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user["favorites"]

def add_favorite_player(data, authorization: str):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = authorization.replace("Bearer ", "", 1)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = payload["sub"]

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
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = authorization.replace("Bearer ", "", 1)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = payload["sub"]

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
