import { create } from 'zustand';
import type { AuthUser } from '../types/chat';

type AuthMode = 'login' | 'register';

type AuthStore = {
	user: AuthUser | null;
	isSessionLoading: boolean;
	mode: AuthMode;
	email: string;
	password: string;
	error: string;
	isSubmitting: boolean;
	setUser: (user: AuthUser | null) => void;
	setSessionLoading: (loading: boolean) => void;
	setMode: (mode: AuthMode) => void;
	toggleMode: () => void;
	setEmail: (email: string) => void;
	setPassword: (password: string) => void;
	setError: (error: string) => void;
	setSubmitting: (submitting: boolean) => void;
	resetForm: () => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
	user: null,
	isSessionLoading: true,
	mode: 'login',
	email: '',
	password: '',
	error: '',
	isSubmitting: false,
	setUser: (user) => set({ user }),
	setSessionLoading: (isSessionLoading) => set({ isSessionLoading }),
	setMode: (mode) => set({ mode }),
	toggleMode: () => set((state) => ({ mode: state.mode === 'login' ? 'register' : 'login', error: '' })),
	setEmail: (email) => set({ email }),
	setPassword: (password) => set({ password }),
	setError: (error) => set({ error }),
	setSubmitting: (isSubmitting) => set({ isSubmitting }),
	resetForm: () => set({ email: '', password: '', error: '', isSubmitting: false }),
}));
