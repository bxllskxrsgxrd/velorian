import { useState } from 'react';
import { ACCENT_THEMES, ACCENT_THEME_LABELS, type AccentTheme } from '../../theme/accentTheme';
import type { ContrastPreference, ThemePreference } from '../../theme/appearanceSettings';
import {
	DownloadIcon,
	PaletteIcon,
	SettingsIcon,
	TrashIcon,
} from '../icons/AppIcons';
import { CustomSelect, type CustomSelectOption } from '../ui/CustomSelect/CustomSelect';
import { SettingRow, SettingsToggle } from './SettingsControls';
import { SettingsShell } from './SettingsShell';
import { UnsavedChangesGuard } from './UnsavedChangesGuard';
import './_chatSidebar.scss';

type SettingsSection = 'general' | 'appearance';

type SettingsPanelProps = {
	accentTheme: AccentTheme;
	theme: ThemePreference;
	contrast: ContrastPreference;
	compactMode: boolean;
	animations: boolean;
	onAccentChange: (accent: AccentTheme) => void;
	onThemeChange: (theme: ThemePreference) => void;
	onContrastChange: (contrast: ContrastPreference) => void;
	onCompactModeChange: (compactMode: boolean) => void;
	onAnimationsChange: (animations: boolean) => void;
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

export function SettingsPanel({
	accentTheme,
	theme,
	contrast,
	compactMode,
	animations,
	onAccentChange,
	onThemeChange,
	onContrastChange,
	onCompactModeChange,
	onAnimationsChange,
}: SettingsPanelProps) {
	const [section, setSection] = useState<SettingsSection>('general');
	const [language, setLanguage] = useState('auto');
	const [dateFormat, setDateFormat] = useState('dmy');
	const [timezone, setTimezone] = useState('auto');
	const [openNewChat, setOpenNewChat] = useState(true);
	const [sendOnEnter, setSendOnEnter] = useState(true);
	const [showHints, setShowHints] = useState(false);
	const copy = SECTION_COPY[section];
	const isDirty =
		language !== 'auto' ||
		dateFormat !== 'dmy' ||
		timezone !== 'auto' ||
		!openNewChat ||
		!sendOnEnter ||
		showHints;

	return (
		<>
			<SettingsShell
				sidebarTitle="Настройки"
				title={copy.title}
				description={copy.description}
				titleId="chat-sidebar-settings-title"
				navigation={(
					<>
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
					</>
				)}
			>
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
										<SettingsToggle checked={openNewChat} onChange={setOpenNewChat} label="Открывать новый чат при запуске" />
									</SettingRow>
									<SettingRow
										title="Отправка сообщения по Enter"
										description="Отправлять сообщение в чате при нажатии клавиши Enter (вместо переноса строки)"
									>
										<SettingsToggle checked={sendOnEnter} onChange={setSendOnEnter} label="Отправка сообщения по Enter" />
									</SettingRow>
									<SettingRow
										title="Показывать подсказки интерфейса"
										description="Отображать полезные подсказки и советы при использовании приложения"
									>
										<SettingsToggle checked={showHints} onChange={setShowHints} label="Показывать подсказки интерфейса" />
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
									<CustomSelect
										value={theme}
										options={THEME_OPTIONS}
										onChange={(value) => onThemeChange(value as ThemePreference)}
										ariaLabel="Тема"
									/>
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
										onChange={(value) => onContrastChange(value as ContrastPreference)}
										ariaLabel="Контраст"
									/>
								</SettingRow>
								<SettingRow
									title="Компактный режим интерфейса"
									description="Уменьшает вертикальные отступы и делает интерфейс более плотным"
								>
									<SettingsToggle checked={compactMode} onChange={onCompactModeChange} label="Компактный режим интерфейса" />
								</SettingRow>
								<SettingRow
									title="Анимации интерфейса"
									description="Показывать плавные переходы и анимации в интерфейсе"
								>
									<SettingsToggle checked={animations} onChange={onAnimationsChange} label="Анимации интерфейса" />
								</SettingRow>
							</div>
						)}
			</SettingsShell>
			<UnsavedChangesGuard when={isDirty} />
		</>
	);
}
