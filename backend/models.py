import re

from pydantic import BaseModel, field_validator


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

class AuthRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str):
        email = str(value or "").strip().lower()

        if not EMAIL_PATTERN.fullmatch(email):
            raise ValueError("Enter a valid email address")

        return email

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

class PlayerCommentReplyRequest(BaseModel):
    text: str
    username: str | None = None
    profile_image: str | None = None
