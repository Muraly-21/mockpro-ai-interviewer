/**
 * PhaseRouter.jsx – Renders the correct phase component based on currentPhase.
 * Each phase is wrapped in its own ErrorBoundary for fault isolation.
 */

import ErrorBoundary from './ErrorBoundary';
import { useInterview, PHASES, PHASE_LABELS } from '../context/InterviewContext';

// Phase placeholder components (will be replaced by actual modules in subsequent builds)
import SetupPhase     from '../phases/SetupPhase';
import AptitudePhase  from '../phases/AptitudePhase';
import CodingPhase    from '../phases/CodingPhase';
import VoicePhase     from '../phases/VoicePhase';
import ScorecardPhase from '../phases/ScorecardPhase';

const PHASE_COMPONENTS = [
  SetupPhase,
  AptitudePhase,
  CodingPhase,
  VoicePhase,
  ScorecardPhase,
];

export default function PhaseRouter() {
  const { currentPhase } = useInterview();
  const ActivePhase = PHASE_COMPONENTS[currentPhase] ?? SetupPhase;
  const label = PHASE_LABELS[currentPhase] ?? 'Phase';

  return (
    <main id="phase-content" className="flex-1 min-h-0">
      <ErrorBoundary phase={label} key={currentPhase}>
        <ActivePhase />
      </ErrorBoundary>
    </main>
  );
}
