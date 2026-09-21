import { useRef, useEffect, useState } from 'react';
import { Send, X, Mic, MicOff, PanelLeft, Sparkles, Copy, Check } from 'lucide-react';
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

const QUICK_PROMPTS = [
  { label: "✨ What can you do?", prompt: "Hello LUCY! What are your top features and skills?" },
  { label: "💡 Explain a concept", prompt: "Can you explain quantum computing in simple, fun terms?" },
  { label: "🎵 Relaxing music", prompt: "Can you recommend some calming focus music?" },
  { label: "💻 Help me code", prompt: "Can you help me write a Python script for automation?" },
];

export function Chat({ isVisible, onCloseChat, isSecondaryWindow = false }: { isVisible: boolean, onCloseChat: () => void, isSecondaryWindow?: boolean }) {
  const [showHistory, setShowHistory] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { messages, input, setInput } = useChatStore();
  const { sendText, toggleMic } = useEngineStore();
  
  const { isMicOn, isSpeaking, connectionState } = useAvatarState(useShallow(s => ({
    isMicOn: s.isMicOn,
    isSpeaking: s.isSpeaking,
    connectionState: s.connectionState,
  })));

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendText = (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query) return;
    if (isSecondaryWindow) {
      emitCrossWindow('soltini-chat-send', query);
    } else {
      sendText(query);
    }
    if (!textToSend) setInput('');
  };

  const handleToggleMic = () => {
    if (isSecondaryWindow) {
      emitCrossWindow('soltini-toggle-mic');
    } else {
      toggleMic();
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(cleanMessageText(text));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isVisible) return null;

  const content = (
    <div className={`w-full h-full bg-gradient-to-br from-[#FFF5F8] via-[#FFFFFF] to-[#FFF0F5] text-[#1E1926] flex flex-col relative overflow-hidden shadow-2xl ${isSecondaryWindow ? '' : 'rounded-[28px] border border-[#FCE7F3]'}`}>
      
      {/* Header */}
      <div className="chat-drag-handle shrink-0 px-5 py-3.5 flex items-center justify-between border-b border-[#FCE7F3] bg-white/80 backdrop-blur-md cursor-move">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowHistory(!showHistory)} 
            className="cancel-drag p-1.5 hover:bg-pink-50 rounded-xl text-[#6B7280] hover:text-[#1E1926] transition-colors pointer-events-auto" 
            title="Toggle Chat History"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          
          <div className="relative">
            <div className="w-8 h-8 rounded-full overflow-hidden border border-[#FCE7F3] shadow-xs">
              <img src="/lucy-logo.png" alt="LUCY" className="w-full h-full object-cover" />
            </div>
            <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
              connectionState === 'connected' ? 'bg-[#10B981] animate-pulse' : 'bg-[#F59E0B]'
            }`} />
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[#1E1926] font-extrabold text-sm tracking-tight">LUCY Live</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#FDF2F8] text-[#F43F8E] border border-[#FCE7F3]">AI</span>
            </div>
            <p className="text-[10px] text-[#9CA3AF] font-medium leading-none mt-0.5">
              {connectionState === 'connected' ? (isSpeaking ? 'Speaking…' : isMicOn ? 'Listening…' : 'Online & Ready') : 'Connecting to Live engine…'}
            </p>
          </div>
        </div>

        <button 
          onClick={onCloseChat} 
          className="cancel-drag p-1.5 hover:bg-pink-50 rounded-full text-[#9CA3AF] hover:text-[#1E1926] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 cancel-drag" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-[#FCE7F3] shadow-lg shadow-pink-500/10 mb-4 animate-in zoom-in-95 duration-300">
              <img src="/lucy-logo.png" alt="LUCY" className="w-full h-full object-cover" />
            </div>
            <h3 className="text-base font-extrabold text-[#1E1926] mb-1">Say hello to LUCY</h3>
            <p className="text-xs text-[#6B7280] max-w-xs mb-6">
              Your real-time multimodal AI assistant with live voice, 3D animations, and desktop automation.
            </p>

            {/* Quick Starter Prompt Chips */}
            <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
              {QUICK_PROMPTS.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendText(item.prompt)}
                  className="p-2.5 text-left bg-white hover:bg-[#FFF5F8] border border-[#FCE7F3] hover:border-[#F43F8E] rounded-xl text-xs font-medium text-[#1E1926] transition-all shadow-xs hover:shadow-sm flex items-center gap-2 cursor-pointer"
                >
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === 'user';
            const cleanText = m.role === 'model' ? cleanMessageText(m.text) : m.text;
            return (
              <div key={m.id} className={`flex items-end gap-2 group ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 border border-[#FCE7F3] shadow-xs mb-1">
                    <img src="/lucy-logo.png" alt="LUCY" className="w-full h-full object-cover" />
                  </div>
                )}
                
                <div className={`relative max-w-[82%] px-4 py-3 rounded-2xl shadow-xs transition-all ${
                  isUser
                    ? 'bg-gradient-to-r from-[#F43F8E] to-[#8B5CF6] text-white rounded-br-xs shadow-pink-500/15'
                    : 'bg-white border border-[#FCE7F3] text-[#1E1926] rounded-bl-xs'
                }`}>
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed text-[13px] text-inherit break-words">
                    {cleanText}
                  </div>
                  
                  {/* Copy Button on Model Messages */}
                  {!isUser && (
                    <button
                      onClick={() => handleCopy(m.id, m.text)}
                      className="absolute top-2 right-2 p-1 rounded-md bg-white/80 hover:bg-pink-50 text-[#9CA3AF] hover:text-[#F43F8E] transition-all opacity-0 group-hover:opacity-100 cursor-pointer border border-[#FCE7F3]"
                      title="Copy response"
                    >
                      {copiedId === m.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 shrink-0 bg-white/90 backdrop-blur-md border-t border-[#FCE7F3] cancel-drag">
        <form onSubmit={(e) => { e.preventDefault(); handleSendText(); }} className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleMic}
            title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
            className={`cancel-drag h-10 w-10 shrink-0 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
              isMicOn 
                ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/25 animate-pulse' 
                : 'bg-[#FFF5F8] text-[#6B7280] border border-[#FCE7F3] hover:bg-pink-50'
            }`}
          >
            {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={connectionState === 'connected' ? 'Ask LUCY anything…' : 'Connecting…'}
            className="flex-1 h-10 bg-[#FFF5F8] border border-[#FCE7F3] rounded-xl px-4 text-xs font-medium text-[#1E1926] placeholder-[#9CA3AF] outline-none focus:border-[#F43F8E] focus:bg-white transition-all"
          />

          <button
            type="submit"
            disabled={!input.trim() || connectionState !== 'connected'}
            className="h-10 px-4 shrink-0 rounded-xl bg-gradient-to-r from-[#F43F8E] to-[#8B5CF6] text-white text-xs font-bold flex items-center gap-1.5 hover:opacity-95 disabled:opacity-30 transition-all cursor-pointer cancel-drag shadow-md shadow-pink-500/20"
          >
            <Send className="w-3.5 h-3.5" />
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
