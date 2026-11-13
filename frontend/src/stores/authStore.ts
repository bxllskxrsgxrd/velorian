import { create } from 'zustand';
import type { AuthUser } from '../types/chat';

type AuthMode = 'login' | 'register';
export type AuthField = 'identifier' | 'login' | 'email' | 'password' | 'confirmPassword';
export type AuthFieldErrors = Partial<Record<AuthField, string>>;

type AuthStore = {
	user: AuthUser | null;
	isSessionLoading: boolean;
	mode: AuthMode;
	identifier: string;
	login: string;
	email: string;
	password: string;
	confirmPassword: string;
	error: string;
	fieldErrors: AuthFieldErrors;
	isSubmitting: boolean;
	setUser: (user: AuthUser | null) => void;
	setSessionLoading: (loading: boolean) => void;
	setMode: (mode: AuthMode) => void;
	toggleMode: () => void;
	setIdentifier: (identifier: string) => void;
	setLogin: (login: string) => void;
	setEmail: (email: string) => void;
	setPassword: (password: string) => void;
	setConfirmPassword: (confirmPassword: string) => void;
	setError: (error: string) => void;
	setFieldErrors: (fieldErrors: AuthFieldErrors) => void;
	setSubmitting: (submitting: boolean) => void;
	resetForm: () => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
	user: null,
	isSessionLoading: true,
	mode: 'login',
	identifier: '',
	login: '',
	email: '',
	password: '',
	confirmPassword: '',
	error: '',
	fieldErrors: {},
	isSubmitting: false,
	setUser: (user) => set({ user }),
	setSessionLoading: (isSessionLoading) => set({ isSessionLoading }),
	setMode: (mode) => set({ mode }),
	toggleMode: () => set((state) => ({ mode: state.mode === 'login' ? 'register' : 'login', error: '', fieldErrors: {} })),
	setIdentifier: (identifier) => set({ identifier }),
	setLogin: (login) => set({ login }),
	setEmail: (email) => set({ email }),
	setPassword: (password) => set({ password }),
	setConfirmPassword: (confirmPassword) => set({ confirmPassword }),
	setError: (error) => set({ error }),
	setFieldErrors: (fieldErrors) => set({ fieldErrors }),
	setSubmitting: (isSubmitting) => set({ isSubmitting }),
	resetForm: () => set({ identifier: '', login: '', email: '', password: '', confirmPassword: '', error: '', fieldErrors: {}, isSubmitting: false }),
}));
