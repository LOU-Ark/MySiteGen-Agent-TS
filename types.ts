
export type SiteType = 'Corporate' | 'Personal';

export interface Identity {
  siteName: string;
  slug: string;
  mission: string;
  brandDescription: string;
  themeColor: string;
}

export interface HubPage {
  id: string;
  title: string;
  slug: string;
  description: string;
  html?: string;
}

export interface Article {
  id: string;
  hubId: string;
  title: string;
  slug: string;
  contentHtml?: string;
  createdAt: string;
}

export interface GitHubConfig {
  token: string;
  repo: string; // "owner/repo" format
  branch: string;
  path: string; // Target directory (e.g., "docs", "site", or "")
}

export interface ProjectState {
  opinion: string;
  siteType: SiteType;
  identity?: Identity;
  hubs: HubPage[];
  articles: Article[];
  gtmId: string;
  adsenseId: string;
  strategyRationale?: string; // AIがなぜこの構造を選んだかの解説
  status: 'idle' | 'importing' | 'analyzing_site' | 'building_identity' | 'generating_strategy' | 'generating_hubs' | 'ready' | 'creating_repo' | 'pushing_files' | 'enabling_pages' | 'tuning_design';
  githubConfig: GitHubConfig;
}

export interface AnalysisData {
  name: string;
  count: number;
}
