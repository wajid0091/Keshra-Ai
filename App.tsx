import React, { useState, useRef, useEffect } from 'react';
import { useWAI } from './hooks/useWAI';
import ArcReactor from './components/ArcReactor';
import { ConnectionState } from './types';
import { 
  Mic, Send, Search, Image as ImageIcon, ShieldCheck, 
  EyeOff, Eye, Plus, MessageSquare, Trash2, Menu, X, Sparkles, 
  MapPin, Globe, Code, Zap, Settings, Moon, Sun, Copy, Check, Youtube, Mail, ExternalLink as LinkIcon, Download, Paperclip, Cpu, Loader2
} from 'lucide-react';

const App: React.FC = () => {
  const { 
    messages, sessions, activeSessionId, setActiveSessionId, createNewChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, isGeneratingImage, connect, disconnect, sendTextMessage 
  } = useWAI();

  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ data: string, mimeType: string, preview: string } | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showChatUI, setShowChatUI] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({});
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showChatUI) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showChatUI]);

  const handleSend = () => {
    if (!inputText.trim() && !selectedImage) return;
    sendTextMessage(inputText, selectedImage ? { data: selectedImage.data, mimeType: selectedImage.mimeType } : undefined);
    setInputText('');
    setSelectedImage(null);
    setShowChatUI(true);
    const ta = document.querySelector('textarea');
    if (ta) ta.style.height = 'auto';
  };

  const toggleVoice = () => connectionState === ConnectionState.CONNECTED ? disconnect() : connect();

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopyStatus({ ...copyStatus, [id]: true });
    setTimeout(() => setCopyStatus({ ...copyStatus, [id]: false }), 2000);
  };

  const isRTL = (text: string) => /[\u0600-\u06FF]/.test(text);

  const renderContent = (content: string, messageId: string) => {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    const processText = (text: string, baseKey: string) => {
      let cleanText = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/###\s*(.*)/g, '<h3 class="font-black text-cyan-600 mt-2">$1</h3>');
      const urlRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
      const elements: React.ReactNode[] = [];
      let cursor = 0;
      let m;
      while ((m = urlRegex.exec(cleanText)) !== null) {
        if (m.index > cursor) elements.push(<span key={`${baseKey}-${cursor}`} dangerouslySetInnerHTML={{ __html: cleanText.substring(cursor, m.index).replace(/\n/g, '<br/>') }} />);
        elements.push(<a key={`${baseKey}-l-${m.index}`} href={m[2] || m[3]} target="_blank" rel="noopener" className="text-cyan-600 hover:text-cyan-700 underline font-black inline-flex items-center gap-1 mx-1">{m[1] || m[3]} <LinkIcon className="w-3 h-3" /></a>);
        cursor = urlRegex.lastIndex;
      }
      if (cursor < cleanText.length) elements.push(<span key={`${baseKey}-e-${cursor}`} dangerouslySetInnerHTML={{ __html: cleanText.substring(cursor).replace(/\n/g, '<br/>') }} />);
      return elements;
    };

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) parts.push(<span key={`t-${lastIndex}`}>{processText(content.substring(lastIndex, match.index), `txt-${lastIndex}`)}</span>);
      const code = match[2].trim();
      const blockId = `${messageId}-${match.index}`;
      parts.push(
        <div key={blockId} className="my-4 rounded-xl overflow-hidden border border-slate-200 bg-slate-900 text-slate-100 shadow-lg w-full">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 text-[10px] font-black uppercase text-slate-400">
            <span>{match[1] || 'code'}</span>
            <button onClick={() => handleCopy(code, blockId)} className="flex items-center gap-1 hover:text-white px-2 py-1 rounded bg-white/5">{copyStatus[blockId] ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />} {copyStatus[blockId] ? 'Copied' : 'Copy'}</button>
          </div>
          <pre className="p-4 overflow-x-auto text-[11px] font-mono leading-relaxed bg-slate-900 scrollbar-hide"><code>{code}</code></pre>
        </div>
      );
      lastIndex = codeBlockRegex.lastIndex;
    }
    if (lastIndex < content.length) parts.push(<span key={`t-${lastIndex}`}>{processText(content.substring(lastIndex), `txt-${lastIndex}`)}</span>);
    return parts.length > 0 ? parts : processText(content, 'p');
  };

  const sidebarBg = theme === 'dark' ? 'bg-[#121214]' : 'bg-white';
  const borderCol = theme === 'dark' ? 'border-white/5' : 'border-slate-100';

  return (
    <div className={`flex h-screen ${theme === 'dark' ? 'bg-[#09090b] text-white' : 'bg-slate-50 text-slate-900'} font-sans overflow-hidden transition-colors duration-300 text-[13px]`}>
      
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 ${sidebarBg} ${borderCol} border-r shadow-2xl lg:shadow-none transform transition-transform duration-300 ${showSidebar ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0`}>
        <div className="flex flex-col h-full p-4">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2"><Zap className="w-5 h-5 text-cyan-600 fill-cyan-600" /><h1 className="text-sm font-black uppercase tracking-tighter">Keshra AI</h1></div>
            <button onClick={() => setShowSidebar(false)} className="lg:hidden p-1 hover:bg-slate-100 rounded-full"><X className="w-4 h-4" /></button>
          </div>
          <button onClick={() => { createNewChat(); setShowSidebar(false); }} className={`flex items-center gap-2.5 w-full p-2.5 rounded-2xl border ${theme === 'dark' ? 'border-white/10 hover:bg-white/5' : 'border-slate-200 bg-white shadow-sm'} transition-all font-bold text-[11px] mb-6 active:scale-95`}><Plus className="w-3.5 h-3.5 text-cyan-500" /> New Chat</button>
          <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-3 mb-2">History</p>
            {sessions.map((s) => (
              <div key={s.id} onClick={() => { setActiveSessionId(s.id); if (window.innerWidth < 1024) setShowSidebar(false); }} className={`group flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all ${activeSessionId === s.id ? 'bg-cyan-600 text-white shadow-md' : 'hover:bg-slate-100'}`}>
                <div className="flex items-center gap-2 truncate"><MessageSquare className="w-3.5 h-3.5" /><span className="truncate font-semibold text-[11px]">{s.title}</span></div>
                <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          <div className={`mt-auto pt-4 border-t ${borderCol}`}>
             <div className="flex items-center justify-between p-1">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-cyan-600 flex items-center justify-center text-white font-black text-[9px]">WA</div>
                  <div><p className="text-[9px] font-bold">Wajid Ali</p><p className="text-[7px] text-cyan-600 font-bold uppercase">Architect</p></div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 rounded-lg border border-slate-100 text-slate-400"><Settings className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-1.5 rounded-lg border border-slate-100 text-slate-400">{theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}</button>
                </div>
             </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        <nav className={`flex items-center justify-between px-4 py-2 border-b ${borderCol} ${theme === 'dark' ? 'bg-[#09090b]/95' : 'bg-white/95'} backdrop-blur-md sticky top-0 z-30 shadow-sm`}>
          <div className="flex items-center gap-2.5">
            <button onClick={() => setShowSidebar(true)} className="p-1 hover:bg-slate-100 rounded-lg lg:hidden"><Menu className="w-5 h-5" /></button>
            <div className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-cyan-600" /><h1 className="text-xs font-black uppercase tracking-tight">Keshra AI</h1></div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowChatUI(!showChatUI)} className="p-1.5 rounded-lg border border-slate-100 text-slate-400">{showChatUI ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
            <button onClick={createNewChat} className="p-1.5 bg-cyan-600 text-white rounded-lg shadow-sm active:scale-95"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        </nav>

        <div className="flex-1 relative flex flex-col items-center overflow-hidden">
          {(!showChatUI || messages.length === 0) && (
            <div className="z-20 flex flex-col items-center pointer-events-none scale-90 opacity-100 py-12 transition-all duration-1000">
              <div className="pointer-events-auto cursor-pointer" onClick={toggleVoice}><ArcReactor isActive={connectionState === ConnectionState.CONNECTED} isSpeaking={isSpeaking} volume={volumeLevel} /></div>
              <div className="mt-8 text-center px-6"><h2 className="text-xl font-black mb-1 tracking-tight">Keshra Intelligence</h2><div className="inline-block px-3 py-1 border border-slate-100 rounded-full bg-white text-[9px] font-bold text-slate-400 uppercase tracking-widest shadow-sm">Pakistan's Sovereign Node</div></div>
            </div>
          )}

          <div className={`flex-1 w-full max-w-4xl mx-auto px-4 overflow-y-auto pt-6 pb-40 transition-all duration-700 custom-scrollbar ${showChatUI && messages.length > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
            {messages.map((m) => (
              <div key={m.id} className={`flex w-full mb-6 ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                <div className={`flex gap-3 max-w-full ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center mt-1 text-[9px] font-black border ${m.role === 'user' ? 'bg-white text-slate-400 border-slate-100' : 'bg-cyan-600 text-white border-cyan-500 shadow-sm'}`}>{m.role === 'user' ? 'USER' : 'KES'}</div>
                  <div className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} max-w-[calc(100%-40px)]`}>
                    <div className={`p-3.5 rounded-2xl shadow-sm ${m.role === 'user' ? 'bg-white text-slate-800 rounded-tr-none border border-slate-100' : 'bg-transparent text-slate-900 rounded-tl-none border-transparent'} w-auto inline-block min-w-0`}>
                      {m.type === 'text' ? <div className={`space-y-3 ${isRTL(m.content) ? 'rtl text-right font-urdu' : 'text-left'}`}><div className="text-[13px] leading-relaxed font-semibold">{renderContent(m.content, m.id)}</div>{m.sources?.length && <div className="pt-3 mt-1 border-t border-slate-100 flex flex-wrap gap-2">{m.sources.map((src, i) => <a key={i} href={src.uri} target="_blank" rel="noopener" className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-xl text-[9px] text-cyan-700 border border-slate-100 font-bold shadow-xs"><Search className="w-3 h-3" /><span className="max-w-[120px] truncate uppercase">{src.title}</span></a>)}</div>}</div> : <div className="space-y-3"><div className="rounded-xl border border-slate-100 bg-white p-1 shadow-md overflow-hidden relative group/img"><img src={m.content} alt="Output" className="w-full max-h-[450px] object-contain rounded-lg" /><div className="absolute top-3 right-3 opacity-0 group-hover/img:opacity-100"><button onClick={() => window.open(m.content, '_blank')} className="p-2 bg-white/95 text-cyan-600 rounded-full shadow-xl"><Download className="w-4 h-4" /></button></div></div></div>}
                    </div>
                    <span className="text-[8px] text-slate-400 font-bold mt-1.5 px-2 uppercase tracking-widest opacity-60">{m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              </div>
            ))}

            {isProcessing && (
              <div className="flex justify-start mb-6 animate-in fade-in duration-300">
                <div className="flex gap-2 max-w-full">
                  <div className={`w-8 h-8 rounded-xl ${isGeneratingImage ? 'bg-cyan-600' : 'bg-transparent'} flex items-center justify-center border ${isGeneratingImage ? 'border-cyan-500 shadow-sm' : 'border-transparent'}`}>{isGeneratingImage ? <Sparkles className="w-3.5 h-3.5 text-white animate-spin" /> : <Cpu className="w-3.5 h-3.5 text-cyan-600" />}</div>
                  {isGeneratingImage ? (
                    <div className="px-4 py-3 bg-white border border-cyan-100 rounded-2xl rounded-tl-none flex flex-col gap-2 min-w-[200px] shadow-sm">
                      <div className="flex items-center gap-2"><ImageIcon className="w-4 h-4 text-cyan-600 animate-pulse" /><span className="text-[11px] font-bold text-slate-700">Synthesizing Art...</span></div>
                      <div className="h-1 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-cyan-600 animate-[loading_4s_ease-in-out_infinite]" style={{width: '60%'}}></div></div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-transparent rounded-2xl"><Loader2 className="w-3.5 h-3.5 text-cyan-600 animate-spin" /><span className="text-[11px] font-bold text-slate-500 tracking-tight">Keshra AI Thinking...</span></div>
                  )}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Compact Input Bar */}
        <div className="absolute bottom-0 left-0 w-full p-4 lg:p-6 bg-gradient-to-t from-white via-white/80 to-transparent z-40">
          <div className="max-w-2xl mx-auto flex flex-col gap-2.5">
            {selectedImage && <div className="flex items-center gap-3 p-2 bg-white rounded-2xl border border-cyan-100 shadow-xl mx-4"><div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-50"><img src={selectedImage.preview} alt="Target" className="w-full h-full object-cover" /></div><span className="flex-1 text-[9px] font-black text-cyan-600 uppercase">Image Loaded</span><button onClick={() => setSelectedImage(null)} className="p-1 hover:bg-red-50 text-red-400 rounded-lg"><X className="w-4 h-4" /></button></div>}
            <div className="relative flex items-center gap-1 bg-white border border-slate-200 px-2 py-1.5 rounded-[2rem] shadow-xl transition-all group focus-within:ring-2 focus-within:ring-cyan-100/50">
              <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-cyan-600 active:scale-90"><Paperclip className="w-4.5 h-4.5" /></button>
              <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onloadend = () => setSelectedImage({ data: (r.result as string).split(',')[1], mimeType: f.type, preview: r.result as string }); r.readAsDataURL(f); } }} accept="image/*" className="hidden" />
              <textarea rows={1} value={inputText} onChange={(e) => { setInputText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder={isSpeaking ? "Speaking..." : "Ask Keshra..."} className="flex-1 bg-transparent border-none outline-none text-[14px] py-2 px-1 text-slate-900 placeholder:text-slate-300 resize-none max-h-[120px] custom-scrollbar font-bold scrollbar-hide" />
              <div className="flex items-center gap-1 pr-1">
                <button onClick={toggleVoice} disabled={connectionState === ConnectionState.CONNECTING || isSpeaking} className={`p-2 rounded-full transition-all relative ${isSpeaking ? 'text-slate-200 opacity-30 cursor-not-allowed' : connectionState === ConnectionState.CONNECTED ? 'text-red-500' : 'text-slate-400 hover:text-cyan-600'}`}><Mic className="w-5 h-5" />{connectionState === ConnectionState.CONNECTED && !isSpeaking && <span className="absolute inset-0 rounded-full border border-red-100 animate-ping opacity-20"></span>}</button>
                <button onClick={handleSend} disabled={(!inputText.trim() && !selectedImage) || isProcessing} className={`p-2 rounded-full shadow-sm active:scale-90 ${inputText.trim() || selectedImage ? 'bg-cyan-600 text-white' : 'bg-slate-50 text-slate-300'}`}><Send className="w-5 h-5" /></button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Settings */}
      {isSettingsOpen && (
        <div className={`fixed inset-0 z-[100] ${sidebarBg} animate-in fade-in duration-200 flex flex-col`}>
           <nav className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><div className="flex items-center gap-2"><Settings className="w-5 h-5 text-cyan-600" /><h2 className="text-xs font-black uppercase tracking-widest">Keshra Config</h2></div><button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-all"><X className="w-6 h-6" /></button></nav>
           <div className="flex-1 p-6 max-w-xl mx-auto w-full space-y-8">
              <section><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Lead Developer</p><div className="p-6 rounded-[2rem] border border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center gap-6 shadow-sm"><div className="w-16 h-16 rounded-[1.25rem] bg-cyan-600 flex items-center justify-center text-white font-black text-xl shadow-lg">WA</div><div className="flex-1 text-center sm:text-left"><h3 className="font-bold text-base">Wajid Ali</h3><p className="text-[10px] text-slate-500 font-bold uppercase">Architect - Sovereign AI (PK)</p></div><div className="flex gap-3"><button onClick={() => window.open('mailto:mbhi78@gmail.com')} className="p-3 bg-white border border-slate-100 rounded-xl text-slate-500 hover:text-cyan-600 shadow-sm"><Mail className="w-5 h-5" /></button><button onClick={() => window.open('https://youtube.com/@wajidtechtube?si=x38X_GDqZtWlcoQD', '_blank')} className="p-3 bg-white border border-slate-100 rounded-xl text-slate-500 hover:text-red-600 shadow-sm"><Youtube className="w-5 h-5" /></button></div></div></section>
              <div className="pt-8 text-center"><p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.4em]">Keshra Neural Engine - Build 15.2 (Optimized)</p></div>
           </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 2px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.05); border-radius: 10px; }
        .rtl { direction: rtl; }
        .font-urdu { font-family: 'Noto Sans Arabic', sans-serif; font-weight: 700; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
      `}</style>
    </div>
  );
};

export default App;