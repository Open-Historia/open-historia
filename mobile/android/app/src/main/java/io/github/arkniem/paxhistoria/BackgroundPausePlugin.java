/*! Open Historia — the app rests in the background © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
package io.github.arkniem.paxhistoria;

import android.app.Activity;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The page's half is src/runtime/native/backgroundPause.js: once the app is in
// the background and nothing is being generated, the page calls idle(), and
// MainActivity pauses the WebView's timers until the app comes back.
@CapacitorPlugin(name = "OhBackground")
public class BackgroundPausePlugin extends Plugin {
    @PluginMethod
    public void idle(PluginCall call) {
        call.resolve();
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            MainActivity main = (MainActivity) activity;
            main.runOnUiThread(main::restInBackground);
        }
    }
}
