import { useRef, useEffect, useState } from 'react';
import { Send, X, Mic, MicOff, Volume2, VolumeX, Activity, PanelLeft } from 'lucide-react';
import { useChatStore } from '../../lib/store/chatStore';
import { useEngineStore } from '../../lib/store/engineStore';
import { useAvatarState } from '../../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { DraggableWindow } from '../layout/DraggableWindow';
import { ChatHistoryPanel } from './ChatHistoryPanel';

import { emitCrossWindow } from '../../lib/events/crossWindowEventBus';

const cleanMessageText = (text: string) => {
  let cleaned = text.replace(/^\[.*?\]\s*/, '');
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
  return cleaned;
};

export function Chat({ isVisible, onCloseChat, isSecondaryWindow = false }: { isVisible: boolean, onCloseChat: () => void, isSecondaryWindow?: boolean }) {
  const [showHistory, setShowHistory] = useState(false);
  const { messages, input, setInput } = useChatStore();
  const { sendText, toggleMic } = useEngineStore();
  
  const { isMicOn, connectionState } = useAvatarState(useShallow(s => ({
    isMicOn: s.isMicOn,
    connectionState: s.connectionState,
  })));

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendText = () => {
    if (!input.trim()) return;
    if (isSecondaryWindow) {
      emitCrossWindow('soltini-chat-send', input.trim());
    } else {
      sendText(input.trim());
    }
    setInput('');
  };

  const handleToggleMic = () => {
    if (isSecondaryWindow) {
      emitCrossWindow('soltini-toggle-mic');
    } else {
      toggleMic();
    }
  };

  if (!isVisible) return null;

  const content = (
    <div className={`w-full h-full bg-[#181818] flex flex-col relative overflow-hidden ${isSecondaryWindow ? '' : 'rounded-[24px] border border-white/20'}`}>
      
      {/* Header */}
          <div className="chat-drag-handle shrink-0 p-4 flex items-center justify-between border-b border-white/5 bg-black/20 cursor-move">
            <div className="flex items-center gap-2">
              <button onClick={() => setShowHistory(!showHistory)} className="cancel-drag p-1 hover:bg-white/10 rounded text-white/50 hover:text-white transition-colors pointer-events-auto mr-1" title="Toggle Chat History">
                <PanelLeft className="w-4 h-4" />
              </button>
              <div className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-blue-500 animate-pulse' : 'bg-yellow-500'}`} />
              <span className="text-white/90 font-medium text-sm tracking-wide">
                Gemini Live <span className="text-white/40 text-[10px] uppercase tracking-widest ml-1">{connectionState}</span>
              </span>
            </div>
            <button onClick={onCloseChat} className="cancel-drag p-1 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 cancel-drag" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-white/30 text-sm italic">
                No messages yet.
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`px-4 py-2.5 max-w-[85%] rounded-2xl ${m.role === 'user'
                      ? 'bg-white/10 text-white rounded-br-none'
                      : 'bg-pink-500/10 border border-pink-500/20 text-pink-50 rounded-bl-none'
                    }`}>
                    <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap leading-relaxed text-[13px]">
                      {m.role === 'model' ? cleanMessageText(m.text) : m.text}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Input Area */}
          <div className="p-3 shrink-0 bg-black/40 border-t border-white/5 cancel-drag">
            <form onSubmit={(e) => { e.preventDefault(); handleSendText(); }} className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleMic}
                title={isMicOn ? 'Mute Mic' : 'Unmute Mic'}
                className={`cancel-drag h-10 w-10 shrink-0 rounded-xl flex items-center justify-center transition-all cursor-pointer ${isMicOn ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30' : 'bg-white/5 text-white/50 border border-transparent hover:bg-white/10'}`}
              >
                {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={connectionState === 'connected' ? 'Type a message…' : 'Connecting…'}
                className="flex-1 h-10 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-white/30 outline-none focus:border-pink-500/50 transition-colors"
              />
              <button
                type="submit"
                disabled={!input.trim() || connectionState !== 'connected'}
                className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-pink-600 to-purple-600 text-white flex items-center justify-center hover:opacity-90 disabled:opacity-30 transition-all cursor-pointer cancel-drag"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

          {showHistory && <ChatHistoryPanel onClose={() => setShowHistory(false)} />}
    </div>
  );

  if (isSecondaryWindow) {
    return content;
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-[100]">
      <DraggableWindow
        defaultPosition={{ 
          x: typeof window !== 'undefined' && window.innerWidth > 400 ? window.innerWidth - 420 : 20, 
          y: 80 
        }}
        defaultSize={{ width: 400, height: 600 }}
        minWidth={300}
        minHeight={400}
        dragHandleClass="chat-drag-handle"
        cancelClass="cancel-drag"
        className="pointer-events-auto"
      >
        {content}
      </DraggableWindow>
    </div>
  );
}
