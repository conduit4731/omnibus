"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import localforage from "localforage"
import {
  ChevronLeft, ChevronRight, X, Loader2, Maximize, Minimize, Check,
  Settings as SettingsIcon, Bookmark, CloudDownload, Flag, Tag, Plus, ScanSearch
} from "lucide-react"
import { GuidedSettingsSection, GuidedView, useGuidedSettings } from "@/components/guided-view"
import { useSession } from "next-auth/react"
import PageManagerModal from "@/components/page-manager-modal"
import { useToast } from "@/components/ui/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// Fork: Batcave's reader look — top bar height, magnifier size and power
const BAR_H = 54;
const LENS_SIZE = 240;
const LENS_ZOOM = 2.5;

function SegLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.77px] text-[rgba(235,235,245,0.4)]">{children}</div>;
}

// A settings row: small-caps label over a segmented control, the chosen segment in orange
function Seg<T extends string>({ label, value, options, onChange }: { label: string, value: T, options: [T, string][], onChange: (v: T) => void }) {
  return (
    <div className="space-y-2">
      <SegLabel>{label}</SegLabel>
      <div role="radiogroup" aria-label={label} className="flex h-[38px] p-[2px] rounded-[10px] bg-[rgba(118,118,128,0.24)]">
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)}
            className={`flex-1 h-[34px] rounded-[8px] text-[13px] transition-colors ${v === value ? 'bg-[#ffa332] text-black font-semibold shadow-[0_2px_8px_rgba(255,163,50,0.35)]' : 'text-[rgba(235,235,245,0.6)] font-medium hover:text-[rgba(235,235,245,0.87)]'}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

// A top-bar tool: icon plus label (label from xl up), orange while on
function ToolBtn({ icon, label, active, className, ...rest }: { icon: React.ReactNode, label?: string, active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" title={label} aria-label={rest.title || label} {...rest}
      className={`flex shrink-0 items-center gap-1.5 font-medium disabled:opacity-40 hover:text-white [&_svg]:size-4 pointer-coarse:[&_svg]:size-5 pointer-coarse:min-w-9 pointer-coarse:h-9 justify-center ${active ? 'text-[#ffa332]' : 'text-[rgba(235,235,245,0.87)]'} ${className || ''}`}>
      {icon}{label && <span className="hidden xl:inline">{label}</span>}
    </button>
  );
}

function ReaderContent() {
  if (typeof document !== 'undefined') {
    document.title = "Omnibus - Reader";
  }

  const searchParams = useSearchParams();
  const router = useRouter();
  const filePath = searchParams.get('path');
  const seriesPath = searchParams.get('series');
  const pageParam = searchParams.get('page'); // Support linking directly to a bookmarked page
  const listId = searchParams.get('list'); // Opened from a reading list: "next issue" follows the list, not the series
  const { toast } = useToast();

  const [pages, setPages] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMarkedRead, setIsMarkedRead] = useState(false);
  
  const [isReadyToSync, setIsReadyToSync] = useState(false);
  
  // Bookmarks State
  const [bookmarks, setBookmarks] = useState<number[]>([]);

  // In-reader page flagging (issue #189 Phase 2, admin-only): flag junk pages while reading; on
  // close (or via the review chip) the flags pre-fill the Page Manager, which owns the explicit
  // delete confirmation — flags themselves never delete anything.
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'ADMIN';
  const [issueId, setIssueId] = useState<string | null>(null);
  const [flaggedPages, setFlaggedPages] = useState<Set<string>>(new Set());
  const [pageManagerOpen, setPageManagerOpen] = useState(false);
  const exitAfterManagerRef = useRef(false);
  const managerAppliedRef = useRef(false);

  // In-reader tagging (#199 round 2, concept by CapitanoNemo78; admin-only): note characters,
  // teams, locations, and credits spotted while reading. Nothing saves per-tag — additions
  // accumulate and are written ONCE on close via the existing PATCH /api/library/issue (which
  // also queues the ComicInfo.xml embed), so a six-tag session costs one archive rewrite, not six.
  // Categories map 1:1 onto the route's ARRAY_FIELDS whitelist — all eleven ComicInfo credit and
  // appearance roles since inker/editor/translator gained per-issue columns (Call-3 Beta A).
  const TAG_CATEGORY_LABELS = {
    characters: 'Character', teams: 'Team', locations: 'Location',
    writers: 'Writer', artists: 'Penciller', inker: 'Inker', coverArtists: 'Cover Artist',
    colorists: 'Colorist', letterers: 'Letterer', editor: 'Editor', translator: 'Translator',
  } as const;
  type TagCategory = keyof typeof TAG_CATEGORY_LABELS;
  const emptyPendingTags = (): Record<TagCategory, string[]> => ({
    characters: [], teams: [], locations: [], writers: [], artists: [], inker: [],
    coverArtists: [], colorists: [], letterers: [], editor: [], translator: [],
  });
  const [pendingTags, setPendingTags] = useState<Record<TagCategory, string[]>>(emptyPendingTags());
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagCategory, setTagCategory] = useState<TagCategory>('characters');
  const [tagInput, setTagInput] = useState("");
  const [isSavingTags, setIsSavingTags] = useState(false);
  const pendingTagCount = Object.values(pendingTags).reduce((n, arr) => n + arr.length, 0);

  const addPendingTag = () => {
    const val = tagInput.trim();
    if (!val) return;
    setPendingTags(prev => prev[tagCategory].includes(val) ? prev : { ...prev, [tagCategory]: [...prev[tagCategory], val] });
    setTagInput("");
  };
  const removePendingTag = (category: TagCategory, value: string) => {
    setPendingTags(prev => ({ ...prev, [category]: prev[category].filter(v => v !== value) }));
  };

  // Merges each edited category's new names into the issue's CURRENT values (fetched fresh — the
  // reader never loads full metadata) and saves through the metadata editor's endpoint: additive
  // only, deduplicated, absent categories untouched. useCallback with pendingTags in the deps so
  // the Escape-key handler below always closes over the latest pending set, never a stale one.
  const savePendingTagsIfAny = useCallback(async () => {
    if (!isAdmin || !issueId || pendingTagCount === 0) return;
    setIsSavingTags(true);
    try {
      const res = await fetch(`/api/library/issue?id=${issueId}`, { headers: getAuthHeaders() });
      const current = await res.json();
      if (!res.ok || current.error) throw new Error(current.error || "Couldn't load current issue metadata");

      const payload: Record<string, any> = { issueId };
      (Object.keys(TAG_CATEGORY_LABELS) as TagCategory[]).forEach(cat => {
        if (pendingTags[cat].length === 0) return;
        const base: string[] = Array.isArray(current[cat]) ? current[cat] : [];
        const merged = [...base];
        pendingTags[cat].forEach(v => { if (!merged.includes(v)) merged.push(v); });
        payload[cat] = merged;
      });

      const saveRes = await fetch('/api/library/issue', {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saveData.error || "Save failed");

      toast({
        title: "Tags saved",
        description: saveData.wroteToFile
          ? "Saved to the library and embedded into the comic's ComicInfo.xml."
          : "Saved to the library."
      });
      setPendingTags(emptyPendingTags());
    } catch (e: any) {
      toast({ title: "Couldn't save tags", description: e.message, variant: "destructive" });
    } finally {
      setIsSavingTags(false);
    }
    // TAG_CATEGORY_LABELS/emptyPendingTags are stable-shape locals, not reactive state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, issueId, pendingTagCount, pendingTags, toast]);

  // PWA Offline Caching State
  const [pageUrls, setPageUrls] = useState<Record<string, string>>({});
  const [isCaching, setIsCaching] = useState(false);
  const [cacheProgress, setCacheProgress] = useState(0);

  // UI States
  const [showUI, setShowUI] = useState(false); 
  const [hoverTop, setHoverTop] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // New Reader Features State
  const [zoomLevel, setZoomLevel] = useState(100);
  const [pageLoadError, setPageLoadError] = useState(false);

  // Mouse Panning State
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // TOUCH/SWIPE STATE
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(0);
  const touchEndY = useRef(0);

  // PINCH-ZOOM STATE — a two-finger gesture drives zoomLevel; multiTouchRef suppresses the swipe
  // page-turn so a pinch can't flip the page. zoomRef mirrors zoomLevel for the native listener.
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 100 });
  const multiTouchRef = useRef(false);
  const zoomRef = useRef(100);

  // Transient Page Indicator State
  const [showPageToast, setShowPageToast] = useState(false);
  const hideToastTimeout = useRef<NodeJS.Timeout | null>(null);

  // Mouse Idle State (for cursor hiding)
  const [isIdle, setIsIdle] = useState(false);
  const idleTimeout = useRef<NodeJS.Timeout | null>(null);

  // Settings (fork: Batcave's reader settings). readingMode/pageLayout keep their saved names; Batcave's
  // Paginated / Spread / Web / Infinite map onto them plus `infinite`.
  const [settings, setSettings] = useState({
      readingMode: 'ltr',
      pageLayout: 'single',
      infinite: false,
      topBar: 'scroll' as 'scroll' | 'hidden',
      magnifier: false,
      clickNav: 'both' as 'both' | 'forward',
      autoMarkRead: true,
      autoBookmark: true,
      imageWidth: 'auto' as 'auto' | 'manual' | 'at-least' | 'fit-height',
      widthPx: 900,
      brightness: 100,
      cropMargins: false
  });
  const [tocOpen, setTocOpen] = useState(false);
  const [scrolledDown, setScrolledDown] = useState(false);
  const lastScrollY = useRef(0);
  const zHeld = useRef(false);
  const [lens, setLens] = useState<{ x: number, y: number, src: string, w: number, h: number, bx: number, by: number } | null>(null);

  const [nextIssue, setNextIssue] = useState<{ path: string, name: string, series: string } | null>(null);
  const [prevIssue, setPrevIssue] = useState<{ path: string, name: string, series: string } | null>(null);
  const nextIssueHref = (n: { path: string, series: string }) =>
    `/reader?path=${encodeURIComponent(n.path)}&series=${encodeURIComponent(n.series)}${listId ? `&list=${encodeURIComponent(listId)}` : ''}`;

  // Fork: guided view (panel by panel), remembered per browser; enterAtEnd = came back from the next page
  const [guided, setGuided] = useState(false);
  const [guidedFromEnd, setGuidedFromEnd] = useState(false);
  const [guidedSettings, setGuidedSettings] = useGuidedSettings();
  useEffect(() => { try { setGuided(localStorage.getItem('omnibus-guided') === '1') } catch { /* private mode */ } }, []);
  const toggleGuided = () => setGuided(g => { try { localStorage.setItem('omnibus-guided', g ? '0' : '1') } catch { /* private mode */ } return !g });

  // Per-series reader preferences: seriesId identifies the series; prefsLoaded gates saving until the
  // saved prefs have been fetched + merged, so we never overwrite them with defaults on first load.
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const issueName = filePath ? filePath.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, "") : "Loading...";
  const seriesName = seriesPath ? seriesPath.split(/[\\/]/).pop() : "Comic Reader";

  const getAuthHeaders = useCallback(() => {
    return { 'Content-Type': 'application/json' };
  }, []);

  // Flag/unflag the page on screen (by entry NAME — the unit the Page Manager works in).
  const toggleFlagCurrentPage = () => {
    const name = pages[currentIndex];
    if (!name) return;
    setFlaggedPages(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Close intercept: pending tags save silently first (#199 round 2 — additive and non-destructive,
  // so no review step needed; a failed save toasts but never traps the user in the reader). Flagged
  // pages then go through the Page Manager for explicit confirm; the exit continues when the manager
  // closes. No flags → plain exit. useCallback so the Escape handler always calls the current version.
  const handleReaderClose = useCallback(async () => {
    await savePendingTagsIfAny();
    if (isAdmin && issueId && filePath && flaggedPages.size > 0) {
      exitAfterManagerRef.current = true;
      setPageManagerOpen(true);
      return;
    }
    router.back();
  }, [savePendingTagsIfAny, isAdmin, issueId, filePath, flaggedPages, router]);

  const handleManagerOpenChange = (open: boolean) => {
    setPageManagerOpen(open);
    if (!open) {
      const exit = exitAfterManagerRef.current;
      const applied = managerAppliedRef.current;
      exitAfterManagerRef.current = false;
      managerAppliedRef.current = false;
      if (exit) {
        router.back();
      } else if (applied) {
        // Pages changed under the open reader — reload so indices, progress, and the page list agree.
        window.location.reload();
      }
    }
  };

  // Fetch Pages, Context, & Exact Progress
  useEffect(() => {
    if (!filePath) return;
    setLoading(true);
    
    // Reset reader state immediately when navigating to a new issue
    setCurrentIndex(0);
    setIsReadyToSync(false);
    setPrefsLoaded(false);
    setPages([]);
    setFlaggedPages(new Set());
    setPendingTags(emptyPendingTags());
    setIssueId(null);
    
    Promise.all([
      fetch(`/api/reader/pages?path=${encodeURIComponent(filePath)}`).then(res => res.json()),
      fetch(`/api/progress?path=${encodeURIComponent(filePath)}`, { headers: getAuthHeaders() }).then(res => res.json()),
      fetch(`/api/progress/bookmark?path=${encodeURIComponent(filePath)}`, { headers: getAuthHeaders() }).then(res => res.ok ? res.json() : { bookmarks: [] }),
      seriesPath ? fetch(`/api/library/series?path=${encodeURIComponent(seriesPath)}`, { headers: getAuthHeaders() }).then(res => res.json()) : Promise.resolve(null),
      listId ? fetch(`/api/reading-lists?id=${encodeURIComponent(listId)}`).then(res => res.ok ? res.json() : null).catch(() => null) : Promise.resolve(null)
    ])
      .then(([pageData, progressData, bookmarkData, seriesData, listData]) => {
        if (pageData.error) throw new Error(pageData.error);
        setPages(pageData.pages);
        
        if (bookmarkData.bookmarks) {
            setBookmarks(bookmarkData.bookmarks.map((b: any) => b.pageIndex));
        }

        if (seriesData && seriesData.downloadedIssues) {
            if (seriesData.isManga) setSettings(s => ({ ...s, readingMode: 'rtl' }));
            // #203: annuals read AFTER the main run — same order as the series page and OPDS, so
            // "next issue" from the run's finale is Annual #1, not a mid-run jump.
            const sortedIssues = [...seriesData.downloadedIssues].sort((a, b) =>
                (((a as any).isAnnual ? 1 : 0) - ((b as any).isAnnual ? 1 : 0)) || ((a.parsedNum ?? 0) - (b.parsedNum ?? 0)));
            const currentIdx = sortedIssues.findIndex((issue: any) => issue.fullPath === filePath);
            if (currentIdx > -1 && currentIdx < sortedIssues.length - 1) {
                setNextIssue({ path: sortedIssues[currentIdx + 1].fullPath, name: sortedIssues[currentIdx + 1].name, series: seriesPath! });
            } else {
                setNextIssue(null); // Ensure we clear it if it's the last issue
            }
            setPrevIssue(currentIdx > 0 ? { path: sortedIssues[currentIdx - 1].fullPath, name: sortedIssues[currentIdx - 1].name, series: seriesPath! } : null);
        } else {
            setNextIssue(null);
            setPrevIssue(null);
        }
        // Reading list: the next unread entry after this one that has a file, whatever its series
        const listItems: any[] = listData?.items || [];
        const listIdx = listItems.findIndex(i => i.issue?.filePath === filePath);
        if (listIdx > -1) {
            const next = listItems.slice(listIdx + 1).find(i => i.issue?.filePath && i.issue.series?.folderPath && !i.progress?.isCompleted);
            setNextIssue(next ? { path: next.issue.filePath, name: `${next.issue.series.name} #${next.issue.number}`, series: next.issue.series.folderPath } : null);
            const prev = listItems.slice(0, listIdx).reverse().find(i => i.issue?.filePath && i.issue.series?.folderPath);
            setPrevIssue(prev ? { path: prev.issue.filePath, name: `${prev.issue.series.name} #${prev.issue.number}`, series: prev.issue.series.folderPath } : null);
        }

        // Load this user's saved reader preferences for the series (overriding the isManga RTL default
        // applied above). prefsLoaded gates the save effect so first load can't clobber saved prefs.
        const sid: string | null = seriesData?.id ?? null;
        setSeriesId(sid);
        if (sid) {
            fetch(`/api/reader/preferences?seriesId=${encodeURIComponent(sid)}`)
                .then(r => r.ok ? r.json() : { settings: null })
                .then(d => { if (d?.settings && typeof d.settings === 'object') setSettings(s => ({ ...s, ...d.settings })); })
                .catch(() => {})
                .finally(() => setPrefsLoaded(true));
        } else {
            setPrefsLoaded(true);
        }

        // Apply progress or URL query param for the specific issue
        if (pageParam && !isNaN(parseInt(pageParam))) {
            const requestedPage = Math.min(parseInt(pageParam), pageData.pages.length - 1);
            setCurrentIndex(requestedPage);
        } else if (progressData && progressData.currentPage > 0 && !progressData.isCompleted) {
            const safePage = Math.min(progressData.currentPage, pageData.pages.length - 1);
            setCurrentIndex(safePage);
        } else {
            setCurrentIndex(0); // Explicitly start at 0 if no progress exists
        }
        
        setIsMarkedRead(progressData?.isCompleted || false);
        setIssueId(progressData?.issueId || null);
        setTimeout(() => setIsReadyToSync(true), 500);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [filePath, seriesPath, pageParam, getAuthHeaders]);

  // Sync Progress
  const unmarkedAtPage = useRef<number | null>(null);
  useEffect(() => {
    if (loading || !isReadyToSync || pages.length === 0) return;
    if (unmarkedAtPage.current !== currentIndex) unmarkedAtPage.current = null; // a page turn ends the unmark
    
    // Automatic bookmark off: no resume position; the last page still finishes the issue when auto-read is on
    if (!settings.autoBookmark && !(settings.autoMarkRead && currentIndex >= pages.length - 2)) return;
    const timer = setTimeout(() => {
        if (unmarkedAtPage.current === currentIndex) return; // unmarked while this save was pending: stays unread
        fetch('/api/progress', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ filePath, currentPage: currentIndex, totalPages: pages.length, keepCompleted: true, noComplete: !settings.autoMarkRead })
        });
    }, 1500);

    return () => clearTimeout(timer);
  }, [currentIndex, pages.length, filePath, loading, isReadyToSync, getAuthHeaders, settings.autoBookmark, settings.autoMarkRead]);

  // Persist reader settings per series (debounced). Gated on prefsLoaded so the defaults/merge on
  // first load don't overwrite the user's saved prefs before they've been fetched.
  useEffect(() => {
    if (!prefsLoaded || !seriesId) return;
    const t = setTimeout(() => {
        fetch('/api/reader/preferences', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ seriesId, settings })
        }).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [settings, prefsLoaded, seriesId, getAuthHeaders]);

  const getStep = useCallback(() => {
    if (settings.pageLayout === 'single' || settings.readingMode === 'webtoon') return 1;
    if (settings.pageLayout === 'double') return 2;
    if (settings.pageLayout === 'double-no-cover') return currentIndex === 0 ? 1 : 2;
    return 1;
  }, [settings.pageLayout, settings.readingMode, currentIndex]);

  // PWA Offline Caching & Local URL resolution
  const loadCachedPage = useCallback(async (pageName: string) => {
    if (!pageName || pageUrls[pageName]) return;
    const cacheKey = `omnibus_cache_${filePath}_${pageName}`;
    try {
        const cachedBlob = await localforage.getItem<Blob>(cacheKey);
        if (cachedBlob) {
            setPageUrls(prev => ({ ...prev, [pageName]: URL.createObjectURL(cachedBlob) }));
        }
    } catch (e) {}
  }, [filePath, pageUrls]);

  const getPageUrl = useCallback((pageName: string) => {
    if (!pageName) return "";
    if (pageUrls[pageName]) return pageUrls[pageName];
    // Dynamic fallback to the API route with cropping setting
    return `/api/reader/image?path=${encodeURIComponent(filePath!)}&page=${encodeURIComponent(pageName)}&crop=${settings.cropMargins}`;
  }, [pageUrls, filePath, settings.cropMargins]);

  useEffect(() => {
      if (!pages.length || !filePath) return;
      
      const preloadImage = (index: number) => {
          if (index >= pages.length) return;
          const pageName = pages[index];
          
          loadCachedPage(pageName).then(() => {
              // Preload into browser memory whether cached or live; decode ahead so the page swap is instant.
              const img = new Image();
              img.src = getPageUrl(pageName);
              if ('decode' in img) img.decode().catch(() => {});
          });
      };

      const step = getStep();
      for (let i = 1; i <= 3; i++) {
          preloadImage(currentIndex + (step * i));
          if (settings.pageLayout.includes('double')) preloadImage(currentIndex + (step * i) + 1);
      }
  }, [currentIndex, pages, filePath, getStep, settings.pageLayout, loadCachedPage, getPageUrl]);

  useEffect(() => { if (settings.readingMode !== 'webtoon') if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [currentIndex, settings.readingMode]);

  // Clear the page-load error overlay whenever the page changes or the pages reload.
  useEffect(() => { setPageLoadError(false); }, [currentIndex, pages]);

  // Cleanup object URLs on unmount
  useEffect(() => {
      return () => {
          Object.values(pageUrls).forEach(url => {
              if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          });
      };
  }, [pageUrls]);

  const handleMakeOffline = async () => {
      if (isCaching || !filePath || pages.length === 0) return;
      setIsCaching(true);
      setCacheProgress(0);
      let downloaded = 0;
      
      for (const pageName of pages) {
          const cacheKey = `omnibus_cache_${filePath}_${pageName}`;
          try {
              const exists = await localforage.getItem(cacheKey);
              if (!exists) {
                  const res = await fetch(`/api/reader/image?path=${encodeURIComponent(filePath!)}&page=${encodeURIComponent(pageName)}&crop=${settings.cropMargins}`);
                  if (res.ok) {
                      const blob = await res.blob();
                      await localforage.setItem(cacheKey, blob);
                  }
              }
          } catch (e) {
              console.error("Failed to cache page", pageName, e);
          }
          downloaded++;
          setCacheProgress(Math.round((downloaded / pages.length) * 100));
      }
      
      setIsCaching(false);
      toast({ title: "Available Offline", description: "Issue has been fully downloaded to your device." });
  };

  const toggleBookmark = async () => {
    const isBookmarked = bookmarks.includes(currentIndex);
    const method = isBookmarked ? 'DELETE' : 'POST';
    
    try {
        const res = await fetch('/api/progress/bookmark', {
            method,
            headers: getAuthHeaders(),
            body: JSON.stringify({ filePath, pageIndex: currentIndex })
        });
        
        if (res.ok) {
            if (isBookmarked) {
                setBookmarks(prev => prev.filter(i => i !== currentIndex));
                toast({ title: "Bookmark Removed" });
            } else {
                setBookmarks(prev => [...prev, currentIndex]);
                toast({ title: "Bookmark Added", description: `Saved page ${currentIndex + 1} to your profile.` });
            }
        }
    } catch (e) {
        toast({ title: "Error", description: "Failed to update bookmark", variant: "destructive" });
    }
  };

  useEffect(() => {
    const handleMouseMove = () => {
        setIsIdle(false);
        if (idleTimeout.current) clearTimeout(idleTimeout.current);
        idleTimeout.current = setTimeout(() => setIsIdle(true), 2500); 
    };
    idleTimeout.current = setTimeout(() => setIsIdle(true), 2500);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        if (idleTimeout.current) clearTimeout(idleTimeout.current);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  useEffect(() => {
      const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const triggerPageToast = useCallback(() => {
      setShowPageToast(true);
      if (hideToastTimeout.current) clearTimeout(hideToastTimeout.current);
      hideToastTimeout.current = setTimeout(() => setShowPageToast(false), 1500);
  }, []);

  const nextPage = useCallback(() => {
    const step = getStep();
    if (currentIndex < pages.length - step) {
        setCurrentIndex(prev => prev + step);
        if (!showUI) triggerPageToast();
    } else if (currentIndex < pages.length - 1) {
        setCurrentIndex(pages.length - 1);
        if (!showUI) triggerPageToast();
    } else if (nextIssue) {
        // Force sync the current issue as 100% complete before moving on
        if (settings.autoMarkRead) fetch('/api/progress', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ 
                filePath, 
                currentPage: pages.length, 
                totalPages: pages.length 
            })
        }).catch(() => {});

        toast({ title: "Loading Next Issue...", description: nextIssue.name });
        router.replace(nextIssueHref(nextIssue));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nextIssueHref only reads listId from the URL
  }, [currentIndex, pages.length, nextIssue, router, toast, getStep, showUI, triggerPageToast, filePath, getAuthHeaders, settings.autoMarkRead]);

  const prevPage = useCallback(() => {
    if (currentIndex > 0) {
        let step = (settings.pageLayout === 'double') ? 2 : (settings.pageLayout === 'double-no-cover' && currentIndex === 1) ? 1 : 2;
        if (settings.pageLayout === 'single') step = 1;
        setCurrentIndex(prev => Math.max(0, prev - step));
        if (!showUI) triggerPageToast();
    }
  }, [currentIndex, settings.pageLayout, showUI, triggerPageToast]);

  const toggleReadStatus = async () => {
      const newStatus = !isMarkedRead;
      setIsMarkedRead(newStatus);
      // Fork: unmarked on (or near) the last page — the page sync would mark it read again 1.5 s later
      unmarkedAtPage.current = newStatus ? null : currentIndex;
      await fetch('/api/progress', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ filePath, currentPage: newStatus ? pages.length : 0, totalPages: pages.length })
      });
      toast({ title: newStatus ? "Marked as Read" : "Marked as Unread" });
  };

  // Fork: webtoon mode never moved currentIndex, so nothing was saved (resume page, read status, reading
  // time). The page reaching the top third of the screen is now the current page. On open, jump to the
  // saved page first and only then start watching, or page 1 at the top would overwrite the progress.
  const webtoonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
      const root = webtoonRef.current;
      if (settings.readingMode !== 'webtoon' || !root || loading || !isReadyToSync || pages.length === 0) return;
      root.querySelector(`[data-page="${currentIndexRef.current}"]`)?.scrollIntoView({ block: 'start' });
      let obs: IntersectionObserver | null = null;
      const t = setTimeout(() => {
          obs = new IntersectionObserver(entries => {
              for (const e of entries) {
                  // an image not loaded yet has no height: never count it (they all sit at the top)
                  if (e.isIntersecting && e.boundingClientRect.height > 100) setCurrentIndex(Number((e.target as HTMLElement).dataset.page));
              }
          }, { root, rootMargin: '0px 0px -66% 0px' });
          root.querySelectorAll('[data-page]').forEach(el => obs!.observe(el));
      }, 400);
      return () => { clearTimeout(t); obs?.disconnect(); };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened issue / mode, not per page turn
  }, [settings.readingMode, loading, isReadyToSync, pages]);

  // Fork: end-of-issue buttons (webtoon): mark read, then the next issue or back to the series
  const finishIssue = async (goNext: boolean) => {
      if (!isMarkedRead) {
          setIsMarkedRead(true);
          await fetch('/api/progress', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ filePath, currentPage: pages.length, totalPages: pages.length }) });
      }
      if (goNext && nextIssue) router.replace(nextIssueHref(nextIssue));
      else handleReaderClose();
  };

  // Fork (Batcave "Infinite"): reaching the end of the issue opens the next one
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
      const el = endRef.current;
      if (!el || !settings.infinite || settings.readingMode !== 'webtoon' || !nextIssue || loading) return;
      const obs = new IntersectionObserver(([e]) => {
          if (!e.isIntersecting) return;
          obs.disconnect();
          if (settings.autoMarkRead) finishIssue(true); else router.replace(nextIssueHref(nextIssue));
      });
      const t = setTimeout(() => obs.observe(el), 1500);  // not while the pages are still loading in at the top
      return () => { clearTimeout(t); obs.disconnect(); };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- finishIssue/nextIssueHref read current state
  }, [settings.infinite, settings.readingMode, settings.autoMarkRead, nextIssue, loading]);

  // NATIVE TOUCH GESTURE LOGIC
  const handleTouchStart = (e: React.TouchEvent) => {
      if (e.touches.length > 1) return; // multi-touch is a pinch (handled natively), not a swipe
      touchStartX.current = e.changedTouches[0].screenX;
      touchStartY.current = e.changedTouches[0].screenY;
      touchEndX.current = e.changedTouches[0].screenX;
      touchEndY.current = e.changedTouches[0].screenY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
      touchEndX.current = e.changedTouches[0].screenX;
      touchEndY.current = e.changedTouches[0].screenY;
  };

  const handleTouchEnd = () => {
      if (multiTouchRef.current) return; // a pinch just ended — don't treat it as a swipe
      if (zoomLevel !== 100 || settings.readingMode === 'webtoon') return;

      const deltaX = touchEndX.current - touchStartX.current;
      const deltaY = touchEndY.current - touchStartY.current;

      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          if (deltaX > 0) {
              if (settings.readingMode === 'rtl') nextPage(); else prevPage();
          } else {
              if (settings.readingMode === 'rtl') prevPage(); else nextPage();
          }
      }
  };

  // Keep a ref copy of the zoom level so the native pinch listener reads the latest value without re-binding.
  useEffect(() => { zoomRef.current = zoomLevel; }, [zoomLevel]);

  // Two-finger pinch-to-zoom on touch devices. Uses native non-passive listeners so preventDefault can
  // stop the container scrolling/native-gesturing mid-pinch (the app disables browser pinch globally via
  // the viewport meta, so the reader supplies its own). Single-finger pan/scroll + swipe are untouched.
  useEffect(() => {
      const el = scrollRef.current;
      if (!el || loading || settings.readingMode === 'webtoon') return;

      const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

      const onStart = (e: TouchEvent) => {
          if (e.touches.length === 2) {
              multiTouchRef.current = true;
              pinchRef.current = { active: true, startDist: distance(e.touches) || 1, startZoom: zoomRef.current };
          }
      };
      const onMove = (e: TouchEvent) => {
          if (pinchRef.current.active && e.touches.length === 2) {
              e.preventDefault();
              const ratio = distance(e.touches) / pinchRef.current.startDist;
              setZoomLevel(Math.min(300, Math.max(50, Math.round(pinchRef.current.startZoom * ratio))));
          }
      };
      const onEnd = (e: TouchEvent) => {
          if (e.touches.length < 2) pinchRef.current.active = false;
          // Reset the multi-touch flag only after the event settles, so the React touchend handler
          // (swipe detection) still sees it was a pinch and skips the page turn.
          if (e.touches.length === 0) setTimeout(() => { multiTouchRef.current = false; }, 0);
      };

      el.addEventListener('touchstart', onStart, { passive: false });
      el.addEventListener('touchmove', onMove, { passive: false });
      el.addEventListener('touchend', onEnd);
      el.addEventListener('touchcancel', onEnd);
      return () => {
          el.removeEventListener('touchstart', onStart);
          el.removeEventListener('touchmove', onMove);
          el.removeEventListener('touchend', onEnd);
          el.removeEventListener('touchcancel', onEnd);
      };
  }, [loading, settings.readingMode]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (guided && settings.readingMode !== 'webtoon' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) return;  // panel by panel: GuidedView
      if (e.key === 'ArrowRight') { if (settings.readingMode === 'rtl') prevPage(); else nextPage(); }
      if (e.key === 'ArrowLeft') { if (settings.readingMode === 'rtl') nextPage(); else prevPage(); }
      // Escape with the tag dialog open belongs to the dialog (Radix closes it) — without this
      // guard the same keypress would also save-and-exit the whole reader.
      if (e.key === 'Escape') { if (tagDialogOpen) return; if (settingsOpen) { setSettingsOpen(false); return; } if (tocOpen) { setTocOpen(false); return; } if (isFullscreen) document.exitFullscreen(); else handleReaderClose(); }
      if (e.key === '=' || e.key === '+') setZoomLevel(z => Math.min(z + 10, 300));
      if (e.key === '-') setZoomLevel(z => Math.max(z - 10, 50));
      if (e.key === 'z' || e.key === 'Z') zHeld.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => { if (e.key === 'z' || e.key === 'Z') { zHeld.current = false; setLens(null); } };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [nextPage, prevPage, router, settings.readingMode, isFullscreen, handleReaderClose, tagDialogOpen, guided, settingsOpen, tocOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
      if (zoomLevel === 100) return;
      setIsDragging(true);
      if (scrollRef.current) {
          setDragStart({ x: e.pageX, y: e.pageY, scrollLeft: scrollRef.current.scrollLeft, scrollTop: scrollRef.current.scrollTop });
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (!isDragging || !scrollRef.current) return;
      e.preventDefault(); 
      const dx = e.pageX - dragStart.x;
      const dy = e.pageY - dragStart.y;
      scrollRef.current.scrollLeft = dragStart.scrollLeft - dx;
      scrollRef.current.scrollTop = dragStart.scrollTop - dy;
  };

  const handleMouseUp = () => setIsDragging(false);

  // Fork (Batcave): a click on the page turns it — left half back, right half forward (mirrored for RTL);
  // "Forward only" turns forward wherever you click. Zoomed pages pan instead.
  const handleClickCanvas = (e: React.MouseEvent) => {
      if (zoomLevel !== 100) return;
      const leftHalf = e.clientX < window.innerWidth / 2;
      if (settings.clickNav === 'both' && leftHalf !== (settings.readingMode === 'rtl')) prevPage(); else nextPage();
  };

  // Top bar "Show on scroll up": hides while scrolling down, comes back on the first scroll up
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      const y = e.currentTarget.scrollTop;
      if (Math.abs(y - lastScrollY.current) < 8) return;
      setScrolledDown(y > lastScrollY.current && y > BAR_H);
      lastScrollY.current = y;
  };

  // Magnifier: hold Z over a page
  const handleLens = (e: React.MouseEvent) => {
      if (!settings.magnifier || !zHeld.current) return;
      const img = (e.target as HTMLElement).closest('img');
      if (!img) { setLens(null); return; }
      const r = img.getBoundingClientRect();
      setLens({ x: e.clientX, y: e.clientY, src: img.currentSrc || img.src, w: r.width * LENS_ZOOM, h: r.height * LENS_ZOOM,
          bx: LENS_SIZE / 2 - (e.clientX - r.left) * LENS_ZOOM, by: LENS_SIZE / 2 - (e.clientY - r.top) * LENS_ZOOM });
  };

  if (error) return <div className="p-10 text-center text-red-500 font-bold">Error: {error}</div>;
  if (loading) return <div className="flex h-screen w-screen items-center justify-center bg-black"><Loader2 className="w-10 h-10 animate-spin text-white" /></div>;

  const isWeb = settings.readingMode === 'webtoon';
  const mode = isWeb ? (settings.infinite ? 'infinite' : 'web') : settings.pageLayout === 'single' ? 'paginated' : 'spread';
  const setMode = (m: string) => setSettings(s => ({ ...s,
      readingMode: m === 'web' || m === 'infinite' ? 'webtoon' : s.readingMode === 'webtoon' ? 'ltr' : s.readingMode,
      pageLayout: m === 'spread' ? 'double-no-cover' : 'single',
      infinite: m === 'infinite' }));
  const set = <K extends keyof typeof settings>(k: K, v: (typeof settings)[K]) => setSettings(s => ({ ...s, [k]: v }));
  const barVisible = settingsOpen || tocOpen || hoverTop || (settings.topBar === 'scroll' ? !scrolledDown : showUI);
  const pad = settings.topBar === 'scroll' ? BAR_H : 0;
  const hideCursor = isIdle && !barVisible;
  const isZoomed = zoomLevel !== 100;
  const isDouble = !isWeb && (settings.pageLayout === 'double' || (settings.pageLayout === 'double-no-cover' && currentIndex !== 0));
  const filter = settings.brightness !== 100 ? `brightness(${settings.brightness}%)` : undefined;

  // Image width (Batcave): Auto = the page up to the screen width, Manual = exactly N px, At Least = N px or
  // wider up to the screen, Fit Height = the whole page on screen. Zoom (pinch, +/-) scales on top.
  const widthStyle = (share: number): React.CSSProperties => {
      if (settings.imageWidth === 'manual') return { width: settings.widthPx * zoomLevel / 100 / share, maxWidth: 'none' };
      if (isZoomed) return { width: `${zoomLevel / share}vw`, maxWidth: 'none' };
      if (settings.imageWidth === 'at-least') return { minWidth: `min(${settings.widthPx / share}px, ${100 / share}%)`, maxWidth: `${100 / share}%` };
      if (settings.imageWidth === 'fit-height') return { height: `calc(100dvh - ${pad}px)`, width: 'auto', maxWidth: `${100 / share}%`, objectFit: 'contain' };
      return { maxWidth: `${100 / share}%` };
  };
  const pageStyle = { ...widthStyle(isDouble ? 2 : 1), filter };
  const wide = isZoomed || settings.imageWidth === 'manual';  // may be wider than the screen: scroll sideways
  const jumpTo = (i: number) => {
      setTocOpen(false);
      if (isWeb) webtoonRef.current?.querySelector(`[data-page="${i}"]`)?.scrollIntoView();
      else setCurrentIndex(i);
  };

  return (
    <div className={`relative h-screen w-screen bg-black overflow-hidden flex flex-col items-center justify-center select-none ${hideCursor ? 'cursor-none' : ''}`}>

      {/* Mouse at the top edge (or a tap there) brings the bar back */}
      <div className="absolute top-0 left-0 w-full h-5 z-40" onMouseEnter={() => setHoverTop(true)} onMouseLeave={() => setHoverTop(false)} onClick={() => setShowUI(v => !v)} />

      {/* TOP BAR (Batcave): back + series · table of contents · tools */}
      <header
        className={`fixed top-0 inset-x-0 z-50 h-[54px] flex items-center gap-3 px-4 text-[13px] font-bold text-[#f2f2f7] bg-[rgba(30,30,30,0.72)] backdrop-blur-[12px] backdrop-saturate-[1.6] transition-transform duration-300 ${barVisible ? 'translate-y-0' : '-translate-y-full'}`}
        onMouseEnter={() => setHoverTop(true)}
        onMouseLeave={() => setHoverTop(false)}
      >
        <button type="button" aria-label="Close" onClick={handleReaderClose} disabled={isSavingTags} className="flex flex-1 items-center gap-2 min-w-0 text-left hover:opacity-80">
            {isSavingTags ? <Loader2 className="w-5 h-5 shrink-0 animate-spin text-[#ffa332]" /> : <ChevronLeft className="w-5 h-5 shrink-0 text-[#ffa332]" strokeWidth={3} />}
            <span className="truncate text-[15px] hidden sm:inline">{seriesName}</span>
        </button>

        <div className="flex items-center h-[38px] max-w-[46vw] sm:max-w-[34vw] rounded-[10px] bg-[rgba(118,118,128,0.24)] px-1">
            <button type="button" aria-label="Previous issue" title={prevIssue?.name} disabled={!prevIssue} onClick={() => prevIssue && router.replace(nextIssueHref(prevIssue))} className="p-1.5 text-[#ffa332] disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" strokeWidth={3} />
            </button>
            <button type="button" onClick={() => setTocOpen(o => !o)} className="flex flex-col items-center min-w-0 px-2 leading-tight">
                <span className="text-[9px] font-semibold uppercase tracking-[0.77px] text-[rgba(235,235,245,0.4)]">Table of contents</span>
                <span className="truncate max-w-full">{issueName}</span>
            </button>
            <button type="button" aria-label="Next issue" title={nextIssue?.name} disabled={!nextIssue} onClick={() => nextIssue && router.replace(nextIssueHref(nextIssue))} className="p-1.5 text-[#ffa332] disabled:opacity-30">
                <ChevronRight className="w-4 h-4" strokeWidth={3} />
            </button>
        </div>

        <nav className="flex flex-1 items-center justify-end gap-3 xl:gap-5 min-w-0">
            <ToolBtn icon={<Check strokeWidth={3} />} label="Read" active={isMarkedRead} onClick={toggleReadStatus} />
            <ToolBtn icon={<Bookmark className={bookmarks.includes(currentIndex) ? 'fill-current' : ''} />} label="Bookmark" active={bookmarks.includes(currentIndex)} onClick={toggleBookmark} />
            {isAdmin && issueId && (
                <ToolBtn icon={<Flag className={flaggedPages.has(pages[currentIndex]) ? 'fill-current' : ''} />} label="Report" active={flaggedPages.has(pages[currentIndex])} onClick={toggleFlagCurrentPage}
                    title="Flag page for removal (reviewed before anything is deleted)" />
            )}
            {isAdmin && issueId && flaggedPages.size > 0 && (
                <button type="button" className="shrink-0 font-semibold text-[#ff7b7b] hover:opacity-80" onClick={() => setPageManagerOpen(true)} title="Review flagged pages in the Page Manager">
                    Review {flaggedPages.size} flagged
                </button>
            )}
            {isAdmin && issueId && (
                <ToolBtn icon={<Tag />} label={pendingTagCount > 0 ? `Tags (${pendingTagCount})` : 'Tags'} active={pendingTagCount > 0} onClick={() => setTagDialogOpen(true)} disabled={isSavingTags}
                    title="Add a character, team, location or credit spotted while reading (saved when you leave the reader)" />
            )}
            <ToolBtn icon={isCaching ? <Loader2 className="animate-spin" /> : <CloudDownload />} label={isCaching ? `${cacheProgress}%` : 'Offline'} onClick={handleMakeOffline} disabled={isCaching}
                title="Download issue for offline reading" className="hidden sm:flex" />
            {!isWeb && <ToolBtn icon={<ScanSearch />} label="Panels" active={guided} onClick={toggleGuided} title={guided ? "Panel-Ansicht aus" : "Panel-Ansicht: Panel für Panel lesen"} />}
            <ToolBtn icon={isFullscreen ? <Minimize /> : <Maximize />} onClick={toggleFullscreen} title="Fullscreen" className="hidden sm:flex" />
            <ToolBtn icon={<SettingsIcon />} label="Settings" onClick={() => setSettingsOpen(true)} />
        </nav>
      </header>

      {/* TABLE OF CONTENTS: the issue's pages (outside the header — its backdrop blur would trap position:fixed) */}
      {tocOpen && (
          <>
              <div className="fixed inset-0 z-[55]" onClick={() => setTocOpen(false)} />
              <div className="fixed top-[58px] left-1/2 -translate-x-1/2 z-[56] w-64 max-h-[60vh] overflow-y-auto rounded-xl p-1 bg-[rgba(28,28,30,0.95)] backdrop-blur-[16px] shadow-2xl">
                  {pages.map((_, i) => (
                      <button key={i} type="button" onClick={() => jumpTo(i)}
                          className={`w-full flex justify-between px-3 py-2 rounded-lg text-[13px] text-left ${i === currentIndex ? 'bg-[#ffa332] text-black font-semibold' : 'text-[rgba(235,235,245,0.87)] font-medium hover:bg-white/10'}`}>
                          <span>Page {i + 1} / {pages.length}</span>
                          {bookmarks.includes(i) && <Bookmark className="w-3.5 h-3.5 fill-current" />}
                      </button>
                  ))}
              </div>
          </>
      )}

      {/* CANVAS */}
      {isWeb ? (
          <div ref={webtoonRef} onScroll={handleScroll} onMouseMove={handleLens} onMouseLeave={() => setLens(null)}
              className={`absolute inset-0 z-10 overflow-auto flex flex-col ${wide ? 'items-start' : 'items-center'}`} style={{ paddingTop: pad }}>
              {pages.map((p, i) => (
                  <img
                      key={p}
                      data-page={i}
                      src={getPageUrl(p)}
                      style={settings.imageWidth === 'auto' && !isZoomed ? { filter } : { ...widthStyle(1), filter }}
                      className={`${settings.imageWidth === 'auto' && !isZoomed ? 'w-full max-w-4xl' : ''} h-auto block m-0 p-0 [aspect-ratio:auto_2/3] ${wide ? 'mx-auto' : ''}`}
                      loading="lazy"
                      alt={`Page ${i + 1}`}
                  />
              ))}
              {pages.length > 0 && (
                  <div ref={endRef} className="w-full max-w-4xl mx-auto px-6 py-16 flex flex-col items-center gap-4 text-white">
                      <p className="text-sm uppercase tracking-widest text-white/60 font-bold">End of {issueName || 'issue'}</p>
                      {nextIssue && (
                          <button type="button" className="w-full max-w-md h-14 rounded-[10px] text-base font-semibold bg-[#ffa332] text-black shadow-[0_2px_8px_rgba(255,163,50,0.35)]" onClick={() => finishIssue(true)}>
                              {settings.infinite ? 'Loading next: ' : 'Finished · Next: '}{nextIssue.name}
                          </button>
                      )}
                      <button type="button" className="w-full max-w-md h-14 rounded-[10px] text-base font-semibold bg-[rgba(118,118,128,0.24)] text-[#f2f2f7]" onClick={() => finishIssue(false)}>
                          {isMarkedRead ? 'Back to series' : 'Mark as read & back to series'}
                      </button>
                      {isMarkedRead && (
                          <button type="button" className="h-12 text-white/70 hover:text-white" onClick={toggleReadStatus}>Mark as unread</button>
                      )}
                  </div>
              )}
          </div>
      ) : guided ? (
          <GuidedView
              key={`${pages[currentIndex]}|${guidedSettings.mode}|${guidedSettings.fullPage}`}  // fresh state per page (and when the steps' settings change)
              settings={guidedSettings}
              src={getPageUrl(pages[currentIndex])}
              nextSrc={currentIndex + 1 < pages.length ? getPageUrl(pages[currentIndex + 1]) : undefined}
              rtl={settings.readingMode === 'rtl'}
              enterAtEnd={guidedFromEnd}
              imgStyle={filter ? { filter } : undefined}
              onToggleUI={() => setShowUI(v => !v)}
              // one page per step, also in double-page layout; past the last page nextPage() opens the next issue
              onNextPage={() => { setGuidedFromEnd(false); if (currentIndex < pages.length - 1) setCurrentIndex(currentIndex + 1); else nextPage(); }}
              onPrevPage={() => { if (currentIndex > 0) { setGuidedFromEnd(true); setCurrentIndex(currentIndex - 1); } }}
          />
      ) : (
          <div
              ref={scrollRef}
              onScroll={handleScroll}
              className={`absolute inset-0 z-10 overflow-auto ${isZoomed ? 'cursor-grab active:cursor-grabbing' : ''}`}
              style={{ paddingTop: pad }}
              onMouseDown={isZoomed ? handleMouseDown : undefined}
              onMouseMove={e => { if (isZoomed) handleMouseMove(e); handleLens(e); }}
              onMouseUp={isZoomed ? handleMouseUp : undefined}
              onMouseLeave={() => { handleMouseUp(); setLens(null); }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
          >
              <div
                  className={`flex min-h-full ${settings.readingMode === 'rtl' ? 'flex-row-reverse' : 'flex-row'} justify-center ${settings.imageWidth === 'fit-height' ? 'items-center' : 'items-start'} ${wide ? 'w-max min-w-full' : 'w-full'}`}
                  onClick={handleClickCanvas}
              >
                  <img
                      key={`p1-${currentIndex}`}
                      src={getPageUrl(pages[currentIndex])}
                      style={pageStyle}
                      className="block h-auto"
                      alt={`Page ${currentIndex + 1}`}
                      draggable={false}
                      onLoad={() => setPageLoadError(false)}
                      onError={() => setPageLoadError(true)}
                  />
                  {isDouble && currentIndex + 1 < pages.length && (
                      <img
                          key={`p2-${currentIndex + 1}`}
                          src={getPageUrl(pages[currentIndex + 1])}
                          style={pageStyle}
                          className="block h-auto"
                          alt={`Page ${currentIndex + 2}`}
                          draggable={false}
                      />
                  )}
              </div>

              {/* PAGE LOAD ERROR OVERLAY */}
              {pageLoadError && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/70 text-white p-6 text-center">
                      <p className="font-bold text-sm max-w-sm">This page couldn&apos;t be loaded — it may be missing or corrupt in the archive.</p>
                      {currentIndex < pages.length - 1 && (
                          <button type="button" className="h-10 px-4 rounded-[10px] bg-[#ffa332] text-black font-semibold" onClick={() => nextPage()}>Skip Page</button>
                      )}
                  </div>
              )}
          </div>
      )}

      {/* MAGNIFIER (hold Z) */}
      {lens && (
          <div className="fixed z-[45] pointer-events-none rounded-full border-2 border-white/80 shadow-2xl bg-no-repeat"
              style={{ left: lens.x - LENS_SIZE / 2, top: lens.y - LENS_SIZE / 2, width: LENS_SIZE, height: LENS_SIZE, filter,
                  backgroundImage: `url("${lens.src}")`, backgroundSize: `${lens.w}px ${lens.h}px`, backgroundPosition: `${lens.bx}px ${lens.by}px` }} />
      )}

      {/* PAGE INDICATOR: with the bar, and briefly after each page turn */}
      {!isWeb && (
          <div className={`fixed bottom-4 right-4 z-40 px-3 py-1.5 rounded-lg bg-[rgba(28,28,30,0.85)] backdrop-blur-[16px] text-[13px] font-bold text-[#f2f2f7] pointer-events-none transition-opacity duration-300 ${barVisible || showPageToast ? 'opacity-100' : 'opacity-0'}`}>
              Page {currentIndex + 1} / {pages.length}
          </div>
      )}

      {/* SETTINGS (Batcave): a sheet from the right over the blurred page */}
      {settingsOpen && (
          <>
              <div className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-md" onClick={() => setSettingsOpen(false)} />
              <aside className="fixed inset-y-0 right-0 z-[61] w-[400px] max-w-full overflow-y-auto text-[13px] font-bold text-[#f2f2f7] bg-[rgba(28,28,30,0.85)] backdrop-blur-[16px] backdrop-saturate-[1.8]" aria-label="Settings">
                  <div className="sticky top-0 z-10 h-[54px] flex items-center justify-center px-[10px] text-[16px] text-[rgba(235,235,245,0.87)] bg-[rgba(28,28,30,0.85)]">
                      Settings
                      <button type="button" onClick={() => setSettingsOpen(false)} className="absolute right-[10px] h-8 px-2.5 rounded-[10px] text-[17px] font-normal text-[#ffa332] hover:bg-white/5">Done</button>
                  </div>
                  <div className="px-4 pt-2 pb-8 space-y-[22px]">
                      <Seg label="Reading Mode" value={mode} onChange={setMode} options={[['paginated', 'Paginated'], ['spread', 'Spread'], ['web', 'Web'], ['infinite', 'Infinite']]} />
                      {!isWeb && <Seg label="Reading Direction" value={settings.readingMode} onChange={v => set('readingMode', v)} options={[['ltr', 'Left to Right'], ['rtl', 'Right to Left']]} />}
                      <Seg label="Top Bar" value={settings.topBar} onChange={v => set('topBar', v)} options={[['scroll', 'Show on scroll up'], ['hidden', 'Always hidden']]} />
                      <Seg label="Magnifier (Z key)" value={settings.magnifier ? 'on' : 'off'} onChange={v => set('magnifier', v === 'on')} options={[['on', 'On'], ['off', 'Off']]} />
                      <Seg label="Click Navigation on Image" value={settings.clickNav} onChange={v => set('clickNav', v)} options={[['both', 'Forward and Back'], ['forward', 'Forward Only']]} />
                      <Seg label="Automatically Mark Chapter Read" value={settings.autoMarkRead ? 'yes' : 'no'} onChange={v => set('autoMarkRead', v === 'yes')} options={[['yes', 'Yes'], ['no', 'No']]} />
                      <Seg label="Automatic Bookmark" value={settings.autoBookmark ? 'yes' : 'no'} onChange={v => set('autoBookmark', v === 'yes')} options={[['yes', 'Yes'], ['no', 'No']]} />
                      <div className="space-y-2">
                          <Seg label="Image Width" value={settings.imageWidth} onChange={v => set('imageWidth', v)} options={[['auto', 'Auto'], ['manual', 'Manual'], ['at-least', 'At Least'], ['fit-height', 'Fit Height']]} />
                          {(settings.imageWidth === 'manual' || settings.imageWidth === 'at-least') && (
                              <div className="flex items-center h-[38px] p-[2px] rounded-[10px] bg-[rgba(118,118,128,0.24)]">
                                  <button type="button" aria-label="Narrower" onClick={() => set('widthPx', Math.max(300, settings.widthPx - 50))} className="w-12 h-[34px] rounded-[8px] bg-[#ffa332] text-black font-semibold shadow-[0_2px_8px_rgba(255,163,50,0.35)]">-</button>
                                  <span className="flex-1 text-center">{settings.widthPx}px</span>
                                  <button type="button" aria-label="Wider" onClick={() => set('widthPx', Math.min(4000, settings.widthPx + 50))} className="w-12 h-[34px] rounded-[8px] bg-[#ffa332] text-black font-semibold shadow-[0_2px_8px_rgba(255,163,50,0.35)]">+</button>
                              </div>
                          )}
                      </div>
                      <div className="space-y-2">
                          <SegLabel>Brightness</SegLabel>
                          <div className="rounded-[10px] bg-[rgba(118,118,128,0.24)] px-3 pt-3 pb-2">
                              <input type="range" min={30} max={100} step={5} value={Math.min(settings.brightness, 100)} aria-label="Brightness"
                                  onChange={e => set('brightness', parseInt(e.target.value))} className="w-full accent-[#ffa332] cursor-pointer" />
                              <div className="text-center mt-1 font-semibold text-[rgba(235,235,245,0.6)]">{Math.min(settings.brightness, 100)}%</div>
                          </div>
                      </div>
                      <Seg label="Auto-Crop Margins" value={settings.cropMargins ? 'on' : 'off'} onChange={v => set('cropMargins', v === 'on')} options={[['on', 'On'], ['off', 'Off']]} />
                      {!isWeb && (
                          <div className="dark text-foreground font-normal">
                              <GuidedSettingsSection value={guidedSettings} onChange={setGuidedSettings} />
                          </div>
                      )}
                  </div>
              </aside>
          </>
      )}

      {/* ADD TAG MODAL (#199 round 2, admin-only): note characters/teams/locations/credits while
          reading. Nothing saves here — additions accumulate for this session and are written on
          Close via savePendingTagsIfAny (additive merge into the issue's current values + the
          ComicInfo.xml embed, if enabled). */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
          <DialogContent className="sm:max-w-[425px] w-[95%] bg-background border-border rounded-xl">
              <DialogHeader><DialogTitle className="text-xl font-black tracking-tight text-foreground">Add to This Issue</DialogTitle></DialogHeader>

              <div className="grid gap-4 py-2">
                  <p className="text-xs text-muted-foreground">
                      Saved to the library when you close the reader — and embedded into the comic&apos;s ComicInfo.xml, if enabled. Like any manual edit, saving locks these fields so provider syncs won&apos;t overwrite them.
                  </p>

                  <div className="flex gap-2">
                      <Select value={tagCategory} onValueChange={(v) => setTagCategory(v as TagCategory)}>
                          <SelectTrigger className="w-[150px] h-10 text-xs bg-background border-border shrink-0"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                              {(Object.keys(TAG_CATEGORY_LABELS) as TagCategory[]).map(cat => (
                                  <SelectItem key={cat} value={cat} className="focus:bg-primary/10 focus:text-primary">{TAG_CATEGORY_LABELS[cat]}</SelectItem>
                              ))}
                          </SelectContent>
                      </Select>
                      <Input
                          autoFocus
                          value={tagInput}
                          onChange={e => setTagInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPendingTag(); } }}
                          placeholder={`Add a ${TAG_CATEGORY_LABELS[tagCategory].toLowerCase()}…`}
                          className="flex-1 h-10 bg-background border-border"
                      />
                      <Button size="sm" className="h-10 shrink-0 bg-primary text-primary-foreground font-bold hover:bg-primary/90" onClick={addPendingTag} disabled={!tagInput.trim()} title="Add to this session's pending tags">
                          <Plus className="w-4 h-4" />
                      </Button>
                  </div>

                  {pendingTagCount > 0 ? (
                      <div className="grid gap-3 max-h-[40vh] overflow-y-auto pr-1">
                          {(Object.keys(TAG_CATEGORY_LABELS) as TagCategory[]).filter(cat => pendingTags[cat].length > 0).map(cat => (
                              <div key={cat} className="grid gap-1.5">
                                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{TAG_CATEGORY_LABELS[cat]}</Label>
                                  <div className="flex flex-wrap gap-1.5">
                                      {pendingTags[cat].map(val => (
                                          <span key={val} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                                              {val}
                                              <button type="button" aria-label={`Remove ${val}`} onClick={() => removePendingTag(cat, val)} className="hover:bg-primary/20 rounded-full p-0.5">
                                                  <X className="w-3 h-3" />
                                              </button>
                                          </span>
                                      ))}
                                  </div>
                              </div>
                          ))}
                      </div>
                  ) : (
                      <p className="text-xs text-muted-foreground italic">Nothing added yet this session.</p>
                  )}
              </div>
          </DialogContent>
      </Dialog>

      {/* PAGE MANAGER (issue #189 Phase 2): reviews the pages flagged while reading. Flags only
          pre-fill the grid — deletion happens solely through the manager's explicit confirm. */}
      {isAdmin && issueId && filePath && (
          <PageManagerModal
              open={pageManagerOpen}
              onOpenChange={handleManagerOpenChange}
              queue={[{ issueId, filePath, label: `${seriesName || 'Issue'}${issueName ? ' ' + issueName : ''}` }]}
              initialMarked={[...flaggedPages]}
              onApplied={() => { managerAppliedRef.current = true; setFlaggedPages(new Set()); }}
          />
      )}
    </div>
  )
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black flex items-center justify-center text-white">Loading Reader...</div>}>
      <ReaderContent />
    </Suspense>
  )
}