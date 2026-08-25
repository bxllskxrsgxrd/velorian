type IconProps = { size?: number };

export function SidebarIcon({ size = 18 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>;
}

export function SearchIcon({ size = 18 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>;
}

export function MoreIcon({ size = 18 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>;
}

export function EditIcon({ size = 18 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>;
}

export function TrashIcon({ size = 18 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>;
}

export function SettingsIcon({ size = 18 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7 2-.7Z" transform="translate(2 0) scale(.83 1)"/></svg>;
}

export function LogoutIcon({ size = 18 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></svg>;
}

export function DownloadIcon({ size = 18 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m-4-4 4 4 4-4M5 20h14"/></svg>;
}

export function UserIcon({ size = 18 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>;
}

export function ChevronIcon({ size = 16 }: IconProps) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6"/></svg>;
}
