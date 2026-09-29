/**
 * CodingPhase.jsx – Phase 2: Technical Coding Round (Socratic Gated IDE)
 *
 * Implements a true MAANG pre-flight gate:
 *  - Renders the Audio & Mic Hardware Verification screen BEFORE the IDE mounts.
 *  - Guarantees the 45-minute interview countdown timer does NOT start until the candidate
 *    explicitly completes hardware diagnostics and clicks "Enter Technical Coding Round".
 */

import { useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import Phase2SocraticIDE from '../components/Phase2SocraticIDE';
import AudioHardwareCheckModal from '../components/AudioHardwareCheckModal';

export default function CodingPhase() {
  const [hardwareVerified, setHardwareVerified] = useState(
    () => sessionStorage.getItem('mockpro_audio_tested_coding') === 'true'
  );

  if (!hardwareVerified) {
    return (
      <ErrorBoundary phase="Hardware Check">
        <AudioHardwareCheckModal
          isOpen={true}
          fullPage={true}
          roundName="Technical Coding Round"
          onComplete={() => {
            sessionStorage.setItem('mockpro_audio_tested_coding', 'true');
            setHardwareVerified(true);
          }}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary phase="Coding IDE">
      <Phase2SocraticIDE />
    </ErrorBoundary>
  );
}
