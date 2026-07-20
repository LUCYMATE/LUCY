import { useShallow } from 'zustand/react/shallow';
import { useAvatarState } from '../../lib/store/avatarState';
import { useEngineStore } from '../../lib/store/engineStore';

export function SystemIndicators() {
  const { isToolAgentRunning, connectionState, isMicOn } = useAvatarState(useShallow(s => ({
    isToolAgentRunning: s.isToolAgentRunning,
    connectionState: s.connectionState,
    isMicOn: s.isMicOn,
  })));

  const { initSystem, toggleMic } = useEngineStore();

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[200] pointer-events-auto flex flex-row items-center gap-[7px]">
      
      {/* Agent Status (Purple Dot) */}
      {isToolAgentRunning && (
        <div className="flex items-center" title="Agent is working...">
          <div className="relative flex items-center justify-center">
            <div className="absolute w-1.5 h-1.5 rounded-full bg-purple-500 animate-ping opacity-60"></div>
            <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
          </div>
        </div>
      )}

      {/* Connection Status (Green/Yellow/Red/Blue Dot) */}
      <div 
        className={`flex items-center ${['idle', 'disconnected', 'error'].includes(connectionState) ? 'cursor-pointer hover:scale-110' : ''}`}
        title={['idle', 'disconnected', 'error'].includes(connectionState) ? "Click to Connect to Gemini" : "Connection Status"}
        onClick={() => {
          if (['idle', 'disconnected', 'error'].includes(connectionState)) initSystem();
        }}
      >
        <div className="relative flex items-center justify-center">
          {connectionState === 'connected' && (
            <>
              <div className="absolute w-1.5 h-1.5 rounded-full bg-green-500 animate-ping opacity-60"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
            </>
          )}
          {connectionState === 'connecting' && (
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></div>
          )}

          {/* The Red Bouncing Disconnect Dot */}
          {['disconnected', 'error'].includes(connectionState) && (
            <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)] animate-bounce"></div>
          )}
        </div>
      </div>

      {/* Mic Status (Pink/Grey Dot) */}
      <div 
        className="flex items-center cursor-pointer hover:scale-110 transition-transform"
        title={isMicOn ? "Microphone ON - Click to Mute" : "Microphone OFF - Click to Listen"}
        onClick={toggleMic}
      >
        <div className="relative flex items-center justify-center">
          {isMicOn ? (
            <>
              <div className="absolute w-1.5 h-1.5 rounded-full bg-pink-500 animate-ping opacity-60"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-pink-400"></div>
            </>
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
          )}
        </div>
      </div>

    </div>
  );
}
