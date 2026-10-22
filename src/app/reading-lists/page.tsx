// src/app/reading-lists/page.tsx
"use client"

import { useState, useEffect, Suspense } from "react"
import { useSession } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { copyText } from "@/lib/utils/clipboard"
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog"
import {
    BookOpen, Trash2, Plus, GripVertical, Loader2, Image as ImageIcon,
    ArrowLeft, ListOrdered, Calendar, Minus, FolderOpen, CloudDownload,
    Check, DownloadCloud, Sparkles, Globe, ExternalLink, Share2, Info,
    ChevronDown, LayoutList, List, RefreshCw, Star
} from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Logger } from "@/lib/logger"
import { getErrorMessage } from "@/lib/utils/error"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ReadingListPicker } from "@/components/reading-list-picker"
import { nextInList } from "@/lib/reading-list-next"
import { SeriesLink } from "@/components/series-link"

// Fork: series an entry belongs to, also when the issue is not in the library ("Catwoman (2011) #47" -> "Catwoman (2011)")
const seriesOfItem = (item: any): string => item.issue?.series
    ? `${item.issue.series.name}${item.issue.series.year ? ` (${item.issue.series.year})` : ''}`
    : (item.title || '').replace(/\s*#\s*[^#]*$/, '').trim() || 'Unknown series'
const ownedOf = (items: any[]) => items.filter((i: any) => i.issue?.filePath).length

/** Green "all owned", amber "x of y", red "missing" for a group of entries. */
function OwnedState({ items }: { items: any[] }) {
  const owned = ownedOf(items)
  const cls = owned === items.length ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800'
    : owned === 0 ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800'
  return <Badge variant="secondary" className={`text-[10px] ${cls}`}>{owned === items.length ? 'all owned' : owned === 0 ? `missing (${items.length})` : `${owned} of ${items.length} owned`}</Badge>
}

// Read / in progress marker for a list entry; nothing for unread
function ReadState({ progress }: { progress: { currentPage: number, totalPages: number, isCompleted: boolean } | null }) {
  if (progress?.isCompleted) {
      return <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mt-1"><Check className="w-3 h-3" /> Read</div>
  }
  if (progress && progress.currentPage > 0) {
      const pct = progress.totalPages > 0 ? Math.round(100 * (progress.currentPage + 1) / progress.totalPages) : 0
      return (
          <div className="flex items-center gap-2 mt-1">
              <div className="h-1 w-20 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
              <span className="text-[10px] font-bold text-muted-foreground">Page {progress.currentPage + 1}{progress.totalPages > 0 ? ` / ${progress.totalPages}` : ""}</span>
          </div>
      )
  }
  return null
}

function ReadingListsContent() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'ADMIN'
  const searchParams = useSearchParams()
  const paramId = searchParams.get('id')
  const { toast } = useToast()
  
  const [lists, setLists] = useState<any[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  // The open list with its items + the user's progress; the sidebar only has names and counts (#252)
  const [activeDetail, setActiveDetail] = useState<any | null>(null)
  const [detailNonce, setDetailNonce] = useState(0)
  const [hideRead, setHideRead] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [showAllSeries, setShowAllSeries] = useState(false)
  const [skipNoticeOpen, setSkipNoticeOpen] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  
  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newListName, setNewListName] = useState("")
  const [newListDesc, setNewListDesc] = useState("")
  const [isGlobal, setIsGlobal] = useState(false) 
  const [isCreating, setIsCreating] = useState(false)

  // Auto-Build Modal
  const [autoBuildModalOpen, setAutoBuildModalOpen] = useState(false)
  const [eventId, setEventId] = useState("")
  const [eventSource, setEventSource] = useState("COMICVINE")
  const [autoBuildGlobal, setAutoBuildGlobal] = useState(false)
  const [isAutoBuilding, setIsAutoBuilding] = useState(false)
  const [autoBuildAddMissing, setAutoBuildAddMissing] = useState(false)

  // Refresh affordances (fork review #1)
  const [isRefreshingList, setIsRefreshingList] = useState(false)
  const [refreshingItemIds, setRefreshingItemIds] = useState<Set<string>>(new Set())
  const [resyncingSeriesIds, setResyncingSeriesIds] = useState<Set<string>>(new Set())

  // CSV Import Modal
  const [csvModalOpen, setCsvModalOpen] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvListName, setCsvListName] = useState("")
  const [csvIsGlobal, setCsvIsGlobal] = useState(false)
  const [isImportingCsv, setIsImportingCsv] = useState(false)

  // AniList Import Modal
  const [aniListModalOpen, setAniListModalOpen] = useState(false);
  const [aniListUsername, setAniListUsername] = useState("");
  const [aniListIsGlobal, setAniListIsGlobal] = useState(false);
  const [aniListRequestMissing, setAniListRequestMissing] = useState(false);
  const [isImportingAniList, setIsImportingAniList] = useState(false);

  // MAL Import Modal
  const [malModalOpen, setMalModalOpen] = useState(false);
  const [malUsername, setMalUsername] = useState("");
  const [malIsGlobal, setMalIsGlobal] = useState(false);
  const [malRequestMissing, setMalRequestMissing] = useState(false);
  const [isImportingMal, setIsImportingMal] = useState(false);

  // CBL Import Modal
  const [cblModalOpen, setCblModalOpen] = useState(false)
  const [cblFile, setCblFile] = useState<File | null>(null)
  const [cblUrl, setCblUrl] = useState("")
  const [cblListName, setCblListName] = useState("")
  const [cblIsGlobal, setCblIsGlobal] = useState(false)
  const [isImportingCbl, setIsImportingCbl] = useState(false)

  // Auto-Extract Name from CBL URL
  useEffect(() => {
      if (!cblUrl || !cblUrl.startsWith('http')) return;
      const fetchCblName = async () => {
          try {
              const res = await fetch(cblUrl);
              if (res.ok) {
                  const text = await res.text();
                  const parser = new DOMParser();
                  const xmlDoc = parser.parseFromString(text, "text/xml");
                  const nameNode = xmlDoc.getElementsByTagName("Name")[0];
                  if (nameNode && nameNode.textContent) {
                      setCblListName(nameNode.textContent.trim());
                  }
              }
          } catch (e) {} 
      };
      const timer = setTimeout(fetchCblName, 600); 
      return () => clearTimeout(timer);
  }, [cblUrl]);

  // Auto-Extract Name from Local CBL File
  useEffect(() => {
      if (!cblFile) return;
      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const text = e.target?.result as string;
              if (text) {
                  const parser = new DOMParser();
                  const xmlDoc = parser.parseFromString(text, "text/xml");
                  const nameNode = xmlDoc.getElementsByTagName("Name")[0];
                  if (nameNode && nameNode.textContent) {
                      setCblListName(nameNode.textContent.trim());
                  }
              }
          } catch (err) {}
      };
      reader.readAsText(cblFile);
  }, [cblFile]);

  // Deletion Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Requests Tracking
  const [requestingIds, setRequestingIds] = useState<Set<string>>(new Set())
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set())
  const [isBulkDownloading, setIsBulkDownloading] = useState(false)

  const [isMounted, setIsMounted] = useState(false)

  // Fork: compact table in reading order (default) or the drag & drop list for reordering
  const [viewMode, setViewMode] = useState<'table' | 'flat'>('table')

  useEffect(() => {
    setIsMounted(true)
    fetchLists(paramId)

    const savedRequests = localStorage.getItem('omnibus_requested_issues');
    if (savedRequests) {
        try { setRequestedIds(new Set(JSON.parse(savedRequests))); } catch (e) {}
    }
  }, [paramId])

  useEffect(() => {
    if (!activeListId) { setActiveDetail(null); return; }
    let cancelled = false;
    fetch(`/api/reading-lists?id=${encodeURIComponent(activeListId)}&t=${Date.now()}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data) setActiveDetail(data) })
      .catch(() => toast({ title: "Error", description: "Failed to load the reading list.", variant: "destructive" }))
    return () => { cancelled = true };
  }, [activeListId, detailNonce])

  const handleToggleFavorite = async (id: string) => {
    const favorite = !favoriteIds.includes(id)
    const res = await fetch('/api/reading-lists/favorites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listId: id, favorite }) })
    if (res.ok) {
        setFavoriteIds((await res.json()).listIds || [])
        toast({ title: favorite ? "Added to favorites" : "Removed from favorites" })
    } else {
        toast({ title: "Error", description: "Failed to save the favorites.", variant: "destructive" })
    }
  }

  const fetchLists = async (selectId?: string | null) => {
    try {
      const [res, mainRes] = await Promise.all([
        fetch(`/api/reading-lists?t=${Date.now()}`),
        fetch(`/api/reading-lists/favorites?t=${Date.now()}`),
      ])
      const favorites: string[] = mainRes.ok ? (await mainRes.json()).listIds || [] : []
      setFavoriteIds(favorites)
      if (!selectId && !activeListId) selectId = favorites[0] || null
      if (res.ok) {
        const data = await res.json()
        setLists(data)
        setDetailNonce(n => n + 1) // reload the open list too (callers refetch after changing it)
        if (selectId && data.find((l:any) => l.id === selectId)) {
            setActiveListId(selectId)
        } else if (data.length > 0 && !activeListId) {
            setActiveListId(data[0].id)
        } else if (data.length === 0) {
            setActiveListId(null)
        }
      }
    } catch (e) {
      toast({ title: "Error", description: "Failed to load reading lists.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    setIsCreating(true);
    try {
        const res = await fetch('/api/reading-lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newListName, description: newListDesc, isGlobal })
        });
        if (res.ok) {
            toast({ title: "List Created" });
            setCreateModalOpen(false);
            setNewListName("");
            setNewListDesc("");
            setIsGlobal(false);
            fetchLists();
        }
    } catch (e) {
        toast({ title: "Error", variant: "destructive" });
    } finally {
        setIsCreating(false);
    }
  }

  const handleAutoBuild = async () => {
      if (!eventId.trim()) return;
      setIsAutoBuilding(true);
      try {
          const res = await fetch('/api/reading-lists/auto-build', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ eventId: parseInt(eventId), eventSource, isGlobal: autoBuildGlobal, addMissingSeries: autoBuildAddMissing })
          });
          const data = await res.json();
          if (res.ok) {
              toast({ title: "Event Auto-Built!", description: data.message });
              setAutoBuildModalOpen(false);
              setEventId("");
              setAutoBuildGlobal(false);
              fetchLists(data.listId);
              if (autoBuildAddMissing) {
                  if (Array.isArray(data.missingSeries) && data.missingSeries.length > 0) {
                      void addMissingArcSeries(data.missingSeries);
                  } else {
                      toast({ title: "No missing series", description: "Every series in this arc is already in your library." });
                  }
                  setAutoBuildAddMissing(false);
              }
          } else {
              throw new Error(data.error);
          }
      } catch (e: any) {
          toast({ title: "Auto-Build Failed", description: e.message, variant: "destructive" });
      } finally {
          setIsAutoBuilding(false);
      }
  }

  // Fork review #5: entirely-unowned arc series get added metadata-only through the NORMAL request
  // pipeline (permissions, manga gate, audit all apply). Sequential with an 800ms stagger — each add
  // triggers provider metadata resolution + folder creation server-side, and the fork's own testing
  // showed un-staggered bursts are what hurt (their #6). monitorOnly never downloads the back
  // catalog; monitored series DO auto-download future releases, same as any monitored series.
  const addMissingArcSeries = async (series: { id: string; name: string; source: string }[]) => {
      toast({ title: `Adding ${series.length} missing series…`, description: "Metadata and cover only — nothing downloads now." });
      let added = 0, failed = 0;
      for (let i = 0; i < series.length; i++) {
          const s = series[i];
          try {
              const res = await fetch('/api/request', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ cvId: parseInt(s.id, 10) || s.id, name: s.name, type: 'volume', metadataSource: s.source, monitorOnly: true })
              });
              if (res.ok) added++; else failed++;
          } catch { failed++; }
          if (i < series.length - 1) await new Promise(r => setTimeout(r, 800));
      }
      toast({
          title: "Missing series added",
          description: `${added} series added metadata-only${failed ? `, ${failed} failed` : ''}. Monitored series will auto-download future releases.`
      });
  }

  // Fork review #1: re-fetching re-runs the server's auto-link pass for unlinked items; admins
  // additionally queue a live metadata resync for every unique linked series in the list (each
  // resync is one live provider call, so they run sequentially with a small stagger).
  const handleRefreshList = async () => {
      if (!activeList || isRefreshingList) return;
      setIsRefreshingList(true);
      try {
          const uniqueSeries = new Map<string, any>();
          if (isAdmin) {
              for (const item of activeList.items) {
                  const s = item.issue?.series;
                  if (s?.metadataId && !String(s.metadataId).startsWith('unmatched')) uniqueSeries.set(s.id, s);
              }
          }
          await fetchLists(activeList.id);
          let resynced = 0;
          for (const s of Array.from(uniqueSeries.values())) {
              try {
                  const res = await fetch('/api/library/refresh-series', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ metadataId: s.metadataId, metadataSource: s.metadataSource || 'COMICVINE', folderPath: s.folderPath })
                  });
                  if (res.ok) resynced++;
              } catch { /* per-series failure shouldn't stop the sweep */ }
              await new Promise(r => setTimeout(r, 300));
          }
          toast({
              title: "List refreshed",
              description: resynced > 0
                  ? `Missing items re-checked; metadata resynced for ${resynced} series.`
                  : "Missing items re-checked against the library."
          });
          if (resynced > 0) fetchLists(activeList.id);
      } finally {
          setIsRefreshingList(false);
      }
  }

  // Per-row re-check for a missing item: the list GET re-runs auto-linking, so a refetch is the
  // re-check — the row-level state just scopes the spinner to the row that asked.
  const handleRefreshItem = async (itemId: string) => {
      setRefreshingItemIds(prev => new Set(prev).add(itemId));
      try {
          await fetchLists(activeListId);
      } finally {
          setRefreshingItemIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
      }
  }

  // Per-row admin resync for a linked series (one live provider call via refresh-series).
  const handleResyncSeries = async (series: any) => {
      if (!series?.metadataId || resyncingSeriesIds.has(series.id)) return;
      setResyncingSeriesIds(prev => new Set(prev).add(series.id));
      try {
          const res = await fetch('/api/library/refresh-series', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ metadataId: series.metadataId, metadataSource: series.metadataSource || 'COMICVINE', folderPath: series.folderPath })
          });
          if (res.ok) {
              toast({ title: "Metadata resynced", description: series.name });
              fetchLists(activeListId);
          } else {
              const data = await res.json().catch(() => ({}));
              toast({ title: "Resync failed", description: data.error || "Request failed", variant: "destructive" });
          }
      } catch (e: any) {
          toast({ title: "Resync failed", description: e.message, variant: "destructive" });
      } finally {
          setResyncingSeriesIds(prev => { const next = new Set(prev); next.delete(series.id); return next; });
      }
  }

  const handleQuickLoad = (id: string, source: string) => {
      setEventSource(source);
      setEventId(id);
  }

  const handleCsvImport = async () => {
      if (!csvFile || !csvListName.trim()) return;
      setIsImportingCsv(true);
      
      const formData = new FormData();
      formData.append('file', csvFile);
      formData.append('name', csvListName);
      formData.append('isGlobal', csvIsGlobal.toString());

      try {
          const res = await fetch('/api/reading-lists/import-csv', {
              method: 'POST',
              body: formData
          });
          const data = await res.json();
          
          if (res.ok) {
              toast({ title: "Import Complete!", description: data.message });
              setCsvModalOpen(false);
              setCsvFile(null);
              setCsvListName("");
              setCsvIsGlobal(false);
              fetchLists(data.listId);
          } else {
              throw new Error(data.error);
          }
      } catch (e: any) {
          toast({ title: "Import Failed", description: e.message, variant: "destructive" });
      } finally {
          setIsImportingCsv(false);
      }
  }

  const handleCblImport = async () => {
      if ((!cblFile && !cblUrl.trim()) || !cblListName.trim()) return;
      setIsImportingCbl(true);
      
      const formData = new FormData();
      if (cblFile) formData.append('file', cblFile);
      if (cblUrl.trim()) formData.append('url', cblUrl.trim());
      formData.append('name', cblListName);
      formData.append('isGlobal', cblIsGlobal.toString());

      try {
          const res = await fetch('/api/reading-lists/import-cbl', {
              method: 'POST',
              body: formData
          });
          const data = await res.json();
          
          if (res.ok) {
              toast({ title: "CBL Import Complete!", description: data.message });
              setCblModalOpen(false);
              setCblFile(null);
              setCblUrl("");
              setCblListName("");
              setCblIsGlobal(false);
              fetchLists(data.listId);
          } else {
              throw new Error(data.error);
          }
      } catch (e: any) {
          toast({ title: "Import Failed", description: e.message, variant: "destructive" });
      } finally {
          setIsImportingCbl(false);
      }
  }

  const handleAniListSync = async () => {
      if (!aniListUsername.trim()) return;
      setIsImportingAniList(true);
      try {
          const res = await fetch('/api/reading-lists/import-anilist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                  username: aniListUsername.trim(),
                  requestMissing: aniListRequestMissing,
                  isGlobal: aniListIsGlobal
              })
          });
          const data = await res.json();
          if (res.ok) {
              toast({ title: "Sync Complete!", description: data.message });
              setAniListModalOpen(false);
              fetchLists();
          } else {
              toast({ title: "Sync Failed", description: data.error, variant: "destructive" });
          }
      } catch (e) {
          toast({ title: "Error", description: "Network error during sync.", variant: "destructive" });
      } finally {
          setIsImportingAniList(false);
      }
  }

  const handleMalSync = async () => {
      if (!malUsername.trim()) return;
      setIsImportingMal(true);
      try {
          const res = await fetch('/api/reading-lists/import-mal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                  username: malUsername.trim(),
                  requestMissing: malRequestMissing,
                  isGlobal: malIsGlobal
              })
          });
          const data = await res.json();
          if (res.ok) {
              toast({ title: "Sync Complete!", description: data.message });
              setMalModalOpen(false);
              fetchLists();
          } else {
              toast({ title: "Sync Failed", description: data.error, variant: "destructive" });
          }
      } catch (e) {
          toast({ title: "Error", description: "Network error during sync.", variant: "destructive" });
      } finally {
          setIsImportingMal(false);
      }
  }

  const handleShareList = async (listId: string) => {
    try {
        const res = await fetch('/api/reading-lists/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ listId })
        });
        const data = await res.json();
        if (res.ok) {
            const url = `${window.location.origin}/reading-lists/shared/${data.shareId}`;
            if (await copyText(url)) toast({ title: "Link Copied!", description: "Share link copied to clipboard." });
            else toast({ title: "Copy failed", description: url, variant: "destructive" });
            fetchLists(listId);
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        toast({ title: "Failed to generate link", variant: "destructive" });
    }
  }

  const confirmDeleteList = async () => {
    if (!activeListId) return;
    setIsDeleting(true);
    try {
        const res = await fetch(`/api/reading-lists?id=${activeListId}`, { method: 'DELETE' });
        if (res.ok) {
            toast({ title: "List Deleted" });
            setActiveListId(null);
            setDeleteModalOpen(false);
            fetchLists();
        }
    } catch (e) {
        toast({ title: "Error", variant: "destructive" });
    } finally {
        setIsDeleting(false);
    }
  }

  const handleRemoveItem = async (itemId: string) => {
      if (!activeListId || !itemId) return;
      try {
          const res = await fetch('/api/reading-lists/items', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ listId: activeListId, itemId, action: 'remove' })
          });
          if (res.ok) fetchLists(activeListId);
          else toast({ title: "Couldn't remove item", variant: "destructive" });
      } catch (e) {
          toast({ title: "Error", variant: "destructive" });
      }
  }

  const handleRequestMissing = async (item: any, coverUrl: string | null = null) => {
      setRequestingIds(prev => new Set(prev).add(item.id));
      
      try {
          let volumeId = 0;
          let year = new Date().getFullYear().toString();
          
          // FIX: Natively pull the provider from the list item
          const provider = item.metadataSource || item.issue?.metadataSource || 'COMICVINE';
          
          if (item.issue?.series?.metadataId && provider === (item.issue.series.metadataSource || 'COMICVINE')) {
              // Fork: series already in Omnibus (issue WANTED) - no ComicVine lookup needed
              volumeId = Number(item.issue.series.metadataId) || 0;
              if (item.issue.series.year) year = String(item.issue.series.year);
          } else if (item.cvIssueId) {
              try {
                  // FIX: Pass provider to lookup-volume API
                  const lookupRes = await fetch(`/api/reading-lists/lookup-volume?issueId=${item.cvIssueId}&provider=${provider}`);
                  if (lookupRes.ok) {
                      const data = await lookupRes.json();
                      if (data.volumeId) volumeId = data.volumeId;
                      if (data.year) year = data.year;
                  }
              } catch (e) { Logger.log(`Lookup failed: ${getErrorMessage(e)}`, 'error'); }
          }

          let extractedIssueNumber = "1";
          const match = item.title.match(/(?:#|issue\s*#?|ch(?:apter)?\s*\.?)\s*0*(\d+(?:\.\d+)?)/i);
          if (match) {
              extractedIssueNumber = match[1];
          }

          const standardRes = await fetch('/api/request', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  type: 'issue',
                  cvId: volumeId,
                  name: item.title, 
                  year: year,
                  publisher: "Unknown",
                  image: coverUrl,
                  issueNumber: extractedIssueNumber,
                  metadataSource: provider // <-- FIX: Pass down provider
              })
          });

          if (!standardRes.ok) {
              const baseName = item.title.split('#')[0].trim();
              const cleanSearchTerm = baseName.replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "+");
              const searchLink = `https://getcomics.org/?s=${cleanSearchTerm}`;

              const fallbackRes = await fetch('/api/reading-lists/manual-fallback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      cvId: volumeId,
                      name: item.title,
                      image: coverUrl,
                      searchLink: searchLink,
                      metadataSource: provider // <-- FIX: Pass down provider
                  })
              });

              if (!fallbackRes.ok) throw new Error("Fallback failed");
          }

          setRequestedIds(prev => {
              const next = new Set(prev).add(item.id);
              localStorage.setItem('omnibus_requested_issues', JSON.stringify(Array.from(next)));
              return next;
          });
          return true;
          
      } catch (error: unknown) {
          return false;
      } finally {
          setRequestingIds(prev => {
              const next = new Set(prev);
              next.delete(item.id);
              return next;
          });
      }
  }

  const handleDownloadAllMissing = async (missingItems: any[]) => {
      if (missingItems.length === 0) return;
      setIsBulkDownloading(true);
      toast({ title: "Bulk Request Started", description: `Queuing ${missingItems.length} issues...` });
      
      let successCount = 0;
      for (const item of missingItems) {
          if (!requestedIds.has(item.id)) {
              const coverUrl = activeList?.coverUrl || null; 
              const success = await handleRequestMissing(item, coverUrl);
              if (success) successCount++;
              await new Promise(resolve => setTimeout(resolve, 300));
          }
      }
      toast({ title: "Bulk Request Complete", description: `Queued ${successCount} issues.` });
      setIsBulkDownloading(false);
  }

  const onDragEnd = async (result: any) => {
      if (!result.destination || !activeListId) return;
      
      if (activeDetail?.id !== activeListId) return;

      const items = Array.from(activeDetail.items);
      const [reorderedItem] = items.splice(result.source.index, 1);
      items.splice(result.destination.index, 0, reorderedItem);

      setActiveDetail({ ...activeDetail, items });

      const updatedOrder = items.map((item: any, index: number) => ({
          id: item.id,
          order: index
      }));

      try {
          await fetch('/api/reading-lists/items', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ listId: activeListId, items: updatedOrder })
          });
      } catch (e) {
          toast({ title: "Failed to save order", variant: "destructive" });
          fetchLists(activeListId); 
      }
  }

  if (!isMounted || loading) {
      return (
          <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
      );
  }

  const activeList = activeDetail?.id === activeListId ? activeDetail : null;
  // Linked to a library issue that has no file yet (e.g. WANTED) counts as missing, not readable
  const missingItems = activeList ? activeList.items.filter((i: any) => !i.issue?.filePath) : [];
  const readCount = activeList ? activeList.items.filter((i: any) => i.progress?.isCompleted).length : 0;
  const { item: nextUp, skipped: skippedMissing } = nextInList<any>(activeList?.items || []);
  // Fork: every series of the list with owned / total, missing entirely first, then partial, then complete
  const seriesSummary = (() => {
      const m = new Map<string, any[]>();
      for (const item of activeList?.items || []) m.set(seriesOfItem(item), [...(m.get(seriesOfItem(item)) || []), item]);
      const rank = (items: any[]) => ownedOf(items) === 0 ? 0 : ownedOf(items) < items.length ? 1 : 2;
      return [...m].map(([name, items]) => ({ name, items })).sort((a, b) => rank(a.items) - rank(b.items) || b.items.length - a.items.length);
  })();
  const readerHref = (issue: any) => `/reader?path=${encodeURIComponent(issue.filePath)}&series=${encodeURIComponent(issue.series.folderPath)}`;

  return (
    <div className="container mx-auto py-10 px-6 max-w-[1400px] space-y-8 transition-colors duration-300">
      
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild className="shrink-0 text-foreground hover:bg-muted"><Link href="/profile"><ArrowLeft className="w-5 h-5" /></Link></Button>
            <h1 className="text-3xl font-bold flex items-center gap-2 text-foreground">
                <ListOrdered className="w-7 h-7 text-primary" />
                Reading Lists
            </h1>
        </div>
      </div>

      <div className="space-y-6">
          {/* Fork: one bar with the list picker + import menu instead of a sidebar listing every list */}
          <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="h-11 font-bold border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary max-w-full" onClick={() => setPickerOpen(true)}>
                  <ListOrdered className="w-4 h-4 mr-2 shrink-0" />
                  <span className="truncate">{lists.find(l => l.id === activeListId)?.name || "Choose a reading list"}</span>
                  {activeListId && favoriteIds.includes(activeListId) && <Star className="w-3.5 h-3.5 ml-2 fill-amber-400 text-amber-400 shrink-0" />}
                  <ChevronDown className="w-4 h-4 ml-2 shrink-0" />
              </Button>
              <span className="text-xs text-muted-foreground font-bold">{lists.length} lists</span>
              <div className="flex-1" />
              <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                      <Button className="h-11 font-bold shadow-md bg-primary hover:bg-primary/90 text-primary-foreground border-0"><Plus className="w-4 h-4 mr-2" /> New / Import</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[240px] bg-popover border-border z-[100]">
                      <DropdownMenuItem className="cursor-pointer" onClick={() => setAutoBuildModalOpen(true)}><Sparkles className="w-4 h-4 mr-2" /> Auto-Build Story Arc</DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer" onClick={() => setCblModalOpen(true)}><DownloadCloud className="w-4 h-4 mr-2" /> Import from .CBL</DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer" onClick={() => setCsvModalOpen(true)}><DownloadCloud className="w-4 h-4 mr-2" /> Import from CSV</DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer" onClick={() => setAniListModalOpen(true)}><DownloadCloud className="w-4 h-4 mr-2" /> AniList</DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer" onClick={() => setMalModalOpen(true)}><DownloadCloud className="w-4 h-4 mr-2" /> MAL</DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer" onClick={() => setCreateModalOpen(true)}><Plus className="w-4 h-4 mr-2" /> Create Empty List</DropdownMenuItem>
                      <DropdownMenuItem asChild className="cursor-pointer"><a href="https://comicvine.gamespot.com/story-arcs/" target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 mr-2" /> ComicVine Story Arcs</a></DropdownMenuItem>
                      <DropdownMenuItem asChild className="cursor-pointer"><a href="https://metron.cloud/arc/" target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 mr-2" /> Metron Story Arcs</a></DropdownMenuItem>
                  </DropdownMenuContent>
              </DropdownMenu>
          </div>
          <ReadingListPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              lists={lists}
              activeId={activeListId}
              favoriteIds={favoriteIds}
              onSelect={setActiveListId}
              onToggleFavorite={handleToggleFavorite}
          />

          {activeList ? (
              <div className="space-y-6">
                  <Card className="shadow-sm border-primary/20 bg-primary/5">
                      <CardHeader className="flex flex-col gap-4">
                          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4 w-full">
                              <div className="flex flex-wrap items-center gap-3 min-w-0 flex-1">
                                {/* Fork: cover of the first issue as the list's hero image (Batcave-style) */}
                                {activeList.items.find((i: any) => i.issue?.coverUrl)?.issue?.coverUrl && (
                                    <img src={activeList.items.find((i: any) => i.issue?.coverUrl).issue.coverUrl} alt="" className="w-20 sm:w-28 aspect-[2/3] object-cover rounded-lg shadow-lg border border-border shrink-0" />
                                )}
                                <CardTitle className="text-2xl sm:text-3xl font-black text-primary leading-tight break-words">{activeList.name}</CardTitle>
                                {activeList.isGlobal && <Badge variant="outline" className="shrink-0 bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"><Globe className="w-3 h-3 mr-1"/> Global ({activeList.user?.username || 'Unknown'})</Badge>}
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-3 shrink-0 w-full xl:w-auto justify-start xl:justify-end">
                                  {nextUp && skippedMissing.length === 0 && (
                                      <Button size="sm" asChild className="h-10 sm:h-auto font-bold shadow-sm bg-primary hover:bg-primary/90 text-primary-foreground" title={`${nextUp.issue.series.name} #${nextUp.issue.number}`}>
                                          <Link href={readerHref(nextUp.issue)}>
                                              <BookOpen className="w-4 h-4 mr-2" /> {readCount > 0 || nextUp.progress ? "Continue" : "Start"} · {nextUp.issue.series.name} #{nextUp.issue.number}
                                          </Link>
                                      </Button>
                                  )}
                                  {/* The next entries in order are missing: say so before jumping over them */}
                                  {skippedMissing.length > 0 && (
                                      <Button size="sm" className="h-10 sm:h-auto font-bold shadow-sm bg-amber-500 hover:bg-amber-500/90 text-white" onClick={() => setSkipNoticeOpen(true)}>
                                          <Info className="w-4 h-4 mr-2" /> {nextUp ? `Continue · ${nextUp.issue.series.name} #${nextUp.issue.number}` : "Continue"} · {skippedMissing.length} missing
                                      </Button>
                                  )}
                                  {/* --- VIEW MODE TOGGLE --- */}
                                  <div className="flex items-center gap-1 bg-muted p-1 rounded-md border border-border shadow-inner">
                                      <Button variant={viewMode === 'table' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('table')} className={`h-8 px-3 text-xs ${viewMode === 'table' ? 'shadow-sm bg-background text-foreground' : 'text-muted-foreground'}`}>
                                          <LayoutList className="w-3.5 h-3.5 mr-1.5" /> Table
                                      </Button>
                                      <Button variant={viewMode === 'flat' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('flat')} className={`h-8 px-3 text-xs ${viewMode === 'flat' ? 'shadow-sm bg-background text-foreground' : 'text-muted-foreground'}`}>
                                          <List className="w-3.5 h-3.5 mr-1.5" /> Reorder
                                      </Button>
                                  </div>
                                  <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-10 sm:h-auto font-bold border-border"
                                      onClick={handleRefreshList}
                                      disabled={isRefreshingList}
                                      title={isAdmin ? "Re-check missing items against the library and resync metadata for every linked series" : "Re-check missing items against the library"}
                                  >
                                      {isRefreshingList ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />} Refresh
                                  </Button>
                                  <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-10 sm:h-auto font-bold border-border"
                                      onClick={async () => {
                                          if ((activeList as any).shareId) {
                                              const url = `${window.location.origin}/reading-lists/shared/${(activeList as any).shareId}`;
                                              if (await copyText(url)) toast({ title: "Link Copied!" });
                                              else toast({ title: "Copy failed", description: url, variant: "destructive" });
                                          } else {
                                              handleShareList(activeList.id);
                                          }
                                      }}
                                  >
                                      <Share2 className="w-4 h-4 mr-2" /> {(activeList as any).shareId ? "Copy Link" : "Share"}
                                  </Button>

                                  {missingItems.length > 0 && (
                                      <Button 
                                          size="sm" 
                                          variant="outline" 
                                          className="h-10 sm:h-auto font-bold border-primary/30 text-primary bg-primary/5 hover:bg-primary/10"
                                          disabled={isBulkDownloading}
                                          onClick={() => handleDownloadAllMissing(missingItems)}
                                      >
                                          {isBulkDownloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <DownloadCloud className="w-4 h-4 mr-2" />}
                                          Missing ({missingItems.length})
                                      </Button>
                                  )}
                                  {(isAdmin || activeList.userId === session?.user?.id) && (
                                      <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-9 sm:w-9 border border-transparent hover:border-red-200 dark:hover:border-red-900/50 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteModalOpen(true)}>
                                          <Trash2 className="w-4 h-4" />
                                      </Button>
                                  )}
                              </div>
                          </div>
                          
                          <div className="flex items-center gap-3 w-full">
                              <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden border border-border">
                                  <div className="h-full bg-primary transition-all" style={{ width: `${activeList.items.length ? (100 * readCount / activeList.items.length) : 0}%` }} />
                              </div>
                              <span className="text-xs font-bold text-primary shrink-0">
                                  {readCount} / {activeList.items.length} read · {activeList.items.length - missingItems.length} owned
                              </span>
                              {viewMode === 'table' && (
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0" onClick={() => setHideRead(h => !h)}>
                                      {hideRead ? "Show read" : "Hide read"}
                                  </Button>
                              )}
                          </div>

                          {activeList.description && (
                              <CardDescription className="text-primary/80 leading-relaxed text-sm sm:text-base break-words whitespace-normal w-full mt-2">
                                  {activeList.description}
                              </CardDescription>
                          )}
                      </CardHeader>
                  </Card>

                  {seriesSummary.length > 1 && (
                      <Card className="border-border bg-background/80">
                          <CardHeader className="pb-2">
                              <CardTitle className="text-base flex items-center justify-between gap-2">
                                  <span>Series in this list <span className="text-muted-foreground font-bold text-sm">({seriesSummary.length})</span></span>
                                  <span className="text-xs font-bold text-muted-foreground">
                                      {seriesSummary.filter(x => ownedOf(x.items) === x.items.length).length} complete · {seriesSummary.filter(x => ownedOf(x.items) > 0 && ownedOf(x.items) < x.items.length).length} partial · {seriesSummary.filter(x => ownedOf(x.items) === 0).length} missing
                                  </span>
                              </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-1">
                              {/* Fork: Batcave-style "at a glance" */}
                              <p className="text-xs text-muted-foreground pb-2">
                                  {lists.find(l => l.id === activeList.id)?.publisher && <><b className="text-foreground">{lists.find(l => l.id === activeList.id)?.publisher}</b> · </>}
                                  <b className="text-foreground">{activeList.items.length}</b> issues from <b className="text-foreground">{seriesSummary.length}</b> titles · biggest: {[...seriesSummary].sort((a, b) => b.items.length - a.items.length).slice(0, 5).map(x => `${x.name} (${x.items.length})`).join(', ')}{seriesSummary.length > 5 ? ` and ${seriesSummary.length - 5} more` : ''}
                              </p>
                              {(showAllSeries ? seriesSummary : seriesSummary.slice(0, 8)).map(({ name, items }) => {
                                  const owned = ownedOf(items);
                                  return (
                                      <div key={name} className="flex items-center gap-3 py-1">
                                          <span className="text-sm font-medium truncate flex-1 min-w-0" title={name}><SeriesLink series={items.find((i: any) => i.issue?.series)?.issue?.series}>{name}</SeriesLink></span>
                                          <div className="hidden sm:block h-1.5 w-28 rounded-full bg-muted overflow-hidden shrink-0"><div className={`h-full ${owned === items.length ? 'bg-emerald-500' : owned === 0 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${Math.max(4, Math.round(100 * owned / items.length))}%` }} /></div>
                                          <OwnedState items={items} />
                                          {owned < items.length ? (
                                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] font-bold uppercase text-primary hover:bg-primary/10 shrink-0" disabled={isBulkDownloading}
                                                  onClick={() => handleDownloadAllMissing(items.filter((i: any) => !i.issue?.filePath))}>
                                                  <CloudDownload className="w-3.5 h-3.5 mr-1" /> Request {items.length - owned}
                                              </Button>
                                          ) : <span className="w-[86px] shrink-0" />}
                                      </div>
                                  );
                              })}
                              {seriesSummary.length > 8 && (
                                  <Button variant="ghost" size="sm" className="w-full text-xs font-bold" onClick={() => setShowAllSeries(v => !v)}>
                                      {showAllSeries ? 'Show less' : `Show all ${seriesSummary.length} series`}
                                  </Button>
                              )}
                          </CardContent>
                      </Card>
                  )}

                  {activeList.items.length === 0 ? (
                    <div className="text-center py-20 border-2 border-dashed rounded-xl border-border bg-muted/30">
                        <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                        <h3 className="text-lg font-bold text-foreground">This list is empty</h3>
                        <p className="text-sm text-muted-foreground mt-1">Navigate to any series and use the "Add to List" button on an issue.</p>
                    </div>
                  ) : viewMode === 'table' ? (
                      /* Fork: one compact row per entry, in reading order */
                      <div className="rounded-xl border border-border bg-background/80 overflow-hidden mb-20">
                          <table className="w-full table-fixed">
                              <tbody>
                                  {activeList.items.map((item: any, index: number) => {
                                      if (hideRead && item.progress?.isCompleted) return null;
                                      const issue = item.issue;
                                      const owned = !!issue?.filePath;
                                      const seriesName = seriesOfItem(item);
                                      const number = issue?.number ?? (item.title.match(/#\s*([^\s#]+)\s*$/)?.[1] || '');
                                      const isRequesting = requestingIds.has(item.id);
                                      const isAlreadyRequested = requestedIds.has(item.id);
                                      return (
                                          <tr key={item.id} className={`border-b border-border text-sm hover:bg-muted/40 ${item.progress?.isCompleted ? 'opacity-55' : ''} ${item === nextUp ? 'bg-primary/10' : ''}`}>
                                              <td className="w-12 pl-3 py-1.5 font-mono text-xs text-muted-foreground">{index + 1}</td>
                                              <td className="px-2 py-1.5 truncate">
                                                  <SeriesLink series={issue?.series} className={`font-medium ${owned ? 'text-foreground' : 'text-muted-foreground'}`}>{seriesName}</SeriesLink>
                                                  <span className="ml-2 font-bold">#{number}</span>
                                                  {issue?.name && <span className="hidden md:inline ml-2 text-xs text-muted-foreground">{issue.name}</span>}
                                              </td>
                                              <td className="w-36 px-2 py-1.5 hidden sm:table-cell">
                                                  {item.progress?.isCompleted ? <span className="text-[10px] font-bold uppercase text-emerald-500 flex items-center gap-1"><Check className="w-3 h-3" /> Read</span>
                                                      : owned ? (item.progress?.currentPage > 0 ? <ReadState progress={item.progress} /> : <span className="text-[10px] font-bold uppercase text-muted-foreground">Owned</span>)
                                                      : <span className="text-[10px] font-bold uppercase text-orange-500">Not in library</span>}
                                              </td>
                                              <td className="w-32 pr-2 py-1 text-right whitespace-nowrap">
                                                  {owned ? (
                                                      <Button size="sm" asChild className="h-7 px-2 font-bold bg-primary hover:bg-primary/90 text-primary-foreground">
                                                          <Link href={readerHref(issue)}><BookOpen className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Read</span></Link>
                                                      </Button>
                                                  ) : isAlreadyRequested ? (
                                                      <span className="text-[10px] font-bold uppercase text-emerald-500 px-2">Requested</span>
                                                  ) : (
                                                      <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] font-bold uppercase border-primary/30 text-primary" onClick={() => handleRequestMissing(item)} disabled={isRequesting}>
                                                          {isRequesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}<span className="hidden sm:inline ml-1">Request</span>
                                                      </Button>
                                                  )}
                                                  {(isAdmin || activeList.userId === session?.user?.id) && (
                                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 ml-1 hidden sm:inline-flex" title="Remove from list" onClick={() => handleRemoveItem(item.id)}>
                                                          <Minus className="w-3.5 h-3.5" />
                                                      </Button>
                                                  )}
                                              </td>
                                          </tr>
                                      );
                                  })}
                              </tbody>
                          </table>
                      </div>
            ) : (
                      <DragDropContext onDragEnd={onDragEnd}>
                          <Droppable droppableId="reading-list">
                              {(provided) => (
                                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3 pb-20">
                                      {activeList.items.map((item: any, index: number) => {
                                          const issue = item.issue;
                                          const series = issue?.series;
                                          const coverUrl = activeList.coverUrl || issue?.coverUrl || (series?.folderPath ? `/api/library/cover?path=${encodeURIComponent(series.folderPath)}` : '/api/library/cover?path=missing');

                                          if (!issue?.filePath) {
                                              const isRequesting = requestingIds.has(item.id);
                                              const isAlreadyRequested = requestedIds.has(item.id);
                                              
                                              return (
                                                  <Draggable key={item.id} draggableId={item.id} index={index}>
                                                      {(provided, snapshot) => (
                                                          <div 
                                                              ref={provided.innerRef} 
                                                              {...provided.draggableProps} 
                                                              className={`flex items-center gap-4 p-3 bg-muted/50 border border-dashed rounded-xl opacity-80 transition-all ${snapshot.isDragging ? 'shadow-xl scale-[1.02] border-primary z-50 bg-background' : 'border-border'}`}
                                                          >
                                                              <div {...provided.dragHandleProps} className="px-2 py-4 text-muted-foreground hover:text-primary cursor-grab active:cursor-grabbing">
                                                                  <GripVertical className="w-5 h-5" />
                                                              </div>
                                                              
                                                              <div className="w-12 h-16 shrink-0 rounded overflow-hidden bg-muted border border-border flex items-center justify-center grayscale">
                                                                  <img src={coverUrl} className="w-full h-full object-cover" alt="" />
                                                              </div>

                                                              <div className="flex-1 min-w-0">
                                                                  <div className="flex items-center gap-2 mb-1">
                                                                      <Badge variant="secondary" className="shrink-0 text-[10px] font-mono h-5 bg-muted border-border text-muted-foreground">Part {index + 1}</Badge>
                                                                      <h4 className="font-bold text-sm truncate text-muted-foreground">{item.title}</h4>
                                                                  </div>
                                                                  <div className="text-[10px] font-bold uppercase tracking-wider text-orange-500 dark:text-orange-400 mt-1">Not in Library</div>
                                                              </div>

                                                              <div className="flex items-center gap-2 shrink-0 pr-2">
                                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" title="Re-check this item against the library" onClick={() => handleRefreshItem(item.id)} disabled={refreshingItemIds.has(item.id)}>
                                                                      {refreshingItemIds.has(item.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                                                  </Button>
                                                                  {isAlreadyRequested ? (
                                                                      <Button size="sm" variant="secondary" disabled className="h-8 bg-green-50 text-green-700 dark:bg-green-900/20 border-green-200 opacity-100 cursor-not-allowed">
                                                                          <Check className="w-3.5 h-3.5 mr-1"/> Requested
                                                                      </Button>
                                                                  ) : (
                                                                      <Button size="sm" variant="outline" className="h-8 font-bold text-[10px] uppercase tracking-wider border-primary/30 text-primary bg-primary/5 hover:bg-primary/10" onClick={() => handleRequestMissing(item)} disabled={isRequesting}>
                                                                          {isRequesting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1"/> : <CloudDownload className="w-3.5 h-3.5 mr-1"/>} Request
                                                                      </Button>
                                                                  )}
                                                              </div>
                                                          </div>
                                                      )}
                                                  </Draggable>
                                              );
                                          }

                                          return (
                                              <Draggable key={item.id} draggableId={item.id} index={index}>
                                                  {(provided, snapshot) => (
                                                      <div 
                                                          ref={provided.innerRef} 
                                                          {...provided.draggableProps} 
                                                          className={`flex items-center gap-4 p-3 bg-background border border-border rounded-xl shadow-sm transition-all ${snapshot.isDragging ? 'shadow-xl scale-[1.02] border-primary z-50 ring-2 ring-primary/20' : 'hover:border-primary/50'} ${item.progress?.isCompleted && !snapshot.isDragging ? 'opacity-60' : ''}`}
                                                      >
                                                          <div {...provided.dragHandleProps} className="px-2 py-4 text-muted-foreground hover:text-primary cursor-grab active:cursor-grabbing">
                                                              <GripVertical className="w-5 h-5" />
                                                          </div>
                                                          
                                                          <div className="w-12 h-16 shrink-0 rounded overflow-hidden bg-muted border border-border flex items-center justify-center">
                                                              <img src={coverUrl} className="w-full h-full object-cover" alt="" />
                                                          </div>

                                                          <div className="flex-1 min-w-0">
                                                              <div className="flex items-center gap-2 mb-1">
                                                                  <Badge variant="secondary" className="shrink-0 text-[10px] font-mono h-5 bg-primary/20 text-primary border-primary/30">Part {index + 1}</Badge>
                                                                  <h4 className="font-bold text-sm truncate text-foreground"><SeriesLink series={series}>{series.name}</SeriesLink></h4>
                                                              </div>
                                                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                  <span className="font-bold text-foreground shrink-0">Issue #{issue.number}</span>
                                                                  <span className="truncate hidden sm:inline">• {issue.name || "Untitled Issue"}</span>
                                                              </div>
                                                              <ReadState progress={item.progress} />
                                                          </div>

                                                          <div className="flex items-center gap-2 shrink-0 pr-2">
                                                              {isAdmin && (
                                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary hidden sm:flex" title={`Resync metadata for ${series.name}`} onClick={() => handleResyncSeries(series)} disabled={resyncingSeriesIds.has(series.id)}>
                                                                      {resyncingSeriesIds.has(series.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                                                  </Button>
                                                              )}
                                                              <Button size="sm" asChild className="h-8 shadow-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground">
                                                                  <Link href={readerHref(issue)}>
                                                                      <BookOpen className="w-3.5 h-3.5 sm:mr-2" /> <span className="hidden sm:inline">Read</span>
                                                                  </Link>
                                                              </Button>
                                                              {(isAdmin || activeList.userId === session?.user?.id) && (
                                                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 hidden sm:flex" onClick={() => handleRemoveItem(item.id)}>
                                                                      <Minus className="w-4 h-4" />
                                                                  </Button>
                                                              )}
                                                          </div>
                                                      </div>
                                                  )}
                                              </Draggable>
                                          );
                                      })}
                                      {provided.placeholder}
                                  </div>
                              )}
                          </Droppable>
                      </DragDropContext>
                  )}
              </div>
          ) : activeListId ? (
              <div className="flex justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : (
              <div className="flex flex-col items-center justify-center py-32 text-center border-2 border-dashed rounded-xl border-border bg-background">
                  <FolderOpen className="w-16 h-16 text-muted-foreground/30 mb-4" />
                  <p className="text-lg font-bold text-muted-foreground">Select a reading list to manage.</p>
                  <Button variant="outline" className="mt-4 font-bold" onClick={() => setPickerOpen(true)}>Choose a reading list</Button>
              </div>
          )}
      </div>

      <Dialog open={skipNoticeOpen} onOpenChange={setSkipNoticeOpen}>
        <DialogContent className="sm:max-w-[480px] bg-background border-border rounded-xl">
            <DialogHeader>
                <DialogTitle>{skippedMissing.length} {skippedMissing.length === 1 ? "issue is" : "issues are"} not in your library</DialogTitle>
                <DialogDescription>
                    {nextUp ? `These come next in the reading order. Continue with the next issue you have, ${nextUp.issue.series.name} #${nextUp.issue.number}, or request the missing ones first.` : "Everything left in this list is missing. Request it to keep reading."}
                </DialogDescription>
            </DialogHeader>
            <ul className="max-h-60 overflow-y-auto text-sm space-y-1 border border-border rounded-lg p-3 bg-muted/30">
                {skippedMissing.map((i: any) => <li key={i.id} className="truncate"><span className="text-orange-500 font-bold mr-2">✕</span>{i.issue?.series ? `${i.issue.series.name} #${i.issue.number}` : i.title}</li>)}
            </ul>
            <DialogFooter className="gap-2">
                <Button variant="outline" className="font-bold" disabled={isBulkDownloading} onClick={() => { setSkipNoticeOpen(false); handleDownloadAllMissing(skippedMissing); }}>
                    <CloudDownload className="w-4 h-4 mr-2" /> Request missing ({skippedMissing.length})
                </Button>
                {nextUp && (
                    <Button asChild className="font-bold">
                        <Link href={readerHref(nextUp.issue)}><BookOpen className="w-4 h-4 mr-2" /> Continue with #{nextUp.issue.number}</Link>
                    </Button>
                )}
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="sm:max-w-[425px] bg-background border-border rounded-xl">
            <DialogHeader><DialogTitle>Create Reading Order</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                    <Label>Story Arc / List Name</Label>
                    <Input placeholder="e.g. My Favorite Batman Issues" value={newListName} onChange={e => setNewListName(e.target.value)} className="bg-background border-border" />
                </div>
                <div className="grid gap-2">
                    <Label>Description (Optional)</Label>
                    <Input placeholder="e.g. A custom list of great stories." value={newListDesc} onChange={e => setNewListDesc(e.target.value)} className="bg-background border-border" />
                </div>
                {(isAdmin || (session?.user as any)?.canCreateGlobalLists) && (
                    <div className="flex items-center gap-3 mt-2 p-3 bg-muted border border-border rounded-lg">
                        <Switch id="global-toggle" checked={isGlobal} onCheckedChange={setIsGlobal} />
                        <div className="grid gap-0.5">
                            <Label htmlFor="global-toggle" className="font-bold cursor-pointer">Make public for all users</Label>
                            <p className="text-[10px] text-muted-foreground">Global lists appear on every user's profile.</p>
                        </div>
                    </div>
                )}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setCreateModalOpen(false)} className="border-border hover:bg-muted">Cancel</Button>
                <Button onClick={handleCreateList} disabled={isCreating || !newListName.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                    {isCreating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Create List"}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={autoBuildModalOpen} onOpenChange={setAutoBuildModalOpen}>
        <DialogContent className="sm:max-w-[450px] bg-background border-border rounded-xl">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-primary">
                    <Sparkles className="w-5 h-5" /> Auto-Build Story Arc
                </DialogTitle>
                <DialogDescription>
                    Omnibus will scrape ComicVine or Metron, build the entire official reading order, and map your downloaded files directly into the list!
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="flex gap-4">
                    <div className="space-y-2 flex-1">
                        <Label className="font-bold">Source</Label>
                        <Select value={eventSource} onValueChange={setEventSource}>
                            <SelectTrigger className="bg-background border-border text-lg h-12">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border">
                                <SelectItem value="COMICVINE">ComicVine</SelectItem>
                                <SelectItem value="METRON">Metron.Cloud</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2 flex-1">
                        <Label className="font-bold">Story Arc ID</Label>
                        <Input 
                            placeholder={eventSource === 'COMICVINE' ? "e.g. 40615" : "e.g. 52"} 
                            value={eventId} 
                            onChange={e => setEventId(e.target.value)} 
                            className="bg-background border-border font-mono text-lg h-12" 
                        />
                    </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-[-4px]">
                    {eventSource === 'COMICVINE' 
                        ? "Find the ID in the URL of the event on ComicVine (e.g. /marvel-civil-war/4045-40615/)"
                        : "Find the ID in the URL of the event on Metron.Cloud (e.g. /arc/52/)"}
                </p>

                {(isAdmin || (session?.user as any)?.canCreateGlobalLists) && (
                    <div className="flex items-center gap-3 mt-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <Switch id="auto-global-toggle" checked={autoBuildGlobal} onCheckedChange={setAutoBuildGlobal} />
                        <div className="grid gap-0.5">
                            <Label htmlFor="auto-global-toggle" className="font-bold cursor-pointer">Make story arc public</Label>
                            <p className="text-[10px] text-muted-foreground">This reading order will be available to all users.</p>
                        </div>
                    </div>
                )}

                {(isAdmin || (session?.user as any)?.canRequest) && (
                    <div className="flex items-center gap-3 mt-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <Switch id="auto-add-missing-toggle" checked={autoBuildAddMissing} onCheckedChange={setAutoBuildAddMissing} />
                        <div className="grid gap-0.5">
                            <Label htmlFor="auto-add-missing-toggle" className="font-bold cursor-pointer">Add missing series to my library</Label>
                            <p className="text-[10px] text-muted-foreground">Series from this arc you don't own at all are added metadata-only and monitored. Nothing downloads now, but future releases auto-download like any monitored series.</p>
                        </div>
                    </div>
                )}
                
                <div className="space-y-2 mt-4 pt-4 border-t border-border">
                    <Label className="text-xs uppercase tracking-widest text-muted-foreground font-black">Quick Load Popular Story Arcs</Label>
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted border-border text-foreground" onClick={() => handleQuickLoad("40615", "COMICVINE")}>Civil War [CV]</Badge>
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted border-border text-foreground" onClick={() => handleQuickLoad("56681", "COMICVINE")}>Avengers vs X-Men [CV]</Badge>
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted border-border text-foreground" onClick={() => handleQuickLoad("40978", "COMICVINE")}>Secret Wars [CV]</Badge>
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted border-border text-foreground" onClick={() => handleQuickLoad("56053", "COMICVINE")}>Flashpoint [CV]</Badge>
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted border-border text-foreground" onClick={() => handleQuickLoad("42711", "COMICVINE")}>Infinity Gauntlet [CV]</Badge>
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted border-border text-foreground" onClick={() => handleQuickLoad("52", "METRON")}>Death of the Family [Metron]</Badge>
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted border-border text-foreground" onClick={() => handleQuickLoad("31", "METRON")}>Absolute Carnage [Metron]</Badge>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setAutoBuildModalOpen(false)} className="border-border hover:bg-muted">Cancel</Button>
                <Button onClick={handleAutoBuild} disabled={isAutoBuilding || !eventId.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                    {isAutoBuilding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Build List"}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV IMPORT MODAL */}
      <Dialog open={csvModalOpen} onOpenChange={setCsvModalOpen}>
        <DialogContent className="sm:max-w-[450px] bg-background border-border rounded-xl">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-primary">
                    <DownloadCloud className="w-5 h-5" /> Import CSV File
                </DialogTitle>
                <DialogDescription>
                    Upload a CSV export from League of Comic Geeks (or Goodreads). Omnibus will automatically match the issues to your downloaded library.
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                    <Label className="font-bold">Reading List Name</Label>
                    <Input 
                        placeholder="e.g. My LOCG Pull List" 
                        value={csvListName} 
                        onChange={e => setCsvListName(e.target.value)} 
                        className="bg-background border-border" 
                    />
                </div>
                
                <div className="grid gap-2 mt-2">
                    <Label className="font-bold">Upload CSV File</Label>
                    <Input 
                        type="file" 
                        accept=".csv" 
                        onChange={e => setCsvFile(e.target.files?.[0] || null)} 
                        className="h-12 sm:h-10 pt-[9px] sm:pt-[5px] text-muted-foreground bg-muted/50 border-border cursor-pointer file:text-foreground file:font-bold file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:bg-primary/10 file:text-primary hover:file:bg-primary/20" 
                    />
                </div>

                {(isAdmin || (session?.user as any)?.canCreateGlobalLists) && (
                    <div className="flex items-center gap-3 mt-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <Switch id="csv-global-toggle" checked={csvIsGlobal} onCheckedChange={setCsvIsGlobal} />
                        <div className="grid gap-0.5">
                            <Label htmlFor="csv-global-toggle" className="font-bold cursor-pointer">Make list public</Label>
                            <p className="text-[10px] text-muted-foreground">This reading order will be available to all users.</p>
                        </div>
                    </div>
                )}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setCsvModalOpen(false)} disabled={isImportingCsv} className="border-border hover:bg-muted">Cancel</Button>
                <Button onClick={handleCsvImport} disabled={isImportingCsv || !csvFile || !csvListName.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                    {isImportingCsv ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Import CSV"}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CBL IMPORT MODAL */}
      <Dialog open={cblModalOpen} onOpenChange={setCblModalOpen}>
        <DialogContent className="sm:max-w-[450px] bg-background border-border rounded-xl">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-primary">
                    <DownloadCloud className="w-5 h-5" /> Import .CBL File
                </DialogTitle>
                <DialogDescription>
                    Import a ComicRack (.cbl) file. You can upload a file directly or paste a raw GitHub URL.
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                
                {/* --- Community Repo Link --- */}
                <div className="bg-muted/30 border border-border p-3 rounded-lg flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <div className="flex flex-col">
                            <span className="text-xs font-bold text-foreground">Need help finding lists?</span>
                            <span className="text-[11px] text-muted-foreground mt-0.5 leading-snug">Browse the community-maintained repository for hundreds of curated reading orders.</span>
                        </div>
                    </div>
                    <Button variant="outline" size="sm" asChild className="h-8 w-full border-border bg-background hover:bg-muted text-foreground text-xs font-bold shadow-sm mt-1">
                        <a href="https://github.com/DieselTech/CBL-ReadingLists" target="_blank" rel="noopener noreferrer">
                            Browse Community Repository <ExternalLink className="w-3 h-3 ml-1.5" />
                        </a>
                    </Button>
                </div>

                <div className="grid gap-2">
                    <Label className="font-bold">Reading List Name</Label>
                    <Input 
                        placeholder="e.g. Dawn of X Reading Order" 
                        value={cblListName} 
                        onChange={e => setCblListName(e.target.value)} 
                        className="bg-background border-border" 
                    />
                </div>

                <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Select Source</span></div>
                </div>
                
                <div className="grid gap-2">
                    <Label className="font-bold">Raw GitHub URL</Label>
                    <Input 
                        placeholder="https://raw.githubusercontent.com/..." 
                        value={cblUrl} 
                        onChange={e => {
                            setCblUrl(e.target.value);
                            setCblFile(null); 
                        }} 
                        className="bg-background border-border" 
                    />
                </div>

                <div className="text-center text-xs font-bold text-muted-foreground uppercase">- OR -</div>

                <div className="grid gap-2">
                    <Label className="font-bold">Upload Local .CBL File</Label>
                    <Input 
                        type="file" 
                        accept=".cbl,.xml" 
                        onChange={e => {
                            setCblFile(e.target.files?.[0] || null);
                            setCblUrl(""); 
                        }} 
                        className="h-12 sm:h-10 pt-[9px] sm:pt-[5px] text-muted-foreground bg-muted/50 border-border cursor-pointer file:text-foreground file:font-bold file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:bg-primary/10 file:text-primary hover:file:bg-primary/20" 
                    />
                </div>

                {(isAdmin || (session?.user as any)?.canCreateGlobalLists) && (
                    <div className="flex items-center gap-3 mt-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <Switch id="cbl-global-toggle" checked={cblIsGlobal} onCheckedChange={setCblIsGlobal} />
                        <div className="grid gap-0.5">
                            <Label htmlFor="cbl-global-toggle" className="font-bold cursor-pointer">Make list public</Label>
                            <p className="text-[10px] text-muted-foreground">This reading order will be available to all users.</p>
                        </div>
                    </div>
                )}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setCblModalOpen(false)} disabled={isImportingCbl} className="border-border hover:bg-muted">Cancel</Button>
                <Button onClick={handleCblImport} disabled={isImportingCbl || (!cblFile && !cblUrl.trim()) || !cblListName.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                    {isImportingCbl ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Import CBL"}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ANILIST IMPORT MODAL */}
      <Dialog open={aniListModalOpen} onOpenChange={setAniListModalOpen}>
          <DialogContent className="sm:max-w-[425px] bg-background border-border rounded-xl">
              <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-primary">
                      <DownloadCloud className="w-5 h-5" /> Sync with AniList
                  </DialogTitle>
                  <DialogDescription>
                      Omnibus will fetch your AniList profile and automatically generate Reading Lists for any manga that you have downloaded.
                  </DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-4">
                  <div className="space-y-2">
                      <Label>AniList Username</Label>
                      <Input placeholder="e.g. hanks_cafe" value={aniListUsername} onChange={e => setAniListUsername(e.target.value)} className="bg-muted border-border h-12" />
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-muted border border-border rounded-lg">
                      <Switch id="auto-req-toggle" checked={aniListRequestMissing} onCheckedChange={setAniListRequestMissing} />
                      <div className="grid gap-0.5">
                          <Label htmlFor="auto-req-toggle" className="font-bold cursor-pointer">Auto-Request Missing Manga</Label>
                          <p className="text-[10px] text-muted-foreground">Omnibus will queue missing titles for download.</p>
                      </div>
                  </div>
                  {(isAdmin || (session?.user as any)?.canCreateGlobalLists) && (
                    <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <Switch id="anilist-global-toggle" checked={aniListIsGlobal} onCheckedChange={setAniListIsGlobal} />
                        <div className="grid gap-0.5">
                            <Label htmlFor="anilist-global-toggle" className="font-bold cursor-pointer">Make lists public</Label>
                            <p className="text-[10px] text-muted-foreground">These reading orders will be available to all users.</p>
                        </div>
                    </div>
                )}
              </div>
              <DialogFooter>
                  <Button variant="outline" onClick={() => setAniListModalOpen(false)} disabled={isImportingAniList} className="border-border hover:bg-muted">Cancel</Button>
                  <Button onClick={handleAniListSync} disabled={isImportingAniList || !aniListUsername.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                      {isImportingAniList ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Sync Account
                  </Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>

      {/* MYANIMELIST IMPORT MODAL */}
      <Dialog open={malModalOpen} onOpenChange={setMalModalOpen}>
          <DialogContent className="sm:max-w-[425px] bg-background border-border rounded-xl">
              <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-primary">
                      <DownloadCloud className="w-5 h-5" /> Sync with MyAnimeList
                  </DialogTitle>
                  <DialogDescription>
                      Omnibus will fetch your public MyAnimeList profile and automatically generate Reading Lists based on your reading status.
                  </DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-4">
                  <div className="space-y-2">
                      <Label>MAL Username</Label>
                      <Input placeholder="e.g. hanks_cafe" value={malUsername} onChange={e => setMalUsername(e.target.value)} className="bg-muted border-border h-12" />
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-muted border border-border rounded-lg">
                      <Switch id="mal-auto-req-toggle" checked={malRequestMissing} onCheckedChange={setMalRequestMissing} />
                      <div className="grid gap-0.5">
                          <Label htmlFor="mal-auto-req-toggle" className="font-bold cursor-pointer">Auto-Request Missing Manga</Label>
                          <p className="text-[10px] text-muted-foreground">Omnibus will queue missing titles for download.</p>
                      </div>
                  </div>
                  {(isAdmin || (session?.user as any)?.canCreateGlobalLists) && (
                    <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <Switch id="mal-global-toggle" checked={malIsGlobal} onCheckedChange={setMalIsGlobal} />
                        <div className="grid gap-0.5">
                            <Label htmlFor="mal-global-toggle" className="font-bold cursor-pointer">Make lists public</Label>
                            <p className="text-[10px] text-muted-foreground">These reading orders will be available to all users.</p>
                        </div>
                    </div>
                )}
              </div>
              <DialogFooter>
                  <Button variant="outline" onClick={() => setMalModalOpen(false)} disabled={isImportingMal} className="border-border hover:bg-muted">Cancel</Button>
                  <Button onClick={handleMalSync} disabled={isImportingMal || !malUsername.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                      {isImportingMal ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Sync Account
                  </Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>

      <ConfirmationDialog 
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmDeleteList}
        isLoading={isDeleting}
        title="Delete Reading List?"
        description={`Are you sure you want to delete the "${activeList?.name}" reading list? This action cannot be undone.`}
        confirmText="Delete List"
      />
    </div>
  )
}

export default function ReadingListsPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted-foreground">Loading...</div>}>
      <ReadingListsContent />
    </Suspense>
  )
}