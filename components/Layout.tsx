
import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Navigation Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-900/80 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="font-bold text-white text-xl">G</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight">Gemini<span className="text-blue-500">Starter</span></h1>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#" className="text-slate-400 hover:text-white transition-colors">Documentation</a>
            <a href="#" className="text-slate-400 hover:text-white transition-colors">API Reference</a>
            <button className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-full text-sm font-semibold transition-all">
              Launch App
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-sm">
            &copy; {new Date().getFullYear()} Modern React Starter. Built with Gemini AI.
          </p>
          <div className="flex gap-4">
            <span className="px-2 py-1 bg-slate-800 rounded text-[10px] uppercase tracking-widest text-slate-400 font-bold">
              v1.0.0 Stable
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
