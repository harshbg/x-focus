package app.xfocus;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * X in a single WebView. Everything the user sees (timer, check-ins, video
 * and ad removal, colour rules) lives in the X Focus script, which this
 * shell injects into every x.com page and keeps up to date from
 * Config.UPDATE_URL. The shell itself only needs replacing when this file changes.
 */
public class MainActivity extends Activity {
    private static final String HOME = "https://x.com/home";
    private static final String STATE_KEY = "xfocus.v1";
    private static final String SCRIPT_FILE = "x-focus.user.js";
    private static final int FILE_REQUEST = 41;
    private static final long CHECK_EVERY_MS = 30 * 60 * 1000L;
    private static final int MAX_SCRIPT_BYTES = 512 * 1024;
    private static final Pattern VERSION = Pattern.compile("@version\\s+([0-9]+(?:\\.[0-9]+)*)");

    private WebView web;
    private Paint greyPaint;
    private boolean nativeGrey;
    private String bundledScript = "";
    private String script = "";
    private volatile String pendingScript;
    private boolean resumed;
    private long resumedAt;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        prefs = getSharedPreferences("xfocus", MODE_PRIVATE);
        bundledScript = readStream(openAsset(SCRIPT_FILE));
        script = pickScript();

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);

        ColorMatrix grey = new ColorMatrix();
        grey.setSaturation(0f);
        greyPaint = new Paint();
        greyPaint.setColorFilter(new ColorMatrixColorFilter(grey));
        setNativeGrey(true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "XFocusNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        setContentView(web);
        web.loadUrl(startUrl(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent == null ? null : intent.getData();
        if (data != null && isX(data)) web.loadUrl(data.toString());
    }

    private static String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        return data != null && isX(data) ? data.toString() : HOME;
    }

    static boolean isX(Uri u) {
        if (u == null || !"https".equalsIgnoreCase(u.getScheme())) return false;
        String h = u.getHost();
        if (h == null) return false;
        h = h.toLowerCase();
        return h.equals("x.com") || h.endsWith(".x.com") || h.equals("twitter.com") || h.endsWith(".twitter.com");
    }

    /**
     * Greyscale for the whole view. It is on from the first frame of every page;
     * the script switches it off once its own grey layer (which leaves the timer
     * and a held post in colour) has taken over. If the script never loads,
     * everything simply stays grey.
     */
    private void setNativeGrey(boolean on) {
        if (web == null || on == nativeGrey) return;
        nativeGrey = on;
        if (on) web.setLayerType(View.LAYER_TYPE_HARDWARE, greyPaint);
        else web.setLayerType(View.LAYER_TYPE_NONE, null);
    }

    private void inject(WebView view) {
        // The script checks the page's own address and runs once per page.
        if (script.length() > 0) view.evaluateJavascript(script, null);
    }

    private void openOutside(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception ignored) {
        }
    }

    // ---- Script updates -------------------------------------------------

    private InputStream openAsset(String name) {
        try {
            return getAssets().open(name);
        } catch (Exception e) {
            return null;
        }
    }

    private static String readStream(InputStream in) {
        if (in == null) return "";
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_SCRIPT_BYTES) return "";
            }
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "";
        } finally {
            try {
                in.close();
            } catch (Exception ignored) {
            }
        }
    }

    private File scriptFile() {
        return new File(getFilesDir(), SCRIPT_FILE);
    }

    /** The downloaded script, unless the one built into this app is newer. */
    private String pickScript() {
        String cached = "";
        try {
            File f = scriptFile();
            if (f.exists()) cached = readStream(new FileInputStream(f));
        } catch (Exception ignored) {
        }
        if (looksLikeScript(cached) && compareVersions(versionOf(cached), versionOf(bundledScript)) >= 0) return cached;
        return bundledScript;
    }

    static boolean looksLikeScript(String s) {
        return s != null && s.length() > 2000 && s.startsWith("// ==UserScript==")
                && s.contains("==/UserScript==") && s.contains("X Focus");
    }

    static String versionOf(String s) {
        Matcher m = VERSION.matcher(s == null ? "" : s);
        return m.find() ? m.group(1) : "0";
    }

    static int compareVersions(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return p < q ? -1 : 1;
        }
        return 0;
    }

    private static int parse(String s) {
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return 0;
        }
    }

    private void checkForUpdate() {
        if (Config.UPDATE_URL.length() == 0) return;
        long now = System.currentTimeMillis();
        if (now - prefs.getLong("lastCheck", 0) < CHECK_EVERY_MS) return;
        prefs.edit().putLong("lastCheck", now).apply();
        final String current = script;
        new Thread(new Runnable() {
            @Override
            public void run() {
                fetchUpdate(current);
            }
        }).start();
    }

    private void fetchUpdate(String current) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(Config.UPDATE_URL).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setUseCaches(false);
            c.setInstanceFollowRedirects(true);
            if (c.getResponseCode() != 200 || !"https".equals(c.getURL().getProtocol())) return;
            final String text = readStream(c.getInputStream());
            if (!looksLikeScript(text) || text.equals(current)) return;
            // Never step back below the script this app was built with.
            if (compareVersions(versionOf(text), versionOf(bundledScript)) < 0) return;
            File tmp = new File(getFilesDir(), SCRIPT_FILE + ".tmp");
            FileOutputStream out = new FileOutputStream(tmp);
            out.write(text.getBytes("UTF-8"));
            out.close();
            if (!tmp.renameTo(scriptFile())) return;
            pendingScript = text;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    // Just opened: switch now. Otherwise wait for the next time the app comes to the front.
                    if (resumed && System.currentTimeMillis() - resumedAt < 10000) applyPending();
                }
            });
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void applyPending() {
        String next = pendingScript;
        if (next == null || web == null) return;
        pendingScript = null;
        script = next;
        web.reload();
    }

    // ---- What the script can ask the app to do ---------------------------

    private final class Bridge {
        /** Timer state kept outside the page, so signing out of X cannot reset the clock. */
        @JavascriptInterface
        public String getValue(String key) {
            if (!STATE_KEY.equals(key)) return "";
            return prefs.getString(STATE_KEY, "");
        }

        @JavascriptInterface
        public void setValue(String key, String value) {
            if (!STATE_KEY.equals(key) || value == null || value.length() > 4096) return;
            prefs.edit().putString(STATE_KEY, value).apply();
        }

        @JavascriptInterface
        public void setGrey(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    setNativeGrey(on);
                }
            });
        }

        @JavascriptInterface
        public void close() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    moveTaskToBack(true);
                }
            });
        }
    }

    private final class Client extends WebViewClient {
        // Overrides the API 24 method; no @Override because the build compiles against API 23.
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri u = request.getUrl();
            if (isX(u)) return false;
            // Everything that is not X opens in your normal browser.
            openOutside(u);
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String host = request.getUrl().getHost();
            if (host != null && host.toLowerCase().equals("video.twimg.com")) {
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked",
                        new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
            }
            return null;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            setNativeGrey(true);
            inject(view);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            inject(view);
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            inject(view);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            inject(view);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                Intent i = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                startActivityForResult(i, FILE_REQUEST);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != FILE_REQUEST) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < result.length; i++) result[i] = clip.getItemAt(i).getUri();
            } else {
                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        resumedAt = System.currentTimeMillis();
        if (web != null) web.onResume();
        applyPending();
        checkForUpdate();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
