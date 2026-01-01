import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectState, SiteType, Identity, HubPage, Article, GitHubConfig } from './types';
import * as gemini from './services/geminiService';
import * as github from './services/githubService';
import AnalysisChart from './components/AnalysisChart';

const STORAGE_KEY = 'mysitegen_state_v2';

const statusLabels: Record<string, string> = {
  idle: '待機中',
  importing: 'リポジトリ解析中...',
  analyzing_site: 'AI構造分析中...',
  building_identity: 'アイデンティティ生成中...',
  generating_strategy: '戦略策定中...',
  generating_hubs: 'ページ生成中...',
  ready: '準備完了',
  creating_repo: 'リポジトリ作成中...',
  pushing_files: 'デプロイ中...',
  enabling_pages: 'Pages設定中...',
  tuning_design: 'デザイン調整中...'
};

const App: React.FC = () => {
  const [state, setState] = useState<ProjectState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    return {
      opinion: "技術的人道主義：テクノロジーは人間の精神を代替するものではなく、奉仕するものであるべきだ。",
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
  const [isImproving, setIsImproving] = useState(false);
  const [publishStatus, setPublishStatus] = useState<'idle' | 'processing'>('idle');
  
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectMaterial, setProjectMaterial] = useState("");
  const [projectDesignInstruction, setProjectDesignInstruction] = useState(""); // New: Design instruction
  const [isGeneratingProject, setIsGeneratingProject] = useState(false);

  // Design Tuner State
  const [tuningTargetId, setTuningTargetId] = useState<string>("");
  const [tuningInstruction, setTuningInstruction] = useState("");

  // Detailed Progress Message
  const [progressMessage, setProgressMessage] = useState("");

  const [showImport, setShowImport] = useState(false);
  const [importRepo, setImportRepo] = useState("");
  const [importToken, setImportToken] = useState("");

  // Process Abort Controller
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // プレビュータブを開いた時、未選択ならホームを自動選択
  useEffect(() => {
    if (activeTab === 'preview' && !selectedHubId && state.hubs.length > 0) {
      const homeHub = state.hubs.find(h => h.slug === 'index') || state.hubs[0];
      if (homeHub) setSelectedHubId(homeHub.id);
    }
  }, [activeTab, selectedHubId, state.hubs]);

  // プレビュー内のナビゲーションイベントハンドリング
  useEffect(() => {
    const handlePreviewMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'PREVIEW_NAV') return;
      const href = event.data.href as string;
      if (!href) return;

      console.log('Preview navigation:', href);

      // 1. ホームへの遷移判定
      if (href === 'index.html' || href === './index.html' || href === '../index.html') {
        const home = state.hubs.find(h => h.slug === 'index');
        if (home) setSelectedHubId(home.id);
        return;
      }

      // 2. Hub（セクション）への遷移判定 ([slug]/index.html または ../[slug]/index.html)
      // "contact/index.html" -> ["contact", "index.html"]
      const cleanHref = href.replace(/^\.\//, '').replace(/^\.\.\//, '');
      const sectionMatch = cleanHref.match(/^([^\/]+)\/index\.html$/);
      
      if (sectionMatch) {
        const slug = sectionMatch[1];
        const hub = state.hubs.find(h => h.slug === slug);
        if (hub) {
          setSelectedHubId(hub.id);
          return;
        }
      }

      // 3. 記事への遷移判定 ([slug].html)
      const articleMatch = cleanHref.match(/^([^\/]+)\.html$/);
      if (articleMatch) {
        const slug = articleMatch[1];
        if (slug !== 'index') {
          const article = state.articles.find(a => a.slug === slug);
          if (article) {
             setSelectedHubId(article.id);
             return;
          }
        }
      }
      
      console.warn('Navigation target not found:', href);
    };

    window.addEventListener('message', handlePreviewMessage);
    return () => window.removeEventListener('message', handlePreviewMessage);
  }, [state.hubs, state.articles]);

  const updateState = (updates: Partial<ProjectState>) => {
    setState(prev => ({ ...prev, ...updates }));
  };

  const updateGithubConfig = (updates: Partial<GitHubConfig>) => {
    setState(prev => ({
      ...prev,
      githubConfig: { ...prev.githubConfig, ...updates }
    }));
  };

  /**
   * Helper to simulate detailed progress steps for long-running AI tasks.
   * Updates the progress message periodically to keep the user informed.
   */
  const runProgressSimulation = (steps: string[], interval: number = 3000, onUpdate: (msg: string) => void) => {
    let index = 0;
    onUpdate(steps[0]);
    
    const timer = setInterval(() => {
      index++;
      if (index < steps.length) {
        onUpdate(steps[index]);
      }
    }, interval);

    return () => clearInterval(timer);
  };

  // キャンセル処理
  const handleCancelProcess = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    updateState({ status: 'idle' });
    setIsImproving(false);
    setIsGeneratingProject(false);
    setPublishStatus('idle');
    setProgressMessage("");
    alert("処理を中断しました。");
  }, []);

  const handleImport = async () => {
    const rawRepo = importRepo.trim();
    const cleanToken = importToken.trim();

    if (!rawRepo || !cleanToken) {
      alert("リポジトリ(URL)とトークンを入力してください。");
      return;
    }

    // Reset Controller
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      updateState({ status: 'importing' });
      setProgressMessage("GitHubからリポジトリ情報を取得しています...");
      
      const tempConfig = { token: cleanToken, repo: rawRepo, branch: '', path: '' };
      const repoDetails = await github.fetchRepoDetails(tempConfig, signal);
      const defaultBranch = repoDetails.default_branch || 'main';
      const config = { token: cleanToken, repo: rawRepo, branch: defaultBranch, path: '' }; 
      
      setProgressMessage("ファイル構造をスキャンしています...");
      const tree = await github.fetchRepoStructure(config, signal);
      
      // index.htmlの探索（ルート、docs、publicの順）
      const possibleIndexPaths = ['index.html', 'docs/index.html', 'public/index.html', 'site/index.html'];
      const indexNode = tree.find(node => possibleIndexPaths.includes(node.path));
      
      if (!indexNode) {
        throw new Error("サイトの基点となる index.html が見つかりませんでした。静的サイトのリポジトリであることを確認してください。");
      }

      const rootDir = indexNode.path.includes('/') ? indexNode.path.split('/')[0] : '';
      updateState({ status: 'analyzing_site' });
      setProgressMessage("index.htmlを解析してアイデンティティを抽出中...");
      
      if (signal.aborted) return;
      const indexContent = await github.fetchFileContent(indexNode.url, cleanToken, signal);
      
      if (signal.aborted) return;
      const identity = await gemini.analyzeSiteIdentityAgent(indexContent);

      const hubs: HubPage[] = [];
      const articles: Article[] = [];
      
      hubs.push({
        id: 'home',
        title: 'ホーム',
        slug: 'index',
        description: 'メインエントランス',
        html: indexContent
      });

      // HTMLファイルの自動マッピング
      setProgressMessage("サイト内のページをインポートしています...");
      for (const node of tree) {
        if (signal.aborted) return;
        if (node.type !== 'blob' || !node.path.endsWith('.html')) continue;
        if (rootDir && !node.path.startsWith(rootDir + '/')) continue;

        const relativePath = rootDir ? node.path.substring(rootDir.length + 1) : node.path;
        if (relativePath === 'index.html') continue;

        const parts = relativePath.split('/');
        
        // [slug]/index.html 形式を HubPage として認識
        if (parts.length === 2 && parts[1] === 'index.html') {
          setProgressMessage(`セクション読み込み中: ${parts[0]}...`);
          const content = await github.fetchFileContent(node.url, cleanToken, signal);
          const titleMatch = content.match(/<title>(.*?)<\/title>/i);
          const title = titleMatch ? titleMatch[1].split(/[|-]/)[0].trim() : parts[0];
          
          hubs.push({
            id: Math.random().toString(36).substr(2, 9),
            title,
            slug: parts[0],
            description: 'Imported Hub',
            html: content
          });
        }
      }

      // Hub配下の記事をマッピング
      for (const node of tree) {
        if (signal.aborted) return;
        if (node.type !== 'blob' || !node.path.endsWith('.html')) continue;
        if (rootDir && !node.path.startsWith(rootDir + '/')) continue;

        const relativePath = rootDir ? node.path.substring(rootDir.length + 1) : node.path;
        const parts = relativePath.split('/');

        if (parts.length === 2 && parts[1] !== 'index.html') {
          const parentHub = hubs.find(h => h.slug === parts[0]);
          if (parentHub) {
            setProgressMessage(`記事読み込み中: ${parts[1]}...`);
            const content = await github.fetchFileContent(node.url, cleanToken, signal);
            const titleMatch = content.match(/<title>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].split(/[|-]/)[0].trim() : parts[1].replace('.html', '');

            articles.push({
              id: Math.random().toString(36).substr(2, 9),
              hubId: parentHub.id,
              title,
              slug: parts[1].replace('.html', ''),
              contentHtml: content,
              createdAt: new Date().toISOString()
            });
          }
        }
      }

      if (signal.aborted) return;

      updateState({
        identity,
        hubs,
        articles,
        status: 'ready',
        githubConfig: { token: cleanToken, repo: rawRepo, branch: defaultBranch, path: rootDir },
        opinion: identity.mission
      });
      
      setShowImport(false);
      setProgressMessage("");
      setActiveTab('dashboard');
      alert(`インポート成功!\n${hubs.length}つのセクションと ${articles.length}つの記事を解析しました。`);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log("Import cancelled by user");
        return;
      }
      console.error(error);
      alert(`インポート失敗: ${error.message}`);
      updateState({ status: 'idle' });
      setProgressMessage("");
    }
  };

  const handleInitialBuild = async () => {
    let stopProgress: (() => void) | null = null;
    try {
      updateState({ status: 'building_identity' });
      
      stopProgress = runProgressSimulation([
        "あなたの理念からブランドアイデンティティを抽出中...",
        "コアとなる価値観と言語トーンを定義中...",
        "最適な配色とデザインテーマを選定中..."
      ], 2500, setProgressMessage);
      
      const identity = await gemini.generateIdentityAgent(state.opinion, state.siteType);
      
      if (stopProgress) stopProgress();
      updateState({ identity, status: 'generating_strategy' });
      
      stopProgress = runProgressSimulation([
        "ブランドアイデンティティに基づくサイト構造を設計中...",
        "ユーザー体験(UX)フローを最適化中...",
        "必要なセクションとコンテンツ戦略を立案中..."
      ], 2500, setProgressMessage);
      
      const { hubs, rationale } = await gemini.generateStrategyAgent(identity, state.siteType);
      
      if (stopProgress) stopProgress();
      updateState({ hubs, strategyRationale: rationale, status: 'generating_hubs' });
      setProgressMessage("各ページのHTMLコンテンツを生成しています...");

      const updatedHubs: HubPage[] = [];
      for (const hub of hubs) {
        setProgressMessage(`セクション生成中: ${hub.title}...`);
        const links = [{ title: "ホームに戻る", url: "../index.html" }];
        await new Promise(r => setTimeout(r, 1500));
        // 初期構築時はreferenceHtmlなし
        const html = await gemini.generateHtmlAgent(hub, identity, state.siteType, hubs, links, false);
        updatedHubs.push({ ...hub, html });
      }

      setProgressMessage("トップページを生成しています...");
      const indexPage = { title: identity.siteName, description: identity.mission };
      const hubLinks = updatedHubs.map(h => ({ title: h.title, url: `${h.slug}/index.html` }));
      await new Promise(r => setTimeout(r, 1500));
      const indexHtml = await gemini.generateHtmlAgent(indexPage, identity, state.siteType, updatedHubs, hubLinks, true);
      
      const homeHub: HubPage = { id: 'home', title: 'ホーム', slug: 'index', description: 'メインエントランス', html: indexHtml };

      updateState({ hubs: [homeHub, ...updatedHubs], status: 'ready' });
      setActiveTab('dashboard');
    } catch (error: any) {
      alert(`構築失敗: ${error.message}`);
      updateState({ status: 'idle' });
    } finally {
      if (stopProgress) stopProgress();
      setProgressMessage("");
    }
  };

  const handleAddProject = async () => {
    if (!projectMaterial || !state.identity) return;
    setIsGeneratingProject(true);
    let stopProgress: (() => void) | null = null;
    
    try {
      stopProgress = runProgressSimulation([
         "プロジェクト資料から重要ポイントを抽出中...",
         "最適な掲載セクションをAIが選定中...",
         "プレゼンテーション構成を設計中...",
         "デザインガイドラインに沿ってHTMLを生成中..."
      ], 3000, setProgressMessage);

      const projectInfo = await gemini.generateProjectShowcaseAgent(projectMaterial, state.identity, state.hubs);
      const targetHub = state.hubs.find(h => h.id === projectInfo.targetHubId);
      if (!targetHub) throw new Error("セクションマッチング失敗");

      const links = [
        { title: "ホームに戻る", url: "../index.html" },
        { title: `${targetHub.title} に戻る`, url: "index.html" }
      ];

      // スタイル参照用にホームページのHTMLを取得
      const homePage = state.hubs.find(h => h.slug === 'index');
      const referenceHtml = homePage ? homePage.html : undefined;

      const contentHtml = await gemini.generateHtmlAgent(
        { title: projectInfo.title, description: projectInfo.description, material: projectMaterial },
        state.identity, state.siteType, state.hubs.filter(h => h.id !== 'home'), links, false,
        referenceHtml, // ホームページのスタイルを渡す
        projectDesignInstruction // ユーザーの追加指示を渡す
      );

      const newArticle: Article = {
        id: Math.random().toString(36).substr(2, 9),
        hubId: targetHub.id,
        title: projectInfo.title,
        slug: projectInfo.slug,
        contentHtml,
        createdAt: new Date().toISOString()
      };

      const updatedArticles = [...state.articles, newArticle];
      const hubArticles = updatedArticles.filter(a => a.hubId === targetHub.id);
      const hubLinks = [{ title: "ホームに戻る", url: "../index.html" }, ...hubArticles.map(a => ({ title: a.title, url: `${a.slug}.html` }))];
      
      setProgressMessage("セクションのリンク構造を更新しています...");
      // Hub側も更新（リンク追加のため）
      const newHubHtml = await gemini.generateHtmlAgent(targetHub, state.identity, state.siteType, state.hubs.filter(h => h.id !== 'home'), hubLinks, false, referenceHtml);
      const updatedHubs = state.hubs.map(h => h.id === targetHub.id ? { ...h, html: newHubHtml } : h);

      updateState({ articles: updatedArticles, hubs: updatedHubs });
      setShowProjectModal(false);
      setProjectMaterial("");
      setProjectDesignInstruction("");
      alert(`実績「${projectInfo.title}」を追加しました。`);
    } catch (error: any) {
      alert(`エラー: ${error.message}`);
    } finally {
      if (stopProgress) stopProgress();
      setIsGeneratingProject(false);
      setProgressMessage("");
    }
  };

  const handleTuneDesign = async () => {
    if (!tuningTargetId || !state.identity) {
      alert("調整するページを選択してください。");
      return;
    }
    if (!tuningInstruction.trim()) {
       alert("具体的な変更指示を入力してください。\n例：「全体的に文字を大きく」「トップページの配色に合わせて」など");
       return;
    }

    let stopProgress: (() => void) | null = null;

    try {
      updateState({ status: 'tuning_design' }); // Correct type
      
      // Start simulated progress
      stopProgress = runProgressSimulation([
        "現在のHTML構造とコンテンツを解析中...",
        "参照元のデザインパターン（色・フォント・余白）を抽出中...",
        "指示内容に基づき、新しいレイアウト方針を策定中...",
        "Tailwind CSSクラスを適用し、スタイルを刷新しています...",
        "レスポンシブ対応と視認性のチェックを行っています...",
        "最終的なHTMLコードを生成・最適化中..."
      ], 3000, setProgressMessage);
      
      // Find Target
      let targetHub = state.hubs.find(h => h.id === tuningTargetId);
      let targetArticle = state.articles.find(a => a.id === tuningTargetId);
      const currentHtml = targetHub?.html || targetArticle?.contentHtml;
      
      if (!currentHtml) throw new Error("ページコンテンツが見つかりません。");

      // Find Reference (Home page, unless target IS home)
      const homePage = state.hubs.find(h => h.slug === 'index');
      let referenceHtml = homePage?.html;

      // If tuning Home, reference itself (or undefined to rely purely on instruction)
      if (targetHub?.slug === 'index') {
         referenceHtml = undefined; // No external reference, just update based on instruction
      }

      const newHtml = await gemini.tunePageDesignAgent(
        currentHtml, 
        referenceHtml, 
        tuningInstruction, 
        state.identity
      );

      if (targetHub) {
        const updatedHubs = state.hubs.map(h => h.id === targetHub!.id ? { ...h, html: newHtml } : h);
        updateState({ hubs: updatedHubs });
      } else if (targetArticle) {
        const updatedArticles = state.articles.map(a => a.id === targetArticle!.id ? { ...a, contentHtml: newHtml } : a);
        updateState({ articles: updatedArticles });
      }

      setTuningInstruction("");
      alert("デザイン調整が完了しました。「プレビュー」で確認してください。");

    } catch(error: any) {
      alert(`調整エラー: ${error.message}`);
    } finally {
      if (stopProgress) stopProgress();
      updateState({ status: 'ready' });
      setProgressMessage("");
    }
  };

  const handleCreateAndPublish = async () => {
    if (!state.githubConfig.token || !state.githubConfig.repo) {
      alert("GitHubトークンとリポジトリURLを入力してください。");
      return;
    }
    
    // Reset Controller for Publish
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setPublishStatus('processing');
    try {
      updateState({ status: 'creating_repo' });
      setProgressMessage("GitHubリポジトリを作成・確認しています...");
      await github.createRepository(state.githubConfig, signal);
      
      updateState({ status: 'pushing_files' });
      setProgressMessage("READMEを作成しています...");
      if (signal.aborted) return;

      const readme = await gemini.generateReadmeAgent(state.identity!);
      if (signal.aborted) return;
      
      setProgressMessage("ファイルをGitHubへアップロードしています...");
      await github.publishToGithub(state.githubConfig, state.hubs, state.articles, readme, signal);
      
      updateState({ status: 'enabling_pages' });
      setProgressMessage("GitHub Pagesを有効化しています...");
      await github.enablePages(state.githubConfig, signal);
      
      alert("デプロイが完了しました。GitHub Pagesの反映まで数分かかる場合があります。");
      updateState({ status: 'ready' });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log("Publish cancelled");
        return;
      }
      alert(`デプロイエラー: ${error.message}`);
      updateState({ status: 'ready' });
    } finally {
      setPublishStatus('idle');
      setProgressMessage("");
    }
  };

  const analysisData = state.hubs.filter(h => h.id !== 'home').map(h => ({
    name: h.title,
    count: state.articles.filter(a => a.hubId === h.id).length
  }));

  // Helper for Preview Info
  const getActivePageInfo = () => {
    const hub = state.hubs.find(h => h.id === selectedHubId);
    if (hub) return { 
      title: hub.title, 
      path: hub.slug === 'index' ? 'index.html' : `${hub.slug}/index.html`, 
      type: 'Section' 
    };
    const article = state.articles.find(a => a.id === selectedHubId);
    if (article) return { 
      title: article.title, 
      path: `articles/${article.slug}.html`, 
      type: 'Article' 
    };
    return { title: 'No Page Selected', path: '-', type: '-' };
  };

  const activePageInfo = getActivePageInfo();
  
  // Check if system is busy
  const isBusy = state.status !== 'idle' && state.status !== 'ready';

  // Inject script to intercept clicks in iframe
  const injectPreviewScript = (html: string | undefined) => {
    if (!html) return `<div class="p-20 text-center font-bold text-slate-300">PREVIEW AREA<br/>Select a page from the menu</div>`;
    const script = `
      <script>
        document.addEventListener('click', function(e) {
          const link = e.target.closest('a');
          if (link) {
            e.preventDefault();
            const href = link.getAttribute('href');
            if (href && href !== '#') {
              window.parent.postMessage({ type: 'PREVIEW_NAV', href: href }, '*');
            }
          }
        });
      </script>
    `;
    return html + script;
  };

  const currentPreviewContent = state.hubs.find(h => h.id === selectedHubId)?.html || state.articles.find(a => a.id === selectedHubId)?.contentHtml;

  return (
    <div className={`flex flex-col h-screen overflow-hidden ${state.siteType === 'Corporate' ? 'bg-slate-50 text-slate-900' : 'bg-rose-50/20 text-slate-800'}`}>
      
      {/* Robot Working Overlay */}
      {isBusy && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-fadeIn">
          <div className="relative mb-8">
             <i className="fa-solid fa-robot text-8xl text-indigo-500 animate-bounce"></i>
             <i className="fa-solid fa-gear fa-spin text-5xl text-emerald-400 absolute -bottom-2 -right-4 shadow-lg rounded-full bg-slate-900 border-4 border-slate-900"></i>
          </div>
          <h3 className="text-2xl font-black text-white mb-2 tracking-tight">
             AI AGENT WORKING
          </h3>
          <p className="text-slate-400 font-mono text-sm mb-8 animate-pulse text-center max-w-lg px-4">
            {progressMessage || statusLabels[state.status] || 'Processing...'}
          </p>
          <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden mb-8">
            <div className="h-full bg-gradient-to-r from-indigo-500 via-emerald-400 to-indigo-500 animate-gradient-x w-full"></div>
          </div>
          <button 
            onClick={handleCancelProcess}
            className="px-8 py-3 bg-rose-500/20 text-rose-400 border border-rose-500/50 rounded-xl font-bold text-xs hover:bg-rose-500 hover:text-white transition-all"
          >
            <i className="fa-solid fa-ban mr-2"></i>
            処理を中断する
          </button>
        </div>
      )}

      <header className="bg-white/80 backdrop-blur-md border-b px-4 sm:px-8 py-4 flex justify-between items-center z-20 sticky top-0">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-xl transition-all ${state.siteType === 'Corporate' ? 'bg-indigo-600' : 'bg-rose-500'}`}>
            <i className={`fa-solid ${state.siteType === 'Corporate' ? 'fa-building-shield' : 'fa-wand-magic-sparkles'}`}></i>
          </div>
          <div className="hidden xs:block">
            <h1 className="font-black text-lg tracking-tight">MySiteGen<span className="text-indigo-600">Agent</span></h1>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Autonomous Web Lifecycle</p>
          </div>
        </div>
        
        <nav className="flex bg-slate-200/50 p-1.5 rounded-2xl">
          {['build', 'dashboard', 'preview'].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab as any)} disabled={tab !== 'build' && !state.identity}
              className={`px-3 sm:px-5 py-2 text-xs font-black rounded-xl transition-all ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-white/40'}`}>
              {tab === 'build' ? '構築' : tab === 'dashboard' ? '運用' : 'プレビュー'}
            </button>
          ))}
        </nav>

        <div className="hidden sm:flex items-center gap-4">
          <div className={`px-4 py-1.5 rounded-full text-[10px] font-black border flex items-center gap-2 ${state.status === 'ready' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>
            {state.status !== 'idle' && state.status !== 'ready' && <i className="fa-solid fa-spinner fa-spin"></i>}
            {statusLabels[state.status] || state.status}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-8">
        <div className="max-w-6xl mx-auto h-full">
          {activeTab === 'build' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
              <div className="space-y-6">
                <section className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm">
                  <div className="flex justify-between items-center mb-8">
                    <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
                      <i className="fa-solid fa-gear text-indigo-500"></i> Setup
                    </h2>
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button onClick={() => updateState({ siteType: 'Corporate' })} className={`px-4 py-2 text-[10px] font-black rounded-lg transition-all ${state.siteType === 'Corporate' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>CORPORATE</button>
                      <button onClick={() => updateState({ siteType: 'Personal' })} className={`px-4 py-2 text-[10px] font-black rounded-lg transition-all ${state.siteType === 'Personal' ? 'bg-white shadow-sm text-rose-500' : 'text-slate-400'}`}>PERSONAL</button>
                    </div>
                  </div>
                  
                  {!showImport ? (
                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Brand Philosophy</label>
                        <textarea className="w-full h-40 p-5 border-2 border-slate-100 rounded-3xl bg-slate-50 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-sm font-medium" 
                          placeholder="あなたの理念やビジョンを入力してください..." value={state.opinion} onChange={(e) => updateState({ opinion: e.target.value })} />
                      </div>
                      <button onClick={handleInitialBuild} disabled={state.status !== 'idle' && state.status !== 'ready'} 
                        className="w-full bg-slate-900 text-white py-5 rounded-[2rem] font-black text-sm shadow-xl hover:bg-indigo-600 transition-all flex items-center justify-center gap-3">
                        <i className="fa-solid fa-wand-magic-sparkles text-amber-400"></i> AIでサイトを新規構築
                      </button>
                      <div className="flex items-center gap-4 py-2">
                        <div className="h-px flex-1 bg-slate-100"></div>
                        <span className="text-[10px] font-black text-slate-300">OR</span>
                        <div className="h-px flex-1 bg-slate-100"></div>
                      </div>
                      <button onClick={() => setShowImport(true)} className="w-full py-4 rounded-[2rem] border-2 border-slate-200 text-slate-500 font-black text-[11px] hover:border-slate-800 hover:text-slate-800 transition-all flex items-center justify-center gap-2">
                        <i className="fa-brands fa-github text-lg"></i> 既存リポジトリをインポート
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-6 animate-fadeIn">
                      <div className="space-y-4">
                        <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">GitHub Repo URL / Name</label>
                          <input type="text" placeholder="https://github.com/owner/repo" className="w-full p-4 border-2 border-slate-100 rounded-2xl text-sm font-bold bg-slate-50 focus:border-indigo-500 outline-none" 
                            value={importRepo} onChange={e => setImportRepo(e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Personal Access Token</label>
                          <input type="password" placeholder="ghp_xxxxxxxxxxxx" className="w-full p-4 border-2 border-slate-100 rounded-2xl text-sm font-bold bg-slate-50 focus:border-indigo-500 outline-none" 
                            value={importToken} onChange={e => setImportToken(e.target.value)} />
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <button onClick={() => setShowImport(false)} className="flex-1 py-4 rounded-2xl font-black text-xs bg-slate-100 text-slate-500 hover:bg-slate-200">CANCEL</button>
                        <button onClick={handleImport} className="flex-[2] py-4 rounded-2xl font-black text-xs bg-slate-900 text-white hover:bg-indigo-600 shadow-lg">IMPORT & ANALYZE</button>
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <div className="h-full">
                {state.identity ? (
                  <section className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-200 h-full animate-slideUp">
                    <div className="flex items-center gap-8 mb-10 border-b border-slate-100 pb-10">
                      <div className="w-24 h-24 rounded-3xl shadow-2xl flex items-center justify-center text-white text-4xl font-black shrink-0" style={{ backgroundColor: state.identity.themeColor }}>
                        {state.identity.siteName.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-3xl font-black text-slate-800 mb-2">{state.identity.siteName}</h3>
                        <p className="text-indigo-600 font-black text-xs uppercase tracking-widest">{state.identity.mission}</p>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] mb-3 block">Brand Description</label>
                        <p className="text-slate-500 text-sm leading-relaxed font-medium">{state.identity.brandDescription}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-4">
                        {state.hubs.map(h => (
                          <span key={h.id} className="px-4 py-1.5 bg-slate-50 rounded-full text-[10px] font-black text-slate-400 border border-slate-100 uppercase tracking-wider">/{h.slug}</span>
                        ))}
                      </div>
                    </div>
                  </section>
                ) : (
                  <div className="h-full border-4 border-dashed border-slate-200 rounded-[2.5rem] flex flex-col items-center justify-center p-12 text-slate-300">
                    <i className="fa-solid fa-fingerprint text-6xl mb-6 opacity-20"></i>
                    <p className="font-black text-sm uppercase tracking-widest">Awaiting Brand Core</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && state.identity && (
            <div className="space-y-8 animate-fadeIn h-full pb-20">
              
              {/* New: Design Tuner Section */}
              <section className="bg-gradient-to-r from-indigo-50 to-blue-50 p-10 rounded-[2.5rem] border-2 border-indigo-100 shadow-lg relative overflow-hidden">
                 <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
                    <i className="fa-solid fa-paintbrush text-9xl"></i>
                 </div>
                 <div className="relative z-10">
                    <h2 className="text-2xl font-black mb-3 flex items-center gap-3 text-slate-800">
                      <i className="fa-solid fa-swatchbook text-indigo-500"></i> Design Tuner
                    </h2>
                    <p className="text-sm text-slate-500 mb-6 font-medium leading-relaxed max-w-2xl">
                       選択したページのデザインや雰囲気を、AIが既存のコンテンツを維持したまま調整します。「トップページに合わせて」「もっと落ち着いた色で」など、自然言語で指示してください。
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                       <div className="md:col-span-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block pl-1">Target Page</label>
                          <select 
                            className="w-full p-4 border-2 border-white rounded-2xl text-sm font-bold bg-white/80 outline-none focus:border-indigo-400 shadow-sm"
                            value={tuningTargetId}
                            onChange={(e) => setTuningTargetId(e.target.value)}
                          >
                             <option value="">ページを選択...</option>
                             <optgroup label="Sections">
                                {state.hubs.map(h => (
                                   <option key={h.id} value={h.id}>/{h.slug} ({h.title})</option>
                                ))}
                             </optgroup>
                             <optgroup label="Articles">
                                {state.articles.map(a => (
                                   <option key={a.id} value={a.id}>/articles/{a.slug} ({a.title})</option>
                                ))}
                             </optgroup>
                          </select>
                       </div>
                       <div className="md:col-span-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block pl-1">Adjustment Instruction</label>
                          <input 
                             type="text" 
                             className="w-full p-4 border-2 border-white rounded-2xl text-sm font-bold bg-white/80 outline-none focus:border-indigo-400 shadow-sm placeholder-slate-300"
                             placeholder="例: 全体的に余白を広げて / トップページのデザインルールを適用して..."
                             value={tuningInstruction}
                             onChange={(e) => setTuningInstruction(e.target.value)}
                          />
                       </div>
                       <div className="md:col-span-1">
                          <button 
                            onClick={handleTuneDesign}
                            disabled={!tuningTargetId || !tuningInstruction}
                            className="w-full p-4 bg-slate-900 text-white rounded-2xl font-black text-sm hover:bg-indigo-600 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <i className="fa-solid fa-wand-magic-sparkles text-amber-300 mr-2"></i>
                            TUNE
                          </button>
                       </div>
                    </div>
                 </div>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <section className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col justify-between group hover:border-slate-300 transition-all">
                  <div>
                    <h2 className="text-2xl font-black mb-3 flex items-center gap-3">
                      <i className="fa-solid fa-plus-circle text-indigo-500"></i> Add Project
                    </h2>
                    <p className="text-sm text-slate-500 mb-8 font-medium leading-relaxed">プロジェクトの成果や技術資料を投入してください。AIが自動的に構成し、最適なセクションへ配置します。</p>
                  </div>
                  <button onClick={() => setShowProjectModal(true)} className="w-full bg-indigo-50 text-indigo-600 border-2 border-indigo-100 py-5 rounded-2xl font-black text-sm hover:bg-indigo-600 hover:text-white hover:border-indigo-600 shadow-none hover:shadow-xl transition-all">実績資料を投入する</button>
                </section>

                <section className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div>
                    <h2 className="text-2xl font-black mb-3 flex items-center gap-3 text-emerald-600">
                      <i className="fa-solid fa-chart-line"></i> Optimization
                    </h2>
                    <p className="text-sm text-slate-500 mb-8 font-medium leading-relaxed">コンテンツ密度をAIが分析し、情報の薄いセクションを自動的に補強してサイト全体の専門性を高めます。</p>
                  </div>
                  <button onClick={() => setIsImproving(true)} disabled={isImproving} className="w-full bg-slate-50 text-slate-600 border-2 border-slate-100 py-5 rounded-2xl font-black text-sm hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all flex items-center justify-center gap-2">
                    {isImproving ? <i className="fa-solid fa-sync fa-spin"></i> : <i className="fa-solid fa-wand-magic-sparkles text-amber-400"></i>}
                    密度分析と自動補正
                  </button>
                </section>
              </div>

              <section className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm">
                <h2 className="text-xl font-black mb-8 flex items-center gap-3"><i className="fa-solid fa-microchip text-slate-400"></i> Portfolio Density Analysis</h2>
                <AnalysisChart data={analysisData} />
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-10">
                <section className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm">
                   <h2 className="text-xl font-black mb-8">Deployment Configuration</h2>
                   <div className="space-y-4">
                     <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Repository URL/Name</label>
                       <input type="text" className="w-full p-4 border-2 border-slate-50 rounded-2xl text-sm font-bold bg-slate-50 outline-none" value={state.githubConfig.repo} onChange={e => updateGithubConfig({ repo: e.target.value })} />
                     </div>
                     <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Access Token</label>
                       <input type="password" className="w-full p-4 border-2 border-slate-50 rounded-2xl text-sm font-bold bg-slate-50 outline-none" value={state.githubConfig.token} onChange={e => updateGithubConfig({ token: e.target.value })} />
                     </div>
                   </div>
                   <button onClick={handleCreateAndPublish} disabled={publishStatus === 'processing'} className="w-full mt-8 bg-emerald-600 text-white py-5 rounded-2xl font-black text-sm hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all flex items-center justify-center gap-3">
                    <i className="fa-solid fa-rocket"></i> 公開サーバーへ同期デプロイ
                   </button>
                </section>

                <section className="bg-slate-950 p-10 rounded-[2.5rem] shadow-2xl text-white overflow-hidden relative">
                  <div className="absolute top-0 right-0 p-8 opacity-10">
                    <i className="fa-solid fa-terminal text-8xl"></i>
                  </div>
                  <h2 className="text-xl font-black mb-6 flex items-center gap-3"><i className="fa-solid fa-brain text-indigo-400"></i> Strategic Logic Log</h2>
                  <div className="space-y-6 relative z-10">
                    <p className="text-slate-400 text-xs italic leading-relaxed border-l-2 border-indigo-500 pl-4 py-1">
                      「{state.strategyRationale || '既存の構造を継承し、コンテンツの最適化を継続します。'}」
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {state.hubs.map(h => (
                        <div key={h.id} className="bg-white/5 p-4 rounded-2xl border border-white/10 text-[10px] font-black flex items-center gap-2 group hover:bg-white/10 transition-colors">
                          <i className="fa-solid fa-folder text-indigo-400"></i>/{h.slug}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
          
          {activeTab === 'preview' && (
             <div className="h-full bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-200 flex flex-col animate-fadeIn">
               <div className="bg-slate-100 px-6 py-3 border-b border-slate-200 flex justify-between items-center">
                  <div className="flex gap-2">
                     <div className="w-3 h-3 rounded-full bg-rose-400"></div>
                     <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                     <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                  </div>
                  <div className="bg-white px-4 py-1.5 rounded-lg shadow-sm text-[10px] font-mono text-slate-400 flex items-center gap-2">
                     <i className="fa-solid fa-lock text-[8px]"></i>
                     mysite-preview.local/{activePageInfo.path}
                  </div>
                  <div className="flex gap-3 text-slate-400 text-xs">
                    <i className="fa-solid fa-rotate-right hover:text-slate-600 cursor-pointer"></i>
                    <i className="fa-solid fa-up-right-from-square hover:text-slate-600 cursor-pointer"></i>
                  </div>
               </div>
               <div className="flex-1 relative bg-white">
                  {selectedHubId ? (
                    <iframe 
                      title="Preview"
                      className="w-full h-full"
                      srcDoc={injectPreviewScript(currentPreviewContent)}
                      sandbox="allow-scripts allow-same-origin"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-300">
                      <i className="fa-solid fa-eye-slash text-6xl mb-4"></i>
                      <p className="font-bold">Select a page to preview</p>
                    </div>
                  )}
               </div>
               <div className="bg-slate-900 text-white px-6 py-3 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                     <span className="text-xs font-bold text-slate-400">Viewing:</span>
                     <span className="text-sm font-black text-white">{activePageInfo.title}</span>
                     <span className="px-2 py-0.5 bg-indigo-600 rounded text-[10px] font-bold">{activePageInfo.type}</span>
                  </div>
                  {/* Design Tuner Quick Trigger (Optional) */}
                  {selectedHubId && (
                    <button 
                      onClick={() => {
                         setTuningTargetId(selectedHubId);
                         setActiveTab('dashboard');
                      }}
                      className="text-xs text-indigo-300 hover:text-white font-bold flex items-center gap-2 transition-colors"
                    >
                      <i className="fa-solid fa-wand-magic-sparkles"></i>
                      このページを調整する
                    </button>
                  )}
               </div>
             </div>
          )}

        </div>
      </main>

      {/* Modal for Project Input */}
      {showProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-[2rem] p-8 max-w-2xl w-full shadow-2xl transform transition-all scale-100">
            <h3 className="text-xl font-black mb-6 flex items-center gap-3">
              <i className="fa-solid fa-pen-nib text-indigo-500"></i> New Project Entry
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Project Material / Data</label>
                <textarea 
                  className="w-full h-40 p-4 border-2 border-slate-100 rounded-2xl bg-slate-50 focus:border-indigo-500 outline-none text-sm font-medium"
                  placeholder="プロジェクトの概要、成果、使用技術、期間などを入力してください..."
                  value={projectMaterial}
                  onChange={(e) => setProjectMaterial(e.target.value)}
                />
              </div>
              <div>
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Design Instructions (Optional)</label>
                 <input 
                    type="text"
                    className="w-full p-4 border-2 border-slate-100 rounded-2xl bg-slate-50 focus:border-indigo-500 outline-none text-sm font-bold"
                    placeholder="例: 写真を多めに使って / 数値を強調して..."
                    value={projectDesignInstruction}
                    onChange={(e) => setProjectDesignInstruction(e.target.value)}
                 />
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button onClick={() => setShowProjectModal(false)} className="flex-1 py-4 rounded-2xl font-black text-xs bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">CANCEL</button>
              <button onClick={handleAddProject} disabled={!projectMaterial || isGeneratingProject} className="flex-[2] py-4 rounded-2xl font-black text-xs bg-slate-900 text-white hover:bg-indigo-600 transition-all shadow-lg flex items-center justify-center gap-2">
                {isGeneratingProject ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-magic"></i>}
                GENERATE PAGE
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;