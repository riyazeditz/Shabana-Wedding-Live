import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Camera,
  UploadCloud,
  QrCode as QrCodeIcon,
  Images,
  Download,
  RefreshCw,
  Copy,
  ExternalLink,
  X,
  Loader2,
  Radio,
} from "lucide-react";
import { supabase } from "./supabase";
import "./App.css";

const WEDDING_PATH_PATTERN = /^\/w\/([^/]+)$/;
const PHOTO_BUCKET = "wedding-photos";

function publicPhotoUrl(storagePath) {
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl ?? "";
}

function formatTimestamp(value) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ============================================================
   Admin Dashboard
============================================================ */

function AdminDashboard() {
  const [weddingName, setWeddingName] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeWedding, setActiveWedding] = useState(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [recentPhotos, setRecentPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [generatingQr, setGeneratingQr] = useState(false);
  const [copied, setCopied] = useState(false);

  const galleryUrl = useMemo(() => {
    if (!activeWedding?.id) return "";
    return `${window.location.origin}/w/${activeWedding.id}`;
  }, [activeWedding?.id]);

  const loadActiveWedding = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("weddings")
      .select("id, name, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      setError(fetchError.message);
      return null;
    }

    setError(null);
    setActiveWedding(data ?? null);
    return data ?? null;
  }, []);

  const refreshStats = useCallback(async (weddingId) => {
    if (!weddingId) {
      setPhotoCount(0);
      setRecentPhotos([]);
      return;
    }

    const [{ count }, { data: photos }] = await Promise.all([
      supabase
        .from("photos")
        .select("*", { count: "exact", head: true })
        .eq("wedding_id", weddingId),
      supabase
        .from("photos")
        .select("id, filename, storage_path, created_at")
        .eq("wedding_id", weddingId)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

    setPhotoCount(count ?? 0);
    setRecentPhotos(photos ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const wedding = await loadActiveWedding();
      await refreshStats(wedding?.id);
      setLoading(false);
    })();
  }, [loadActiveWedding, refreshStats]);

  // Live photo monitor: new uploads appear without a manual refresh.
  useEffect(() => {
    if (!activeWedding?.id) return undefined;

    const channel = supabase
      .channel(`admin-photos-${activeWedding.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "photos",
          filter: `wedding_id=eq.${activeWedding.id}`,
        },
        (payload) => {
          setPhotoCount((count) => count + 1);
          setRecentPhotos((prev) => [payload.new, ...prev].slice(0, 12));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeWedding?.id]);

  async function handleCreateWedding(event) {
    event.preventDefault();
    const name = weddingName.trim();
    if (!name || creating) return;

    setCreating(true);
    setError(null);

    try {
      if (activeWedding?.id) {
        const { error: deactivateError } = await supabase
          .from("weddings")
          .update({ active: false })
          .eq("id", activeWedding.id);
        if (deactivateError) throw deactivateError;
      }

      const { data, error: insertError } = await supabase
        .from("weddings")
        .insert({ name, active: true })
        .select()
        .single();
      if (insertError) throw insertError;

      setActiveWedding(data);
      setPhotoCount(0);
      setRecentPhotos([]);
      setQrDataUrl(null);
      setWeddingName("");
    } catch (err) {
      setError(err.message ?? "Could not create the wedding.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    const wedding = await loadActiveWedding();
    await refreshStats(wedding?.id);
    setRefreshing(false);
  }

  async function handleGenerateQr() {
    if (!galleryUrl) return;
    setGeneratingQr(true);
    try {
      const dataUrl = await QRCode.toDataURL(galleryUrl, {
        width: 480,
        margin: 2,
        color: { dark: "#0b0a08", light: "#f6f2e9" },
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      setError("Could not generate the QR code.");
    } finally {
      setGeneratingQr(false);
    }
  }

  function handleDownloadQr() {
    if (!qrDataUrl || !activeWedding) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `${activeWedding.name.replace(/\s+/g, "-").toLowerCase()}-qr.png`;
    link.click();
  }

  async function handleCopyLink() {
    if (!galleryUrl) return;
    try {
      await navigator.clipboard.writeText(galleryUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError("Could not copy the link.");
    }
  }

  return (
    <div className="app-shell">
      <header className="admin-header">
        <div className="brand">
          <span className="brand-mark">Riyaz</span>
          <span className="brand-sub">Wedding Live</span>
        </div>
        <div className={`status-pill ${error ? "status-pill--warn" : ""}`}>
          <span className="status-dot" />
          {error ? "Connection issue" : "System online"}
        </div>
      </header>

      <main className="admin-main">
        <section className="panel">
          <h1 className="panel-title">Wedding dashboard</h1>
          <p className="panel-lede">
            Create one wedding QR code and share it with every guest.
          </p>
          <form className="create-form" onSubmit={handleCreateWedding}>
            <input
              type="text"
              className="text-input"
              placeholder="Wedding name, e.g. Shabana Wedding"
              value={weddingName}
              onChange={(e) => setWeddingName(e.target.value)}
              disabled={creating}
            />
            <button type="submit" className="btn btn-primary" disabled={creating || !weddingName.trim()}>
              {creating ? <Loader2 className="icon spin" size={16} /> : null}
              Create wedding
            </button>
          </form>
          {error ? <p className="error-text">{error}</p> : null}
        </section>

        {loading ? (
          <section className="panel panel-center">
            <Loader2 className="icon spin" size={20} />
            <span>Loading current wedding&hellip;</span>
          </section>
        ) : activeWedding ? (
          <>
            <section className="panel">
              <div className="panel-header-row">
                <h2 className="panel-title">Active wedding</h2>
                <span className="status-badge">Active</span>
              </div>

              <dl className="wedding-meta">
                <div>
                  <dt>Wedding name</dt>
                  <dd>{activeWedding.name}</dd>
                </div>
                <div>
                  <dt>Wedding ID</dt>
                  <dd className="mono">{activeWedding.id}</dd>
                </div>
                <div>
                  <dt>Total photos</dt>
                  <dd>{photoCount}</dd>
                </div>
              </dl>

              <div className="action-row">
                <a className="btn btn-ghost" href={galleryUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} className="icon" />
                  Open gallery
                </a>
                <button type="button" className="btn btn-ghost" onClick={handleCopyLink}>
                  <Copy size={16} className="icon" />
                  {copied ? "Link copied" : "Copy link"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={handleRefresh} disabled={refreshing}>
                  <RefreshCw size={16} className={`icon ${refreshing ? "spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </section>

            <section className="panel">
              <h2 className="panel-title">Wedding QR code</h2>
              <p className="panel-lede">
                Print this once. Every guest scans the same code for the whole event.
              </p>
              {qrDataUrl ? (
                <div className="qr-block">
                  <img src={qrDataUrl} alt={`QR code for ${activeWedding.name}`} className="qr-image" />
                  <button type="button" className="btn btn-primary" onClick={handleDownloadQr}>
                    <Download size={16} className="icon" />
                    Download QR
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-primary" onClick={handleGenerateQr} disabled={generatingQr}>
                  {generatingQr ? <Loader2 size={16} className="icon spin" /> : <QrCodeIcon size={16} className="icon" />}
                  Generate QR
                </button>
              )}
            </section>

            <section className="panel">
              <h2 className="panel-title">Live photo monitor</h2>
              <p className="panel-lede">
                Photos uploaded from the camera appear here automatically.
              </p>
              {recentPhotos.length === 0 ? (
                <div className="empty-state">
                  <Images size={22} className="icon" />
                  <span>No photos yet. Drop one into the incoming folder to test the pipeline.</span>
                </div>
              ) : (
                <ul className="monitor-list">
                  {recentPhotos.map((photo) => (
                    <li key={photo.id} className="monitor-row">
                      <img
                        src={publicPhotoUrl(photo.storage_path)}
                        alt={photo.filename}
                        className="monitor-thumb"
                        loading="lazy"
                      />
                      <div className="monitor-meta">
                        <span className="monitor-filename">{photo.filename}</span>
                        <span className="monitor-time">{formatTimestamp(photo.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <section className="panel panel-center">
            <span>No active wedding yet. Create one above to generate its QR code.</span>
          </section>
        )}

        <section className="panel how-it-works">
          <h2 className="panel-title">How Wedding Live works</h2>
          <ol className="step-list">
            <li className="step">
              <span className="step-number">01</span>
              <Camera size={18} className="icon" />
              <div>
                <h3>Camera</h3>
                <p>Photos come straight off the Canon EOS R50 into one folder on the laptop.</p>
              </div>
            </li>
            <li className="step">
              <span className="step-number">02</span>
              <UploadCloud size={18} className="icon" />
              <div>
                <h3>Automatic upload</h3>
                <p>A watcher on the laptop spots each new photo and sends it up, with no clicks needed.</p>
              </div>
            </li>
            <li className="step">
              <span className="step-number">03</span>
              <QrCodeIcon size={18} className="icon" />
              <div>
                <h3>One QR code</h3>
                <p>Guests scan a single code, at any point in the event, to open the live gallery.</p>
              </div>
            </li>
            <li className="step">
              <span className="step-number">04</span>
              <Radio size={18} className="icon" />
              <div>
                <h3>Live gallery</h3>
                <p>Every new photo appears for guests in real time, ready to view and download.</p>
              </div>
            </li>
          </ol>
        </section>
      </main>
    </div>
  );
}

/* ============================================================
   Guest Gallery
============================================================ */

function GuestGallery({ weddingId }) {
  const [wedding, setWedding] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  useEffect(() => {
    let isCurrent = true;

    (async () => {
      setLoading(true);

      const { data: weddingRow, error: weddingError } = await supabase
        .from("weddings")
        .select("id, name")
        .eq("id", weddingId)
        .maybeSingle();

      if (!isCurrent) return;

      if (weddingError || !weddingRow) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setWedding(weddingRow);

      const { data: photoRows } = await supabase
        .from("photos")
        .select("id, filename, storage_path, created_at")
        .eq("wedding_id", weddingId)
        .order("created_at", { ascending: false });

      if (!isCurrent) return;
      setPhotos(photoRows ?? []);
      setLoading(false);
    })();

    return () => {
      isCurrent = false;
    };
  }, [weddingId]);

  useEffect(() => {
    const channel = supabase
      .channel(`guest-photos-${weddingId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "photos",
          filter: `wedding_id=eq.${weddingId}`,
        },
        (payload) => {
          setPhotos((prev) =>
            prev.some((photo) => photo.id === payload.new.id) ? prev : [payload.new, ...prev]
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [weddingId]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") setSelectedPhoto(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="guest-shell guest-shell--center">
        <Loader2 size={22} className="icon spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="guest-shell guest-shell--center">
        <p>This wedding gallery could not be found.</p>
      </div>
    );
  }

  return (
    <div className="guest-shell">
      <header className="guest-header">
        <div className="brand">
          <span className="brand-mark">Riyaz</span>
          <span className="brand-sub">Wedding Live</span>
        </div>
        <div className="live-pill">
          <span className="live-dot" />
          Live
        </div>
      </header>

      <div className="guest-intro">
        <h1 className="wedding-title">{wedding?.name}</h1>
        <p className="guest-desc">
          New wedding photos appear automatically as they are uploaded. You do not need to scan the QR code again.
        </p>
        <div className="count-badge">
          {photos.length} live photo{photos.length === 1 ? "" : "s"}
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="empty-gallery">
          <Images size={26} className="icon" />
          <h2>Waiting for photos</h2>
          <p>New wedding photos will appear here automatically.</p>
        </div>
      ) : (
        <div className="photo-grid">
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              className="photo-card"
              onClick={() => setSelectedPhoto(photo)}
            >
              <img src={publicPhotoUrl(photo.storage_path)} alt={photo.filename} loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <footer className="guest-footer">
        <p>Powered by Riyaz Wedding Live</p>
        <p className="guest-footer-sub">Scan once &bull; Watch live &bull; Download originals</p>
      </footer>

      {selectedPhoto ? (
        <div className="lightbox-overlay" onClick={() => setSelectedPhoto(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="lightbox-close" onClick={() => setSelectedPhoto(null)}>
              <X size={20} />
            </button>
            <img
              src={publicPhotoUrl(selectedPhoto.storage_path)}
              alt={selectedPhoto.filename}
              className="lightbox-image"
            />
            <a
              className="btn btn-primary"
              href={publicPhotoUrl(selectedPhoto.storage_path)}
              download={selectedPhoto.filename}
            >
              <Download size={16} className="icon" />
              Download original
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   App / routing
============================================================ */

export default function App() {
  const guestWeddingId = useMemo(() => {
    const match = window.location.pathname.match(WEDDING_PATH_PATTERN);
    return match ? match[1] : null;
  }, []);

  if (guestWeddingId) {
    return <GuestGallery weddingId={guestWeddingId} />;
  }

  return <AdminDashboard />;
}
