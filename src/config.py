"""
配置管理 (pydantic-settings)。

所有配置通过环境变量或 .env 文件注入。
"""

from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 小米 TTS
    # Base URL 必须与云服务器落地区域一致，跨境会多 200-400ms 延迟。
    # 候选：
    #   中国区       https://token-plan-cn.xiaomimimo.com/v1/chat/completions
    #   新加坡       https://token-plan-sgp.xiaomimimo.com/v1/chat/completions
    #   欧洲（阿姆） https://token-plan-ams.xiaomimimo.com/v1/chat/completions
    XIAOMI_API_KEY: str
    XIAOMI_TTS_BASE_URL: str = "https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
    XIAOMI_TTS_MODEL: str = "mimo-v2.5-tts-voiceclone"

    # WebRTC（Phase 4 用）
    STUN_URL: str = "stun:stun.l.google.com:19302"
    TURN_URL: str = ""
    TURN_USERNAME: str = ""
    TURN_PASSWORD: str = ""

    # LLM
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = ""
    LLM_MODEL: str = ""

    # STT (whisper.cpp)
    WHISPER_MODEL: str = "small"  # tiny / base / small / medium
    WHISPER_MODEL_PATH: Optional[str] = None  # 默认使用缓存路径

    # 服务器
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # 数据目录
    DATA_DIR: Path = Path("data")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
