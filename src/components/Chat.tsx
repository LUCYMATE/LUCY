import { useState, useRef, useEffect } from 'react';
import { Send, Activity, Mic, MicOff } from 'lucide-react';
import { Myra3D } from './Myra3D';

type Role = 'user' | 'model';
interface Message {
  id: string;
  role: Role;
  text?: string;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'model', text: 'System ready. I am Myra. How can I assist you?' }
  ]);
  const [input, setInput] = useState('');
  
  const [initialized, setInitialized] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const initSystem = () => {
    setInitialized(true);
  };

  const toggleMic = () => {
    setIsListening(!isListening);
  };

  const handleSendText = () => {
    if (!input.trim()) return;
    
    // Add user message
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text: input.trim() }]);
    setInput('');
    
    // Simulate thinking then speaking
    setIsThinking(true);
    
    setTimeout(() => {
      setIsThinking(false);
      setIsSpeaking(true);
      
      const dummyResponses = [
        "That's an interesting perspective. I'm analyzing the data now.",
        "I can certainly help you with that. The systems are functioning nominally.",
        "Processing your request. Please stand by while I gather the information.",
        "As an autonomous intelligence core, my primary function is to assist you.",
        "I've updated my parameters based on your input."
      ];
      const randomResponse = dummyResponses[Math.floor(Math.random() * dummyResponses.length)];
      
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: randomResponse }]);
      
      // Stop speaking after 3 seconds
      setTimeout(() => {
        setIsSpeaking(false);
      }, 3000);
      
    }, 1500);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-transparent">
      {!initialized ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-1000">
          <div className="w-32 h-32 rounded-full bg-pink-500/10 flex items-center justify-center mb-8 relative">
             <div className="absolute inset-0 bg-pink-500/20 blur-xl rounded-full ai-glow animate-pulse"></div>
             <Activity className="w-12 h-12 text-pink-500 relative z-10" />
          </div>
          <h2 className="text-3xl font-bold tracking-widest uppercase mb-4 text-white">System Myra</h2>
          <p className="text-white/50 max-w-md mb-12">
             Autonomous intelligence core. UI Template mode.
          </p>
          <button
             onClick={initSystem}
             className="px-12 h-16 rounded-3xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold tracking-[0.2em] transform hover:scale-105 transition-all shadow-[0_0_40px_rgba(244,63,94,0.4)]"
          >
             INITIALIZE CORE
          </button>
        </div>
      ) : (
        <>
          {/* Top Status */}
          <div className="shrink-0 p-4 flex justify-end items-center gap-4 border-b border-white/5">
            <div className="flex items-center gap-2 text-xs font-mono text-pink-400">
               <Activity className="w-4 h-4 animate-pulse" />
               UI TEMPLATE MODE
            </div>
          </div>

          {/* Chat Container */}
          <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* 3D View Background Overlay */}
            <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center">
                <Myra3D isSpeaking={isSpeaking} isThinking={isThinking} isListening={isListening} />
            </div>

            {/* Messaging Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 z-10 relative pointer-events-auto" ref={scrollRef}>
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] rounded-2xl px-5 py-3 ${m.role === 'user' ? 'bg-white/10 text-white rounded-br-none backdrop-blur-md' : 'bg-pink-500/10 border border-pink-500/20 text-pink-50 rounded-bl-none backdrop-blur-md'}`}>
                   {m.text && (
                     <div className="prose prose-invert prose-sm max-w-none">
                       {m.text}
                     </div>
                   )}
                </div>
              </div>
            ))}
              {isThinking && (
                 <div className="w-6 h-6 rounded-full border-t-2 border-r-2 border-pink-500 animate-spin ai-glow ml-4"></div>
              )}
            </div>

            {/* Input Dock */}
            <div className="p-6 shrink-0 z-10 relative">
              <form onSubmit={(e) => { e.preventDefault(); handleSendText(); }} className="flex items-center gap-4 w-full">
                {/* Mic Toggle */}
                <button
                  type="button"
                  onClick={toggleMic}
                  title={isListening ? 'Stop microphone' : 'Start microphone'}
                  className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border transition-all ${
                    isListening
                      ? 'bg-pink-600/30 border-pink-500 text-pink-400 shadow-[0_0_16px_rgba(236,72,153,0.4)]'
                      : 'bg-black/40 border-white/10 text-white/40 hover:border-white/30 hover:text-white/70'
                  }`}
                >
                  {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>

                <div className="flex-1 bg-black/40 backdrop-blur-lg border border-white/10 rounded-2xl h-14 flex items-center px-4 gap-4">
                   <input
                     type="text"
                     value={input}
                     onChange={(e) => setInput(e.target.value)}
                     placeholder="Type a message to test animations..."
                     className="bg-transparent border-none outline-none w-full text-white placeholder-white/20 font-light"
                   />
                   <button
                     type="submit"
                     disabled={isThinking || !input.trim()}
                     className="h-10 px-6 shrink-0 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold text-sm tracking-wide hover:opacity-90 transition-opacity disabled:opacity-50"
                   >
                     SEND
                   </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
