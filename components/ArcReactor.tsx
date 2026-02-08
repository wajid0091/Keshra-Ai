
import React from 'react';

interface ArcReactorProps {
  isActive: boolean;
  isSpeaking: boolean;
  volume: number;
}

const ArcReactor: React.FC<ArcReactorProps> = ({ isActive, isSpeaking, volume }) => {
  const pulseScale = isActive ? 1 + (volume * 0.35) : 1;
  const coreColor = isActive 
    ? (isSpeaking ? 'border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.4)]' : 'border-cyan-500 shadow-[0_0_60px_rgba(6,182,212,0.4)]') 
    : 'border-slate-200 shadow-lg shadow-slate-200/40';
  
  const innerLight = isActive 
    ? (isSpeaking ? 'bg-red-500' : 'bg-cyan-500') 
    : 'bg-slate-300';

  return (
    <div className="relative w-56 h-56 flex items-center justify-center">
      {/* Outer Glow Halo */}
      {isActive && (
        <div className={`absolute inset-0 rounded-full blur-[70px] opacity-15 transition-all duration-700 ${isSpeaking ? 'bg-red-500 scale-125' : 'bg-cyan-500 scale-110'}`}></div>
      )}

      {/* Decorative Rotating Orbital Rings */}
      <div className={`absolute inset-0 rounded-full border border-slate-200/20 ${isActive ? 'animate-[spin_40s_linear_infinite]' : ''}`}></div>
      <div className={`absolute inset-6 rounded-full border border-dashed border-slate-200/40 ${isActive ? 'animate-[spin_25s_linear_infinite_reverse]' : ''}`}></div>

      {/* Main Core */}
      <div 
        className={`relative w-28 h-28 rounded-3xl border-4 flex items-center justify-center transition-all duration-150 ease-out ${coreColor} bg-white`}
        style={{ transform: `scale(${pulseScale}) rotate(${isActive ? (volume * 8) : 0}deg)` }}
      >
        <div className={`w-20 h-20 rounded-full border border-slate-100 flex items-center justify-center relative overflow-hidden bg-slate-50/50`}>
           {/* Inner Pulsating Light */}
           <div className={`w-10 h-10 rounded-full ${innerLight} blur-lg transition-all duration-500 ${isActive && isSpeaking ? 'animate-pulse' : ''}`}></div>
           <div className={`absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-full opacity-50`}></div>
           
           {isActive && (
             <div className="absolute inset-0 bg-[linear-gradient(transparent_0%,rgba(6,182,212,0.05)_50%,transparent_100%)] bg-[size:100%_12px] animate-[pulse_3s_infinite]"></div>
           )}
        </div>
        
        {/* Pattern Overlay */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none p-3">
          <svg viewBox="0 0 100 100" className="w-full h-full fill-cyan-900">
            <pattern id="hex-small" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
               <path d="M5 0 L10 2.5 L10 7.5 L5 10 L0 7.5 L0 2.5 Z" />
            </pattern>
            <rect width="100" height="100" fill="url(#hex-small)" />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default ArcReactor;
