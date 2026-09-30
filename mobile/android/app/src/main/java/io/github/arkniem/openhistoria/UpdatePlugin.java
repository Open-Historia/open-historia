/*! Open Historia — the app installs its own updates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
package io.github.arkniem.openhistoria;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// The page's half is src/runtime/native/appInstaller.js. install() downloads the
// new APK into the app's cache, reporting "progress" events, and opens Android's
// installer on it; Android asks the player to confirm (and, the first time, to
// allow installs from this app), and refuses any APK not signed like this one.
// The update used to go through the phone's browser, which left a download for
// the player to find and open.
//
// The APK is kept, with the build it is (the release's build number, which is
// also its versionCode), so a player who closes the installer and taps Update
// later is not sent through the same ~66MB again; once the app is on that build
// or newer, load() deletes it.
@CapacitorPlugin(name = "OhUpdate")
public class UpdatePlugin extends Plugin {
    private static final String TAG = "OpenHistoria";
    private static final String APK_TYPE = "application/vnd.android.package-archive";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean downloading = false;
    private volatile boolean cancelled = false;

    @Override
    public void load() {
        executor.execute(() -> {
            long kept = keptBuild();
            if (kept > 0 && kept <= installedBuild()) {
                deleteKept();
                Log.i(TAG, "The app is on build " + kept + " or newer: its downloaded update is deleted.");
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        String address = call.getString("url", "");
        long build = call.getInt("build", 0);
        if (address == null || !address.startsWith("https://")) {
            call.reject("An update must come over https.");
            return;
        }
        if (downloading) {
            call.reject("An update is already downloading.");
            return;
        }
        downloading = true;
        cancelled = false;
        executor.execute(() -> {
            try {
                File apk = build > 0 && keptBuild() == build && apkFile().isFile() ? apkFile() : download(address, build);
                openInstaller(apk);
                call.resolve();
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : error.toString();
                Log.w(TAG, "The update did not download: " + message);
                call.reject(message);
            } finally {
                downloading = false;
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        call.resolve();
    }

    private File folder() {
        return new File(getContext().getCacheDir(), "updates");
    }

    private File apkFile() {
        return new File(folder(), "open-historia-update.apk");
    }

    private File buildFile() {
        return new File(folder(), "open-historia-update.build");
    }

    // The build the kept APK is, or 0.
    private long keptBuild() {
        if (!apkFile().isFile()) return 0;
        try (InputStream in = new FileInputStream(buildFile())) {
            ByteArrayOutputStream text = new ByteArrayOutputStream();
            byte[] buffer = new byte[32];
            int read;
            while ((read = in.read(buffer)) != -1) text.write(buffer, 0, read);
            return Long.parseLong(new String(text.toByteArray(), StandardCharsets.UTF_8).trim());
        } catch (Exception error) {
            return 0;
        }
    }

    private void deleteKept() {
        apkFile().delete();
        buildFile().delete();
    }

    private long installedBuild() {
        try {
            Context context = getContext();
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (Exception error) {
            return Long.MAX_VALUE; // unknown: never keep an APK that may be installed already
        }
    }

    private File download(String address, long build) throws IOException {
        File folder = folder();
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("There is no room to save the update.");
        File partial = new File(folder, "open-historia-update.apk.part");
        File target = apkFile();
        deleteKept();

        // GitHub answers a release download with a redirect to its file host;
        // HttpURLConnection follows it as long as it stays on https.
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        try {
            int status = connection.getResponseCode();
            if (!"https".equals(connection.getURL().getProtocol())) throw new IOException("An update must come over https.");
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("The update server answered " + status + ".");
            long total = connection.getContentLengthLong();
            long received = 0;
            int reported = -1;
            try (InputStream in = new BufferedInputStream(connection.getInputStream());
                 OutputStream out = new FileOutputStream(partial)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (cancelled) throw new IOException("cancelled");
                    out.write(buffer, 0, read);
                    received += read;
                    if (total > 0) {
                        int percent = (int) Math.min(100, received * 100 / total);
                        if (percent != reported) {
                            reported = percent;
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            notifyListeners("progress", progress);
                        }
                    }
                }
            }
            if (total > 0 && received != total) throw new IOException("The update download was cut short.");
        } catch (IOException error) {
            partial.delete();
            throw error;
        } finally {
            connection.disconnect();
        }
        if (!partial.renameTo(target)) throw new IOException("The downloaded update could not be saved.");
        if (build > 0) {
            try (OutputStream out = new FileOutputStream(buildFile())) {
                out.write(String.valueOf(build).getBytes(StandardCharsets.UTF_8));
            } catch (IOException error) {
                // Not kept for next time; this install still goes ahead.
            }
        }
        return target;
    }

    private void openInstaller(File apk) {
        Context context = getContext();
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, APK_TYPE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }
}
