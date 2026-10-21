// src/app/requests/page.tsx
"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { 
  Loader2, Search, RefreshCw, Clock, CheckCircle2, Calendar, FileText, 
  ChevronLeft, ChevronRight, Info, List, ImageIcon, Server, XCircle, Library,
  CheckSquare, Square, ExternalLink
} from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { COMIC_EXT_REGEX } from "@/lib/utils/formats"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Fork: one table for tabs, filter and the status ring (label, statuses, ring colour)
const STATUS_GROUPS: { tab: string, label: string, statuses: string[], color: string }[] = [
  { tab: "ACTIVE", label: "Active / DL", statuses: ['DOWNLOADING', 'PENDING', 'MANUAL_DDL'], color: '#3b82f6' },
  { tab: "PENDING_APPROVAL", label: "Pending", statuses: ['PENDING_APPROVAL'], color: '#f97316' },
  { tab: "UNRELEASED", label: "Unreleased", statuses: ['UNRELEASED'], color: '#a855f7' },
  { tab: "AWAITING", label: "Awaiting", statuses: ['AWAITING_RELEASE'], color: '#0ea5e9' },
  { tab: "COMPLETED", label: "Completed", statuses: ['IMPORTED', 'COMPLETED'], color: '#22c55e' },
  { tab: "FAILED", label: "Failed", statuses: ['FAILED', 'STALLED', 'ERROR'], color: '#ef4444' },
  { tab: "CANCELLED", label: "Cancelled", statuses: ['CANCELLED'], color: '#64748b' },
];
const CANCELLABLE = ['PENDING_APPROVAL', 'PENDING', 'DOWNLOADING', 'MANUAL_DDL', 'UNRELEASED', 'AWAITING_RELEASE'];
const statusLabel = (status: string) => status === 'PENDING_APPROVAL' ? 'Needs Approval' : status === 'MANUAL_DDL' ? 'GETCOMICS' : status === 'AWAITING_RELEASE' ? 'Awaiting' : status;

