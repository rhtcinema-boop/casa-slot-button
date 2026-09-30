# 店舗／マスター構成（Firebase）のセットアップ

マスター画面: https://rhtcinema-boop.github.io/casa-slot-button/master.html
店舗の端末: https://rhtcinema-boop.github.io/casa-slot-button/ （Fire TV 版も同じ）

## 1. Firebase プロジェクトを作る（あなたの Google アカウント）
1. https://console.firebase.google.com/ を開き「プロジェクトを追加」→ 名前は自由（例: casa-slot）→ Google アナリティクスは「無効」でOK
2. 左メニュー「構築」→「Authentication」→「始める」
   - 「Sign-in method」で **メール / パスワード** を有効にする
   - **匿名** も有効にする（店舗の端末が使う）
   - 「Users」→「ユーザーを追加」で、あなたのメールアドレスとパスワードを登録（これがマスター画面のログイン）
3. 左メニュー「構築」→「Firestore Database」→「データベースを作成」→ ロケーションは asia-northeast1（東京）→ 「本番環境モード」で作成
4. Firestore の「ルール」タブに、このリポジトリの `firestore.rules` の中身を貼り付けて「公開」
   - 1行目付近の `rhtcinema@gmail.com` を、2で登録したメールアドレスに合わせる
5. プロジェクトの設定（歯車）→「全般」→ 下の「マイアプリ」→ ウェブ（</> のアイコン）→ アプリ名は自由 → 登録
   - 表示される `firebaseConfig = { apiKey: "...", authDomain: "...", projectId: "...", ... }` をコピーして私（Claude）に送る

## 2. 私がやること
- `cloud-config.js` にその設定を入れて公開（Web と Fire TV 用 APK）

## 3. 使い方
- マスター画面で、プリセット → 店舗（名前・パスワード・使えるプリセット）を作る
- 店舗の端末でアプリを開くと「店舗を選ぶ → パスワード」。以後はその店舗として動く
- 店舗の設定画面（ロゴ5回タップ）は「プリセット名を選ぶ」だけ。確率の中身は出ない
- マスターで「いま使うプリセット」を切り替えると、店舗の端末に自動で反映（次のプレイから）
- 集計タブで店舗ごとの回転数・当選額・直近のプレイが見える
- 端末を入れ替えるときは、店舗の編集 →「端末を強制ログアウト」
