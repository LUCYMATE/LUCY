import { X, Trash2, Download, Plus, MessageSquare, MoreVertical, Edit2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { chatHistory, ChatSession } from '../../lib/store/chatHistory';

export function Sidebar({ onClose }: { onClose: () => void }) {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    const unsub = chatHistory.subscribe(setChats);
    return () => { unsub(); };
  }, []);

  const handleRenameSubmit = (id: string) => {
    if (renameValue.trim()) {
      chatHistory.renameChat(id, renameValue.trim());
    }
    setRenamingId(null);
  };

  return (
    <div className="absolute top-12 left-4 bottom-4 w-80 z-[100] flex flex-col animate-in slide-in-from-left duration-300">
      <div className="w-full h-full glass rounded-3xl border border-white/10 shadow-2xl flex flex-col overflow-hidden relative">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-pink-500/10 blur-3xl rounded-full pointer-events-none" />

        {/* Header */}
        <div className="flex justify-between items-center p-6 pb-4 shrink-0 relative z-10">
          <span className="text-white font-bold tracking-widest text-sm uppercase flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-pink-500 ai-glow"></div>
            Chat History
          </span>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-all cursor-pointer backdrop-blur-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-6 pb-4 shrink-0 relative z-10">
          <button
            onClick={() => { window.dispatchEvent(new CustomEvent('syra-new-chat')); onClose(); }}
            className="group flex items-center justify-center gap-2 w-full py-3 px-4 bg-gradient-to-r from-pink-500/20 to-purple-500/20 hover:from-pink-500/30 hover:to-purple-500/30 text-white rounded-2xl transition-all border border-pink-500/20 hover:border-pink-500/40 cursor-pointer font-medium shadow-[0_0_20px_rgba(236,72,153,0.1)] hover:shadow-[0_0_30px_rgba(236,72,153,0.2)]"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
            New Conversation
          </button>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-1.5 relative z-10">
          {chats.map(chat => (
            <div 
              key={chat.id} 
              className="group relative flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-black/20 hover:bg-white/10 transition-all cursor-pointer border border-transparent hover:border-white/5"
              onClick={() => {
                if (renamingId !== chat.id) {
                  window.dispatchEvent(new CustomEvent('syra-load-chat', { detail: chat }));
                  onClose();
                }
              }}
            >
              <MessageSquare className="w-4 h-4 text-pink-400/50 group-hover:text-pink-400 shrink-0 transition-colors" />
              
              {renamingId === chat.id ? (
                <input 
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => handleRenameSubmit(chat.id)}
                  onKeyDown={e => e.key === 'Enter' && handleRenameSubmit(chat.id)}
                  autoFocus
                  className="flex-1 bg-black/50 border border-pink-500/50 rounded-lg px-2 py-1.5 text-sm text-white outline-none shadow-[0_0_10px_rgba(236,72,153,0.1)]"
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/90 truncate group-hover:text-white transition-colors">{chat.title}</p>
                  <p className="text-[10px] text-white/30 group-hover:text-white/50 mt-0.5 transition-colors">{new Date(chat.updatedAt).toLocaleDateString()} {new Date(chat.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                </div>
              )}

              {/* 3-dot menu */}
              <div 
                className="shrink-0 relative opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === chat.id ? null : chat.id); }}
              >
                <button className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white backdrop-blur-sm">
                  <MoreVertical className="w-4 h-4" />
                </button>

                {/* Dropdown popup */}
                {activeMenuId === chat.id && (
                  <div className="absolute right-0 top-10 w-36 glass border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[110] p-1 animate-in fade-in zoom-in-95 duration-200">
                    <button 
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-white/80 hover:bg-white/10 hover:text-white rounded-lg transition-colors"
                      onClick={(e) => { e.stopPropagation(); setRenamingId(chat.id); setRenameValue(chat.title); setActiveMenuId(null); }}
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Rename
                    </button>
                    <button 
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 rounded-lg transition-colors mt-0.5"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (window.confirm('Delete this chat?')) {
                          chatHistory.deleteChat(chat.id); 
                          window.dispatchEvent(new CustomEvent('syra-chat-deleted', { detail: { id: chat.id } }));
                        }
                        setActiveMenuId(null); 
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {chats.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full opacity-30 mt-10">
              <MessageSquare className="w-12 h-12 mb-3 text-white" />
              <div className="text-center text-white text-xs font-medium">
                No chat history yet
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/5 flex flex-col gap-2 shrink-0 bg-black/10 relative z-10">
          <button
            onClick={() => { window.dispatchEvent(new CustomEvent('syra-clear-chat')); onClose(); }}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-medium text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer w-full"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Current Chat
          </button>
          <button
            onClick={() => { window.dispatchEvent(new CustomEvent('syra-export-chat')); onClose(); }}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-medium text-white/40 hover:text-white hover:bg-white/10 transition-all cursor-pointer w-full"
          >
            <Download className="w-3.5 h-3.5" />
            Export Current Chat
          </button>
        </div>
      </div>
    </div>
  );
}
