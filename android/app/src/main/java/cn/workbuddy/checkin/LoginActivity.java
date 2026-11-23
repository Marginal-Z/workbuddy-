package cn.workbuddy.checkin;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * App 内官方登录：用我们自己的 WebView 打开 WorkBuddy 官网，
 * 用户点微信 / QQ 完成授权后，由「已完成」按钮读取同源登录态。
 */
public class LoginActivity extends Activity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_DATA = "data";

    private WebView web;
    private ProgressBar progress;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null || url.isEmpty()) url = "https://www.workbuddy.cn/";

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#F3F2EE"));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(16), dp(10), dp(10), dp(10));
        header.setBackgroundColor(Color.parseColor("#F3F2EE"));

        TextView title = new TextView(this);
        title.setText("登录 WorkBuddy");
        title.setTextSize(16);
        title.setTextColor(Color.parseColor("#17171A"));
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button cancel = new Button(this);
        cancel.setText("取消");
        cancel.setAllCaps(false);
        cancel.setTextColor(Color.parseColor("#6D6D67"));
        cancel.setBackgroundColor(Color.TRANSPARENT);
        cancel.setOnClickListener(v -> finishWith(false, null));
        header.addView(cancel);

        Button done = new Button(this);
        done.setText("已完成");
        done.setAllCaps(false);
        done.setTextColor(Color.WHITE);
        done.setBackgroundColor(Color.parseColor("#17171A"));
        done.setOnClickListener(v -> collect());
        header.addView(done);

        root.addView(header);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        root.addView(progress);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        web.loadUrl(url);
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
    }

    private static final String COLLECT_JS =
            "(function(){var o={href:location.href,local:{},session:{}};" +
            "try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);" +
            "o.local[k]=String(localStorage.getItem(k)).slice(0,4000);}}catch(e){}" +
            "try{for(var i=0;i<sessionStorage.length;i++){var k=sessionStorage.key(i);" +
            "o.session[k]=String(sessionStorage.getItem(k)).slice(0,4000);}}catch(e){}" +
            "return JSON.stringify(o);})()";

    private void collect() {
        web.evaluateJavascript(COLLECT_JS, value -> {
            JSONObject payload = new JSONObject();
            try {
                payload.put("dump", value == null ? "" : value);
                payload.put("cookies", String.valueOf(CookieManager.getInstance().getCookie(web.getUrl())));
                payload.put("url", String.valueOf(web.getUrl()));
            } catch (Exception ignored) {
                // 保持返回空对象，前端会走手动粘贴兜底
            }
            finishWith(true, payload.toString());
        });
    }

    private void finishWith(boolean ok, String data) {
        Intent out = new Intent();
        out.putExtra("ok", ok);
        if (data != null) out.putExtra(EXTRA_DATA, data);
        setResult(ok ? RESULT_OK : RESULT_CANCELED, out);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        finishWith(false, null);
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
