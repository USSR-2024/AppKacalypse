import { create } from "zustand";
import type { Me } from "./types";

const KEY = "akc_token";

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

interface AuthState {
  token: string | null;
  me: Me | null;
  setToken: (t: string) => void;
  setMe: (me: Me | null) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: readToken(),
  me: null,
  setToken: (t) => {
    window.localStorage.setItem(KEY, t);
    set({ token: t });
  },
  setMe: (me) => set({ me }),
  logout: () => {
    window.localStorage.removeItem(KEY);
    set({ token: null, me: null });
    if (typeof window !== "undefined") window.location.href = "/login";
  },
}));
