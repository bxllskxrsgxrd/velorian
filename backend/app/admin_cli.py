import argparse
import sys

from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from .database import engine, init_database
from .roles import UserRole


class BootstrapOwnerError(RuntimeError):
	pass


def bootstrap_owner(user_id: str, database_engine: Engine | None = None) -> None:
	user_id = user_id.strip()
	if not user_id:
		raise BootstrapOwnerError("Укажите непустой ID пользователя")
	database_engine = database_engine or engine
	try:
		with database_engine.begin() as connection:
			user_exists = connection.scalar(
				text("SELECT 1 FROM users WHERE id = :user_id"),
				{"user_id": user_id},
			)
			if user_exists is None:
				raise BootstrapOwnerError(f"Пользователь с ID {user_id} не найден")
			result = connection.execute(text(
				"UPDATE users SET role = :owner_role "
				"WHERE id = :user_id "
				"AND NOT EXISTS (SELECT 1 FROM users WHERE role = :owner_role)"
			), {
				"owner_role": UserRole.OWNER.value,
				"user_id": user_id,
			})
			if result.rowcount != 1:
				raise BootstrapOwnerError(
					"Владелец уже назначен; повторная инициализация запрещена"
				)
	except IntegrityError as error:
		raise BootstrapOwnerError(
			"Владелец уже назначен или был назначен конкурентной командой"
		) from error


def _parser() -> argparse.ArgumentParser:
	parser = argparse.ArgumentParser(prog="python -m app.admin_cli")
	subcommands = parser.add_subparsers(dest="command", required=True)
	bootstrap = subcommands.add_parser(
		"bootstrap-owner",
		help="Одноразово назначить первого владельца существующему пользователю",
	)
	bootstrap.add_argument("--user-id", required=True, help="ID существующего пользователя")
	return parser


def main(argv: list[str] | None = None) -> int:
	arguments = _parser().parse_args(argv)
	if arguments.command == "bootstrap-owner":
		try:
			init_database()
			bootstrap_owner(arguments.user_id)
		except BootstrapOwnerError as error:
			print(f"Ошибка: {error}", file=sys.stderr)
			return 1
		print(f"Пользователь {arguments.user_id} назначен владельцем")
		return 0
	return 2


if __name__ == "__main__":
	raise SystemExit(main())
