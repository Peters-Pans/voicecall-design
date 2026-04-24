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

    # CORS：生产环境必须填实际域名（逗号分隔），默认只放 same-origin + localhost 开发
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Token 存活时间（天）；超过自动失效，需管理员重置或 refresh
    TOKEN_TTL_DAYS: int = 30

    # 数据目录
    DATA_DIR: Path = Path("data")

    # 数据库：默认落到项目根 data/voicecall.db，避免不同 cwd 启动导致多份 DB
    DATABASE_URL: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def resolved_database_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        # 项目根（src/config.py → src/ → 项目根）
        project_root = Path(__file__).resolve().parent.parent
        db_path = project_root / "data" / "voicecall.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{db_path}"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
