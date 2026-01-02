
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectState, SiteType, SiteTone, Identity, HubPage, Article, GitHubConfig } from './types';
import * as gemini from './services/geminiService';
import * as github from './services/githubService';
import AnalysisChart from './components/AnalysisChart';

const STORAGE_KEY = 'mysitegen_state_v2';

const statusLabels: Record<string, string> = {
  idle: '待機中',
  importing: 'リポジトリ読込中...',
  analyzing_site: '構造解析中...',
  building_identity: 'アイデンティティ定義中...',
  generating_strategy: '戦略・構成策定中...',
  generating_hubs: 'ページ生成中...',
  ready: '準備完了',
  creating_repo: 'リポジトリ作成中...',
  pushing_files: 'データ送信中...',
  enabling_pages: 'サイト公開設定中...',
  tuning_design: '一括デザイン調整中...'
};

const tones: { label: string; value: SiteTone; icon: string }[] = [
  { label: 'プロフェッショナル', value: 'Professional', icon: 'fa-briefcase' },
  { label: 'クリエイティブ', value: 'Creative', icon: 'fa-palette' },
  { label: 'ミニマル', value: 'Minimal', icon: 'fa-leaf' },
  { label: 'ビビッド', value: 'Vivid', icon: 'fa-bolt' },
  { label: 'ブルータリズム', value: 'Brutalist', icon: 'fa-cubes' },
];

const initialHelpPrompts = [
  { label: "使い方は？", query: "このアプリの基本的な使い方を教えてください。" },
  { label: "全ページ一括反映", query: "運用タグの追加やデザインの変更を全ページに一括反映する方法は？" },
  { label: "実績の追加方法", query: "新しいプロジェクトの実績をページとして追加するには？" },
];

