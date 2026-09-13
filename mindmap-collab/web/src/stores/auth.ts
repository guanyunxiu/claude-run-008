import { create } from 'zustand';
import { api } from '../api/client';

export interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
  loadMe: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  token: localStorage.getItem('token'),
  user: null,

  async login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    set({ token: data.token, user: data.user });
  },

  async register(email, name, password) {
    const { data } = await api.post('/auth/register', { email, name, password });
    localStorage.setItem('token', data.token);
    set({ token: data.token, user: data.user });
  },

  logout() {
    localStorage.removeItem('token');
    set({ token: null, user: null });
  },

  async loadMe() {
    if (!localStorage.getItem('token')) return;
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data });
    } catch {
      /* token 失效时拦截器会跳转登录页 */
    }
  },
}));
