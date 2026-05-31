/**
 * Zustand store — client-side state for the (app) route group.
 * Phase 1: minimal user/session slice. Extend as auth + features land.
 */
import { create } from "zustand";

interface User {
  id: string;
  email: string;
  name: string;
}

interface AppState {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  isLoading: false,
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading }),
}));
