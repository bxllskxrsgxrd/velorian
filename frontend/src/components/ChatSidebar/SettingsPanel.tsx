import { useEffect, useState, type ReactNode } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { ACCENT_THEMES, ACCENT_THEME_LABELS, type AccentTheme } from '../../theme/accentTheme';
import type { AuthUser } from '../../types/chat';
import {
	CameraIcon,
	ChevronIcon,
	DownloadIcon,
	LockIcon,
	LogoutIcon,
	PaletteIcon,
	SettingsIcon,
	TrashIcon,
	UserIcon,
} from '../icons/AppIcons';
import { CustomSelect, type CustomSelectOption } from '../ui/CustomSelect/CustomSelect';
import { ModalDialog } from '../ui/ModalDialog/ModalDialog';
import './_chatSidebar.scss';

type SettingsSection = 'general' | 'appearance' | 'account';

type SettingsPanelProps = {
	user: AuthUser;
	accentTheme: AccentTheme;
	onAccentChange: (accent: AccentTheme) => void;
};

type SettingRowProps = {
	title: string;
	description: string;
	children: ReactNode;
};

const SECTION_COPY: Record<SettingsSection, { title: string; description: string }> = {
	general: {
		title: 'Общие',
		description: 'Настройки поведения приложения и других основных параметров',
	},
	appearance: {
		title: 'Внешний вид',
		description: 'Настройте оформление и визуальное поведение интерфейса',
	},
	account: {
		title: 'Учетная запись',
		description: 'Управляйте своим профилем и настройками безопасности',
	},
};

const THEME_OPTIONS = [
	{ value: 'system', label: 'Системная' },
	{ value: 'dark', label: 'Тёмная' },
	{ value: 'light', label: 'Светлая' },
];

const CONTRAST_OPTIONS = [
	{ value: 'system', label: 'Системный' },
	{ value: 'standard', label: 'Стандартный' },
	{ value: 'high', label: 'Высокий' },
];

const LANGUAGE_OPTIONS = [
	{ value: 'auto', label: 'Автоматически определять' },
	{ value: 'ru', label: 'Русский' },
	{ value: 'en', label: 'English' },
];

const DATE_OPTIONS = [
	{ value: 'dmy', label: 'День.месяц.год (12.09.2026)' },
	{ value: 'mdy', label: 'Месяц/день/год (09/12/2026)' },
	{ value: 'ymd', label: 'Год-месяц-день (2026-09-12)' },
];

const TIMEZONE_OPTIONS = [
	{ value: 'auto', label: 'Автоматически определять' },
	{ value: 'utc', label: 'UTC' },
	{ value: 'novosibirsk', label: 'Новосибирск (UTC+7)' },
];

const ACCENT_OPTIONS: CustomSelectOption[] = ACCENT_THEMES.map((theme) => ({
	value: theme,
	label: (
		<span className="chat-sidebar__settings-accent-option">
			<span className={`chat-sidebar__settings-accent-swatch chat-sidebar__settings-accent-swatch--${theme}`} />
			{ACCENT_THEME_LABELS[theme]}
		</span>
	),
}));

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
	return (
		<button
			className="chat-sidebar__settings-switch"
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
		>
			<span />
		</button>
	);
}

function SettingRow({ title, description, children }: SettingRowProps) {
	return (
		<div className="chat-sidebar__settings-row">
			<div className="chat-sidebar__settings-row-copy">
				<strong>{title}</strong>
				<p>{description}</p>
			</div>
			<div className="chat-sidebar__settings-control">{children}</div>
		</div>
	);
}

