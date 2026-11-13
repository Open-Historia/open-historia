package io.github.arkniem.openhistoria.plugin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

public class SkipService extends Service {
    static final String ACTION_START = "io.github.arkniem.openhistoria.SKIP_START";
    static final String ACTION_UPDATE = "io.github.arkniem.openhistoria.SKIP_UPDATE";
    static final String ACTION_STOP = "io.github.arkniem.openhistoria.SKIP_STOP";
    static final String CHANNEL_RUNNING = "time-skips";
    static final String CHANNEL_DONE = "time-skips-done";
    static final int RUNNING_ID = 4101;
    static final int DONE_ID = 4102;
    static final long POLL_MS = 1000;
    static final long WAKE_MS = 90L * 60L * 1000L;

    static volatile boolean appInFront = true;
    static volatile boolean running = false;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private String title = "Open Historia";
    private String text = "";
    private String doneText = "";
    private String channelName = "";
    private String doneChannelName = "";
    private String busyFile = "";
    private boolean sawBusy = false;
    private long startedAt = 0;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (!running) {
                return;
            }
            readBusyFile();
            handler.postDelayed(this, POLL_MS);
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            finish(false);
            return START_NOT_STICKY;
        }
        if (intent != null) {
            title = pick(intent.getStringExtra("title"), title);
            text = pick(intent.getStringExtra("text"), text);
            doneText = pick(intent.getStringExtra("doneText"), doneText);
            channelName = pick(intent.getStringExtra("channel"), channelName);
            doneChannelName = pick(intent.getStringExtra("doneChannel"), doneChannelName);
            busyFile = pick(intent.getStringExtra("busyFile"), busyFile);
        }
        if (ACTION_START.equals(action) || !running) {
            begin();
        } else {
            show();
        }
        return START_NOT_STICKY;
    }

    private static String pick(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    private void begin() {
        makeChannels();
        Notification notification = build(text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(RUNNING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(RUNNING_ID, notification);
        }
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(DONE_ID);
        }
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (power != null) {
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenHistoria:skip");
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null) {
            wakeLock.acquire(WAKE_MS);
        }
        startedAt = System.currentTimeMillis();
        sawBusy = false;
        if (!running) {
            running = true;
            handler.postDelayed(poll, POLL_MS);
        }
    }

    private void readBusyFile() {
        if (busyFile.isEmpty()) {
            return;
        }
        File file = new File(busyFile);
        if (!file.isFile()) {
            return;
        }
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) Math.min(file.length(), 65536)];
            int read = in.read(bytes);
            if (read <= 0) {
                return;
            }
            JSONObject state = new JSONObject(new String(bytes, 0, read, StandardCharsets.UTF_8));
            int busy = state.optInt("busy", 0);
            long changed = state.optLong("at", 0);
            if (busy > 0) {
                sawBusy = true;
                String label = state.optString("label", "");
                if (!label.isEmpty() && !label.equals(text)) {
                    text = label;
                    show();
                }
            } else if (sawBusy || changed >= startedAt) {
                finish(true);
            }
        } catch (Exception ignored) {
        }
    }

    private void finish(boolean landed) {
        handler.removeCallbacks(poll);
        boolean wasRunning = running;
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        if (landed && wasRunning && !appInFront && !doneText.isEmpty()) {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(DONE_ID, builder(CHANNEL_DONE).setContentTitle(doneText).setAutoCancel(true).build());
            }
        }
        stopSelf();
    }

    private void show() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null && running) {
            manager.notify(RUNNING_ID, build(text));
        }
    }

    private void makeChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(CHANNEL_RUNNING, channelName.isEmpty() ? title : channelName, NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
        NotificationChannel done = new NotificationChannel(CHANNEL_DONE, doneChannelName.isEmpty() ? title : doneChannelName, NotificationManager.IMPORTANCE_DEFAULT);
        manager.createNotificationChannel(done);
    }

    private Notification.Builder builder(String channel) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, channel) : new Notification.Builder(this);
        int icon = getResources().getIdentifier("oh_notification", "drawable", getPackageName());
        builder.setSmallIcon(icon != 0 ? icon : android.R.drawable.stat_notify_sync);
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, flags));
        }
        return builder;
    }

    private Notification build(String body) {
        Notification.Builder builder = builder(CHANNEL_RUNNING);
        builder.setContentTitle(body);
        builder.setOngoing(true);
        builder.setOnlyAlertOnce(true);
        builder.setProgress(0, 0, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        finish(false);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(poll);
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }
}
