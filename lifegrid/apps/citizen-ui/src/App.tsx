import React, { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { AppShell } from './components/layout/AppShell';

const KisanPage = React.lazy(() => import('./kisan/KisanPage'));

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/kisan" element={<KisanPage />} />
        <Route path="/*" element={<AppShell />} />
      </Routes>
    </Suspense>
  );
}
