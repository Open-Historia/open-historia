/*! Open Historia — the page's renderer, gone and started again © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
package io.github.arkniem.openhistoria;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// What MainActivity kept when the page's renderer died, handed to the page once
// it is running again (src/runtime/native/rendererRestart.js puts it in the
// diagnostics log), and then forgotten. Empty when nothing happened.
@CapacitorPlugin(name = "OhRenderer")
public class RendererRestartPlugin extends Plugin {
    @PluginMethod
    public void lastRestart(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(MainActivity.RENDERER_PREFS, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        long at = prefs.getLong("at", 0L);
        if (at > 0L) {
            result.put("at", at);
            result.put("crashed", prefs.getBoolean("crashed", false));
            result.put("priority", prefs.getInt("priority", -1));
            result.put("recent", prefs.getInt("recent", 1));
            result.put("restarted", prefs.getBoolean("restarted", true));
            prefs.edit().clear().apply();
        }
        call.resolve(result);
    }
}
