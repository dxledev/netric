from pydantic import BaseModel

class AuthRequest(BaseModel):
    email: str
    password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class UserProfileRequest(BaseModel):
    username: str
    profile_image: str | None = None

class PlayerCommentRequest(BaseModel):
    text: str
    username: str | None = None
    profile_image: str | None = None
