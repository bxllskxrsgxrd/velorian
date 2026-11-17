from enum import Enum


class UserRole(str, Enum):
	USER = "user"
	ADMIN = "admin"
	OWNER = "owner"


ROLE_LEVEL: dict[UserRole, int] = {
	UserRole.USER: 0,
	UserRole.ADMIN: 1,
	UserRole.OWNER: 2,
}


def parse_user_role(value: UserRole | str) -> UserRole:
	return value if isinstance(value, UserRole) else UserRole(value)


def has_minimum_role(actual: UserRole | str, required: UserRole) -> bool:
	return ROLE_LEVEL[parse_user_role(actual)] >= ROLE_LEVEL[required]
