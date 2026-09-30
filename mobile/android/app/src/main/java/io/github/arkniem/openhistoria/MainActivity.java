/*! Open Historia — portions (download handling for the WebView shell) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
package io.github.arkniem.openhistoria;

import android.content.ComponentCallbacks2;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.ArrayDeque;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "OpenHistoria";

    // The app rests in the background. Capacitor keeps the WebView running there
    // (its KeepRunning default), and with it every timer the page has; a player's
    // phone listed the app at 2 Ah of background battery in a day. The page asks
    // for the pause once it is hidden and nothing is being generated
    // (src/runtime/native/backgroundPause.js, BackgroundPausePlugin); onStart lifts it.
    private boolean inBackground = false;
    private boolean restRequested = false;

    // The page's renderer is a separate process, and Android stops it to free
    // memory (or it crashes). The WebView then takes the whole app down unless
    // somebody says they handled it: Capacitor asks its listeners and nobody
    // answered, so a player's phone reported "Open Historia Beta runtime
    // exception", the country picker frozen half-drawn before it. This answers
    // and builds the page again. Every save is in IndexedDB, so the player loses
    // the screen, not the game. Three restarts in a minute is a page that cannot
    // live at all on this phone, and then the app closes as it used to. What
    // happened is kept for the page's diagnostics log (RendererRestartPlugin,
    // src/runtime/native/rendererRestart.js).
    static final String RENDERER_PREFS = "oh-renderer-restart";
    private static final long RENDERER_RESTART_WINDOW_MS = 60_000L;
    private static final int RENDERER_RESTARTS_ALLOWED = 3;
    // Static: the history has to outlive the activity each restart recreates.
    private static final ArrayDeque<Long> rendererRestarts = new ArrayDeque<>();
    // This activity's WebView lost its renderer: nothing may be asked of it now.
    private boolean rendererGone = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate, which is where Capacitor loads its plugins.
        registerPlugin(BackgroundPausePlugin.class);
        registerPlugin(RendererRestartPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                return restartAfterRendererGone(view, detail);
            }
        });
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
        // Room for the keyboard. Android 15 draws every app edge to edge, and
        // an edge-to-edge window no longer shrinks for the keyboard (the
        // manifest's adjustResize still does that on older versions): the app
        // is told how tall the keyboard is and has to make room itself.
        // Capacitor's margins (capacitor.config.json adjustMarginsForEdgeToEdge)
        // cover the status and navigation bars only, so the keyboard covered
        // the bottom half of the page, the AI key box and the chat's composer
        // with it, and nothing moved. These are the same margins with the
        // keyboard's height at the bottom while it is up, so the page shrinks
        // above it as the website does (index.html interactive-widget).
        if (webView != null && edgeToEdgeMargins()) {
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
                int bottom = Math.max(bars.bottom, keyboard.bottom);
                ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
                if (margins.leftMargin != bars.left || margins.topMargin != bars.top
                        || margins.rightMargin != bars.right || margins.bottomMargin != bottom) {
                    margins.leftMargin = bars.left;
                    margins.topMargin = bars.top;
                    margins.rightMargin = bars.right;
                    margins.bottomMargin = bottom;
                    view.setLayoutParams(margins);
                }
                // Don't pass window insets to children, as Capacitor's own does.
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(webView);
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
        if (view == null || rendererGone) return;
        view.clearCache(false);
        view.evaluateJavascript("window.dispatchEvent(new Event('oh:memory-pressure'))", null);
    }

    @Override
    public void onStart() {
        super.onStart();
        inBackground = false;
        restRequested = false;
        // Always, not only after a pause of ours: pauseTimers holds for every
        // WebView in the process, so it would outlive an activity recreated while
        // the app was away.
        WebView view = webView();
        if (view != null) {
            view.resumeTimers();
            view.onResume();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        inBackground = true;
        // The page can report idle a moment before the activity stops.
        if (restRequested) restInBackground();
    }

    // Called on the UI thread when the page reports it is hidden and idle.
    void restInBackground() {
        restRequested = true;
        if (!inBackground || rendererGone) return;
        WebView view = webView();
        if (view == null) return;
        view.onPause();
        view.pauseTimers();
        Log.i(TAG, "In the background with nothing to finish: the page's timers are paused.");
    }

    // Answers the WebView when its renderer is gone: true, and the page is built
    // again in a new activity; false, the app closes.
    private boolean restartAfterRendererGone(WebView view, RenderProcessGoneDetail detail) {
        // One death, one restart. The WebView of an activity already being
        // rebuilt (or already gone) shares the renderer and hears the same death:
        // handled, and not counted again.
        if (rendererGone || isFinishing() || isDestroyed() || view != webView()) {
            Log.i(TAG, "An earlier WebView heard the same renderer death; nothing more to do.");
            return true;
        }
        boolean crashed = detail != null && detail.didCrash();
        int priority = detail != null ? detail.rendererPriorityAtExit() : -1;
        long now = SystemClock.elapsedRealtime();
        while (!rendererRestarts.isEmpty() && now - rendererRestarts.peekFirst() > RENDERER_RESTART_WINDOW_MS) {
            rendererRestarts.pollFirst();
        }
        rendererGone = true;
        boolean restart = rendererRestarts.size() < RENDERER_RESTARTS_ALLOWED;
        getSharedPreferences(RENDERER_PREFS, MODE_PRIVATE).edit()
                .putLong("at", System.currentTimeMillis())
                .putBoolean("crashed", crashed)
                .putInt("priority", priority)
                .putInt("recent", rendererRestarts.size() + 1)
                .putBoolean("restarted", restart)
                .commit();
        if (!restart) {
            Log.e(TAG, "The page's renderer is gone for the " + (RENDERER_RESTARTS_ALLOWED + 1) + "th time in a minute; closing the app.");
            return false;
        }
        rendererRestarts.addLast(now);
        Log.w(TAG, crashed
                ? "The page's renderer crashed; building the page again."
                : "Android stopped the page's renderer (memory, priority " + priority + "); building the page again.");
        Toast.makeText(getApplicationContext(), crashed
                ? "Open Historia stopped unexpectedly and started again."
                : "Open Historia ran short of memory and started again.", Toast.LENGTH_LONG).show();
        // A new activity, a new WebView; Capacitor destroys the dead one as this
        // activity's window goes (Bridge.onDetachedFromWindow).
        recreate();
        return true;
    }

    // The dead WebView goes with its activity. Capacitor destroys a WebView when
    // the window detaches, but after a restart the old one was still there to
    // hear the next death, so it is taken out and destroyed here as well (a second
    // destroy is a no-op).
    @Override
    public void onDestroy() {
        WebView view = rendererGone ? webView() : null;
        super.onDestroy();
        if (view != null) {
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
            view.destroy();
        }
    }

    private WebView webView() {
        return getBridge() != null ? getBridge().getWebView() : null;
    }

    // Whether Capacitor keeps the page clear of the system bars itself: the
    // test its CapacitorWebView.edgeToEdgeHandler makes.
    private boolean edgeToEdgeMargins() {
        String mode = getBridge().getConfig().adjustMarginsForEdgeToEdge();
        if ("force".equals(mode)) return true;
        if (!"auto".equals(mode) || Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return false;
        TypedValue value = new TypedValue();
        boolean optOut = getTheme().resolveAttribute(android.R.attr.windowOptOutEdgeToEdgeEnforcement, value, true);
        return !(optOut && value.data != 0);
    }
}
