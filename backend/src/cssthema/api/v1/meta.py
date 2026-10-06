from fastapi import APIRouter, Request
from pydantic import BaseModel

from cssthema import __version__
from cssthema.config import Settings

router = APIRouter(tags=["meta"])


class MetaInfo(BaseModel):
    name: str
    version: str
    environment: str
    public_base_url: str


@router.get("/meta", response_model=MetaInfo, operation_id="meta_get")
async def get_meta(request: Request) -> MetaInfo:
    settings: Settings = request.app.state.settings
    return MetaInfo(
        name="cssthema",
        version=__version__,
        environment=settings.environment,
        public_base_url=settings.public_base_url,
    )
