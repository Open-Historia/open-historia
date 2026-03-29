const formatBytes = (bytes) => {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const StartupScreen = ({
  elapsedMs = 0,
  loadedBytes = 0,
  progress = 0,
  stage = "Preparing the world",
  steps = [],
  timeBudgetMs = 30_000,
  timedOut = false,
}) => {
  const secondsLeft = Math.max(0, Math.ceil((timeBudgetMs - elapsedMs) / 1000));

  return (
    <div className="startup-shell">
      <div className="startup-aurora startup-aurora-left" />
      <div className="startup-aurora startup-aurora-right" />
      <div className="startup-grid" />

      <div className="startup-panel">
        <div className="startup-eyebrow">PAX HISTORIA</div>

        <div className="startup-orbit">
          <div className="startup-orbit-ring startup-orbit-ring-large" />
          <div className="startup-orbit-ring startup-orbit-ring-small" />
          <div className="startup-core">
            <span>PH</span>
          </div>
          <div className="startup-scanline" />
        </div>

        <h1 className="startup-title">
          {timedOut ? "Continuing with live loading" : "Preparing the world"}
        </h1>
        <p className="startup-subtitle">
          Up to 30 seconds are reserved for warming critical data, archives,
          initial world textures, and the first world render. If the budget
          runs out, the remaining assets continue loading in-game.
        </p>

        <div className="startup-progress-card">
          <div className="startup-progress-meta">
            <span>{stage}</span>
            <span>{progress}%</span>
          </div>
          <div className="startup-progress-track">
            <div
              className="startup-progress-fill"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>

        <div className="startup-status-row">
          <span>
            {timedOut ? "Background loading enabled" : `${secondsLeft}s remaining`}
          </span>
          <span>{formatBytes(loadedBytes)} cached so far</span>
        </div>

        <div className="startup-steps">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`startup-step startup-step-${step.status}`}
            >
              <span className="startup-step-indicator" />
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StartupScreen;
