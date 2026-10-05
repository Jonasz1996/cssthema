"""Dashboard (F-PL-02, basis): tellers, recent gewijzigde thema's en lokale bestanden."""

from cssthema.repositories import palettes as palette_repo
from cssthema.repositories import themes as theme_repo
from cssthema.repositories.themes import ThemeFilters
from cssthema.schemas.dashboard import Dashboard, LocalFilesSummary
from cssthema.services.context import ServiceContext
from cssthema.services.import_export import local_files_summary
from cssthema.services.views import theme_views

RECENT_THEMES = 5


async def get_dashboard(ctx: ServiceContext) -> Dashboard:
    counts = await theme_repo.theme_counts(ctx.session)
    palettes_total = await palette_repo.count_palettes(ctx.session)
    rows = await theme_repo.list_theme_rows(
        ctx.session, ThemeFilters(), sort="-updated_at", limit=RECENT_THEMES
    )
    recent = await theme_views(ctx, rows)
    total, importable = await local_files_summary(ctx)
    return Dashboard(
        themes_total=counts.total,
        themes_published=counts.published,
        themes_draft_dirty=counts.draft_dirty,
        themes_deleted=counts.deleted,
        palettes_total=palettes_total,
        recent=recent,
        local_files=LocalFilesSummary(
            dir=str(ctx.settings.css_files_dir), total=total, importable=importable
        ),
    )
