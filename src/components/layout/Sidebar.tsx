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
    <div className="absolute top-8 left-0 bottom-0 w-[340px] z-[100] flex flex-col animate-in slide-in-from-left duration-300 px-2 py-1 sm:pl-3 sm:py-1">
      <div className="w-full h-full glass rounded-[20px] shadow-2xl flex flex-col overflow-hidden relative">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-pink-500/10 blur-3xl rounded-full pointer-events-none" />

        {/* Header with Toolbar */}
        <div className="flex justify-between items-center p-4 border-b border-white/5 shrink-0 relative z-10">
          <span className="text-white font-bold tracking-widest text-xs uppercase flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-pink-500 ai-glow"></div>
            History
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('soltini-clear-chat')); onClose(); }}
              className="p-1.5 rounded-lg text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Clear Current Chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('soltini-export-chat')); onClose(); }}
              className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="Export Current Chat"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="Close Menu"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-0.5 relative z-10">
          {/* New Chat Row */}
          <div 
            className="group relative flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-pink-500/10 transition-all cursor-pointer border border-pink-500/20 hover:border-pink-500/40"
            onClick={() => { window.dispatchEvent(new CustomEvent('soltini-new-chat')); onClose(); }}
          >
            <Plus className="w-3 h-3 text-pink-400 shrink-0 transition-transform group-hover:rotate-90" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-pink-400 group-hover:text-pink-300 transition-colors">New Conversation</p>
            </div>
          </div>
          
          {chats.map(chat => (
            <div 
              key={chat.id} 
              className="group relative flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/5 transition-all cursor-pointer border border-transparent hover:border-white/5"
              onClick={() => {
                if (renamingId !== chat.id) {
                  window.dispatchEvent(new CustomEvent('soltini-load-chat', { detail: chat }));
                  onClose();
                }
              }}
            >
              <MessageSquare className="w-3 h-3 text-pink-400/50 group-hover:text-pink-400 shrink-0 transition-colors" />
              
              {renamingId === chat.id ? (
                <input 
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => handleRenameSubmit(chat.id)}
                  onKeyDown={e => e.key === 'Enter' && handleRenameSubmit(chat.id)}
                  autoFocus
                  className="flex-1 bg-black/50 border border-pink-500/50 rounded-lg px-2 py-1 text-xs text-white outline-none shadow-[0_0_10px_rgba(236,72,153,0.1)]"
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/80 truncate group-hover:text-white transition-colors">{chat.title}</p>
                </div>
              )}

              {/* 3-dot menu */}
              <div 
                className="shrink-0 relative opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === chat.id ? null : chat.id); }}
              >
                <button className="p-1 rounded-md hover:bg-white/10 text-white/40 hover:text-white backdrop-blur-sm">
                  <MoreVertical className="w-3 h-3" />
                </button>

                {/* Dropdown popup */}
                {activeMenuId === chat.id && (
                  <div className="absolute right-0 top-6 w-32 glass border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[110] p-1 animate-in fade-in zoom-in-95 duration-200">
                    <button 
                      className="w-full flex items-center gap-2 px-2 py-2 text-xs text-white/80 hover:bg-white/10 hover:text-white rounded-lg transition-colors"
                      onClick={(e) => { e.stopPropagation(); setRenamingId(chat.id); setRenameValue(chat.title); setActiveMenuId(null); }}
                    >
                      <Edit2 className="w-3 h-3" /> Rename
                    </button>
                    <button 
                      className="w-full flex items-center gap-2 px-2 py-2 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 rounded-lg transition-colors mt-0.5"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (window.confirm('Delete this chat?')) {
                          chatHistory.deleteChat(chat.id); 
                        }
                        setActiveMenuId(null); 
                      }}
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {chats.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full opacity-30 mt-10">
              <MessageSquare className="w-8 h-8 mb-2 text-white" />
              <div className="text-center text-white text-xs font-medium">
                No chat history
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
