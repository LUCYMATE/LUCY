import { lazy, Suspense } from 'react';

const MainApp = lazy(() => import('./MainApp'));
const SecondaryWindow = lazy(() =>
  import('./components/layout/SecondaryWindow').then(module => ({ default: module.SecondaryWindow }))
);

export default function App() {
  const isSettings = window.location.hash.startsWith('#settings');
  return (
    <Suspense fallback={<div className="h-screen w-screen" style={{ backgroundColor: isSettings ? '#FFF5F8' : 'transparent' }} aria-label="Loading window" />}>
      {isSettings ? <SecondaryWindow /> : <MainApp />}
    </Suspense>
  );
}
