
import React, { useState, useRef, useEffect } from 'react';
import { useWAI } from './hooks/useWAI';
import ArcReactor from './components/ArcReactor';
import { ConnectionState } from './types';
import { 
  Mic, Send, Search, Image as ImageIcon, ShieldCheck, 
  Activity, EyeOff, Eye, Plus, MessageSquare, Trash2, Menu, X, Sparkles, 
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
    if (showChatUI) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
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

  const toggleVoice = () => {
    if (connectionState === ConnectionState.CONNECTED) disconnect();
    else connect();
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopyStatus({ ...copyStatus, [id]: true });
    setTimeout(() => setCopyStatus({ ...copyStatus, [id]: false }), 2000);
  };

  const handleDownload = (imageUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename || 'keshra-ai-download.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        setSelectedImage({
          data: base64String,
          mimeType: file.type,
          preview: reader.result as string
        });
        setShowChatUI(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const isRTL = (text: string) => {
    const rtlChars = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    return rtlChars.test(text);
  };

  const renderContent = (content: string, messageId: string) => {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    const processText = (text: string, baseKey: string) => {
      let cleanText = text
        .replace(/\*\*\s*\[([^\]]+)\]\(([^)]+)\)\s*\*\*/g, '[$1]($2)')
        .replace(/###\s*(.*)/g, '<h3 class="font-black text-cyan-600 mt-2">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

      const urlRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
      
      const elements: React.ReactNode[] = [];
      let cursor = 0;
      let m;

      while ((m = urlRegex.exec(cleanText)) !== null) {
        if (m.index > cursor) {
          elements.push(<span key={`${baseKey}-pre-${cursor}`} dangerouslySetInnerHTML={{ __html: cleanText.substring(cursor, m.index).replace(/\n/g, '<br/>') }} />);
        }
        
        const label = m[1] || m[3];
        const url = m[2] || m[3];

        elements.push(
          <a 
            key={`${baseKey}-link-${m.index}`} 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-cyan-600 hover:text-cyan-700 underline break-all font-black transition-all inline-flex items-center gap-1 mx-1"
          >
            {label} <LinkIcon className="w-3 h-3" />
          </a>
        );
        cursor = urlRegex.lastIndex;
      }

      if (cursor < cleanText.length) {
        elements.push(<span key={`${baseKey}-post-${cursor}`} dangerouslySetInnerHTML={{ __html: cleanText.substring(cursor).replace(/\n/g, '<br/>') }} />);
      }

      return elements;
    };

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{processText(content.substring(lastIndex, match.index), `txt-${lastIndex}`)}</span>);
      }
      const language = match[1] || 'code';
      const code = match[2].trim();
      const blockId = `${messageId}-${match.index}`;
      parts.push(
        <div key={blockId} className="my-4 rounded-xl overflow-hidden border border-slate-200 bg-slate-900 text-slate-100 shadow-lg w-full max-w-full">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{language}</span>
            <button 
              onClick={() => handleCopy(code, blockId)}
              className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 hover:text-white transition-all px-2.5 py-1 rounded bg-white/5 active:scale-95"
            >
              {copyStatus[blockId] ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copyStatus[blockId] ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-4 overflow-x-auto text-[12px] font-mono leading-relaxed custom-scrollbar whitespace-pre-wrap break-all scrollbar-hide bg-slate-900">
            <code className="block">{code}</code>
          </pre>
        </div>
      );
      lastIndex = codeBlockRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      parts.push(<span key={`text-${lastIndex}`}>{processText(content.substring(lastIndex), `txt-${lastIndex}`)}</span>);
    }

    return parts.length > 0 ? parts : processText(content, 'plain');
  };

  const bgColor = theme === 'dark' ? 'bg-[#09090b]' : 'bg-slate-50';
  const sidebarBg = theme === 'dark' ? 'bg-[#121214]' : 'bg-white';
  const textColor = theme === 'dark' ? 'text-slate-100' : 'text-slate-900';
  const borderCol = theme === 'dark' ? 'border-white/5' : 'border-slate-200';

  return (
    <div className={`flex h-screen ${bgColor} ${textColor} font-sans overflow-hidden transition-colors duration-500 text-[13px]`}>
      
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 ${sidebarBg} ${borderCol} border-r shadow-2xl lg:shadow-none transform transition-transform duration-300 ease-out lg:relative lg:translate-x-0 ${showSidebar ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full p-4">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-cyan-600 fill-cyan-600" />
              <h1 className="text-sm font-black tracking-tighter uppercase">Keshra AI</h1>
            </div>
            <button onClick={() => setShowSidebar(false)} className="lg:hidden p-1.5 hover:bg-slate-100 rounded-full">
              <X className="w-4 h-4" />
            </button>
          </div>

          <button 
            onClick={() => { createNewChat(); setShowSidebar(false); }}
            className={`flex items-center gap-2.5 w-full p-3 rounded-2xl border ${theme === 'dark' ? 'border-white/10 hover:bg-white/5' : 'border-slate-200 bg-white hover:bg-slate-50 shadow-sm'} transition-all font-bold text-[11px] mb-6 active:scale-95`}
          >
            <Plus className="w-3.5 h-3.5 text-cyan-500" />
            <span>New Chat</span>
          </button>

          <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar pr-1">
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-3 mb-2">History</p>
            {sessions.map((session) => (
              <div 
                key={session.id}
                className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all ${
                  activeSessionId === session.id 
                    ? 'bg-cyan-600 text-white shadow-md' 
                    : (theme === 'dark' ? 'text-slate-400 hover:bg-white/5' : 'text-slate-600 hover:bg-slate-100')
                }`}
                onClick={() => {
                  setActiveSessionId(session.id);
                  if (window.innerWidth < 1024) setShowSidebar(false);
                }}
              >
                <div className="flex items-center gap-2 truncate">
                  <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${activeSessionId === session.id ? 'text-white' : 'text-slate-400'}`} />
                  <span className="truncate font-semibold text-[12px]">{session.title}</span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                  className={`opacity-0 group-hover:opacity-100 p-1 transition-all rounded-lg ${activeSessionId === session.id ? 'hover:bg-white/20' : 'hover:bg-red-50 text-red-400'}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className={`mt-auto pt-4 border-t ${borderCol}`}>
             <div className="flex items-center justify-between p-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-cyan-600 flex items-center justify-center text-white font-black text-[10px]">WA</div>
                  <div>
                    <p className="text-[10px] font-bold">Wajid Ali</p>
                    <p className="text-[8px] text-cyan-600 font-bold uppercase tracking-tighter">Chief Architect</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                    <Settings className="w-4 h-4" />
                  </button>
                  <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                    {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  </button>
                </div>
             </div>
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {showSidebar && <div className="fixed inset-0 bg-black/10 backdrop-blur-sm z-40 lg:hidden" onClick={() => setShowSidebar(false)}></div>}

        {/* Top Navbar */}
        <nav className={`flex items-center justify-between px-4 py-3 border-b ${borderCol} ${theme === 'light' ? 'bg-white/95' : 'bg-[#09090b]/95'} backdrop-blur-md sticky top-0 z-30 shadow-sm`}>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowSidebar(true)} className="p-1.5 hover:bg-slate-100 rounded-lg lg:hidden">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-600" />
              <h1 className="text-xs font-black uppercase tracking-tight">Keshra AI</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowChatUI(!showChatUI)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
              {showChatUI ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button onClick={createNewChat} className="p-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg shadow-md active:scale-95">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </nav>

        {/* Workspace Canvas */}
        <div className="flex-1 relative flex flex-col items-center overflow-hidden">
          {(!showChatUI || messages.length === 0) && (
            <div className={`transition-all duration-1000 ease-[cubic-bezier(0.23,1,0.32,1)] z-20 flex flex-col items-center pointer-events-none scale-90 opacity-100 py-16`}>
              <div className="pointer-events-auto cursor-pointer" onClick={toggleVoice}>
                <ArcReactor isActive={connectionState === ConnectionState.CONNECTED} isSpeaking={isSpeaking} volume={volumeLevel} />
              </div>
              <div className="mt-8 text-center animate-in fade-in slide-in-from-top-4 px-6">
                <h2 className="text-2xl font-black mb-2 tracking-tight">Keshra Intelligence</h2>
                <div className="inline-block px-4 py-2 border border-slate-200 rounded-full bg-white text-[10px] font-bold text-slate-400 uppercase tracking-widest shadow-sm">
                   Pakistan's Neural Super-Platform
                </div>
              </div>
            </div>
          )}

          {/* Chat Interface */}
          <div className={`flex-1 w-full max-w-4xl mx-auto px-4 overflow-y-auto pt-6 pb-48 transition-all duration-700 custom-scrollbar ${showChatUI && messages.length > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
            {messages.map((m) => (
              <div key={m.id} className={`flex w-full mb-8 ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-3`}>
                <div className={`flex gap-3 max-w-full ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center mt-1 text-[10px] font-black border ${m.role === 'user' ? 'bg-white text-slate-400 border-slate-200' : 'bg-cyan-600 text-white border-cyan-500 shadow-md shadow-cyan-600/20'}`}>
                    {m.role === 'user' ? 'USER' : 'KES'}
                  </div>
                  <div className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} max-w-[calc(100%-45px)]`}>
                    <div className={`p-4 rounded-2xl shadow-sm ${m.role === 'user' ? 'bg-white text-slate-800 rounded-tr-none border border-slate-200' : 'bg-transparent text-slate-900 rounded-tl-none border-transparent'} w-auto inline-block min-w-0`}>
                      {m.type === 'text' ? (
                        <div className={`space-y-4 ${isRTL(m.content) ? 'rtl text-right font-urdu' : 'text-left'}`}>
                          <div className="text-[14px] leading-relaxed font-semibold">{renderContent(m.content, m.id)}</div>
                          {m.sources && m.sources.length > 0 && (
                            <div className="pt-4 mt-2 border-t border-slate-100 flex flex-wrap gap-2.5">
                              {m.sources.map((src, i) => (
                                <a key={i} href={src.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-xl text-[10px] text-cyan-700 border border-slate-200 font-bold transition-all shadow-sm">
                                  <Search className="w-3.5 h-3.5" />
                                  <span className="max-w-[140px] truncate uppercase">{src.title}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="rounded-xl border border-slate-200 bg-white p-1 shadow-lg overflow-hidden relative group/img">
                            <img src={m.content} alt="Output" className="w-full max-h-[500px] object-contain rounded-lg" />
                            <div className="absolute top-4 right-4 opacity-0 group-hover/img:opacity-100 transition-opacity">
                              <button 
                                onClick={() => handleDownload(m.content, `keshra-art-${m.id}.png`)}
                                className="p-2.5 bg-white/95 backdrop-blur-md text-cyan-600 rounded-full shadow-2xl hover:bg-white active:scale-90 transition-all border border-slate-200"
                              >
                                <Download className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                          <div className="flex gap-2">
                             <button onClick={() => window.open(m.content, '_blank')} className="px-3.5 py-2 bg-white text-[10px] text-cyan-600 font-bold rounded-xl border border-slate-200 shadow-sm active:scale-95 flex items-center gap-2">
                                <LinkIcon className="w-4 h-4" /> Original View
                             </button>
                             <button onClick={() => handleDownload(m.content, `keshra-art-${m.id}.png`)} className="px-3.5 py-2 bg-white text-[10px] text-cyan-600 font-bold rounded-xl border border-slate-200 shadow-sm active:scale-95 flex items-center gap-2">
                                <Download className="w-4 h-4" /> Download Art
                             </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-slate-400 font-bold mt-2 px-2 uppercase tracking-widest opacity-70">
                      {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {isProcessing && (
              <div className="flex justify-start mb-8 animate-in fade-in duration-500">
                <div className="flex gap-3 max-w-full">
                  <div className={`w-9 h-9 rounded-xl ${isGeneratingImage ? 'bg-cyan-600' : 'bg-transparent'} flex items-center justify-center border ${isGeneratingImage ? 'border-cyan-500 shadow-md' : 'border-transparent'}`}>
                    {isGeneratingImage ? <Sparkles className="w-4 h-4 text-white animate-spin" /> : <Cpu className="w-4 h-4 text-cyan-600 animate-pulse" />}
                  </div>
                  
                  {isGeneratingImage ? (
                    <div className="px-5 py-4 bg-white/60 border border-cyan-100 rounded-2xl rounded-tl-none flex flex-col gap-2.5 min-w-[220px] shadow-sm backdrop-blur-md">
                      <div className="flex items-center gap-2.5">
                         <ImageIcon className="w-4 h-4 text-cyan-600 animate-pulse" />
                         <span className="text-[12px] font-bold text-slate-700">Synthesizing High-Quality Art...</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                         <div className="h-full bg-cyan-600 animate-[loading_4s_ease-in-out_infinite]" style={{width: '60%'}}></div>
                      </div>
                      <p className="text-[10px] text-slate-500 font-semibold tracking-tight">Crafting visual assets. Please stand by.</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-2 bg-transparent rounded-2xl border border-transparent">
                       <Loader2 className="w-4 h-4 text-cyan-600 animate-spin" />
                       <span className="text-[12px] font-bold text-slate-500">Keshra AI Thinking...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Settings */}
        {isSettingsOpen && (
          <div className={`fixed inset-0 z-[100] ${sidebarBg} animate-in fade-in zoom-in-95 duration-300 flex flex-col`}>
             <nav className={`flex items-center justify-between px-6 py-5 border-b ${borderCol}`}>
                <div className="flex items-center gap-3">
                  <Settings className="w-6 h-6 text-cyan-600" />
                  <h2 className="text-sm font-black uppercase tracking-widest">Keshra Config</h2>
                </div>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2.5 hover:bg-slate-100 rounded-xl transition-all">
                  <X className="w-7 h-7" />
                </button>
             </nav>
             <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full space-y-10">
                <section>
                   <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] mb-5">Lead Developer</p>
                   <div className="p-8 rounded-[2.5rem] border border-slate-100 bg-slate-50 flex flex-col sm:flex-row items-center gap-8 shadow-sm">
                      <div className="w-20 h-20 rounded-[1.75rem] bg-cyan-600 flex items-center justify-center text-white font-black text-2xl shadow-2xl shadow-cyan-600/30">WA</div>
                      <div className="flex-1 text-center sm:text-left">
                         <h3 className="font-bold text-xl mb-1">Wajid Ali</h3>
                         <p className="text-sm text-slate-500 font-semibold">Chief Architect of Sovereign AI (Pakistan)</p>
                      </div>
                      <div className="flex gap-4">
                         <button onClick={() => window.open('mailto:mbhi78@gmail.com')} className="p-4 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:text-cyan-600 transition-all shadow-md hover:shadow-lg active:scale-90">
                            <Mail className="w-6 h-6" />
                         </button>
                         <button onClick={() => window.open('https://youtube.com/@wajidtechtube?si=x38X_GDqZtWlcoQD', '_blank')} className="p-4 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:text-red-600 transition-all shadow-md hover:shadow-lg active:scale-90">
                            <Youtube className="w-6 h-6" />
                         </button>
                      </div>
                   </div>
                </section>
                <div className="pt-16 text-center">
                   <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.5em]">Keshra Neural Engine - Build 14.1</p>
                </div>
             </div>
          </div>
        )}

        {/* Compact ChatGPT-like Input Bar */}
        <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-slate-50 via-slate-50/80 to-transparent z-40">
          <div className="max-w-3xl mx-auto flex flex-col gap-3">
            
            {selectedImage && (
              <div className="flex items-center gap-3 p-2 bg-white rounded-2xl border border-cyan-100 shadow-xl animate-in slide-in-from-bottom-3 ring-2 ring-cyan-50 mx-4">
                 <div className="w-12 h-12 rounded-lg overflow-hidden border border-slate-100 shadow-sm">
                    <img src={selectedImage.preview} alt="Target" className="w-full h-full object-cover" />
                 </div>
                 <div className="flex-1">
                    <p className="text-[10px] font-black text-cyan-600 uppercase">Asset Loaded</p>
                    <p className="text-[9px] text-slate-400 font-bold">Neural Command Ready</p>
                 </div>
                 <button onClick={() => setSelectedImage(null)} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors active:scale-90">
                    <X className="w-4 h-4" />
                 </button>
              </div>
            )}

            <div className="relative flex items-center gap-2 bg-white border border-slate-200 px-3 py-1.5 rounded-[2.2rem] shadow-xl transition-all ring-1 ring-slate-100 group focus-within:ring-cyan-200/50">
              
              {/* Attachment Button */}
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-slate-400 hover:text-cyan-600 rounded-full transition-all active:scale-90"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <input type="file" ref={fileInputRef} onChange={handleImageSelect} accept="image/*" className="hidden" />

              {/* Text Area */}
              <textarea 
                rows={1} 
                value={inputText} 
                onChange={(e) => { 
                  setInputText(e.target.value); 
                  e.target.style.height = 'auto'; 
                  e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px'; 
                }} 
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} 
                onFocus={() => setShowChatUI(true)} 
                placeholder={isSpeaking ? "Articulating..." : "Instruct Keshra AI..."} 
                className="flex-1 bg-transparent border-none outline-none text-[14px] py-3 px-1 text-slate-900 placeholder:text-slate-400 resize-none max-h-[150px] overflow-y-auto custom-scrollbar font-semibold scrollbar-hide" 
              />

              {/* Integrated Voice and Send Buttons */}
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={toggleVoice} 
                  disabled={connectionState === ConnectionState.CONNECTING || isSpeaking} 
                  className={`p-2.5 rounded-full transition-all flex items-center justify-center active:scale-95 relative ${isSpeaking ? 'text-slate-200 opacity-40 cursor-not-allowed' : connectionState === ConnectionState.CONNECTED ? 'text-red-500' : 'text-slate-400 hover:text-cyan-600'}`}
                >
                  <Mic className={`w-5 h-5 ${connectionState === ConnectionState.CONNECTED && !isSpeaking ? 'animate-pulse' : ''}`} />
                  {connectionState === ConnectionState.CONNECTED && !isSpeaking && <span className="absolute inset-0 rounded-full border border-red-200 animate-ping opacity-30"></span>}
                </button>

                <button 
                  onClick={handleSend} 
                  disabled={(!inputText.trim() && !selectedImage) || isProcessing} 
                  className={`p-2.5 rounded-full transition-all shadow-sm active:scale-90 disabled:opacity-30 ${inputText.trim() || selectedImage ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-300'}`}
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="flex items-center justify-center gap-4 opacity-40 select-none">
               <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-slate-400"><ShieldCheck className="w-3 h-3" /> Secure Node</div>
               <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-slate-400"><MapPin className="w-3 h-3" /> Peshawar</div>
            </div>
          </div>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 10px; }
        ::selection { background-color: rgba(6, 182, 212, 0.25); }
        .rtl { direction: rtl; }
        .font-urdu { font-family: 'Noto Sans Arabic', sans-serif; font-weight: 700; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
};

export default App;
