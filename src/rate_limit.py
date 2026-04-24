"""
共享 slowapi Limiter 实例。

抽出到独立模块是为了让 main.py 和各 router 能同时 import 同一个 limiter，
避免「router 反向 import main」造成的循环依赖。
"""

from fastapi import Request
from slowapi import Limiter


def _rate_limit_key(request: Request) -> str:
    """优先用 token（每用户独立配额），缺失回退到客户端 IP。"""
    token = request.headers.get("X-Access-Token")
    if token:
        return f"token:{token[:16]}"
    return request.client.host if request.client else "anonymous"


limiter = Limiter(key_func=_rate_limit_key)
