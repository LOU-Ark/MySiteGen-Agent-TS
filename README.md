# MySiteGen-Agent - AI Webライフサイクル・マネージャー

<div align="center">
  <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 5rem; color: #4f46e5;"></i>
</div>

**MySiteGen-Agent**は、Gemini AIを活用してWebサイトの立ち上げから運用、デザイン調整までを自動化・サポートするエージェント型プラットフォームです。

## 🌟 主な機能

### 1. AIブランド・アイデンティティ構築
一言の理念やミッションを入力するだけで、AIがサイト名、タグライン、テーマカラー、そしてブランドのトンマナ（Professional, Creative, Minimal, Vivid, Brutalist）を定義します。

### 2. 戦略的サイト構造の自動生成
定義されたアイデンティティに基づき、UXアーキテクトAIが最適なページ構成（ハブページ）を提案。各ページの内容まで一気に生成します。

### 3. サイトチューナー（一括デザイン・運用反映）
「ダークモードに変更して」「Googleタグマネージャーを全ページに設置して」といった指示を出すだけで、サイト全体のHTML構造をAIが解析し、一括で反映・リファクタリングを行います。

### 4. 実績のページ化（Project Analyzer）
プロジェクトの概要や成果をテキストで投入するだけで、AIがその内容を分析。サイト内の最適なセクションに、ブランドイメージを維持した高品質な紹介ページを自動生成します。

### 5. GitHub連携（インポート・復元）
既存のGitHubリポジトリからサイト構造を読み込み、AIによる再分析や追加編集が可能です。

### 6. コンテキスト・サポートAI
操作に迷った時は、画面右下のサポートエージェントに相談。会話の文脈に合わせたおすすめの質問も自動で提示されます。

## 🚀 はじめかた

### 必要なもの
- Node.js
- Gemini API キー (Google AI Studioで取得)

### セットアップ
1. 依存関係のインストール:
   ```bash
   npm install
   ```
2. `.env.local` ファイルを作成し、APIキーを設定:
   ```env
   GEMINI_API_KEY=あなたのAPIキー
   ```
3. 開発サーバーの起動:
   ```bash
   npm run dev
   ```

## 🛠️ 技術スタック
- **Frontend:** React 19, TypeScript, Tailwind CSS
- **AI:** Google Gemini API (@google/genai)
- **Visuals:** FontAwesome 6, Recharts (データ分析)
- **Infrastructure:** GitHub API (リポジトリ連携)

---
Developed with MySiteGen-Agent. 