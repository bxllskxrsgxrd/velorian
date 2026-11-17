import { ProfilePanel } from '../components/ChatSidebar/ProfilePanel';
import type { AuthUser } from '../types/chat';

export function ProfilePage({ user }: { user: AuthUser }) {
	return <ProfilePanel user={user} />;
}
