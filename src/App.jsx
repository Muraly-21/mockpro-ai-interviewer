/**
 * App.jsx – Application shell for MOCK PRO.
 *
 * Composes:
 *  - InterviewProvider (global state)
 *  - Header (global nav — never crashes, isolated from phase errors)
 *  - PhaseRouter (routes currentPhase → phase component, each fault-isolated)
 *  - Footer
 */

import { InterviewProvider } from './context/InterviewContext';
import Header from './components/Header';
import PhaseRouter from './components/PhaseRouter';

function Footer() {
  return (
    <footer className="border-t border-white/5 py-4 px-6 text-center">
      <p className="text-xs text-gray-600">
        MOCK PRO &copy; {new Date().getFullYear()} &mdash; AI Technical Interview Simulator &mdash; Enterprise Candidate Assessment
      </p>
    </footer>
  );
}

export default function App() {
  return (
    <InterviewProvider>
      {/* Global dot-grid background */}
      <div className="fixed inset-0 dot-grid-bg pointer-events-none opacity-40 -z-10" />

      {/* App layout */}
      <div className="min-h-dvh flex flex-col">
        {/* Header is outside all ErrorBoundaries — it never crashes */}
        <Header />

        {/* Phase content — each phase is fault-isolated */}
        <PhaseRouter />

        {/* Footer */}
        <Footer />
      </div>
    </InterviewProvider>
  );
}
