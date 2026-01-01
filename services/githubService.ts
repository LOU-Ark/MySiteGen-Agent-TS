
import { GitHubConfig, HubPage, Article } from "../types";

/**
 * リポジトリ入力を "owner/repo" 形式にクレンジング
 * URL、末尾の .git、前後の空白などを適切に処理
 */
const cleanRepo = (repo: string): string => {
  let cleaned = repo.trim();
  // https://github.com/ プレフィックスの除去
  cleaned = cleaned.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  // 末尾の .git の除去
  cleaned = cleaned.replace(/\.git$/i, '');
  // 前後のスラッシュを除去
  cleaned = cleaned.replace(/^\/+|\/+$/g, '');
  return cleaned;
};

/**
 * 共通のGitHub APIヘッダーを生成
 */
const getHeaders = (token: string) => ({
  "Authorization": `Bearer ${token ? token.trim() : ''}`,
  "Content-Type": "application/json",
  "Accept": "application/vnd.github.v3+json"
});

/**
 * 指数バックオフ付きのリトライ機能
 * signalを追加してキャンセル可能に
 */
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3, signal?: AbortSignal): Promise<Response> => {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const res = await fetch(url, { ...options, signal });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (e: any) {
      lastError = e;
      if (e.name === 'AbortError') throw e; // キャンセルの場合はリトライしない
      
      // Don't wait on last attempt
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
  }
  
  // Enhance error message if it's a generic fetch error (likely network)
  if (lastError && (lastError.name === 'TypeError' || lastError.message?.includes('Failed to fetch'))) {
      throw new Error(`GitHub APIへの接続に失敗しました: ${lastError.message} (Network Error)`);
  }
  
  throw lastError || new Error("ネットワークエラーが発生しました。");
};

export const createRepository = async (config: GitHubConfig, signal?: AbortSignal): Promise<void> => {
  const cleanedRepo = cleanRepo(config.repo);
  const repoName = cleanedRepo.split('/').pop(); 
  if (!config.token || !repoName) throw new Error("不正な設定です。リポジトリ名とトークンを確認してください。");

  const res = await fetchWithRetry("https://api.github.com/user/repos", {
    method: "POST",
    headers: getHeaders(config.token),
    body: JSON.stringify({ name: repoName, auto_init: true })
  }, 3, signal);

  if (!res.ok && res.status !== 422) {
    const error = await res.json().catch(() => ({ message: "不明なエラー" }));
    throw new Error(`リポジトリ作成に失敗しました (${res.status}): ${error.message}`);
  }
};

export const enablePages = async (config: GitHubConfig, signal?: AbortSignal): Promise<void> => {
  const cleanedRepo = cleanRepo(config.repo);
  const cleanPath = config.path.replace(/^\/+|\/+$/g, '');
  
  const res = await fetchWithRetry(`https://api.github.com/repos/${cleanedRepo}/pages`, {
    method: "POST",
    headers: getHeaders(config.token),
    body: JSON.stringify({
      source: { branch: config.branch, path: cleanPath ? `/${cleanPath}` : "/" }
    })
  }, 3, signal);

  if (!res.ok && res.status !== 409) {
    const error = await res.json().catch(() => ({ message: "不明なエラー" }));
    console.warn(`GitHub Pages有効化エラー (${res.status}): ${error.message}`);
  }
};

export const publishToGithub = async (
  config: GitHubConfig, 
  hubs: HubPage[], 
  articles: Article[],
  readme?: string,
  signal?: AbortSignal
): Promise<void> => {
  const cleanedRepo = cleanRepo(config.repo);
  const cleanPath = config.path.replace(/^\/+|\/+$/g, '');
  const baseUrl = `https://api.github.com/repos/${cleanedRepo}/contents${cleanPath ? `/${cleanPath}` : ''}`;
  const headers = getHeaders(config.token);

  const files: { path: string; content: string }[] = [];
  hubs.forEach(h => {
    const path = h.slug === 'index' ? 'index.html' : `${h.slug}/index.html`;
    files.push({ path, content: h.html || "" });
  });

  articles.forEach(a => {
    const parentHub = hubs.find(h => h.id === a.hubId);
    const path = (parentHub && parentHub.slug !== 'index') 
      ? `${parentHub.slug}/${a.slug}.html` 
      : `articles/${a.slug}.html`;
    files.push({ path, content: a.contentHtml || "" });
  });

  if (readme) files.push({ path: 'README.md', content: readme });

  for (const file of files) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    
    let sha = "";
    try {
      const checkRes = await fetchWithRetry(`${baseUrl}/${file.path}?ref=${config.branch}`, { headers }, 3, signal);
      if (checkRes.ok) {
        const data = await checkRes.json();
        sha = data.sha;
      }
    } catch {}

    const res = await fetchWithRetry(`${baseUrl}/${file.path}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `Deploy ${file.path} via MySiteGen-Agent`,
        content: btoa(unescape(encodeURIComponent(file.content))),
        branch: config.branch,
        sha: sha || undefined
      })
    }, 3, signal);

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: "不明なエラー" }));
      throw new Error(`${file.path} 送信失敗 (${res.status}): ${error.message}`);
    }
  }
};

export interface GitHubFileNode {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  url: string;
}

export const fetchRepoDetails = async (config: GitHubConfig, signal?: AbortSignal): Promise<{ default_branch: string }> => {
  const cleanedRepo = cleanRepo(config.repo);
  if (!cleanedRepo.includes('/')) {
    throw new Error("リポジトリ名は 'owner/repo' または GitHub URL で入力してください。");
  }

  const res = await fetchWithRetry(`https://api.github.com/repos/${cleanedRepo}`, { 
    headers: getHeaders(config.token) 
  }, 3, signal);
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "不明なエラー" }));
    if (res.status === 404) {
      throw new Error(`リポジトリが見つかりません (404)。\n\n【確認事項】\n1. URLや名前が正しいか\n2. プライベートリポジトリの場合、トークンに 'repo' スコープ権限があるか`);
    }
    throw new Error(`リポジトリ取得失敗 (${res.status}): ${error.message}`);
  }
  return await res.json();
};

export const fetchRepoStructure = async (config: GitHubConfig, signal?: AbortSignal): Promise<GitHubFileNode[]> => {
  const cleanedRepo = cleanRepo(config.repo);
  const res = await fetchWithRetry(`https://api.github.com/repos/${cleanedRepo}/git/trees/${config.branch}?recursive=1`, { 
    headers: getHeaders(config.token) 
  }, 3, signal);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "不明なエラー" }));
    throw new Error(`構造取得失敗 (${res.status}): ${error.message}`);
  }
  const data = await res.json();
  return data.tree;
};

export const fetchFileContent = async (url: string, token: string, signal?: AbortSignal): Promise<string> => {
  const res = await fetchWithRetry(url, {
    headers: getHeaders(token)
  }, 3, signal);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "不明なエラー" }));
    throw new Error(`内容取得失敗 (${res.status}): ${error.message}`);
  }
  const data = await res.json();
  return decodeURIComponent(escape(window.atob(data.content.replace(/\n/g, ""))));
};
