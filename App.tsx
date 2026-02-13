import React, { useState, useRef, useEffect, memo } from 'react';
import { useWAI } from './hooks/useWAI';
import ArcReactor from './components/ArcReactor';
import { ConnectionState, ChatMode } from './types';
import { 
  Mic, Send, Search, Image as ImageIcon, Sparkles, 
  Plus, MessageSquare, Trash2, Menu, X, 
  Settings, Moon, Sun, Copy, Check, Download, Paperclip, Loader2,
  FileText, Lightbulb, BarChart, ExternalLink, Zap, Brain, Globe, ChevronUp,
  ThumbsUp, ThumbsDown
} from 'lucide-react';

// --- Dedicated CodeBlock Component (Crash-Proof Version) ---
// Using hljs.highlight instead of highlightElement prevents React hydration conflicts
const CodeBlock = memo(({ language, code }: { language: string, code: string }) => {
  const [copied, setCopied] = useState(false);
  const [highlightedCode, setHighlightedCode] = useState(code);

  useEffect(() => {
    // Check if highlight.js is loaded
    if ((window as any).hljs) {
      try {
        const validLang = (window as any).hljs.getLanguage(language) ? language : 'plaintext';
        const result = (window as any).hljs.highlight(code, { language: validLang });
        setHighlightedCode(result.value);
      } catch (e) {
        setHighlightedCode(code); // Fallback to plain text
      }
    } else {
      setHighlightedCode(code);
    }
  }, [code, language]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-[#1e1e1e] text-slate-100 shadow-md w-full max-w-full dir-ltr text-left">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-400 select-none">
        <span className="flex items-center gap-1.5">
           <FileText className="w-3 h-3" /> {language}
        </span>
        <button 
          onClick={handleCopy} 
          className="flex items-center gap-1.5 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-2 py-1 rounded-md"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="relative group">
           <pre className="m-0 p-0 overflow-x-auto custom-scrollbar">
              {/* Using dangerouslySetInnerHTML allows HLJS to style without crashing React */}
              <code 
                className={`language-${language} !bg-transparent !p-3 !font-mono text-[12px] leading-relaxed block`}
                dangerouslySetInnerHTML={{ __html: highlightedCode }}
              />
           </pre>
      </div>
    </div>
  );
});

const App: React.FC = () => {
  const { 
    messages, sessions, activeSessionId, setActiveSessionId, createNewChat, deleteSession,
    connectionState, isSpeaking, volumeLevel, isProcessing, connect, disconnect, sendTextMessage,
    chatMode, setChatMode, giveFeedback
  } = useWAI();

  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ data: string, mimeType: string, preview: string } | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light'); 
  const [showModeMenu, setShowModeMenu] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => setTheme(e.matches ? 'dark' : 'light');
    handleChange(mediaQuery); 
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Optimized Scroll: Instant scroll when processing to keep up with typing
  useEffect(() => {
    if (chatEndRef.current) {
        chatEndRef.current.scrollIntoView({ behavior: isProcessing ? 'auto' : 'smooth', block: 'end' });
    }
  }, [messages, isProcessing, connectionState]);

  const handleSend = (overrideText?: string) => {
    const validOverride = (typeof overrideText === 'string') ? overrideText : '';
    const textToSend = validOverride || inputText;
    
    if (!textToSend.trim() && !selectedImage) return;
    sendTextMessage(textToSend, selectedImage ? { data: selectedImage.data, mimeType: selectedImage.mimeType } : undefined);
    setInputText('');
    setSelectedImage(null);
  };

  const isRTL = (text: string) => /[\u0600-\u06FF]/.test(text);

  const renderContent = (content: string, messageId: string) => {
    const parts = content.split('```');
    
    const processText = (text: string, baseKey: string) => {
      let cleanText = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/###\s*(.*)/g, '<h3 class="font-bold text-cyan-700 dark:text-cyan-400 mt-3 mb-1">$1</h3>');
      
      const elements: React.ReactNode[] = [];
      let cursor = 0;
      const urlRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
      let m;
      while ((m = urlRegex.exec(cleanText)) !== null) {
        if (m.index > cursor) {
          elements.push(<span key={`${baseKey}-${cursor}`} dangerouslySetInnerHTML={{ __html: cleanText.substring(cursor, m.index).replace(/\n/g, '<br/>') }} />);
        }
        elements.push(
          <a key={`${baseKey}-l-${m.index}`} href={m[2] || m[3]} target="_blank" rel="noopener" 
             className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 border-b border-cyan-400/30 hover:border-cyan-400 transition-all mx-1 font-bold">
            {m[1] || 'Link'}
          </a>
        );
        cursor = urlRegex.lastIndex;
      }
      if (cursor < cleanText.length) {
        elements.push(<span key={`${baseKey}-e-${cursor}`} dangerouslySetInnerHTML={{ __html: cleanText.substring(cursor).replace(/\n/g, '<br/>') }} />);
      }
      return elements;
    };

    return parts.map((part, index) => {
      if (index % 2 === 0) {
        // Even index = Normal Text
        return (
          <span key={`${messageId}-text-${index}`} className="whitespace-pre-wrap">
            {processText(part, `${messageId}-txt-${index}`)}
          </span>
        );
      } else {
        // Odd index = Code Block
        let [firstLine, ...codeLines] = part.split('\n');
        let lang = firstLine.trim();
        // If content is streaming, codeLines might be empty or partial
        let code = codeLines.join('\n');
        
        if (!lang && codeLines.length === 0) {
             code = part; 
        }

        if (!lang || lang.length > 15) lang = 'plaintext';

        return (
          <CodeBlock key={`${messageId}-code-${index}`} language={lang} code={code || part} />
        );
      }
    });
  };

  const sidebarBg = theme === 'dark' ? 'bg-black' : 'bg-white';
  const mainBg = theme === 'dark' ? 'bg-black' : 'bg-white';
  const borderCol = theme === 'dark' ? 'border-white/10' : 'border-slate-100';
  const textColor = theme === 'dark' ? 'text-white' : 'text-black';
  const secondaryTextColor = theme === 'dark' ? 'text-slate-400' : 'text-slate-600';

  const showLandingPage = messages.length === 0 && connectionState === ConnectionState.DISCONNECTED;

  const modeIcons = {
    normal: <Sparkles className="w-4 h-4 text-cyan-500" />,
    search: <Globe className="w-4 h-4 text-green-500" />,
    thinking: <Brain className="w-4 h-4 text-purple-500" />
  };

  const modeLabels = {
    normal: 'Fast Chat',
    search: 'Google Search',
    thinking: 'Deep Thinking'
  };

  return (
    <div className={`flex h-full w-full ${textColor} font-sans overflow-hidden transition-colors duration-300 ${theme === 'dark' ? 'dark' : ''}`}>
      
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[280px] shrink-0 h-full ${sidebarBg} ${borderCol} border-r shadow-2xl lg:shadow-none transition-transform duration-300 ${showSidebar ? 'translate-x-0' : '-translate-x-full'} lg:static lg:translate-x-0 lg:flex lg:flex-col`}>
        <div className="flex flex-col h-full p-4 w-full">
          <div className="flex items-center justify-between mb-8 px-2">
            <div className="flex items-center gap-3">
               <div className="w-8 h-8 bg-cyan-600 rounded-lg flex items-center justify-center shadow-lg">
                 <Sparkles className="w-5 h-5 text-white" />
               </div>
               <h1 className={`text-lg font-black tracking-tight ${textColor}`}>KESHRA AI</h1>
            </div>
            <button onClick={() => setShowSidebar(false)} className={`lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full ${textColor}`}><X className="w-5 h-5" /></button>
          </div>

          <button onClick={() => { createNewChat(); setShowSidebar(false); }} 
                  className={`flex items-center justify-center gap-3 w-full py-3 mb-6 rounded-xl border ${borderCol} hover:bg-slate-50 dark:hover:bg-white/5 transition-all font-bold text-[13px] bg-slate-50 dark:bg-white/5 ${textColor}`}>
            <Plus className="w-4 h-4" /> New Chat
          </button>

          <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar px-1">
            <p className={`text-[10px] font-black uppercase tracking-widest ${secondaryTextColor} mb-2 px-2`}>Chat History</p>
            {sessions.map((s) => (
              <div key={s.id} onClick={() => { setActiveSessionId(s.id); if (window.innerWidth < 1024) setShowSidebar(false); }} 
                   className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${activeSessionId === s.id ? 'bg-slate-100 dark:bg-white/10' : 'hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                <div className="flex items-center gap-3 truncate">
                  <MessageSquare className="w-4 h-4 opacity-50" />
                  <span className={`truncate font-semibold text-[13px] ${activeSessionId === s.id ? textColor : secondaryTextColor}`}>{s.title}</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} className={`opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 ${secondaryTextColor}`}><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>

          <div className={`mt-auto pt-6 border-t ${borderCol} space-y-2`}>
             <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className={`flex items-center gap-3 w-full p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition-all text-[13px] font-bold ${textColor}`}>
               {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />} {theme === 'dark' ? 'Light Theme' : 'Dark Theme'}
             </button>
             <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 mt-4">
                <div className="w-8 h-8 rounded-full bg-cyan-600 flex items-center justify-center text-white font-black text-[10px]">WA</div>
                <div className="flex-1 overflow-hidden">
                  <p className={`text-[11px] font-black truncate ${textColor}`}>Wajid Ali</p>
                  <p className={`text-[9px] ${secondaryTextColor} uppercase font-bold`}>Master Dev</p>
                </div>
             </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 flex flex-col relative min-w-0 ${mainBg} h-full overflow-hidden`}>
        {/* Navbar */}
        <nav className={`flex-none flex items-center justify-between px-6 py-4 border-b ${borderCol} ${theme === 'dark' ? 'bg-black/80' : 'bg-white/80'} backdrop-blur-2xl sticky top-0 z-40`}>
          <div className="flex items-center gap-4">
            <button onClick={() => setShowSidebar(true)} className={`p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl lg:hidden ${textColor}`}><Menu className="w-6 h-6" /></button>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-600" />
              <h1 className={`text-sm font-black uppercase tracking-widest ${textColor}`}>Keshra AI</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
             {/* New Chat Button */}
             <button onClick={() => createNewChat()} className={`p-2 rounded-full hover:bg-slate-100 dark:hover:bg-white/10 transition-all ${textColor}`}>
                <Plus className="w-5 h-5" />
             </button>
             <div className={`w-3 h-3 rounded-full ${connectionState === ConnectionState.CONNECTED ? 'bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
          </div>
        </nav>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto relative custom-scrollbar pb-0">
          {showLandingPage ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-700">
               <div className="relative mb-12 cursor-pointer scale-110" onClick={() => connectionState === ConnectionState.CONNECTED ? disconnect() : connect()}>
                 <ArcReactor isActive={connectionState === ConnectionState.CONNECTED} isSpeaking={isSpeaking} volume={volumeLevel} />
               </div>
               <h2 className={`text-3xl font-black mb-2 tracking-tight ${textColor}`}>What can I help with?</h2>
               <p className={`${secondaryTextColor} font-bold text-sm max-w-md mb-12`}>Talk to Keshra AI, generate original images, or ask for the latest news.</p>
               
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-2xl px-4">
                 {[
                   { icon: <ImageIcon className="w-5 h-5 text-orange-500" />, label: 'Create image', prompt: 'Create a high-quality artistic portrait of a futuristic Peshawar city.' },
                   { icon: <Search className="w-5 h-5 text-cyan-500" />, label: 'Latest News', prompt: 'What are the latest tech news headlines today?' },
                   { icon: <Lightbulb className="w-5 h-5 text-yellow-500" />, label: 'Get advice', prompt: 'How can a developer stay updated with new tech trends?' },
                   { icon: <BarChart className="w-5 h-5 text-green-500" />, label: 'Analyze data', prompt: 'Explain the best way to handle large datasets using Python.' },
                 ].map((chip, i) => (
                   <button key={i} onClick={() => { handleSend(chip.prompt); }} 
                           className={`flex flex-col items-center gap-3 p-5 rounded-2xl border ${borderCol} bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 transition-all group`}>
                     {chip.icon}
                     <span className={`text-[11px] font-black uppercase tracking-tighter whitespace-nowrap ${textColor}`}>{chip.label}</span>
                   </button>
                 ))}
               </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto w-full px-4 pt-10">
              {messages.length === 0 && connectionState === ConnectionState.CONNECTED && (
                 <div className="flex flex-col items-center justify-center pt-20">
                    <div className="cursor-pointer" onClick={() => disconnect()}>
                        <ArcReactor isActive={true} isSpeaking={isSpeaking} volume={volumeLevel} />
                    </div>
                    <p className={`mt-8 text-sm font-bold uppercase tracking-widest ${secondaryTextColor} animate-pulse`}>Listening...</p>
                 </div>
              )}
              
              {messages.map((m, idx) => (
                <div key={m.id} className={`flex w-full mb-10 ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4`}>
                  <div className={`flex gap-4 max-w-[95%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center mt-1 border shadow-sm ${m.role === 'user' ? 'bg-slate-50 border-slate-200' : 'bg-cyan-600 border-cyan-500'}`}>
                      {m.role === 'user' ? <span className="text-[9px] font-black text-slate-400">YOU</span> : <Sparkles className="w-5 h-5 text-white" />}
                    </div>
                    <div className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} min-w-0 max-w-full`}>
                      
                      {/* Identity Label for Model */}
                      {m.role === 'model' && (
                        <div className="flex items-center gap-1 mb-1.5 ml-1">
                          <span className={`text-[11px] font-bold ${textColor}`}>Keshra AI</span>
                          {/* Show loading DOTS if processing and this is the last message */}
                          {isProcessing && idx === messages.length - 1 && (
                             <div className="flex gap-1.5 mt-1 ml-1 items-center">
                               <span className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                               <span className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                               <span className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce"></span>
                             </div>
                          )}
                        </div>
                      )}

                      <div className={`px-4 py-3 rounded-2xl ${m.role === 'user' ? 'bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 shadow-sm' : 'bg-transparent'} max-w-full overflow-hidden`}>
                        {m.type === 'text' && (
                          <div className={`space-y-3 ${isRTL(m.content) ? 'rtl text-right font-urdu' : 'text-left'}`}>
                            {/* Updated Render Content for better Code Blocks */}
                            <div className={`text-[15px] leading-relaxed font-semibold ${textColor}`}>
                                {renderContent(m.content, m.id)}
                            </div>
                            
                            {/* Feedback Buttons: Only show when NOT processing this specific message (i.e., it's done) */}
                            {m.role === 'model' && (!isProcessing || idx !== messages.length - 1) && (
                                <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-100 dark:border-white/5 animate-in fade-in duration-500">
                                    <button 
                                        onClick={() => giveFeedback(activeSessionId!, m.id, 'like')} 
                                        className={`p-1.5 rounded-lg transition-colors ${m.feedback === 'like' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                                    >
                                        <ThumbsUp className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={() => giveFeedback(activeSessionId!, m.id, 'dislike')} 
                                        className={`p-1.5 rounded-lg transition-colors ${m.feedback === 'dislike' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                                    >
                                        <ThumbsDown className="w-4 h-4" />
                                    </button>
                                </div>
                            )}

                            {m.sources && m.sources.length > 0 && (
                              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-white/10">
                                <p className={`text-[10px] font-black uppercase tracking-widest ${secondaryTextColor} mb-2`}>Sources</p>
                                <div className="flex flex-wrap gap-2">
                                  {m.sources.map((source, idx) => (
                                    <a key={idx} href={source.uri} target="_blank" rel="noopener noreferrer" 
                                       className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 hover:border-cyan-500 transition-colors">
                                      <ExternalLink className="w-3 h-3 text-cyan-600" />
                                      <span className={`text-[11px] font-bold ${textColor} truncate max-w-[150px]`}>{source.title}</span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {m.type === 'image' && (
                          <div className="space-y-3">
                             <div className={`rounded-2xl border ${borderCol} bg-slate-50 dark:bg-white/5 p-1.5 shadow-xl`}>
                               <img src={m.content} alt="AI Art" className="w-full max-h-[550px] object-contain rounded-xl" />
                             </div>
                             <a href={m.content} download={`keshra-${m.id}.png`} 
                                className={`flex items-center justify-center gap-2 w-full p-3 rounded-xl border ${borderCol} hover:bg-slate-50 dark:hover:bg-white/5 transition-all text-sm font-bold ${textColor}`}>
                                <Download className="w-4 h-4" /> Download Image
                             </a>
                          </div>
                        )}

                        {m.type === 'loading-image' && (
                          <div className={`w-[300px] aspect-square rounded-2xl border ${borderCol} bg-slate-50 dark:bg-white/5 flex flex-col items-center justify-center p-6 gap-4 animate-pulse`}>
                             <div className="w-16 h-16 rounded-full bg-cyan-600/20 flex items-center justify-center">
                               <Sparkles className="w-8 h-8 text-cyan-600 animate-spin" />
                             </div>
                             <p className={`text-xs font-black uppercase tracking-widest ${secondaryTextColor}`}>Creating your masterpiece...</p>
                          </div>
                        )}

                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              <div ref={chatEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className={`flex-none w-full p-6 ${theme === 'dark' ? 'bg-black border-t border-white/10' : 'bg-white border-t border-slate-100'} z-50`}>
          <div className="max-w-3xl mx-auto">
            {selectedImage && (
              <div className="flex items-center gap-4 p-3 mb-3 bg-cyan-50 dark:bg-white/5 rounded-2xl border border-cyan-500/20 animate-in slide-in-from-bottom-2">
                <img src={selectedImage.preview} className="w-12 h-12 rounded-xl object-cover shadow-lg" />
                <span className="flex-1 text-[10px] font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-400">Image Uploaded</span>
                <button onClick={() => setSelectedImage(null)} className="p-2 text-red-500 hover:bg-red-50 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>
            )}
            
            <div className="relative group">
              {/* Mode Selection Menu (Dropped Up) */}
              {showModeMenu && (
                <div className={`absolute bottom-full left-0 mb-3 w-48 rounded-xl border ${borderCol} ${theme === 'dark' ? 'bg-[#1a1b1e]' : 'bg-white'} shadow-2xl overflow-hidden z-50 animate-in slide-in-from-bottom-2`}>
                   {(['normal', 'search', 'thinking'] as ChatMode[]).map((mode) => (
                      <button key={mode} onClick={() => { setChatMode(mode); setShowModeMenu(false); }}
                              className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-100 dark:hover:bg-white/5 transition-colors ${chatMode === mode ? 'bg-cyan-50 dark:bg-cyan-900/20' : ''}`}>
                         {modeIcons[mode]}
                         <span className={`text-[12px] font-bold ${textColor}`}>{modeLabels[mode]}</span>
                         {chatMode === mode && <Check className="w-3 h-3 ml-auto text-cyan-500" />}
                      </button>
                   ))}
                </div>
              )}

              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-[2.5rem] blur opacity-10 group-focus-within:opacity-25 transition duration-500"></div>
              <div className={`relative flex items-center gap-2 ${theme === 'dark' ? 'bg-[#0d0d0f]' : 'bg-white'} border ${borderCol} p-2 rounded-[2.5rem] shadow-2xl transition-all`}>
                
                {/* Mode Selector Button */}
                <button onClick={() => setShowModeMenu(!showModeMenu)} 
                        className={`p-3 rounded-full transition-colors hover:bg-slate-100 dark:hover:bg-white/5 ${secondaryTextColor} flex items-center gap-1`}>
                    {modeIcons[chatMode]}
                    <ChevronUp className={`w-3 h-3 transition-transform ${showModeMenu ? 'rotate-180' : ''}`} />
                </button>

                <button onClick={() => fileInputRef.current?.click()} className={`p-3 transition-colors ${secondaryTextColor} hover:text-cyan-600`}><Paperclip className="w-5 h-5" /></button>
                <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onloadend = () => setSelectedImage({ data: (r.result as string).split(',')[1], mimeType: f.type, preview: r.result as string }); r.readAsDataURL(f); } }} accept="image/*" className="hidden" />
                
                <textarea rows={1} value={inputText} 
                          onChange={(e) => { setInputText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px'; }} 
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                          placeholder="Ask Keshra..." 
                          className={`flex-1 bg-transparent border-none outline-none text-[15px] py-3 px-2 ${textColor} placeholder-slate-400 resize-none max-h-[150px] scrollbar-hide font-bold`} />
                
                <div className="flex items-center gap-1 px-1">
                  <button onClick={() => connectionState === ConnectionState.CONNECTED ? disconnect() : connect()} 
                          className={`p-3 rounded-full transition-all ${connectionState === ConnectionState.CONNECTED ? 'bg-cyan-600 text-white animate-pulse' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}>
                    <Mic className="w-6 h-6" />
                  </button>
                  <button onClick={() => handleSend()} disabled={(!inputText.trim() && !selectedImage) || isProcessing} 
                          className={`p-3 rounded-full transition-all ${inputText.trim() || selectedImage ? 'bg-cyan-600 text-white scale-105 shadow-xl shadow-cyan-600/20' : 'text-slate-300 dark:text-slate-700'}`}>
                    <Send className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 10px; }
        .rtl { direction: rtl; }
        .font-urdu { font-family: 'Noto Sans Arabic', sans-serif; font-weight: 700; line-height: 2.2; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default App;