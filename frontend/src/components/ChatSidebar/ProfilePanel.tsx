import { useState } from 'react';
import type { AuthUser } from '../../types/chat';
import {
	CameraIcon,
	DownloadIcon,
	LockIcon,
	TrashIcon,
	UserIcon,
} from '../icons/AppIcons';
import { ProfileShell } from '../Profile/ProfileShell';
import { UnsavedChangesGuard } from './UnsavedChangesGuard';

export function ProfilePanel({ user }: { user: AuthUser }) {
	const [login, setLogin] = useState(user.login);
	const [backupEmail, setBackupEmail] = useState('');
	const isDirty = login !== user.login || backupEmail !== '';

	return (
		<>
			<ProfileShell
				section="profile"
				title="Профиль"
				description="Управляйте данными своей учётной записи"
			>
				<div className="chat-sidebar__settings-account">
					<section className="chat-sidebar__settings-group">
						<h3>Профиль</h3>
						<div className="chat-sidebar__settings-photo">
							<div className="chat-sidebar__settings-photo-avatar">
								<UserIcon aria-hidden="true" />
								<button type="button" disabled aria-label="Изменить фото профиля">
									<CameraIcon aria-hidden="true" />
								</button>
							</div>
							<div>
								<strong>Фото профиля</strong>
								<p>JPG, PNG или WEBP. Максимальный размер 5 МБ</p>
								<div className="chat-sidebar__settings-photo-actions">
									<button className="chat-sidebar__settings-button" type="button" disabled>
										<DownloadIcon aria-hidden="true" />
										Загрузить фото
									</button>
									<button
										className="chat-sidebar__settings-button chat-sidebar__settings-button--danger"
										type="button"
										disabled
									>
										<TrashIcon aria-hidden="true" />
										Удалить
									</button>
								</div>
							</div>
						</div>

						<label className="chat-sidebar__settings-input-row">
							<span>Логин</span>
							<div>
								<input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" />
								<small>Используется для отображения в интерфейсе</small>
							</div>
						</label>
						<label className="chat-sidebar__settings-input-row">
							<span>Email (основной)</span>
							<div>
								<span className="chat-sidebar__settings-locked-input">
									<input value={user.email} disabled />
									<LockIcon aria-hidden="true" />
								</span>
								<small>Этот email используется для входа в аккаунт и не может быть изменён</small>
							</div>
						</label>
						<label className="chat-sidebar__settings-input-row">
							<span>Резервная почта</span>
							<div>
								<input
									type="email"
									value={backupEmail}
									placeholder="example@mail.com"
									onChange={(event) => setBackupEmail(event.target.value)}
									autoComplete="email"
								/>
								<small>Используется для восстановления доступа к аккаунту</small>
							</div>
						</label>
						<div className="chat-sidebar__settings-save">
							<button className="chat-sidebar__settings-button chat-sidebar__settings-button--primary" type="button" disabled>
								Сохранить
							</button>
						</div>
					</section>
				</div>
			</ProfileShell>
			<UnsavedChangesGuard when={isDirty} />
		</>
	);
}
