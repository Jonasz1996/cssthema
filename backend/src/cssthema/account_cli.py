"""`cssthema-account`: lokale accounts beheren op de server (AUTH_MODE=lokaal).

    cssthema-account nieuw <e-mail> [--rol admin|editor|viewer] [--naam "Naam"]
    cssthema-account reset <e-mail>
    cssthema-account lijst
    cssthema-account uitschakelen <e-mail>
    cssthema-account inschakelen <e-mail>

`nieuw` en `reset` tonen een tijdelijk wachtwoord. Bij de eerste aanmelding kiest de
gebruiker een eigen wachtwoord en stelt MFA (opnieuw) in. Op de Debian-installatie staat dit
als /usr/local/sbin/cssthema-account (leest /etc/cssthema/cssthema.env, draai als root).
"""

import argparse
import asyncio
import sys

from cssthema.config import get_settings
from cssthema.db.models import User
from cssthema.db.models.enums import UserRole
from cssthema.db.session import create_engine, create_sessionmaker
from cssthema.services import accounts
from cssthema.services.errors import ServiceError


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cssthema-account", description="Lokale accounts van het cssthema-dashboard."
    )
    sub = parser.add_subparsers(dest="command", required=True, metavar="commando")
    new = sub.add_parser("nieuw", help="account aanmaken met een tijdelijk wachtwoord")
    new.add_argument("email")
    new.add_argument("--rol", choices=[r.value for r in UserRole], default=UserRole.ADMIN.value)
    new.add_argument("--naam", default=None, help="weergavenaam (standaard: deel voor de @)")
    reset = sub.add_parser(
        "reset", help="tijdelijk wachtwoord geven en MFA wissen (bij 'kan niet inloggen')"
    )
    reset.add_argument("email")
    sub.add_parser("lijst", help="alle lokale accounts")
    off = sub.add_parser("uitschakelen", help="account blokkeren (meldt ook af)")
    off.add_argument("email")
    on = sub.add_parser("inschakelen", help="geblokkeerd account weer toelaten")
    on.add_argument("email")
    return parser


def _print_temp(user: User, temp: str, hours: int, what: str) -> None:
    print(f"{what}: {user.email}")
    print()
    print(f"  Tijdelijk wachtwoord:  {temp}")
    print(f"  Geldig:                {hours} uur")
    print()
    print("Geef dit wachtwoord aan de gebruiker. Bij de eerste aanmelding kiest die een nieuw")
    print("wachtwoord en stelt MFA in met een authenticator-app. Alle oude sessies zijn afgemeld.")


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings()
    engine = create_engine(settings)
    maker = create_sessionmaker(engine)
    hours = settings.temp_password_hours
    try:
        async with maker() as session:
            if args.command == "nieuw":
                user, temp = await accounts.create_local(
                    session,
                    args.email,
                    role=UserRole(args.rol),
                    display_name=args.naam,
                    hours=hours,
                )
                await session.commit()
                _print_temp(user, temp, hours, "Account aangemaakt")
            elif args.command == "reset":
                user, temp = await accounts.reset_local(session, args.email, hours=hours)
                await session.commit()
                _print_temp(user, temp, hours, "Account gereset")
            elif args.command == "lijst":
                users = await accounts.list_local(session)
                if not users:
                    print(
                        "Nog geen lokale accounts. Maak er een met: cssthema-account nieuw <e-mail>"
                    )
                for user in users:
                    mfa = "MFA aan" if user.totp_secret else "MFA nog instellen"
                    flags = [user.role.value, mfa]
                    if user.must_change_password:
                        flags.append("tijdelijk wachtwoord")
                    if not user.is_active:
                        flags.append("UITGESCHAKELD")
                    print(f"{user.email}  ({', '.join(flags)})")
            else:
                active = args.command == "inschakelen"
                user = await accounts.set_active(session, args.email, active)
                await session.commit()
                print(f"{user.email}: {'ingeschakeld' if active else 'uitgeschakeld'}")
            if settings.auth_mode != "lokaal" and args.command in {"nieuw", "reset"}:
                print()
                print(
                    "Let op: AUTH_MODE staat niet op lokaal; het dashboard vraagt nog geen login."
                )
    except ServiceError as exc:
        print(
            f"cssthema-account: {exc.title}" + (f" ({exc.detail})" if exc.detail else ""),
            file=sys.stderr,
        )
        return 1
    finally:
        await engine.dispose()
    return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_run(_parser().parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
