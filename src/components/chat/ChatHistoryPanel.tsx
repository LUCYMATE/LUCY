import { useEffect, useState } from 'react';
import { Plus, MessageSquare, Trash2, X } from 'lucide-react';
import { chatHistory, ChatSession } from '../../lib/store/chatHistory';
import { useChatStore } from '../../lib/store/chatStore';

export function ChatHistoryPanel({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const { activeChatId, setMessages, setActiveChatId, resetMessages } = useChatStore();

  useEffect(() => {
    // Initial load
    setSessions(chatHistory.getChats());
    
    // Subscribe to changes
    const unsubscribe = chatHistory.subscribe((newChats) => {
      setSessions(newChats);
    });
    return () => { unsubscribe(); };
  }, []);

  const handleNewChat = () => {
    resetMessages();
    onClose();
  };

  const handleSelectChat = (session: ChatSession) => {
    setActiveChatId(session.id);
    setMessages(session.messages);
    onClose();
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    chatHistory.deleteChat(id);
    if (activeChatId === id) {
      resetMessages();
    }
  };

  return (
    <div className="absolute inset-y-0 left-0 w-64 bg-black/90 backdrop-blur-xl border-r border-white/10 flex flex-col z-50 animate-in slide-in-from-left-full duration-200">
      <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <h3 className="font-medium text-white/90 text-sm tracking-wide">Chat History</h3>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 shrink-0">
        <button
          onClick={handleNewChat}
          className="w-full py-2 px-3 rounded-lg bg-pink-500/20 text-pink-400 hover:bg-pink-500/30 border border-pink-500/30 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 custom-scrollbar flex flex-col gap-1">
        {sessions.length === 0 ? (
          <div className="text-center text-white/30 text-xs mt-10">No past conversations</div>
        ) : (
          sessions.map(session => (
            <div
              key={session.id}
              onClick={() => handleSelectChat(session)}
              className={`w-full text-left p-3 rounded-lg transition-colors cursor-pointer group relative ${
                activeChatId === session.id ? 'bg-white/10 border-white/10' : 'hover:bg-white/5 border-transparent'
              } border`}
            >
              <div className="flex items-center gap-2 pr-6">
                <MessageSquare className={`w-4 h-4 shrink-0 ${activeChatId === session.id ? 'text-pink-400' : 'text-white/40 group-hover:text-white/60'}`} />
                <span className={`text-sm truncate font-medium ${activeChatId === session.id ? 'text-white' : 'text-white/70 group-hover:text-white/90'}`}>
                  {session.title}
                </span>
              </div>
              <div className="text-[10px] text-white/30 mt-1 pl-6">
                {new Date(session.updatedAt).toLocaleDateString()}
              </div>

              <button
                onClick={(e) => handleDelete(e, session.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 hover:bg-red-400/20 rounded transition-all"
                title="Delete Chat"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
