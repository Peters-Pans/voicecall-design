"""
FastAPI 应用入口。
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from config import settings
from models.tables import init_db
from rate_limit import limiter
from services.tts_engine import TTSConfig, XiaomiTTSEngine
from services.voice_service import VoiceService


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理。"""
    # 启动
    logger.info("🍮 音色克隆语音通话系统启动中...")

    # 创建数据目录
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    (settings.DATA_DIR / "users").mkdir(exist_ok=True)
    (settings.DATA_DIR / "cache").mkdir(exist_ok=True)

    # 初始化数据库
    await init_db()
    logger.info("✅ 数据库初始化完成")

    # 初始化服务
    voice_service = VoiceService(data_dir=settings.DATA_DIR / "users")
    tts_config = TTSConfig(
        api_key=settings.XIAOMI_API_KEY,
        base_url=settings.XIAOMI_TTS_BASE_URL,
        model=settings.XIAOMI_TTS_MODEL,
    )
    tts_engine = XiaomiTTSEngine(config=tts_config, voice_service=voice_service)

    # 注入到 app state
    app.state.voice_service = voice_service
    app.state.tts_engine = tts_engine

    yield

    # 关闭
    logger.info("🍮 系统关闭中...")
    await tts_engine.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Voice Clone Call System",
        version="0.1.0",
        lifespan=lifespan,
    )

    # 限流：slowapi 中间件 + TTS 路由上的装饰器（在各 router 里通过 Depends 应用）
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    # CORS：白名单由 settings.ALLOWED_ORIGINS 控制（逗号分隔），生产环境务必填实际域名。
    # 同源部署（前端 dist 由后端托管）时其实不触发 CORS；此处只为开发环境前后端分离或嵌入第三方场景兜底。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 路由
    from api.admin import router as admin_router
    from api.auth import router as auth_router
    from api.me import router as me_router
    from api.text_broadcast import router as broadcast_router
    from api.turn import router as turn_router
    from api.voices import router as voices_router

    app.include_router(admin_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(broadcast_router, prefix="/api")
    app.include_router(me_router, prefix="/api")
    app.include_router(turn_router, prefix="/api")
    app.include_router(voices_router, prefix="/api")

    # 前端静态文件 (生产模式) + SPA 回退：未匹配的路径返回 index.html，
    # 让 react-router 在客户端处理深链接。API 路由已在上面注册，不会命中到这里。
    frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
    if frontend_dist.exists():
        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            app.mount(
                "/assets",
                StaticFiles(directory=str(assets_dir)),
                name="frontend-assets",
            )
        index_file = frontend_dist / "index.html"

        # 不应走 SPA 回退的前缀：API、WebSocket、静态 assets、已 mount 的子资源
        NON_SPA_PREFIXES = ("api/", "ws/", "assets/")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            if any(full_path.startswith(p) for p in NON_SPA_PREFIXES):
                raise HTTPException(status_code=404)
            candidate = frontend_dist / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(index_file)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="debug" if settings.DEBUG else "info",
    )
