/*! Open Historia — the app's file, read once per install © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
package io.github.arkniem.openhistoria;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.util.Log;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Each Android app downloads one small text file of its own, once: on the first
// start after it is installed, or after it is updated to a build that has this.
// GitHub counts how often each file on the app-files release is downloaded,
// which is how many installs each app has. The request is a plain GET: no id,
// no query string, nothing about the player or the game. A start that cannot
// reach GitHub leaves no mark and the next start tries again; once a download
// has gone through, the mark (the app's own preferences, which survive an
// update and a reset of the WebView's storage) says so and no start downloads
// it again. A debuggable build (a developer's own) never downloads it. The
// desktop apps do the same in electron/appFile.cjs.
final class AppFile {
    private static final String TAG = "OpenHistoria";
    static final String PREFS = "oh-app-file";
    static final String RELEASE = "https://github.com/Open-Historia/open-historia/releases/download/app-files/";

    private AppFile() {
    }

    // The file this app downloads, or null. build.gradle names it from the
    // channel, next to the application id it gives the channel: android.app.txt
    // for the stable app, android.beta.app.txt for the beta (GitHub serves an
    // uploaded "android app.txt" as android.app.txt), and none for the handover
    // build, whose player is counted when the app it installs starts.
    static String fileFor(String configured) {
        return configured == null || configured.isEmpty() ? null : configured;
    }

    static boolean shouldFetch(String file, boolean debuggable, boolean doneBefore) {
        return file != null && !debuggable && !doneBefore;
    }

    // Called once from MainActivity.onCreate. Returns at once; the download, if
    // there is one, runs on its own thread and never touches the page.
    static void fetchOnce(Context context) {
        final Context app = context.getApplicationContext();
        final String file = fileFor(BuildConfig.OH_APP_FILE);
        final boolean debuggable = (app.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        final SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!shouldFetch(file, debuggable, prefs.getBoolean("done", false))) return;
        Thread thread = new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(RELEASE + file).openConnection();
                connection.setRequestMethod("GET");
                connection.setInstanceFollowRedirects(true);
                connection.setUseCaches(false);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(15_000);
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    Log.i(TAG, "App file: GitHub answered " + status + "; the next start tries again.");
                    return;
                }
                // Read to the end, so the download is a whole one.
                try (InputStream body = connection.getInputStream()) {
                    byte[] buffer = new byte[1024];
                    while (body.read(buffer) != -1) {
                        // nothing to keep
                    }
                }
                prefs.edit().putBoolean("done", true).putLong("at", System.currentTimeMillis()).apply();
                Log.i(TAG, "App file: " + file + " downloaded once; it will not be downloaded again.");
            } catch (Exception error) {
                Log.i(TAG, "App file: " + error + "; the next start tries again.");
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "oh-app-file");
        thread.setDaemon(true);
        thread.start();
    }
}
