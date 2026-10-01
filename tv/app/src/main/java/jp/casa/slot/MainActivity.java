package jp.casa.slot;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/* Fire TV 用: 内蔵した Web アプリ（assets/www）を WebView で表示するだけの薄い皮。
   https://appassets.androidplatform.net/assets/www/ という正規のオリジンで配信するので、
   localStorage / IndexedDB がそのまま使える（file:// ではないため）。 */
public class MainActivity extends Activity {
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // 営業中にスリープさせない
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#050506"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setUserAgentString(s.getUserAgentString() + " casaTV"); // Web 側はこれでテレビ用の操作に切り替わる

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) {
                    String p = u.getPath();
                    if ("/__update".equals(p)) { startUpdate(); return json(updState); }
                    if ("/__update_status".equals(p)) return json(updState);
                    if (p != null && p.startsWith(WWW)) { // 更新で取り込んだ版があれば、内蔵版より優先して出す
                        WebResourceResponse r = fromLive(p.substring(WWW.length()));
                        if (r != null) return r;
                    }
                }
                return loader.shouldInterceptRequest(u);
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !"appassets.androidplatform.net".equals(request.getUrl().getHost()); // 外部リンクは開かない
            }
        });
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        web.requestFocus();
        hideSystemUi();
        pickLive();
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    /* ---------- アップデート（入れ直しなしで中身だけ差し替える） ----------
       設定の「最新版に更新」から呼ばれる。公開サイトの version.json に並んだファイルを端末内（files/www-live）へ取り込み、
       以後は内蔵版より優先して配信する。オリジンは変わらないので、端末内のデータ（店舗ログイン・履歴）はそのまま残る。
       1ファイルでも取れない・内容が一致しないときは何も差し替えない（途中まで混ざった状態にしない）。 */
    private static final String SITE = "https://rhtcinema-boop.github.io/casa-slot-button/";
    private static final String WWW = "/assets/www/";
    private volatile File liveDir;
    private volatile String updState = "{\"state\":\"idle\"}";
    private volatile boolean updBusy = false;

    private static int verNum(String v) {
        try { return Integer.parseInt(v.replaceAll("[^0-9]", "")); } catch (Exception e) { return 0; }
    }
    private static byte[] readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        } finally { in.close(); }
    }
    private static String versionOf(byte[] json) {
        try { return new JSONObject(new String(json, "UTF-8")).optString("v", ""); } catch (Exception e) { return ""; }
    }
    private String bundledVersion() {
        try { return versionOf(readAll(getAssets().open("www/version.json"))); } catch (Exception e) { return ""; }
    }
    private static String liveVersion(File dir) {
        try { return versionOf(readAll(new FileInputStream(new File(dir, "version.json")))); } catch (Exception e) { return ""; }
    }
    private static void wipe(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) wipe(k);
        f.delete();
    }
    /* 起動時: 取り込んだ版が内蔵版より新しいときだけ使う（新しい APK を入れ直したら内蔵版に戻る） */
    private void pickLive() {
        File live = new File(getFilesDir(), "www-live");
        if (live.isDirectory() && verNum(liveVersion(live)) > verNum(bundledVersion())) liveDir = live;
        else { wipe(live); liveDir = null; }
    }
    private WebResourceResponse fromLive(String rel) {
        File dir = liveDir;
        if (dir == null) return null;
        try {
            File f = new File(dir, rel);
            if (!f.isFile() || !f.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator)) return null;
            String mime = "application/octet-stream", enc = "utf-8";
            if (rel.endsWith(".html")) mime = "text/html";
            else if (rel.endsWith(".js")) mime = "application/javascript";
            else if (rel.endsWith(".css")) mime = "text/css";
            else if (rel.endsWith(".json")) mime = "application/json";
            else if (rel.endsWith(".webmanifest")) mime = "application/manifest+json";
            else if (rel.endsWith(".png")) { mime = "image/png"; enc = null; }
            return new WebResourceResponse(mime, enc, new FileInputStream(f));
        } catch (IOException e) { return null; }
    }
    private static WebResourceResponse json(String body) {
        try { return new WebResourceResponse("application/json", "utf-8", new ByteArrayInputStream(body.getBytes("UTF-8"))); }
        catch (IOException e) { return null; }
    }
    private static byte[] http(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(10000);
            c.setReadTimeout(20000);
            c.setUseCaches(false);
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            return readAll(c.getInputStream());
        } finally { c.disconnect(); }
    }
    private static String sha256(byte[] b) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (byte x : MessageDigest.getInstance("SHA-256").digest(b)) sb.append(String.format("%02x", x));
        return sb.toString();
    }
    private void startUpdate() {
        synchronized (this) {
            if (updBusy) return;
            updBusy = true;
            updState = "{\"state\":\"running\"}";
        }
        new Thread(new Runnable() {
            @Override public void run() {
                String res;
                try { res = doUpdate(); }
                catch (Exception e) { res = "{\"state\":\"error\",\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}"; }
                updState = res;
                updBusy = false;
            }
        }).start();
    }
    private String doUpdate() throws Exception {
        String bust = "t=" + System.currentTimeMillis();
        byte[] raw = http(SITE + "version.json?" + bust);
        JSONObject man = new JSONObject(new String(raw, "UTF-8"));
        String v = man.getString("v");
        File cur = liveDir;
        String now = cur != null ? liveVersion(cur) : bundledVersion();
        if (verNum(v) <= verNum(now)) return new JSONObject().put("state", "latest").put("v", now).toString();
        File stage = new File(getFilesDir(), "www-new");
        wipe(stage);
        JSONArray files = man.getJSONArray("files");
        for (int i = 0; i < files.length(); i++) {
            JSONObject f = files.getJSONObject(i);
            String path = f.getString("path");
            if (!path.matches("[A-Za-z0-9_.\\-/]+") || path.contains("..") || path.startsWith("/")) throw new IOException("bad path");
            byte[] body = http(SITE + path + "?v=" + v + "&" + bust);
            if (!sha256(body).equals(f.getString("sha256"))) throw new IOException("stale"); // 配信がまだ新しい版に切り替わっていない
            File out = new File(stage, path);
            File dir = out.getParentFile();
            if (dir != null) dir.mkdirs();
            FileOutputStream os = new FileOutputStream(out);
            try { os.write(body); } finally { os.close(); }
        }
        FileOutputStream os = new FileOutputStream(new File(stage, "version.json"));
        try { os.write(raw); } finally { os.close(); }
        File live = new File(getFilesDir(), "www-live");
        liveDir = null;
        wipe(live);
        if (!stage.renameTo(live)) throw new IOException("rename");
        liveDir = live;
        return new JSONObject().put("state", "done").put("v", v).toString();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    /* リモコンのキーは WebView に渡る前に横取りする（メニューはリモコンによって WebView が握って Web 側へ届かないことがある）。
       戻る: 短押しで閉じる、長押し（約2秒）で設定。メニュー: 3回で設定。アプリは戻るでは終了しない（終了はホームボタン）。 */
    private int backHold = 0;
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                if (event.getRepeatCount() == 0) backHold = 0;
                backHold += 1;
                if (backHold == 12) web.evaluateJavascript("typeof TV!=='undefined' && TV.settings()", null);
            } else if (event.getAction() == KeyEvent.ACTION_UP) {
                if (backHold < 12) web.evaluateJavascript("typeof TV!=='undefined' && TV.back()", null);
                backHold = 0;
            }
            return true;
        }
        // 十字キーと決定も横取りして Web 側へ渡す（WebView が自分で握って画面に届かないことがある）
        String name = null;
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: name = "ArrowUp"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: name = "ArrowDown"; break;
            case KeyEvent.KEYCODE_DPAD_LEFT: name = "ArrowLeft"; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: name = "ArrowRight"; break;
            case KeyEvent.KEYCODE_DPAD_CENTER: case KeyEvent.KEYCODE_ENTER: case KeyEvent.KEYCODE_BUTTON_A: name = "Enter"; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: case KeyEvent.KEYCODE_MEDIA_PLAY: name = "Enter"; break;
        }
        if (name != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) web.evaluateJavascript("typeof TV!=='undefined' && TV.press('" + name + "'," + (event.getRepeatCount() > 0) + ")", null);
            return true;
        }
        if (code == KeyEvent.KEYCODE_MENU) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) web.evaluateJavascript("typeof TV!=='undefined' && TV.menu()", null);
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() { /* 何もしない（onKeyDown で処理済み） */ }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); hideSystemUi(); }
}