// Fork: ring of all requests by status group; a click filters to that group
function StatusRing({ requests, active, onSelect }: { requests: any[], active: string, onSelect: (tab: string) => void }) {
  const counts = STATUS_GROUPS.map(g => ({ ...g, n: requests.filter(r => g.statuses.includes(r.status)).length }));
  const total = counts.reduce((a, c) => a + c.n, 0);
  const manual = requests.filter(r => r.status === 'MANUAL_DDL').length;
  const R = 70, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <Card className="border-border bg-background/80">
      <CardContent className="p-5 flex flex-col sm:flex-row items-center gap-8">
        <svg viewBox="0 0 180 180" className="w-44 h-44 shrink-0 -rotate-90">
          <circle cx="90" cy="90" r={R} fill="none" stroke="currentColor" strokeWidth="22" className="text-muted" />
          {total > 0 && counts.filter(c => c.n > 0).map(c => {
            const len = (c.n / total) * C;
            const seg = (
              <circle key={c.tab} cx="90" cy="90" r={R} fill="none" stroke={c.color} strokeWidth={active === c.tab ? 28 : 22}
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} className="cursor-pointer transition-all" onClick={() => onSelect(c.tab)}>
                <title>{`${c.label}: ${c.n}`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
          <text x="90" y="90" textAnchor="middle" dominantBaseline="central" transform="rotate(90 90 90)" className="fill-foreground font-black" fontSize="28">{total}</text>
        </svg>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 w-full">
          {counts.map(c => (
            <button key={c.tab} onClick={() => onSelect(active === c.tab ? "ALL" : c.tab)} className={`flex items-center gap-2 text-sm rounded-md px-2 py-1 text-left ${active === c.tab ? 'bg-muted font-bold' : 'hover:bg-muted/60'}`}>
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: c.color }} />
              <span className="flex-1">{c.label}</span>
              <span className="font-mono font-bold">{c.n}</span>
            </button>
          ))}
          {manual > 0 && <p className="col-span-2 text-xs text-muted-foreground px-2">{manual} of the active ones need a manual GetComics download.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// Fork: compact one-line request (table view)
function RequestRow({ req, getStatusColor, onCancel, isSelectionMode, isSelected, onToggleSelect }: {
  req: any, getStatusColor: (status: string) => string, onCancel: (id: string) => void,
  isSelectionMode: boolean, isSelected: boolean, onToggleSelect: (id: string) => void
}) {
  const [isCancelling, setIsCancelling] = useState(false);
  const cancellable = CANCELLABLE.includes(req.status);
  const name = (req.seriesName || "Unknown Request").replace(COMIC_EXT_REGEX, '');
  return (
    <tr className={`border-b border-border text-sm ${isSelected && isSelectionMode ? 'bg-primary/10' : 'hover:bg-muted/40'} ${isSelectionMode && cancellable ? 'cursor-pointer' : ''}`}
        onClick={() => { if (isSelectionMode && cancellable) onToggleSelect(req.id); }}>
      {isSelectionMode && <td className="pl-3 w-8">{cancellable ? (isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-muted-foreground" />) : null}</td>}
      <td className="px-3 py-2 w-32"><Badge variant="outline" className={`${getStatusColor(req.status)} text-[10px] font-bold uppercase tracking-wider whitespace-nowrap`}>{statusLabel(req.status)}</Badge></td>
      <td className="px-3 py-2 max-w-0 w-full"><p className="truncate font-medium" title={name}>{name}</p></td>
      <td className="px-3 py-2 hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap max-w-48 truncate">{providerOf(req)}</td>
      <td className="px-3 py-2 hidden sm:table-cell text-xs text-muted-foreground whitespace-nowrap">{new Date(req.createdAt).toLocaleDateString()}</td>
      <td className="px-3 py-2 w-14 text-xs font-mono text-primary">{req.status === 'DOWNLOADING' ? `${req.progress}%` : ''}</td>
      <td className="px-2 py-1 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
        {req.seriesPath && <Button size="icon" variant="ghost" asChild className="h-7 w-7" title="Go to series"><Link href={`/library/series?path=${encodeURIComponent(req.seriesPath)}`}><Library className="w-3.5 h-3.5" /></Link></Button>}
        {req.volumeId && req.volumeId !== "0" && (
          <Button size="icon" variant="ghost" asChild className="h-7 w-7" title={`View on ${req.metadataSource === 'METRON' ? 'Metron' : 'ComicVine'}`}>
            <a href={req.metadataSource === 'METRON' ? `https://metron.cloud/series/${req.volumeId}/` : `https://comicvine.gamespot.com/volume/4050-${req.volumeId}/`} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5" /></a>
          </Button>
        )}
        {cancellable && (
          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" title="Cancel request" disabled={isCancelling || isSelectionMode}
            onClick={async () => { setIsCancelling(true); await onCancel(req.id); setIsCancelling(false); }}>
            {isCancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
          </Button>
        )}
      </td>
    </tr>
  );
}

// Where a request is (being) downloaded from, for cards and table rows
function providerOf(req: any): string {
  let provider = "Pending Search";
  if (req.indexer) {
      provider = req.indexer;
  } else if (req.downloadLink === 'DIRECT_GETCOMICS') {
      provider = "GetComics";
  } else if (req.downloadLink?.startsWith('http')) {
      try {
          const url = new URL(req.downloadLink);
          const hostname = url.hostname.replace('www.', '');
          const parts = hostname.split('.');
          let name = parts.length > 1 ? parts[parts.length - 2] : hostname;
          name = name.charAt(0).toUpperCase() + name.slice(1);
          
          if (hostname.includes('mediafire')) name = 'MediaFire';
          else if (hostname.includes('mega.nz') || hostname.includes('mega.co.nz')) name = 'Mega';
          else if (hostname.includes('pixeldrain')) name = 'Pixeldrain';
          else if (hostname.includes('terabox')) name = 'Terabox';
          else if (hostname.includes('vikingfile')) name = 'VikingFile';
          else if (hostname.includes('annas-archive')) name = "Anna's Archive";
          else if (hostname.includes('rootz')) name = 'Rootz';
          else if (hostname.includes('comicfiles') || hostname.includes('comic-files') || hostname.includes('getcomics')) name = 'GetComics';
          
          provider = `${name} (DDL)`;
      } catch (e) {
          provider = "Direct Download (DDL)";
      }
  } else if (req.downloadLink?.startsWith('magnet:')) {
      provider = "Torrent Indexer";
  } else if (req.downloadLink) {
      provider = "Usenet / Torrent Indexer";
  } else if (req.status === 'PENDING_APPROVAL') {
      provider = "Awaiting Approval";
  } else if (req.status === 'AWAITING_RELEASE') {
      provider = "Not on any source yet — retrying automatically";
  } else if (['FAILED', 'ERROR', 'CANCELLED', 'STALLED'].includes(req.status)) {
      provider = "N/A";
  }
  return provider;
}

function RequestCard({ 
    req, 
    getStatusColor, 
    onCancel, 
    isSelectionMode, 
    isSelected, 
    onToggleSelect 
}: { 
    req: any, 
    getStatusColor: (status: string) => string, 
    onCancel: (id: string) => void,
    isSelectionMode: boolean,
    isSelected: boolean,
    onToggleSelect: (id: string) => void
}) {
  const [desc, setDesc] = useState<string | null>(null)
  const [loadingDesc, setLoadingDesc] = useState(false)
  const [showDesc, setShowDesc] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  // Enforce the rule that users can only cancel pre-processed or active items
  const isCancellable = CANCELLABLE.includes(req.status);

  const handleShowDesc = async () => {
    if (showDesc) {
        setShowDesc(false);
        return;
    }
    setShowDesc(true);
    if (!desc && req.volumeId) {
        setLoadingDesc(true);
        try {
            // Added -? to correctly fetch synopses for negative issue requests
            const issueMatch = req.seriesName?.match(/#(-?\d+(?:\.\d+)?)/);
            
            if (issueMatch) {
                const targetIssueNum = parseFloat(issueMatch[1]);
                const [volRes, issuesRes] = await Promise.all([
                    fetch(`/api/issue-details?id=${req.volumeId}&type=volume&provider=${req.metadataSource || 'COMICVINE'}`),
                    fetch(`/api/series-issues?volumeId=${req.volumeId}&provider=${req.metadataSource || 'COMICVINE'}`)
                ]);
                const volData = await volRes.json();
                const issuesData = await issuesRes.json();
                const specificIssue = issuesData.results?.find((i: any) => parseFloat(i.issueNumber) === targetIssueNum);
                const finalDesc = specificIssue?.description || volData.description;
                setDesc(finalDesc ? finalDesc.trim() : "No synopsis available.");
            } else {
                const res = await fetch(`/api/issue-details?id=${req.volumeId}&type=volume&provider=${req.metadataSource || 'COMICVINE'}`);
                const data = await res.json();
                setDesc(data.description ? data.description.trim() : "No synopsis available.");
            }
        } catch (e) {
            setDesc("Failed to load synopsis.");
        } finally {
            setLoadingDesc(false);
        }
    }
  }

  const handleCancel = async () => {
      setIsCancelling(true);
      await onCancel(req.id);
      setIsCancelling(false);
  }

  const displayName = (req.seriesName || "Unknown Request").replace(COMIC_EXT_REGEX, '');
  const isCompleted = ['IMPORTED', 'COMPLETED'].includes(req.status);

  const provider = providerOf(req);

  return (
    <Card 
        className={`shadow-sm transition-all overflow-hidden bg-background max-w-4xl mx-auto w-full border ${isSelectionMode ? (isCancellable ? 'cursor-pointer hover:border-primary/50' : 'opacity-60 cursor-not-allowed') : 'hover:border-primary/50 border-border'} ${isSelected && isSelectionMode ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : ''}`}
        onClick={() => { if (isSelectionMode && isCancellable) onToggleSelect(req.id); }}
    >
      <CardContent className="p-4 flex flex-col sm:flex-row gap-6 items-start relative">
        {isSelectionMode && isCancellable && (
            <div className="absolute top-2 left-2 z-40 bg-black/50 backdrop-blur-sm rounded p-1 pointer-events-none">
                {isSelected ? <CheckSquare className="w-5 h-5 text-primary" /> : <Square className="w-5 h-5 text-white/80" />}
            </div>
        )}
        
        <div className="w-28 h-40 sm:w-32 sm:h-48 shrink-0 bg-muted rounded-xl overflow-hidden border border-border relative shadow-sm flex items-center justify-center">
            {req.imageUrl && req.imageUrl.trim() !== "" ? (
                <img src={req.imageUrl} alt={displayName} className={`object-cover w-full h-full ${isSelectionMode ? 'opacity-80' : ''}`} />
            ) : (
                <ImageIcon className="w-10 h-10 text-muted-foreground/50" />
            )}
        </div>

        <div className="flex-1 flex flex-col min-w-0 pt-1 w-full">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-3">
                <div className="space-y-1">
                    <h3 className="font-bold text-lg sm:text-xl leading-tight line-clamp-1 text-foreground" title={displayName}>{displayName}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={`${getStatusColor(req.status)} text-[10px] font-bold uppercase tracking-wider`}>
                            {statusLabel(req.status)}
                        </Badge>
                        {req.status === 'DOWNLOADING' && <span className="text-[11px] font-mono text-primary font-bold bg-primary/10 px-2 py-0.5 rounded">{req.progress}%</span>}
                        {isCompleted && <span className="text-[11px] text-green-700 dark:text-green-400 flex items-center gap-1 font-bold bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded"><CheckCircle2 className="w-3 h-3"/> Ready in Library</span>}
                    </div>
                </div>
            </div>

            <div className="flex-1">
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={(e) => { e.stopPropagation(); handleShowDesc(); }} 
                    disabled={isSelectionMode}
                    className="h-7 px-2 text-xs font-bold text-primary hover:text-primary/80 hover:bg-primary/10 -ml-2 mb-1"
                >
                    <Info className="w-3.5 h-3.5 mr-1" /> {showDesc ? "Hide Synopsis" : "Read Synopsis"}
                </Button>
                {showDesc && (
                    <div className="text-sm text-muted-foreground leading-relaxed bg-muted/50 p-4 rounded-md border border-border mt-2 animate-in fade-in slide-in-from-top-2">
                        {loadingDesc ? (
                            <span className="flex items-center gap-2 text-xs font-medium"><Loader2 className="w-3 h-3 animate-spin text-primary"/> Fetching data...</span>
                        ) : (
                            desc
                        )}
                    </div>
                )}
            </div>

            <div className="mt-4 pt-4 border-t border-border flex flex-col gap-3">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-[11px] font-medium">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5" />
                        Requested: {new Date(req.createdAt).toLocaleDateString()}
                    </div>
                    {isCompleted && req.updatedAt && (
                        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-500">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Completed: {new Date(req.updatedAt).toLocaleDateString()}
                        </div>
                    )}
                </div>
                
                <div className="flex flex-col gap-1 text-[11px] text-muted-foreground font-medium">
                    <span className="flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> Provider: <span className="font-bold text-foreground">{provider}</span></span>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 w-full mt-1">
                     {req.seriesPath && (
                        <Button size="sm" asChild variant="secondary" className="flex-1 font-bold shadow-sm h-9" disabled={isSelectionMode}>
                            <Link onClick={(e) => isSelectionMode && e.preventDefault()} href={`/library/series?path=${encodeURIComponent(req.seriesPath)}`}><Library className="w-4 h-4 mr-2" /> Go to Series</Link>
                        </Button>
                     )}
                     
                     {/* ADD THIS NEW BUTTON: */}
                     {req.volumeId && req.volumeId !== "0" && (
                         <Button size="sm" variant="outline" asChild className="flex-1 font-bold shadow-sm h-9 border-border hover:bg-muted text-foreground" disabled={isSelectionMode}>
                            <a href={req.metadataSource === 'METRON' ? `https://metron.cloud/series/${req.volumeId}/` : `https://comicvine.gamespot.com/volume/4050-${req.volumeId}/`} target="_blank" rel="noopener noreferrer">
                               <ExternalLink className="w-4 h-4 mr-2" /> View on {req.metadataSource === 'METRON' ? 'Metron' : 'ComicVine'}
                            </a>
                         </Button>
                     )}
                     
                     {isCancellable && (
                         <Button size="sm" variant="destructive" className="flex-1 font-bold shadow-sm h-9" onClick={(e) => { e.stopPropagation(); handleCancel(); }} disabled={isCancelling || isSelectionMode}>
                            {isCancelling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />} Cancel Request
                         </Button>
                     )}
                </div>
            </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function RequestsPage() {
  const { data: session } = useSession()
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  const [activeTab, setActiveTab] = useState("ALL")
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState("50")
  const [viewMode, setViewMode] = useState<"table" | "cards">("table")
  
  // Selection / Bulk Actions
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set())
  const [isBulkCancelling, setIsBulkCancelling] = useState(false)

  const { toast } = useToast()

  const fetchRequests = async () => {
    if (!session?.user?.id) return;
    try {
      const res = await fetch('/api/request')
      if (res.ok) {
        const data = await res.json()
        setRequests(data)
      }
    } catch (e) {
      toast({ title: "Error", description: "Could not load requests.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRequests()
    const interval = setInterval(fetchRequests, 15000) 
    return () => clearInterval(interval)
  }, [session])

  const handleCancelRequest = async (id: string) => {
      try {
          const res = await fetch(`/api/request?id=${id}`, { method: 'DELETE' });
          if (res.ok) {
              toast({ title: "Request Cancelled" });
              setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'CANCELLED' } : r));
          } else {
              toast({ title: "Failed to cancel request", variant: "destructive" });
          }
      } catch (e) {
          toast({ title: "Error cancelling request", variant: "destructive" });
      }
  };

  const handleBulkCancel = async () => {
      setIsBulkCancelling(true);
      try {
          const promises = Array.from(selectedRequests).map(id =>
              fetch(`/api/request?id=${id}`, { method: 'DELETE' })
          );
          await Promise.all(promises);
          toast({ title: "Requests Cancelled", description: `Successfully cancelled ${selectedRequests.size} requests.` });
          setRequests(prev => prev.map(r => selectedRequests.has(r.id) ? { ...r, status: 'CANCELLED' } : r));
          setSelectedRequests(new Set());
          setIsSelectionMode(false);
      } catch (e) {
          toast({ title: "Error cancelling requests", variant: "destructive" });
      } finally {
          setIsBulkCancelling(false);
      }
  };

  const toggleRequestSelection = (id: string) => {
      setSelectedRequests(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'IMPORTED': case 'COMPLETED': return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800"
      case 'DOWNLOADING': case 'MANUAL_DDL': return "bg-primary/20 text-primary border-primary/30"
      case 'PENDING_APPROVAL': return "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800"
      case 'FAILED': case 'STALLED': case 'ERROR': return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
      case 'UNRELEASED': return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800"
      case 'AWAITING_RELEASE': return "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800"
      default: return "bg-muted text-foreground border-border"
    }
  }

  const filteredRequests = useMemo(() => {
      return requests.filter(req => {
          const matchesSearch = !searchQuery || (req.activeDownloadName || req.seriesName || "").toLowerCase().includes(searchQuery.toLowerCase());
          if (!matchesSearch) return false;

          if (activeTab === "ALL") return true;
          return STATUS_GROUPS.find(g => g.tab === activeTab)?.statuses.includes(req.status) ?? true;
      });
  }, [requests, activeTab, searchQuery]);

  useEffect(() => { setPage(1) }, [activeTab, pageSize, searchQuery]);

  const limit = parseInt(pageSize);
  const totalPages = Math.ceil(filteredRequests.length / limit) || 1;
  const paginatedRequests = filteredRequests.slice((page - 1) * limit, page * limit);
  
  // Calculate which of the currently visible requests are eligible for cancellation
  const cancellableRequests = useMemo(() => paginatedRequests.filter(r => CANCELLABLE.includes(r.status)), [paginatedRequests]);

  return (
    <div className="container mx-auto py-10 px-6 space-y-6 max-w-5xl transition-colors duration-300">
      <title>Omnibus - My Requests</title>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">My Requests</h1>
          <p className="text-muted-foreground mt-1">
            Track the status and history of your requested comics.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            <Button 
                variant={isSelectionMode ? "secondary" : "outline"} 
                onClick={() => { setIsSelectionMode(!isSelectionMode); setSelectedRequests(new Set()); }} 
                className={`h-10 ${isSelectionMode ? 'bg-primary/20 text-primary hover:bg-primary/30 border-primary/50' : 'border-border hover:bg-muted text-foreground'}`}
            >
                {isSelectionMode ? <Square className="w-4 h-4 mr-2" /> : <CheckSquare className="w-4 h-4 mr-2" />}
                {isSelectionMode ? "Cancel Select" : "Select"}
            </Button>
            <div className="flex gap-1 bg-muted p-1 rounded-md border border-border">
                <Button size="sm" variant={viewMode === "table" ? "default" : "ghost"} className="h-8 px-3 font-bold" onClick={() => setViewMode("table")}>Table</Button>
                <Button size="sm" variant={viewMode === "cards" ? "default" : "ghost"} className="h-8 px-3 font-bold" onClick={() => setViewMode("cards")}>Cards</Button>
            </div>
            <Button variant="outline" onClick={fetchRequests} disabled={loading} className="h-10 border-border hover:bg-muted text-foreground">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Refresh
            </Button>
            <Button className="h-10 bg-primary hover:bg-primary/90 text-primary-foreground font-bold" asChild>
                <Link href="/"><Search className="w-4 h-4 mr-2" /> Request More</Link>
            </Button>
        </div>
      </div>

      {requests.length > 0 && <StatusRing requests={requests} active={activeTab} onSelect={setActiveTab} />}

      <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input 
              placeholder="Search your requests..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12 bg-background border-border text-base"
          />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full flex overflow-x-auto justify-start sm:justify-center [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-auto p-1 bg-muted border border-border">
            <TabsTrigger value="ALL" className="px-4 py-2">All <span className="ml-1.5 text-xs opacity-60">{requests.length}</span></TabsTrigger>
            {STATUS_GROUPS.map(g => (
              <TabsTrigger key={g.tab} value={g.tab} className="px-4 py-2">{g.label} <span className="ml-1.5 text-xs opacity-60">{requests.filter(r => g.statuses.includes(r.status)).length}</span></TabsTrigger>
            ))}
        </TabsList>
      </Tabs>

      {viewMode === "table" && paginatedRequests.length > 0 && (
          <div className="rounded-xl border border-border bg-background/80 overflow-hidden">
              <table className="w-full table-fixed sm:table-auto">
                  <tbody>
                      {paginatedRequests.map(req => (
                          <RequestRow key={req.id} req={req} getStatusColor={getStatusColor} onCancel={handleCancelRequest}
                              isSelectionMode={isSelectionMode} isSelected={selectedRequests.has(req.id)} onToggleSelect={toggleRequestSelection} />
                      ))}
                  </tbody>
              </table>
          </div>
      )}

      <div className={`grid grid-cols-1 gap-6 ${viewMode === "cards" ? 'min-h-[400px]' : ''}`}>
          {viewMode === "cards" && paginatedRequests.map((req) => (
              <RequestCard 
                  key={req.id} 
                  req={req} 
                  getStatusColor={getStatusColor} 
                  onCancel={handleCancelRequest} 
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedRequests.has(req.id)}
                  onToggleSelect={toggleRequestSelection}
              />
          ))}
          
          {paginatedRequests.length === 0 && !loading && (
             <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-lg border-border bg-muted/30">
               <FileText className="w-10 h-10 text-muted-foreground/50 mb-4" />
               <p className="text-muted-foreground font-medium">No requests found in this category.</p>
             </div>
          )}
      </div>

      {isSelectionMode && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-background text-foreground px-4 sm:px-6 py-3 rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] flex items-center gap-3 sm:gap-4 z-50 animate-in slide-in-from-bottom-8 border border-border w-[95%] sm:w-auto overflow-x-auto">
              <Button variant="ghost" size="sm" className="h-10 sm:h-8 shrink-0 hover:bg-muted text-muted-foreground font-medium" onClick={() => {
                  if (selectedRequests.size === cancellableRequests.length && cancellableRequests.length > 0) setSelectedRequests(new Set());
                  else setSelectedRequests(new Set(cancellableRequests.map(r => r.id)));
              }}>
                  {selectedRequests.size === cancellableRequests.length && cancellableRequests.length > 0 ? "Deselect All" : "Select All"}
              </Button>
              <div className="h-5 w-px bg-border shrink-0" />
              <span aria-live="polite" className="font-black whitespace-nowrap min-w-[60px] sm:min-w-[100px] text-center text-sm sm:text-base shrink-0">{selectedRequests.size} Selected</span>
              
              <div className="flex gap-2 shrink-0">
                <Button aria-label="Cancel selected requests" size="sm" variant="destructive" className={`h-10 sm:h-8 shadow-sm font-bold transition-all`} disabled={selectedRequests.size === 0 || isBulkCancelling} onClick={handleBulkCancel}>
                    {isBulkCancelling ? <Loader2 className="w-4 h-4 sm:mr-2 animate-spin" /> : <XCircle className="w-4 h-4 sm:mr-2" />} <span className="hidden sm:inline">Cancel Selected</span>
                </Button>
              </div>
          </div>
      )}

      {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border pt-6 mt-6 pb-20">
              <p className="text-sm text-muted-foreground hidden sm:block">
                  Showing {(page - 1) * limit + 1} to {Math.min(page * limit, filteredRequests.length)} of {filteredRequests.length} requests
              </p>
              
              <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
                  <div className="flex items-center gap-2">
                    <Select value={pageSize} onValueChange={setPageSize}>
                      <SelectTrigger className="w-[110px] h-9 bg-background border-border text-xs">
                        <div className="flex items-center gap-2">
                          <List className="w-3 h-3 text-muted-foreground" />
                          <SelectValue placeholder="Show 5" />
                        </div>
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="5" className="cursor-pointer focus:bg-primary/10 focus:text-primary">5 per page</SelectItem>
                        <SelectItem value="10" className="cursor-pointer focus:bg-primary/10 focus:text-primary">10 per page</SelectItem>
                        <SelectItem value="25" className="cursor-pointer focus:bg-primary/10 focus:text-primary">25 per page</SelectItem>
                        <SelectItem value="50" className="cursor-pointer focus:bg-primary/10 focus:text-primary">50 per page</SelectItem>
                        <SelectItem value="100" className="cursor-pointer focus:bg-primary/10 focus:text-primary">100 per page</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="border-border hover:bg-muted text-foreground">
                          <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="border-border hover:bg-muted text-foreground">
                          Next <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                  </div>
              </div>
          </div>
      )}
    </div>
  )
}