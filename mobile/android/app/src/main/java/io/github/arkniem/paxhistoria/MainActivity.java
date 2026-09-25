/*! Open Historia — portions (download handling for the WebView shell) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
package io.github.arkniem.paxhistoria;

import android.content.ComponentCallbacks2;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

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
        // Back closes the panel on top. Capacitor leaves the Back button to its
        // App plugin, which this app does not ship, so without this every Back
        // left the game, whatever was open. Each panel the page opens adds a
        // step to its history (src/runtime/backToClose.js) and stepping back
        // closes it; with nothing open there is no step to take, and Back does
        // what it always did.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = getBridge() != null ? getBridge().getWebView() : null;
                if (view != null && view.canGoBack()) {
                    view.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    // Android asks for memory back: the app went to the background, or memory
    // is running low while it is in front. The WebView's in-memory cache of
    // fetched files goes (every file here is on the device, so it costs nothing
    // to read again), and the page is told, so it can let go of what it keeps
    // only for speed (src/runtime/memoryPressure.js) before the system starts
    // killing processes, the WebView's renderer among the first.
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) releaseMemory();
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        releaseMemory();
    }

    private void releaseMemory() {
        WebView view = getBridge() != null ? getBridge().getWebView() : null;
        if (view == null) return;
        view.clearCache(false);
        view.evaluateJavascript("window.dispatchEvent(new Event('oh:memory-pressure'))", null);
    }
}