const App: React.FC = () => {
  const [state, setState] = useState<ProjectState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    return {
      opinion: "テクノロジーは人間の創造性を拡張し、共感を生むためのツールであるべきだ。",
      siteType: 'Corporate',
      status: 'idle',
      hubs: [],
      articles: [],
      gtmId: '',
      adsenseId: '',
      githubConfig: { token: '', repo: '', branch: 'main', path: 'docs' }
    };
  });

  const [activeTab, setActiveTab] = useState<'build' | 'dashboard' | 'preview'>('build');
  const [selectedHubId, setSelectedHubId] = useState<string | null>(null);
  const [selectedTone, setSelectedTone] = useState<SiteTone | null>(null);
  const [tuningTargetId, setTuningTargetId] = useState<string>("all");
  const [tuningInstruction, setTuningInstruction] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  
  const [showImport, setShowImport] = useState(false);
  const [importRepo, setImportRepo] = useState("");
  const [importToken, setImportToken] = useState("");

  const [isBotOpen, setIsBotOpen] = useState(false);
  const [botMode, setBotMode] = useState<'nav' | 'request'>('nav');
  const [chatHistory, setChatHistory] = useState<{ role: 'bot' | 'user'; text: string }[]>([
    { role: 'bot', text: 'こんにちは！案内役のAIです。使い方の質問や、デザインの一括変更指示など、何でも聞いてくださいね。' }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<{ label: string; query: string }[]>(initialHelpPrompts);

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectMaterial, setProjectMaterial] = useState("");

  const botRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // タブ切り替え時にプレビュー対象がない場合はホームを選択
  useEffect(() => {
    if (activeTab === 'preview' && !selectedHubId && state.hubs.length > 0) {
      const home = state.hubs.find(h => h.slug === 'index') || state.hubs[0];
      setSelectedHubId(home.id);
    }
  }, [activeTab, selectedHubId, state.hubs]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (botRef.current && !botRef.current.contains(event.target as Node)) {
        setIsBotOpen(false);
      }
    };
    if (isBotOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isBotOpen]);

  const updateState = (updates: Partial<ProjectState>) => setState(prev => ({ ...prev, ...updates }));

  const startTask = () => {
    abortControllerRef.current = new AbortController();
    return abortControllerRef.current.signal;
  };

  const handleAbort = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    updateState({ status: state.identity ? 'ready' : 'idle' });
    setProgressMessage("");
    alert("処理を中断しました。");
  };

  const handleInitialBuild = async () => {
    const signal = startTask();
    try {
      updateState({ status: 'building_identity' });
      setProgressMessage("コンセプトをAIが深掘り中...");
      const identity = await gemini.generateIdentityAgent(state.opinion, state.siteType, selectedTone || undefined, signal);
      
      updateState({ identity, status: 'generating_strategy' });
      setProgressMessage("最適なサイト構造を設計中...");
      const { hubs, rationale } = await gemini.generateStrategyAgent(identity, state.siteType, signal);
      
      updateState({ hubs, status: 'generating_hubs', strategyRationale: rationale });
      const updatedHubs: HubPage[] = [];
      for (const h of hubs) {
        if (signal.aborted) return;
        setProgressMessage(`ページ構築中: ${h.title}...`);
        const html = await gemini.generateHtmlAgent(h, identity, state.siteType, hubs, [], false, undefined, undefined, signal);
        updatedHubs.push({ ...h, html });
      }

      setProgressMessage("インデックスを最終調整中...");
      const indexHtml = await gemini.generateHtmlAgent(
        { title: identity.siteName, description: identity.mission },
        identity, state.siteType, updatedHubs, updatedHubs.map(h => ({ title: h.title, url: `${h.slug}/index.html` })), true, undefined, undefined, signal
      );
      
      const homeHub = { id: 'home', title: 'ホーム', slug: 'index', description: 'メインエントランス', html: indexHtml };
      const finalHubs = [homeHub, ...updatedHubs];
      updateState({ hubs: finalHubs, status: 'ready' });
      setSelectedHubId('home');
      setActiveTab('dashboard');
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      console.error(e);
      alert("構築中にエラーが発生しました。");
      updateState({ status: 'idle' });
    } finally {
      setProgressMessage("");
    }
  };

  const handleImport = async () => {
    if (!importRepo || !importToken) return;
    const signal = startTask();
    updateState({ status: 'importing' });
    setProgressMessage("GitHubからコードを取得中...");
    try {
      const config: GitHubConfig = { token: importToken, repo: importRepo, branch: 'main', path: 'docs' };
      const details = await github.fetchRepoDetails(config, signal);
      config.branch = details.default_branch;
      const tree = await github.fetchRepoStructure(config, signal);
      const indexFile = tree.find(f => f.path.endsWith('index.html'));
      if (!indexFile) throw new Error("index.htmlが見つかりませんでした。 docs フォルダなどを確認してください。");
      const html = await github.fetchFileContent(indexFile.url, config.token, signal);
      setProgressMessage("既存のブランドスタイルを解析中...");
      const identity = await gemini.analyzeSiteIdentityAgent(html, signal);
      updateState({
        identity,
        githubConfig: config,
        status: 'ready',
        hubs: [{ id: 'home', title: 'ホーム', slug: 'index', description: 'GitHubからインポートされたページ', html }]
      });
      setSelectedHubId('home');
      setShowImport(false);
      setActiveTab('dashboard');
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      alert(`インポート失敗: ${e.message}`);
      updateState({ status: 'idle' });
    } finally {
      setProgressMessage("");
    }
  };

  const handleTuneDesign = async () => {
    if (!state.identity || !tuningInstruction) return;
    const signal = startTask();
    updateState({ status: 'tuning_design' });
    setProgressMessage("全ページに指示を反映中...");
    try {
      if (tuningTargetId === 'all') {
        const newHubs = [];
        for (const h of state.hubs) {
          if (signal.aborted) return;
          setProgressMessage(`反映中: ${h.title}...`);
          const newHtml = await gemini.tunePageDesignAgent(h.html || "", tuningInstruction, state.identity, signal);
          newHubs.push({ ...h, html: newHtml });
        }
        const newArticles = [];
        for (const a of state.articles) {
          if (signal.aborted) return;
          setProgressMessage(`反映中: ${a.title}...`);
          const newHtml = await gemini.tunePageDesignAgent(a.contentHtml || "", tuningInstruction, state.identity, signal);
          newArticles.push({ ...a, contentHtml: newHtml });
        }
        updateState({ hubs: newHubs, articles: newArticles });
      } else {
        const hub = state.hubs.find(h => h.id === tuningTargetId);
        const art = state.articles.find(a => a.id === tuningTargetId);
        if (hub) {
          const newHtml = await gemini.tunePageDesignAgent(hub.html || "", tuningInstruction, state.identity, signal);
          updateState({ hubs: state.hubs.map(h => h.id === hub.id ? { ...h, html: newHtml } : h) });
        } else if (art) {
          const newHtml = await gemini.tunePageDesignAgent(art.contentHtml || "", tuningInstruction, state.identity, signal);
          updateState({ articles: state.articles.map(a => a.id === art.id ? { ...a, contentHtml: newHtml } : a) });
        }
      }
      setTuningInstruction("");
      alert("反映が完了しました！プレビューで確認してください。");
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      alert("反映中にエラーが発生しました。");
    } finally {
      updateState({ status: 'ready' });
      setProgressMessage("");
    }
  };

  const handleBotSend = async (query?: string) => {
    const text = (query || chatInput).trim();
    if (!text) return;
    
    const newUserHistory = [...chatHistory, { role: 'user', text } as const];
    setChatHistory(newUserHistory);
    setChatInput("");
    setIsBotThinking(true);
    
    try {
      const res = await gemini.chatHelpAgent(text, botMode);
      const newBotHistory = [...newUserHistory, { role: 'bot', text: res } as const];
      setChatHistory(newBotHistory);
      
      if (botMode === 'nav') {
        const suggestions = await gemini.getChatSuggestions(newBotHistory);
        if (suggestions && suggestions.length > 0) {
          setSuggestedQuestions(suggestions.map(s => ({ label: s, query: s })));
        }
      }
    } catch (e) {
      setChatHistory(prev => [...prev, { role: 'bot', text: '一時的な通信エラーです。' }]);
    } finally {
      setIsBotThinking(false);
    }
  };

  const injectPreviewScript = (html: string | undefined) => {
    if (!html) return `<div style="padding: 40px; text-align: center; color: #94a3b8; font-family: sans-serif;">
      <h2 style="font-weight: 900;">コンテンツがありません</h2>
      <p>構築を開始するか、GitHubからインポートしてください。</p>
    </div>`;
    
    const script = `
    <script>
      document.addEventListener('click', e => {
        const a = e.target.closest('a');
        if (a && a.getAttribute('href') && !a.getAttribute('href').startsWith('http')) {
          e.preventDefault();
          window.parent.postMessage({ type: 'PREVIEW_NAV', href: a.getAttribute('href') }, '*');
        }
      });
    </script>`;
    
    if (html.includes('</body>')) {
      return html.replace('</body>', `${script}</body>`);
    }
    return html + script;
  };

  useEffect(() => {
    const handleNav = (e: MessageEvent) => {
      if (e.data?.type === 'PREVIEW_NAV') {
        const href = e.data.href;
        const slug = href.replace('.html', '').split('/').pop() || 'index';
        const hub = state.hubs.find(h => h.slug === slug);
        if (hub) setSelectedHubId(hub.id);
      }
    };
    window.addEventListener('message', handleNav);
    return () => window.removeEventListener('message', handleNav);
  }, [state.hubs]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 font-sans">
      
      {/* 実行中オーバーレイ */}
      {(state.status !== 'idle' && state.status !== 'ready') && (
        <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-lg flex flex-col items-center justify-center p-8 text-white">
          <div className="relative mb-10">
            <i className="fa-solid fa-robot text-8xl text-indigo-400 animate-pulse"></i>
            <div className="absolute -top-2 -right-2 w-6 h-6 bg-rose-500 rounded-full animate-ping"></div>
          </div>
          <p className="text-3xl font-black mb-3 tracking-tighter">{statusLabels[state.status]}</p>
          <p className="text-indigo-300 font-mono text-sm mb-12 h-6">{progressMessage}</p>
          
          <button 
            onClick={handleAbort}
            className="px-10 py-4 bg-white/5 hover:bg-white/10 border border-white/20 rounded-full text-[10px] font-black tracking-[0.2em] transition-all hover:border-white/40 active:scale-95"
          >
            処理を中断する
          </button>
        </div>
      )}

      {/* ナビゲーション */}
      <header className="bg-white border-b px-8 py-4 flex justify-between items-center z-50 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200"><i className="fa-solid fa-wand-magic-sparkles text-lg"></i></div>
          <h1 className="font-black text-xl tracking-tighter text-slate-900">MySiteGen<span className="text-indigo-600">エージェント</span></h1>
        </div>
        <nav className="flex bg-slate-100 p-1 rounded-2xl">
          {['build', 'dashboard', 'preview'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab as any)} disabled={tab !== 'build' && !state.identity}
              className={`px-8 py-2.5 text-xs font-black rounded-xl transition-all ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {tab === 'build' ? 'サイト構築' : tab === 'dashboard' ? '運用管理' : 'プレビュー'}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 overflow-auto p-8">
        <div className="max-w-6xl mx-auto h-full">
          {activeTab === 'build' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full items-start">
              <section className="bg-white p-10 rounded-[2.5rem] border shadow-sm space-y-10">
                <div className="space-y-2">
                  <h2 className="text-2xl font-black flex items-center gap-3"><i className="fa-solid fa-seedling text-indigo-500"></i> ブランドの種</h2>
                  <p className="text-xs text-slate-400 font-medium">あなたの理念やサイトの目的をAIに伝えてください。そこから全てが始まります。</p>
                </div>
                
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">理念・ミッションステートメント</label>
                  <textarea className="w-full h-40 p-6 border-2 border-slate-50 rounded-[2rem] bg-slate-50 outline-none focus:border-indigo-500 text-sm font-medium transition-all leading-relaxed" 
                    value={state.opinion} onChange={e => updateState({ opinion: e.target.value })} 
                    placeholder="例: 私たちはテクノロジーで地方の課題を解決し、人々の笑顔を増やします。" />
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">初期トーン（お好みで）</label>
                  <div className="grid grid-cols-5 gap-3">
                    {tones.map(t => (
                      <button key={t.value} onClick={() => setSelectedTone(selectedTone === t.value ? null : t.value)} 
                        className={`flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all group ${selectedTone === t.value ? 'border-indigo-600 bg-indigo-50 text-indigo-600 shadow-sm' : 'border-slate-50 bg-slate-50 text-slate-300 hover:border-slate-200 hover:text-slate-500'}`}>
                        <i className={`fa-solid ${t.icon} text-xl group-hover:scale-110 transition-transform`}></i>
                        <span className="text-[8px] font-black">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <button onClick={handleInitialBuild} className="flex-1 py-5 bg-slate-900 text-white rounded-[2rem] font-black text-sm hover:bg-indigo-600 transition-all shadow-xl active:scale-95">新規構築を開始</button>
                  <button onClick={() => setShowImport(true)} className="px-10 bg-white border-2 border-slate-100 rounded-[2rem] font-black text-xs text-slate-500 hover:bg-slate-50 transition-all border-dashed">GitHubから復元</button>
                </div>
              </section>

              <div className="flex flex-col justify-center items-center h-full">
                {state.identity ? (
                  <div className="bg-white p-12 rounded-[3rem] border shadow-lg w-full animate-fadeIn border-indigo-100 relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><i className="fa-solid fa-quote-right text-9xl"></i></div>
                     <div className="flex items-center gap-8 mb-10 border-b pb-10">
                       <div className="w-24 h-24 rounded-[2rem] flex items-center justify-center text-white text-4xl font-black shadow-xl" style={{ backgroundColor: state.identity.themeColor }}>{state.identity.siteName[0]}</div>
                       <div>
                         <h3 className="text-3xl font-black text-slate-900 mb-1">{state.identity.siteName}</h3>
                         <p className="text-indigo-600 font-black text-sm uppercase tracking-wider">{state.identity.mission}</p>
                       </div>
                     </div>
                     <p className="text-slate-500 text-lg leading-relaxed font-medium mb-8">{state.identity.brandDescription}</p>
                     <div className="flex gap-3">
                        <span className="px-5 py-2 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded-full uppercase tracking-[0.1em] border border-indigo-100">{state.identity.tone} STYLE</span>
                        <button onClick={() => setActiveTab('dashboard')} className="px-5 py-2 bg-slate-900 text-white text-[10px] font-black rounded-full uppercase tracking-[0.1em] ml-auto hover:bg-indigo-600 transition-colors">管理画面へ <i className="fa-solid fa-arrow-right ml-1"></i></button>
                     </div>
                  </div>
                ) : (
                  <div className="text-slate-200 text-center animate-pulse">
                    <i className="fa-solid fa-fingerprint text-9xl mb-8"></i>
                    <p className="font-black text-sm uppercase tracking-[0.3em]">Identity Awaiting</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && state.identity && (
            <div className="space-y-8 animate-fadeIn pb-32">
               <section className="bg-gradient-to-br from-indigo-50 via-white to-blue-50 p-12 rounded-[3rem] border-2 border-indigo-100 shadow-sm">
                  <div className="mb-8">
                    <h2 className="text-2xl font-black mb-2 flex items-center gap-3 text-slate-900"><i className="fa-solid fa-swatchbook text-indigo-500"></i> 全ページ反映・デザイン調整</h2>
                    <p className="text-sm text-slate-500 font-medium">Googleタグマネージャーの設置指示や、全体のフォント・配色変更などを1回で全ページに反映します。</p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                    <div className="md:col-span-1">
                      <label className="text-[10px] font-black text-slate-400 mb-3 block pl-2 uppercase tracking-widest">対象範囲</label>
                      <select className="w-full p-5 border-2 border-white rounded-2xl bg-white shadow-sm font-bold text-sm outline-none focus:border-indigo-400 appearance-none cursor-pointer" value={tuningTargetId} onChange={e => setTuningTargetId(e.target.value)}>
                        <option value="all">全ページ一括 (推奨)</option>
                        <optgroup label="セクション別">
                          {state.hubs.map(h => <option key={h.id} value={h.id}>{h.title}</option>)}
                        </optgroup>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[10px] font-black text-slate-400 mb-3 block pl-2 uppercase tracking-widest">反映内容 (自然言語で指示)</label>
                      <input type="text" className="w-full p-5 border-2 border-white rounded-2xl bg-white shadow-sm font-bold text-sm outline-none focus:border-indigo-400 transition-all" 
                        placeholder="例: 全てのヘッダーにGTMタグ(GTM-XXXX)を設置して / 配色をさらに高級感のあるものに" value={tuningInstruction} onChange={e => setTuningInstruction(e.target.value)} />
                    </div>
                    <button onClick={handleTuneDesign} className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-sm hover:bg-indigo-600 shadow-xl shadow-slate-200 transition-all active:scale-95">反映を開始する</button>
                  </div>
               </section>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <button onClick={() => setShowProjectModal(true)} className="p-12 bg-white border rounded-[3rem] hover:shadow-2xl transition-all text-left group border-slate-100">
                    <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform"><i className="fa-solid fa-plus text-2xl"></i></div>
                    <h3 className="text-2xl font-black mb-3">実績をページ化する</h3>
                    <p className="text-sm text-slate-500 leading-relaxed font-medium">新しい実績資料をAIに読み込ませて、ブランドトーンを維持した紹介ページを自動生成します。</p>
                  </button>
                  
                  <div className="p-12 bg-white border rounded-[3rem] border-slate-100 flex flex-col">
                    <h3 className="text-xl font-black mb-8 flex items-center gap-3"><i className="fa-solid fa-chart-pie text-slate-300"></i> コンテンツ構造の分析</h3>
                    <div className="flex-1">
                      <AnalysisChart data={state.hubs.filter(h => h.id !== 'home').map(h => ({ name: h.title, count: state.articles.filter(a => a.hubId === h.id).length + 1 }))} />
                    </div>
                  </div>
               </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="h-full bg-white rounded-[3rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col animate-fadeIn">
               <div className="bg-slate-50 px-8 py-4 border-b flex justify-between items-center text-[10px] font-black text-slate-400">
                  <div className="flex gap-2"><div className="w-3 h-3 rounded-full bg-rose-400"></div><div className="w-3 h-3 rounded-full bg-amber-400"></div><div className="w-3 h-3 rounded-full bg-emerald-400"></div></div>
                  <div className="bg-white border px-4 py-1 rounded-full font-mono text-slate-400 shadow-inner flex items-center gap-2">
                    <i className="fa-solid fa-lock text-[8px] text-emerald-500"></i>
                    mysite-preview.local/{state.hubs.find(h => h.id === selectedHubId)?.slug || state.articles.find(a => a.id === selectedHubId)?.slug || 'index'}.html
                  </div>
                  <i className="fa-solid fa-rotate-right cursor-pointer hover:text-indigo-600 transition-colors"></i>
               </div>
               <iframe className="flex-1 w-full border-none" srcDoc={injectPreviewScript(state.hubs.find(h => h.id === selectedHubId)?.html || state.articles.find(a => a.id === selectedHubId)?.contentHtml)} />
            </div>
          )}
        </div>
      </main>

      {/* サポートAIボット */}
      <div className="fixed bottom-10 right-10 z-[200] flex flex-col items-end gap-5" ref={botRef}>
        {isBotOpen && (
          <div className="w-80 sm:w-[420px] h-[600px] bg-white rounded-[2.5rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] border border-slate-100 overflow-hidden flex flex-col animate-slideUp">
            <div className="bg-slate-900 p-8 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center text-xl shadow-lg shadow-indigo-500/20"><i className="fa-solid fa-robot"></i></div>
                <div>
                  <h4 className="font-black tracking-tight text-lg">MySiteエージェント</h4>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{botMode === 'nav' ? '操作案内中' : '要望受付中'}</p>
                  </div>
                </div>
              </div>
              <button onClick={() => setIsBotOpen(false)} className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            
            <div className="flex-1 overflow-auto p-6 space-y-6 bg-slate-50/50">
              {chatHistory.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-4 rounded-3xl text-sm font-medium leading-relaxed shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-100 text-slate-700'}`}>{m.text}</div>
                </div>
              ))}
              {isBotThinking && (
                <div className="flex items-center gap-2 px-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-white border-t space-y-4 shrink-0">
              {botMode === 'nav' && (
                <div className="flex flex-wrap gap-2">
                  {suggestedQuestions.map((p, i) => (
                    <button 
                      key={i} 
                      onClick={() => handleBotSend(p.query)} 
                      className="px-4 py-2 bg-slate-50 text-slate-600 rounded-full text-[11px] font-black hover:bg-indigo-600 hover:text-white transition-all border border-slate-100 hover:border-indigo-600 shadow-sm"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button onClick={() => {
                  setBotMode(botMode === 'nav' ? 'request' : 'nav');
                  setSuggestedQuestions(initialHelpPrompts);
                }} 
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-md ${botMode === 'request' ? 'bg-amber-500 text-white shadow-amber-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`} title="モード切替">
                  <i className={`fa-solid ${botMode === 'nav' ? 'fa-comment-dots' : 'fa-lightbulb'} text-lg`}></i>
                </button>
                <div className="flex-1 relative">
                  <input type="text" className="w-full p-4 bg-slate-50 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-100 border border-transparent transition-all pr-12" 
                    placeholder={botMode === 'nav' ? "使い方を尋ねる..." : "新機能を要望する..."} value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleBotSend()} />
                  <button onClick={() => handleBotSend()} className="absolute right-2 top-2 w-10 h-10 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-200 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"><i className="fa-solid fa-paper-plane text-xs"></i></button>
                </div>
              </div>
            </div>
          </div>
        )}
        <button onClick={() => setIsBotOpen(!isBotOpen)} className="w-20 h-20 bg-indigo-600 text-white rounded-[2rem] shadow-2xl flex items-center justify-center text-4xl hover:scale-110 active:scale-95 transition-all group relative">
          <i className={`fa-solid ${isBotOpen ? 'fa-xmark' : 'fa-comments'} group-hover:rotate-12 transition-transform`}></i>
          {!isBotOpen && <div className="absolute -top-1 -right-1 w-6 h-6 bg-rose-500 border-4 border-slate-50 rounded-full shadow-lg"></div>}
        </button>
      </div>

      {/* GitHubインポートモーダル */}
      {showImport && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-white p-10 rounded-[3rem] max-w-md w-full shadow-2xl space-y-8 border border-slate-100">
            <div className="text-center">
              <i className="fa-brands fa-github text-6xl mb-6 text-slate-900"></i>
              <h3 className="text-2xl font-black">既存サイトの復元</h3>
              <p className="text-xs text-slate-400 font-bold mt-2 uppercase tracking-widest">Import from Repository</p>
            </div>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 pl-1">リポジトリ名 (user/repo)</label>
                <input type="text" className="w-full p-5 border-2 border-slate-50 rounded-2xl bg-slate-50 outline-none font-bold text-sm focus:border-indigo-500 transition-all" placeholder="username/my-site" value={importRepo} onChange={e => setImportRepo(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 pl-1">個人用アクセストークン</label>
                <input type="password" className="w-full p-5 border-2 border-slate-50 rounded-2xl bg-slate-50 outline-none font-bold text-sm focus:border-indigo-500 transition-all" placeholder="ghp_xxxx..." value={importToken} onChange={e => setImportToken(e.target.value)} />
              </div>
            </div>
            
            <div className="flex gap-4 pt-4">
              <button onClick={() => setShowImport(false)} className="flex-1 py-5 font-black text-xs bg-slate-100 rounded-[2rem] hover:bg-slate-200 transition-colors">キャンセル</button>
              <button onClick={handleImport} className="flex-[2] py-5 bg-indigo-600 text-white font-black text-xs rounded-[2rem] shadow-xl shadow-indigo-200 active:scale-95 transition-all">読み込み開始</button>
            </div>
          </div>
        </div>
      )}

      {/* 実績追加モーダル */}
      {showProjectModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-white p-10 rounded-[3rem] max-w-xl w-full shadow-2xl space-y-8 border border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-2xl shadow-inner"><i className="fa-solid fa-pen-nib"></i></div>
              <div>
                <h3 className="text-2xl font-black">実績資料のインプット</h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Project Content Analyzer</p>
              </div>
            </div>
            
            <textarea className="w-full h-56 p-6 border-2 border-slate-50 rounded-[2rem] bg-slate-50 outline-none text-sm font-medium focus:border-indigo-400 transition-all leading-relaxed" 
              placeholder="プロジェクトの概要、苦労した点、技術、得られた成果などを自由に入力してください。AIがそれを解析し、最適なページを生成します。" value={projectMaterial} onChange={e => setProjectMaterial(e.target.value)} />
            
            <div className="flex gap-4">
              <button onClick={() => setShowProjectModal(false)} className="flex-1 py-5 font-black text-xs bg-slate-100 rounded-[2rem] hover:bg-slate-200 transition-colors">キャンセル</button>
              <button onClick={async () => {
                 if (!projectMaterial) return;
                 const signal = startTask();
                 updateState({ status: 'generating_hubs' });
                 setProgressMessage("実績を分析して新しいページを構築中...");
                 setShowProjectModal(false);
                 try {
                   const info = await gemini.generateProjectShowcaseAgent(projectMaterial, state.identity!, state.hubs, signal);
                   const html = await gemini.generateHtmlAgent(info, state.identity!, state.siteType, state.hubs, [], false, undefined, undefined, signal);
                   const newArt: Article = { id: Math.random().toString(36).substr(2, 9), hubId: info.targetHubId, title: info.title, slug: info.slug, contentHtml: html, createdAt: new Date().toISOString() };
                   updateState({ articles: [...state.articles, newArt] });
                   setSelectedHubId(newArt.id);
                   setActiveTab('preview');
                   alert("新しいページが完成しました！プレビューで確認してください。");
                 } catch (e: any) { 
                   if (e.name === 'AbortError') return;
                   alert("生成中にエラーが発生しました。"); 
                 } finally { updateState({ status: 'ready' }); setProgressMessage(""); setProjectMaterial(""); }
              }} className="flex-[2] py-5 bg-slate-900 text-white font-black text-xs rounded-[2rem] shadow-xl active:scale-95 transition-all">AIでページ生成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
