import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IncidentState {
  activeIncidentId: string | null;
  reportedIncidents: string[];
  setActiveIncident: (id: string) => void;
  clearActiveIncident: () => void;
}

export const useIncidentStore = create<IncidentState>()(
  persist(
    (set) => ({
      activeIncidentId: null,
      reportedIncidents: [],

      setActiveIncident: (id) => set((state) => ({
        activeIncidentId: id,
        reportedIncidents: [...new Set([...state.reportedIncidents, id])],
      })),

      clearActiveIncident: () => set({ activeIncidentId: null }),
    }),
    { name: 'lifegrid-incidents' },
  ),
);
