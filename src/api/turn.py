"""
TURN REST API credential 签发。

与 deploy/turnserver.conf 的 `use-auth-secret` + `static-auth-secret` 对齐：
  username   = "<exp_unix_ts>:<user_id>"
  credential = base64(HMAC-SHA1(key=TURN_SECRET, msg=username))
  ttl        = TURN_CREDENTIAL_TTL_SEC (默认 1 小时)

客户端把返回的 urls/username/credential 填进 RTCPeerConnection 的 iceServers。
TURN_SECRET 未配置则 503，前端应自行回退到纯 STUN。
"""

import base64
import hashlib
import hmac
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import authenticate_request
from config import settings
from models.tables import User

router = APIRouter(tags=["turn"])


TURN_CREDENTIAL_TTL_SEC = 3600


class TurnCredential(BaseModel):
    urls: list[str]
    username: str
    credential: str
    ttl: int


@router.get("/turn-credential", response_model=TurnCredential)
async def get_turn_credential(user: User = Depends(authenticate_request)):
    if not settings.TURN_URL or not settings.TURN_PASSWORD:
        raise HTTPException(status_code=503, detail="TURN 未配置")

    exp = int(time.time()) + TURN_CREDENTIAL_TTL_SEC
    username = f"{exp}:{user.user_id}"
    digest = hmac.new(
        settings.TURN_PASSWORD.encode("utf-8"),
        username.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    credential = base64.b64encode(digest).decode("ascii")

    urls = [settings.TURN_URL]
    if settings.STUN_URL:
        urls.append(settings.STUN_URL)

    return TurnCredential(
        urls=urls,
        username=username,
        credential=credential,
        ttl=TURN_CREDENTIAL_TTL_SEC,
    )
