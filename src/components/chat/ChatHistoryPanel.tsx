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
    <div className="absolute inset-y-0 left-0 w-64 bg-[#FFF5F8]/95 backdrop-blur-xl border-r border-[#FCE7F3] flex flex-col z-50 animate-in slide-in-from-left-full duration-200 text-[#1E1926]">
      <div className="p-4 border-b border-[#FCE7F3] bg-white/60 flex items-center justify-between shrink-0">
        <h3 className="font-bold text-[#1E1926] text-sm tracking-wide">Chat History</h3>
        <button onClick={onClose} className="p-1 hover:bg-pink-50 rounded-full text-[#6B7280] hover:text-[#1E1926] transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 shrink-0">
        <button
          onClick={handleNewChat}
          className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-[#F43F8E] to-[#8B5CF6] text-white hover:opacity-95 shadow-sm transition-colors flex items-center justify-center gap-2 text-sm font-bold"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 custom-scrollbar flex flex-col gap-1.5">
        {sessions.length === 0 ? (
          <div className="text-center text-[#9CA3AF] text-xs mt-10">No past conversations</div>
        ) : (
          sessions.map(session => (
            <div
              key={session.id}
              onClick={() => handleSelectChat(session)}
              className={`w-full text-left p-3 rounded-xl transition-colors cursor-pointer group relative shadow-xs ${
                activeChatId === session.id ? 'bg-[#FDF2F8] border-[#F472B6]' : 'bg-white/80 hover:bg-white border-[#FCE7F3]'
              } border`}
            >
              <div className="flex items-center gap-2 pr-6">
                <MessageSquare className={`w-4 h-4 shrink-0 ${activeChatId === session.id ? 'text-[#F43F8E]' : 'text-[#8B5CF6]'}`} />
                <span className={`text-sm truncate font-semibold ${activeChatId === session.id ? 'text-[#F43F8E]' : 'text-[#1E1926]'}`}>
                  {session.title}
                </span>
              </div>
              <div className="text-[10px] text-[#9CA3AF] mt-1 pl-6">
                {new Date(session.updatedAt).toLocaleDateString()}
              </div>

              <button
                onClick={(e) => handleDelete(e, session.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 text-[#9CA3AF] hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
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
