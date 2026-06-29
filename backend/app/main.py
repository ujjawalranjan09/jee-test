"""FastAPI application entry-point."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, health, multi_upload, upload, quiz


def create_app() -> FastAPI:
    app = FastAPI(title="PDF Quiz Generator", version="0.1.0")

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers – all under /api prefix
    app.include_router(health.router, prefix="/api")
    app.include_router(upload.router, prefix="/api")
    app.include_router(multi_upload.router, prefix="/api")
    app.include_router(quiz.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")

    return app


app = create_app()
