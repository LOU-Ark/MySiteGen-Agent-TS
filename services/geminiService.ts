
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SiteType, Identity, HubPage, Article } from "../types";

// Initialize with a safe fallback to avoid immediate crash, but validate before use
const apiKey = (process.env.API_KEY || "").trim();
const ai = new GoogleGenAI({ apiKey });

// Utility to handle rate limits (429) and network errors
const retryWithBackoff = async <T>(
  operation: () => Promise<T>, 
  maxRetries: number = 5, 
  initialDelay: number = 2000
): Promise<T> => {
  if (!apiKey) {
    throw new Error("API Key is missing. Please set GEMINI_API_KEY in your .env.local file.");
  }

  let delay = initialDelay;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      // Check for common fetch failure patterns
      // TypeError is thrown by fetch() on network failure (DNS, offline, CORS, etc.)
      const isNetworkError = 
        error.name === 'TypeError' || 
        (error.message && (
          error.message.includes('Failed to fetch') || 
          error.message.includes('NetworkError') ||
          error.message.includes('Network request failed')
        ));

      const isRateLimit = 
        error.status === 429 || 
        error.code === 429 || 
        error.message?.includes('429') || 
        error.message?.includes('quota') ||
        error.message?.includes('RESOURCE_EXHAUSTED');

      // Retry on network errors, rate limits, or server overloads
      const isRetryable = isNetworkError || isRateLimit || error.message?.includes('overloaded');
      
      if (!isRetryable || i === maxRetries - 1) {
        // Enhance message for network errors which are often generic "Failed to fetch"
        if (isNetworkError) {
          throw new Error("通信エラーが発生しました (Failed to fetch)。\n\n【考えられる原因】\n1. インターネット接続が不安定\n2. ブラウザの拡張機能（広告ブロック等）がGoogle APIを遮断している\n3. APIキーが無効、またはVPN/プロキシの影響\n\n一時的なエラーの場合は、もう一度お試しください。");
        }
        if (isRateLimit) {
           throw new Error("APIリクエスト制限(Quota)に達しました。しばらく待ってから再試行してください。");
        }
        throw error;
      }
      
      console.warn(`API Error (Attempt ${i + 1}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 1.5; // Exponential backoff
    }
  }
  throw new Error("エラーが発生しました。再試行してください。");
};

/**
 * サイトの共通ヘッダーテンプレート
 */
const getHeaderTemplate = (identity: Identity, prefix: string, siteType: SiteType, hubs: HubPage[]) => {
  const navLinks = hubs
    .filter(h => h.slug !== 'index')
    .map(h => `
      <a href="${prefix}${h.slug}/index.html" class="text-sm font-bold text-slate-600 hover:text-indigo-600 transition-colors whitespace-nowrap">
        ${h.title}
      </a>
    `).join('');

  return `
<header class="fixed top-0 w-full z-50 bg-white/90 backdrop-blur-md border-b border-slate-100">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex justify-between items-center gap-4">
    <a href="${prefix}index.html" class="flex items-center gap-2 sm:gap-3 group shrink-0">
      <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-white font-black shadow-lg" style="background-color: ${identity.themeColor}">
        ${identity.siteName.charAt(0)}
      </div>
      <span class="text-lg sm:text-xl font-black text-slate-800 tracking-tight group-hover:text-indigo-600 transition-colors">
        ${identity.siteName}
      </span>
    </a>
    
    <nav class="hidden md:flex items-center gap-6 overflow-x-auto no-scrollbar">
      ${navLinks}
    </nav>

    <div class="flex items-center gap-3">
      <a href="#" class="hidden sm:block px-5 py-2.5 bg-slate-900 text-white text-xs font-black rounded-full hover:bg-indigo-600 transition-all shadow-lg shadow-slate-200 whitespace-nowrap">
        ${siteType === 'Corporate' ? 'お問い合わせ' : 'Contact'}
      </a>
      <button class="md:hidden p-2 text-slate-600" onclick="document.getElementById('mobile-menu').classList.toggle('hidden')">
        <i class="fa-solid fa-bars-staggered text-xl"></i>
      </button>
    </div>
  </div>
  
  <div id="mobile-menu" class="hidden md:hidden bg-white border-b border-slate-100 p-6 space-y-4 animate-fadeIn">
    <div class="flex flex-col gap-4">
      ${navLinks}
      <a href="#" class="block w-full text-center px-5 py-3 bg-slate-900 text-white text-xs font-black rounded-xl">
        ${siteType === 'Corporate' ? 'お問い合わせ' : 'Contact'}
      </a>
    </div>
  </div>
</header>`;
};

const getFooterTemplate = (identity: Identity) => `
<footer class="bg-slate-900 text-white py-16 sm:py-20 px-6 mt-20">
  <div class="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 border-b border-white/10 pb-12 mb-12">
    <div>
      <h4 class="text-2xl font-black mb-6">${identity.siteName}</h4>
      <p class="text-slate-400 leading-relaxed max-w-md font-medium text-sm sm:text-base">${identity.mission}</p>
    </div>
    <div class="flex flex-col md:items-end justify-center">
       <div class="flex gap-4 mb-6">
         <a href="#" class="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center hover:bg-white hover:text-slate-900 transition-all"><i class="fa-brands fa-twitter"></i></a>
         <a href="#" class="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center hover:bg-white hover:text-slate-900 transition-all"><i class="fa-brands fa-linkedin"></i></a>
       </div>
       <p class="text-slate-500 text-xs sm:text-sm font-bold text-center md:text-right">© 2024 ${identity.siteName}.<br class="sm:hidden"/> Generated by MySiteGen-Agent.</p>
    </div>
  </div>
</footer>`;

export const generateIdentityAgent = async (opinion: string, siteType: SiteType): Promise<Identity> => {
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `以下の理念・哲学に基づき、${siteType === 'Corporate' ? '法人（企業・団体）' : '個人（クリエイター・エンジニア等）'}のブランドアイデンティティを作成してください: "${opinion}"`,
    config: {
      systemInstruction: "あなたはブランド戦略家です。日本語のJSON形式で返してください。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          siteName: { type: Type.STRING },
          slug: { type: Type.STRING },
          mission: { type: Type.STRING },
          brandDescription: { type: Type.STRING },
          themeColor: { type: Type.STRING }
        },
        required: ["siteName", "slug", "mission", "brandDescription", "themeColor"]
      }
    }
  }));
  return JSON.parse(response.text || '{}');
};

/**
 * 既存サイトのHTMLからアイデンティティをリバースエンジニアリングする
 */
export const analyzeSiteIdentityAgent = async (htmlContent: string): Promise<Identity> => {
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `以下のHTMLコンテンツ（既存サイトのトップページ）を分析し、ブランドアイデンティティを抽出してください。
    
    HTML:
    ${htmlContent.substring(0, 30000)}`, // トークン制限対策で切り詰め
    config: {
      systemInstruction: "あなたは優秀なブランドアナリストです。既存サイトからトーン、ミッション、色、名前を正確に抽出してJSONで返してください。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          siteName: { type: Type.STRING },
          slug: { type: Type.STRING, description: "URLフレンドリーなサイト名" },
          mission: { type: Type.STRING, description: "サイトから読み取れる主要なメッセージ" },
          brandDescription: { type: Type.STRING, description: "ブランドの雰囲気や特徴の要約" },
          themeColor: { type: Type.STRING, description: "サイトで使用されている主要な色のHEXコード" }
        },
        required: ["siteName", "slug", "mission", "brandDescription", "themeColor"]
      }
    }
  }));
  return JSON.parse(response.text || '{}');
};

export const generateStrategyAgent = async (identity: Identity, siteType: SiteType): Promise<{ hubs: HubPage[], rationale: string }> => {
  const prompt = `「${identity.siteName}」のアイデンティティに基づき、${siteType === 'Corporate' ? '法人の信頼性と成長性を伝える4セクション' : '個人の専門性と感性を伝える4セクション'}を提案してください。`;
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "あなたはUXアーキテクトです。ハブセクションと戦略的根拠をJSONで返してください。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hubs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                slug: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ["title", "slug", "description"]
            }
          },
          rationale: { type: Type.STRING }
        },
        required: ["hubs", "rationale"]
      }
    }
  }));
  const data = JSON.parse(response.text || '{"hubs":[], "rationale":""}');
  return {
    hubs: data.hubs.map((d: any) => ({ ...d, id: Math.random().toString(36).substr(2, 9) })),
    rationale: data.rationale
  };
};

export const generateProjectShowcaseAgent = async (
  material: string, 
  identity: Identity, 
  hubs: HubPage[]
): Promise<{ title: string; slug: string; description: string; targetHubId: string }> => {
  const hubList = hubs.filter(h => h.slug !== 'index').map(h => `${h.id}: ${h.title}`).join(', ');
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `以下の実績資料を分析し、最適なタイトル、スラッグ、概要を生成し、最も適切なセクションIDを選択してください。\n\n【実績資料】\n${material}\n\n【セクション候補】\n${hubList}`,
    config: {
      systemInstruction: "あなたはコンテンツストラテジストです。資料から核心的な価値を抽出し、JSONで返してください。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          slug: { type: Type.STRING },
          description: { type: Type.STRING },
          targetHubId: { type: Type.STRING, description: "候補の中から最適なIDを1つ選択" }
        },
        required: ["title", "slug", "description", "targetHubId"]
      }
    }
  }));
  return JSON.parse(response.text || '{}');
};

export const generateHtmlAgent = async (
  page: { title: string; description: string; material?: string }, 
  identity: Identity,
  siteType: SiteType,
  allHubs: HubPage[],
  links?: { title: string; url: string }[],
  isRoot: boolean = false,
  referenceHtml?: string, // スタイル参照用のHTML
  customInstruction?: string // ユーザーからの追加デザイン指示
): Promise<string> => {
  const prefix = isRoot ? "./" : "../";
  const header = getHeaderTemplate(identity, prefix, siteType, allHubs);
  const footer = getFooterTemplate(identity);

  const linkSectionHtml = links && links.length > 0 
    ? `<div class="mt-20 pt-10 border-t border-slate-100">
        <h3 class="text-xl font-black mb-8 text-slate-800 flex items-center gap-3">
          <i class="fa-solid fa-compass text-indigo-500"></i> Browse Content
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          ${links.map(l => `
            <a href="${l.url}" class="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-transparent hover:border-indigo-400 hover:bg-white hover:shadow-xl transition-all group">
              <span class="font-bold text-slate-700 group-hover:text-indigo-600 text-sm sm:text-base">${l.title}</span>
              <i class="fa-solid fa-chevron-right text-slate-300 group-hover:text-indigo-500 transition-transform group-hover:translate-x-1"></i>
            </a>
          `).join('')}
        </div>
      </div>` 
    : '';

  const isProject = !!page.material;
  const projectContext = isProject ? `これは特定の実績（プロジェクト）紹介ページです。以下の資料を元に「背景」「課題」「解決策」「成果」をセクション分けして詳細に記述してください。\n資料: ${page.material}` : "";
  
  // スタイル参照がある場合のプロンプト追加
  const stylePrompt = referenceHtml 
    ? `\n【重要：デザイン統一】\n以下の「Reference HTML」のCSSクラス、余白設定、配色、フォント選び、Tailwindのクラス構造を分析し、新しいページでも同じデザインシステムを厳密に踏襲してください。\n\nReference HTML (Style Guide):\n${referenceHtml.substring(0, 15000)}...`
    : "";

  const instructionPrompt = customInstruction
    ? `\n【ユーザーからのデザイン指示】\n${customInstruction}\nこれらの指示を最優先してデザインに反映してください。`
    : "";

  const prompt = `
  あなたは世界最高峰のWebデザイナーです。レスポンシブなHTMLを生成してください。
  ${siteType === 'Corporate' ? '法人向け：信頼感・高級感' : '個人向け：創造的・親しみやすさ'}
  
  【ページ情報】
  タイトル: ${page.title}
  説明: ${page.description}
  サイト名: ${identity.siteName}
  ブランド理念: ${identity.mission}
  テーマカラー: ${identity.themeColor}
  ${projectContext}
  ${stylePrompt}
  ${instructionPrompt}

  【構造要件】
  1. 冒頭にヘッダー: ${header}
  2. メインヒーローセクション
  3. ${isProject ? '実績詳細セクション（データや図解風の表現をTailwindでリッチに再現）' : 'メインコンテンツセクション'}
  4. リンクエリア: ${linkSectionHtml}
  5. フッター: ${footer}

  出力はHTMLコードのみ（<!DOCTYPE html>から開始）としてください。`;

  // Switching to gemini-3-flash-preview for HTML generation as it has higher rate limits 
  // and is more reliable for bulk generation tasks compared to Pro.
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "あなたはHTML/CSSのマスターです。特にプロジェクトのショーケースやポートフォリオの表現に長けています。",
    }
  }));
  return response.text || "<html><body>Error</body></html>";
};

export const tunePageDesignAgent = async (
  currentHtml: string,
  referenceHtml: string | undefined,
  instruction: string,
  identity: Identity
): Promise<string> => {
  const referencePrompt = referenceHtml
    ? `\n【参照デザイン】\n以下のHTMLのデザインシステム（色、フォント、余白、コンポーネントの雰囲気）を厳密に適用してください。\n${referenceHtml.substring(0, 15000)}...`
    : "";

  const prompt = `
  あなたはCSS/Tailwindのリファクタリング専門AIです。
  以下の「対象HTML」のコンテンツ（テキスト、画像、リンク構造）は**絶対に保持したまま**、デザイン（CSS/Tailwindクラス）のみを大幅に刷新してください。
  
  【変更指示】
  ${instruction}

  【基本情報】
  サイト名: ${identity.siteName}
  テーマカラー: ${identity.themeColor}
  ${referencePrompt}

  【対象HTML】
  ${currentHtml}

  出力はHTMLコードのみ（<!DOCTYPE html>から開始）としてください。JavaScriptやテキストの内容を変更しないでください。
  `;

  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "あなたはHTML/CSSのマスターです。既存のコンテンツを維持しながらデザインのみを洗練させます。",
    }
  }));
  return response.text || currentHtml;
};

export const generateReadmeAgent = async (identity: Identity): Promise<string> => {
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `「${identity.siteName}」のGitHub用README.mdを作成してください。ミッション: ${identity.mission}`,
  }));
  return response.text || `# ${identity.siteName}`;
};

export const generateArticleIdeasAgent = async (
  hub: HubPage, 
  identity: Identity, 
  currentArticles: Article[]
): Promise<{ title: string; slug: string; description: string }[]> => {
  const existingTitles = currentArticles.map(a => a.title).join(', ');
  const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `セクション「${hub.title}」のために、新しい3つの詳細記事のアイデアを生成してください。既存: ${existingTitles}。理念: ${identity.brandDescription}`,
    config: {
      systemInstruction: "あなたはコンテンツディレクターです。JSON配列を返してください。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            slug: { type: Type.STRING },
            description: { type: Type.STRING }
          },
          required: ["title", "slug", "description"]
        }
      }
    }
  }));
  return JSON.parse(response.text || '[]');
};
