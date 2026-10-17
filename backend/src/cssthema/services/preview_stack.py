"""De stapel van een host voor de preview in de editor (stappenplan D2).

Een thema als `alg-adguard` gebruikt de tokens van `alg-kern` en de framework-modules: op een
snapshot van de app toont de preview het dus pas goed met de rest van de koppeling erbij. De
onderdelen komen uit dezelfde bron als `/host/<host>.css` (`host_service`: eerst
`css-files/<naam>.css`, anders de gepubliceerde versie), in de volgorde van de koppeling, en
gesplitst rond het bewerkte thema: zijn gepubliceerde versie valt weg, want de editor zet de
live draft op die plek.
"""

from cssthema.db.models import HostBinding
from cssthema.domain.hosts import DEFAULT_HOST
from cssthema.repositories import hosts as host_repo
from cssthema.schemas.preview import PreviewStack, StackPart, ThemeUsage
from cssthema.services.context import ServiceContext
from cssthema.services.host_service import _style_part


async def stack(ctx: ServiceContext, hostname: str, theme: str) -> PreviewStack:
    """Wat `hostname` krijgt (eigen koppeling, anders `*`), vóór en na het thema `theme`."""
    binding = await host_repo.resolve(ctx.session, hostname)
    if binding is None or not binding.enabled:
        return PreviewStack(
            hostname=hostname,
            binding=binding.hostname if binding else None,
            enabled=binding is None,
            contains_theme=False,
            before=[],
            after=[],
        )
    names = [str(name) for name in binding.styles]
    before: list[StackPart] = []
    after: list[StackPart] = []
    target = before
    for name in names:
        if name == theme:
            target = after
            continue
        part = await _style_part(ctx.delivery, ctx.settings.css_files_dir, name)
        target.append(StackPart(name=part.name, source=part.source, css=part.content))
    return PreviewStack(
        hostname=hostname,
        binding=binding.hostname,
        enabled=True,
        contains_theme=theme in names,
        before=before,
        after=after,
    )


def _uses(binding: HostBinding, theme: str) -> bool:
    return binding.enabled and theme in binding.styles


async def usage(ctx: ServiceContext, theme: str) -> ThemeUsage:
    """Welke hosts het thema krijgen: eigen koppelingen, en of `*` het bevat."""
    bindings = await host_repo.list_bindings(ctx.session)
    own = [b for b in bindings if b.hostname != DEFAULT_HOST]
    return ThemeUsage(
        theme=theme,
        hostnames=[b.hostname for b in own if _uses(b, theme)],
        default=any(b.hostname == DEFAULT_HOST and _uses(b, theme) for b in bindings),
        bound=[b.hostname for b in own],
    )