export function SettingsPanel({ user, accentTheme, onAccentChange }: SettingsPanelProps) {
	const navigate = useNavigate();
	const location = useLocation();
	const [section, setSection] = useState<SettingsSection>('general');
	const [language, setLanguage] = useState('auto');
	const [dateFormat, setDateFormat] = useState('dmy');
	const [timezone, setTimezone] = useState('auto');
	const [openNewChat, setOpenNewChat] = useState(true);
	const [sendOnEnter, setSendOnEnter] = useState(true);
	const [showHints, setShowHints] = useState(false);
	const [theme, setTheme] = useState('system');
	const [contrast, setContrast] = useState('system');
	const [compactMode, setCompactMode] = useState(false);
	const [animations, setAnimations] = useState(true);
	const [login, setLogin] = useState(user.email.split('@')[0]);
	const [backupEmail, setBackupEmail] = useState('');
	const copy = SECTION_COPY[section];
	const returnPath = typeof location.state?.from === 'string' ? location.state.from : null;
	const isDirty =
		language !== 'auto' ||
		dateFormat !== 'dmy' ||
		timezone !== 'auto' ||
		!openNewChat ||
		!sendOnEnter ||
		showHints ||
		theme !== 'system' ||
		contrast !== 'system' ||
		compactMode ||
		!animations ||
		login !== user.email.split('@')[0] ||
		backupEmail !== '';
	const blocker = useBlocker(() => isDirty);

	useEffect(() => {
		function handleBeforeUnload(event: BeforeUnloadEvent) {
			if (!isDirty) return;
			event.preventDefault();
			event.returnValue = '';
		}

		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	}, [isDirty]);

	function handleBack() {
		if (returnPath) navigate(returnPath, { replace: true });
		else navigate('/chat/new', { replace: true });
	}

	return (
		<>
			<main className="chat-sidebar__settings-panel" aria-labelledby="chat-sidebar-settings-title">
				<aside className="chat-sidebar__settings-sidebar">
					<button className="chat-sidebar__settings-back" type="button" onClick={handleBack}>
						<ChevronIcon aria-hidden="true" />
						<span>Вернуться в приложение</span>
					</button>
					<h2>Настройки</h2>
					<nav aria-label="Разделы настроек">
						<button
							className={section === 'general' ? 'chat-sidebar__settings-nav-item--active' : undefined}
							type="button"
							aria-current={section === 'general' ? 'page' : undefined}
							onClick={() => setSection('general')}
						>
							<SettingsIcon aria-hidden="true" />
							<span>Общие</span>
						</button>
						<button
							className={section === 'appearance' ? 'chat-sidebar__settings-nav-item--active' : undefined}
							type="button"
							aria-current={section === 'appearance' ? 'page' : undefined}
							onClick={() => setSection('appearance')}
						>
							<PaletteIcon aria-hidden="true" />
							<span>Внешний вид</span>
						</button>
						<button
							className={section === 'account' ? 'chat-sidebar__settings-nav-item--active' : undefined}
							type="button"
							aria-current={section === 'account' ? 'page' : undefined}
							onClick={() => setSection('account')}
						>
							<UserIcon aria-hidden="true" />
							<span>Учетная запись</span>
						</button>
					</nav>
				</aside>

				<section className="chat-sidebar__settings-workspace">
					<header className="chat-sidebar__settings-header">
						<div>
							<h2 id="chat-sidebar-settings-title">{copy.title}</h2>
							<p>{copy.description}</p>
						</div>
					</header>

					<div className="chat-sidebar__settings-content">
						{section === 'general' && (
							<div className="chat-sidebar__settings-sections">
								<section className="chat-sidebar__settings-group">
									<h3>Язык и регион</h3>
									<SettingRow title="Язык интерфейса" description="Выберите язык, на котором будет работать приложение">
										<CustomSelect
											value={language}
											options={LANGUAGE_OPTIONS}
											onChange={setLanguage}
											ariaLabel="Язык интерфейса"
										/>
									</SettingRow>
									<SettingRow
										title="Формат даты"
										description="Используется для отображения дат в чатах, истории и файлах"
									>
										<CustomSelect
											value={dateFormat}
											options={DATE_OPTIONS}
											onChange={setDateFormat}
											ariaLabel="Формат даты"
										/>
									</SettingRow>
									<SettingRow
										title="Часовой пояс"
										description="Используется для корректного отображения времени в чате и уведомлениях"
									>
										<CustomSelect
											value={timezone}
											options={TIMEZONE_OPTIONS}
											onChange={setTimezone}
											ariaLabel="Часовой пояс"
										/>
									</SettingRow>
								</section>

								<section className="chat-sidebar__settings-group">
									<h3>Поведение приложения</h3>
									<SettingRow
										title="Открывать новый чат при запуске"
										description="Автоматически создавать новый чат при открытии Velorian"
									>
										<Toggle checked={openNewChat} onChange={setOpenNewChat} label="Открывать новый чат при запуске" />
									</SettingRow>
									<SettingRow
										title="Отправка сообщения по Enter"
										description="Отправлять сообщение в чате при нажатии клавиши Enter (вместо переноса строки)"
									>
										<Toggle checked={sendOnEnter} onChange={setSendOnEnter} label="Отправка сообщения по Enter" />
									</SettingRow>
									<SettingRow
										title="Показывать подсказки интерфейса"
										description="Отображать полезные подсказки и советы при использовании приложения"
									>
										<Toggle checked={showHints} onChange={setShowHints} label="Показывать подсказки интерфейса" />
									</SettingRow>
								</section>

								<section className="chat-sidebar__settings-group">
									<h3>Данные и хранилище</h3>
									<SettingRow
										title="Локальное хранилище"
										description="Управление данными, которые сохраняются на этом устройстве"
									>
										<button className="chat-sidebar__settings-button" type="button" disabled>
											Управление
										</button>
									</SettingRow>
									<SettingRow title="Экспорт данных" description="Скачать историю чатов, настройки и другие данные">
										<button className="chat-sidebar__settings-button" type="button" disabled>
											<DownloadIcon aria-hidden="true" />
											Экспортировать
										</button>
									</SettingRow>
									<SettingRow
										title="Очистить локальные данные"
										description="Удалить все сохранённые на этом устройстве данные (кроме учетной записи)"
									>
										<button
											className="chat-sidebar__settings-button chat-sidebar__settings-button--danger"
											type="button"
											disabled
										>
											<TrashIcon aria-hidden="true" />
											Очистить
										</button>
									</SettingRow>
								</section>
							</div>
						)}

						{section === 'appearance' && (
							<div className="chat-sidebar__settings-appearance">
								<SettingRow title="Тема" description="Выберите режим отображения интерфейса">
									<CustomSelect value={theme} options={THEME_OPTIONS} onChange={setTheme} ariaLabel="Тема" />
								</SettingRow>
								<SettingRow
									title="Акцентный цвет"
									description="Цвет активных элементов интерфейса, кнопок и переключателей"
								>
									<CustomSelect
										value={accentTheme}
										options={ACCENT_OPTIONS}
										onChange={(value) => onAccentChange(value as AccentTheme)}
										ariaLabel="Акцентный цвет"
									/>
								</SettingRow>
								<SettingRow title="Контраст" description="Настройка контрастности элементов интерфейса">
									<CustomSelect
										value={contrast}
										options={CONTRAST_OPTIONS}
										onChange={setContrast}
										ariaLabel="Контраст"
									/>
								</SettingRow>
								<SettingRow
									title="Компактный режим интерфейса"
									description="Уменьшает вертикальные отступы и делает интерфейс более плотным"
								>
									<Toggle checked={compactMode} onChange={setCompactMode} label="Компактный режим интерфейса" />
								</SettingRow>
								<SettingRow
									title="Анимации интерфейса"
									description="Показывать плавные переходы и анимации в интерфейсе"
								>
									<Toggle checked={animations} onChange={setAnimations} label="Анимации интерфейса" />
								</SettingRow>
							</div>
						)}

						{section === 'account' && (
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
										<button
											className="chat-sidebar__settings-button chat-sidebar__settings-button--primary"
											type="button"
											disabled
										>
											Сохранить
										</button>
									</div>
								</section>

								<section className="chat-sidebar__settings-group chat-sidebar__settings-security">
									<h3>Безопасность</h3>
									<p className="chat-sidebar__settings-group-description">Управляйте паролем и активными сеансами</p>
									<SettingRow title="Пароль" description="Последнее изменение: данные недоступны">
										<button className="chat-sidebar__settings-button" type="button" disabled>
											Изменить
										</button>
									</SettingRow>
									<SettingRow title="Активные сеансы" description="Количество устройств недоступно">
										<button className="chat-sidebar__settings-button" type="button" disabled>
											Управление
										</button>
									</SettingRow>
									<button
										className="chat-sidebar__settings-button chat-sidebar__settings-button--danger chat-sidebar__settings-logout-all"
										type="button"
										disabled
									>
										<LogoutIcon aria-hidden="true" />
										Выйти на всех устройствах
									</button>
									<p className="chat-sidebar__settings-session-note">Текущий сеанс останется активным</p>
								</section>
							</div>
						)}
					</div>
				</section>
			</main>
			{blocker.state === 'blocked' && (
				<ModalDialog
					title="Есть несохранённые изменения"
					confirmLabel="Выйти"
					closeLabel="Остаться"
					danger
					onClose={() => blocker.reset()}
					onConfirm={() => blocker.proceed()}
				>
					<p>Несохранённые изменения будут потеряны</p>
				</ModalDialog>
			)}
		</>
	);
}
