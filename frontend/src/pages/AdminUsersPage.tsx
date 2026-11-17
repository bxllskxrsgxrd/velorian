import { useEffect, useState, type FormEvent } from 'react';
import { listAdminUsers, updateAdminUserRole } from '../api/adminApi';
import { AdminShell } from '../components/Admin/AdminShell';
import { ModalDialog } from '../components/ui/ModalDialog/ModalDialog';
import { Button } from '../components/ui/Button/Button';
import { RoleBadge } from '../components/RoleBadge/RoleBadge';
import { useToast } from '../hooks/useToast';
import type { AdminUser, AdminUsersResult, AuthUser } from '../types/chat';
import { reportError } from '../utils/reportError';
import './_adminUsersPage.scss';

type PendingRoleChange = {
	user: AdminUser;
	nextRole: 'user' | 'admin';
};

const PAGE_SIZE = 20;

export function AdminUsersPage({ currentUser }: { currentUser: AuthUser }) {
	const [query, setQuery] = useState('');
	const [search, setSearch] = useState('');
	const [page, setPage] = useState(1);
	const [reloadKey, setReloadKey] = useState(0);
	const [result, setResult] = useState<AdminUsersResult | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [mutationError, setMutationError] = useState<string | null>(null);
	const [pendingChange, setPendingChange] = useState<PendingRoleChange | null>(null);
	const [updating, setUpdating] = useState(false);
	const { showToast } = useToast();

	useEffect(() => {
		let active = true;
		setLoading(true);
		setLoadError(false);
		listAdminUsers({ search, page, pageSize: PAGE_SIZE })
			.then((response) => {
				if (active) setResult(response);
			})
			.catch((error: unknown) => {
				if (!active) return;
				setLoadError(true);
				reportError('ADMIN_USERS_LOAD_FAILED', error, { search, page });
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => { active = false; };
	}, [page, reloadKey, search]);

	function handleSearch(event: FormEvent) {
		event.preventDefault();
		setPage(1);
		setSearch(query.trim());
	}

	async function confirmRoleChange() {
		if (!pendingChange) return;
		setUpdating(true);
		setMutationError(null);
		try {
			const response = await updateAdminUserRole(pendingChange.user.id, pendingChange.nextRole);
			setResult((current) => current ? {
				...current,
				users: current.users.map((user) => user.id === response.user.id ? response.user : user),
			} : current);
			setPendingChange(null);
			showToast(
				pendingChange.nextRole === 'admin'
					? `Пользователь ${pendingChange.user.login} назначен администратором`
					: `Права администратора для ${pendingChange.user.login} сняты`,
				'success',
			);
		} catch (error) {
			setMutationError('Не удалось изменить роль пользователя. Повторите попытку.');
			showToast('Не удалось изменить роль пользователя', 'error');
			reportError('ADMIN_USER_ROLE_UPDATE_FAILED', error, { targetUserId: pendingChange.user.id });
		} finally {
			setUpdating(false);
		}
	}

	return (
		<AdminShell
			section="users"
			title="Пользователи"
			description="Поиск пользователей и управление правами администраторов"
		>
			<div className="admin-users">
				<form className="admin-users__search" role="search" onSubmit={handleSearch}>
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Логин или email"
						aria-label="Поиск пользователей по логину или email"
					/>
					<Button type="submit" variant="filled" tone="accent">Найти</Button>
				</form>

				{mutationError && <p className="admin-users__error" role="alert">{mutationError}</p>}
				{loading && <p className="admin-users__state" role="status">Загрузка пользователей…</p>}
				{!loading && loadError && (
					<div className="admin-users__state admin-users__state--error" role="alert">
						<p>Не удалось загрузить пользователей.</p>
						<Button variant="outline" onClick={() => setReloadKey((value) => value + 1)}>Повторить</Button>
					</div>
				)}
				{!loading && !loadError && result?.users.length === 0 && (
					<p className="admin-users__state">Пользователи не найдены</p>
				)}
				{!loading && !loadError && result && result.users.length > 0 && (
					<>
						<div className="admin-users__table-wrap">
							<table className="admin-users__table">
								<thead>
									<tr><th>Логин</th><th>Email</th><th>Роль</th>{currentUser.role === 'owner' && <th>Действие</th>}</tr>
								</thead>
								<tbody>
									{result.users.map((user) => {
										const nextRole = user.role === 'admin' ? 'user' : 'admin';
										return (
											<tr key={user.id}>
												<td data-label="Логин"><strong>{user.login}</strong></td>
												<td data-label="Email">{user.email}</td>
												<td data-label="Роль"><RoleBadge role={user.role} /></td>
												{currentUser.role === 'owner' && (
													<td data-label="Действие">
														{user.role === 'owner' ? (
															<span className="admin-users__protected">Роль владельца защищена</span>
														) : (
															<Button
																variant="outline"
																tone={nextRole === 'user' ? 'danger' : 'accent'}
																size="small"
																onClick={() => setPendingChange({ user, nextRole })}
															>
																{nextRole === 'admin' ? 'Назначить администратором' : 'Снять права администратора'}
															</Button>
														)}
													</td>
												)}
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
						<div className="admin-users__pagination" aria-label="Пагинация пользователей">
							<Button variant="outline" disabled={result.page <= 1} onClick={() => setPage((value) => value - 1)}>Назад</Button>
							<span>Страница {result.page} из {Math.max(result.totalPages, 1)}</span>
							<Button variant="outline" disabled={result.page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>Вперёд</Button>
						</div>
					</>
				)}
			</div>

			{pendingChange && (
				<ModalDialog
					title={pendingChange.nextRole === 'admin' ? 'Назначить администратора?' : 'Снять права администратора?'}
					confirmLabel={pendingChange.nextRole === 'admin' ? 'Назначить' : 'Снять права'}
					danger={pendingChange.nextRole === 'user'}
					confirmDisabled={updating}
					closeDisabled={updating}
					onClose={() => setPendingChange(null)}
					onConfirm={() => void confirmRoleChange()}
				>
					<p>Пользователь: <strong>{pendingChange.user.login}</strong></p>
				</ModalDialog>
			)}
		</AdminShell>
	);
}
