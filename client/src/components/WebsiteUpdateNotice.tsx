import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { activateWebsiteUpdate, subscribeWebsiteUpdates } from "../services/pwa";

export default function WebsiteUpdateNotice() {
  const [available, setAvailable] = useState(false);
  const [activating, setActivating] = useState(false);

  useEffect(() => subscribeWebsiteUpdates(setAvailable), []);
  if (!available) return null;

  const refresh = async () => {
    setActivating(true);
    const started = await activateWebsiteUpdate();
    if (!started) {
      setActivating(false);
      setAvailable(false);
    }
  };

  return (
    <aside className="website-update-notice" role="status" aria-live="polite">
      <div>
        <strong>TapTap update ready</strong>
        <span>Refresh when you are ready. Your current screen will stay open until then.</span>
      </div>
      <button type="button" onClick={refresh} disabled={activating}>
        <RefreshCw size={18} aria-hidden="true" />
        {activating ? "Refreshing..." : "Refresh now"}
      </button>
    </aside>
  );
}
