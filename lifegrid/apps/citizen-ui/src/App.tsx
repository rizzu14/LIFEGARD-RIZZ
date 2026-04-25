import React, { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { AppShell } from './components/layout/AppShell';

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* All tabs handled inside AppShell */}
        <Route path="/*" element={<AppShell />} />
      </Routes>
    </Suspense>
  );
}
