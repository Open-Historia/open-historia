/*! Open Historia — portions (download handling for the WebView shell) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
package io.github.arkniem.paxhistoria;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView itself cannot download files. Hand any download (the
        // self-update APK) to the system browser, which downloads it and lets
        // the user tap to install.
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {
                    // No browser available — nothing sensible to do.
                }
            });
        }
    }
}
