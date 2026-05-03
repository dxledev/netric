from pydantic import BaseModel

class AuthRequest(BaseModel):
    email: str
    password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class PlayerCommentRequest(BaseModel):
    text: str
    username: str | None = None
    profile_image: str | None = None
