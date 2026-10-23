// src/components/request-search.tsx
"use client"

import { useRouter } from "next/navigation"
import { searchKind, SEARCH_KIND_LABEL, type SearchKind } from "@/lib/search-kind"
import { Chip } from "@/components/list-cards"
import { useState, useEffect, useMemo } from "react"
import { useSession } from "next-auth/react"
import { AllSources, BatcaveButton, GetComicsButton, RequestIconButton } from "@/components/batcave-button" 
import { Search, Loader2, X, Plus, Calendar, Info, Layers, ChevronLeft, Download, CheckCircle2, Clock, Globe, PenTool, Paintbrush, Users, Image as ImageIcon, Activity, Library, FileCheck, Tags, BookMarked, Shield, MapPin, ExternalLink } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { useLibraryOwnership } from "@/hooks/use-library-ownership"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import Link from "next/link"
import { InteractiveSearchModal } from "./interactive-search-modal"
import { cn } from "@/lib/utils"

interface SearchResult {
  id: number;
  name: string;
  year: string;
  publisher: string;
  image: string;
  description: string;
  count: number;
  siteUrl?: string;
  writers?: string[];
  artists?: string[];
  coverArtists?: string[];
  colorists?: string[];
  letterers?: string[];
  characters?: string[];
  genres?: string[];
  storyArcs?: string[];
  teams?: string[];
  locations?: string[];
  metadataSource?: string;
}

interface Issue {
  id: number;
  name: string;
  issueNumber: string;
  year: string;
  image: string;
  description?: string; 
  writers?: string[];
  artists?: string[];
  coverArtists?: string[];
  colorists?: string[];
  letterers?: string[];
  characters?: string[];
  genres?: string[];
  storyArcs?: string[];
  teams?: string[];
  locations?: string[];
  isReleased?: boolean;
}


// variant "header": a search icon in the site header (fork) — same results dialog, the input in a small dialog
// variant "find": a small "Find" button that searches for `query` right away (reading list: series not in the library)
export function RequestSearch({ variant = 'home', query }: { variant?: 'home' | 'header' | 'find', query?: string } = {}) {
  const router = useRouter()
  const [askOpen, setAskOpen] = useState(false)
  const { data: session } = useSession()
  // Admins, or users granted the Request permission, may make requests. Civilians cannot.
  const canRequest = (session?.user as any)?.role === 'ADMIN' || !!(session?.user as any)?.canRequest
  const [open, setOpen] = useState(false)
  const [homeQuery, setHomeQuery] = useState("")
  const [searchSort, setSearchSort] = useState("relevance")
  const [interactiveQuery, setInteractiveQuery] = useState<{ query: string, type: 'volume' | 'issue' } | null>(null)
  
  const [monitorPrompt, setMonitorPrompt] = useState<{ id: number, name: string, image: string, year: string, publisher: string, metadataSource?: string } | null>(null);
  
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  
  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreSearch, setHasMoreSearch] = useState(false);
  const [isSearchingMore, setIsSearchingMore] = useState(false);

  const [selectedItem, setSelectedItem] = useState<any>(null)
  const [volumeIssues, setVolumeIssues] = useState<Issue[]>([])
  
  const [requestingTarget, setRequestingTarget] = useState<string | null>(null)
  // Library ownership + request status, shared with the Discover grid (see useLibraryOwnership).
  const { getVolumeStatus, getIssueStatus, setMonitoredSeries, setRequestedVolumes, setRequestedIssues, setActiveRequests } = useLibraryOwnership();

  const { toast } = useToast()

  // Fork: the opened series' library folder (owned or subscribed), for "Open series"
  const [seriesPath, setSeriesPath] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const lookupPath = async (volumeId: number | string): Promise<string | null> => {
      const d: { path?: string | null } = await fetch(`/api/library/series-path?id=${encodeURIComponent(String(volumeId))}`).then(r => r.ok ? r.json() : {}).catch(() => ({}))
      return d.path || null
  }
  useEffect(() => {
      setSeriesPath(null)
      if (selectedItem?.volumeId) lookupPath(selectedItem.volumeId).then(setSeriesPath)
  }, [selectedItem?.volumeId])
  const openSeries = (path: string) => { setOpen(false); router.push(`/library/series?path=${encodeURIComponent(path)}`) }
  const subscribeAndOpen = async () => {
      setOpening(true)
      await handleRequest(selectedItem.volumeId, seriesBaseName, selectedItem.image, selectedItem.year, 'volume', selectedItem.publisher || 'Unknown', true, undefined, true, selectedItem.metadataSource || 'COMICVINE')
      // the series row is written with the request; a moment later at most
      for (let i = 0; i < 6; i++) {
          const path = await lookupPath(selectedItem.volumeId)
          if (path) { setOpening(false); return openSeries(path) }
          await new Promise(res => setTimeout(res, 1000))
      }
      setOpening(false)
      toast({ title: "Subscribed", description: "The series isn't in the library yet — it shows up there after the next scan." })
  }

  const performSearch = async (e?: React.FormEvent, isLoadMore = false, forQuery?: string) => {
    if (e) e.preventDefault();
    const q = forQuery ?? homeQuery;
    if (q.trim().length < 2) return;

    const nextPage = isLoadMore ? searchPage + 1 : 1;

    if (!isLoadMore) {
        setOpen(true); 
        setLoading(true); 
        setSelectedItem(null);
        setResults([]); // <-- ADD THIS LINE to instantly clear the old results
    } else {
        setIsSearchingMore(true);
    }

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${nextPage}&_t=${Date.now()}`)
      const data = await res.json()
      
      if (isLoadMore) {
          setResults(prev => [...prev, ...(data.results || [])]);
      } else {
          setResults(data.results || []);
      }
      
      setHasMoreSearch(data.hasMore || false);
      setSearchPage(nextPage);
    } catch (e) {
      toast({ title: "Search failed", variant: "destructive" });
    } finally { 
      setLoading(false);
      setIsSearchingMore(false);
    }
  }

  // Fork: results by kind (series / annuals / collected / one-shots), filterable with chips above the grid
  const [kindFilter, setKindFilter] = useState<SearchKind | 'all'>('all');
  const kindCounts = useMemo(() => {
      const m = new Map<SearchKind, number>();
      for (const r of results) m.set(searchKind(r), (m.get(searchKind(r)) || 0) + 1);
      return m;
  }, [results]);
  useEffect(() => { setKindFilter('all'); }, [homeQuery]);

  const sortedResults = useMemo(() => {
      const sorted = results.filter(r => kindFilter === 'all' || searchKind(r) === kindFilter);
      if (searchSort === 'year_desc') sorted.sort((a, b) => parseInt(b.year || '0') - parseInt(a.year || '0'));
      if (searchSort === 'year_asc') sorted.sort((a, b) => parseInt(a.year || '0') - parseInt(b.year || '0'));
      if (searchSort === 'name_asc') sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      if (searchSort === 'name_desc') sorted.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
      if (searchSort === 'issues_desc') sorted.sort((a, b) => (b.count || 0) - (a.count || 0));
      return sorted;
  }, [results, searchSort, kindFilter]);

  const handleSelectSearchResult = async (item: SearchResult) => {
      setLoading(true);
      try {
          const res = await fetch(`/api/series-issues?volumeId=${item.id}&provider=${item.metadataSource || 'COMICVINE'}&_t=${Date.now()}`);
          const data = await res.json();
          const issues = data.results || [];
          
          const sortedDesc = [...issues].sort((a: Issue, b: Issue) => (parseFloat(b.issueNumber) || 0) - (parseFloat(a.issueNumber) || 0));
          setVolumeIssues(sortedDesc);
          
          const firstIssue = [...issues].sort((a: Issue, b: Issue) => (parseFloat(a.issueNumber) || 0) - (parseFloat(b.issueNumber) || 0))[0];
          
          if (firstIssue) {
              setSelectedItem({
                  ...firstIssue,
                  volumeId: item.id,
                  publisher: item.publisher,
                  metadataSource: item.metadataSource || 'COMICVINE',
                  isVolume: false 
              });
          } else {
              setSelectedItem({ ...item, volumeId: item.id, metadataSource: item.metadataSource || 'COMICVINE', isVolume: true });
          }
      } catch (e) {
          setVolumeIssues([]);
          setSelectedItem({ ...item, volumeId: item.id, metadataSource: item.metadataSource || 'COMICVINE', isVolume: true });
      } finally {
          setLoading(false);
      }
  }

  useEffect(() => {
    if (!selectedItem?.id) return;
    const itemType = selectedItem.isVolume ? 'volume' : 'issue';
    
    fetch(`/api/issue-details?id=${selectedItem.id}&type=${itemType}&volId=${selectedItem.volumeId || ''}&provider=${selectedItem.metadataSource || 'COMICVINE'}&_t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) {
          setSelectedItem((prev: any) => {
            if (String(prev?.id) !== String(data.id)) return prev; 
            return {
                ...prev,
                ...data,
                name: data.name || prev?.name,
                publisher: (data.publisher && data.publisher !== 'Unknown') ? data.publisher : prev?.publisher,
                year: (data.year && data.year !== '????') ? data.year : prev?.year,
                image: data.image || prev?.image,
                description: data.description?.trim() ? data.description : prev?.description
            };
          });
        }
      });
  }, [selectedItem?.id, selectedItem?.isVolume]);

  const handleRequest = async (id: number, name: string, image: string, year: string, type: 'volume' | 'issue', publisher: string, monitored: boolean = false, issueNumber?: string, monitorOnly: boolean = false, metadataSource: string = 'COMICVINE', directSource?: 'getcomics') => {
    if (!canRequest) {
        toast({ title: "Requests not enabled", description: "Ask an admin to grant you the Request permission.", variant: "destructive" });
        return;
    }
    if (!name || name === "Unknown" || name === "undefined") {
        toast({ title: "Request Failed", description: "Missing valid series name. Try interactive search.", variant: "destructive" });
        return;
    }

    const exactIssueName = (type === 'issue' && issueNumber && !name.includes(`#${issueNumber}`)) ? `${name} #${issueNumber}` : name;
    const targetKey = type === 'volume' ? `vol-${id}` : `iss-${exactIssueName}`;
    
    setRequestingTarget(targetKey);
    try {
      const res = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            cvId: id, 
            name: exactIssueName, 
            year, 
            publisher: publisher || "Unknown", 
            image, 
            type, 
            monitored,
            issueNumber: issueNumber || (type === 'issue' ? "1" : undefined),
            monitorOnly,
            metadataSource,
            directSource
        })
      });

      if (res.ok) {
        const data = await res.json();
        toast({ title: "Success", description: data.message || `${exactIssueName} added to queue.` })
        if (type === 'volume') {
            if (monitorOnly) {
                setMonitoredSeries(prev => new Set(prev).add(String(id))); 
            } else {
                setRequestedVolumes(prev => new Set(prev).add(String(id))); 
                setOpen(false); 
            }
        } else {
            setRequestedIssues(prev => new Set(prev).add(exactIssueName));
            setActiveRequests(prev => [
                ...prev, 
                { 
                    volumeId: id.toString(), 
                    name: exactIssueName, 
                    status: (session?.user as any)?.role === 'ADMIN' ? 'PENDING' : 'PENDING_APPROVAL' 
                }
            ]);
        }
      }
    } finally { setRequestingTarget(null) }
  }

  const getDisplayDescription = () => {
    if (selectedItem?.description?.trim() && selectedItem.description !== "No description available.") {
        return selectedItem.description;
    }
    if (volumeIssues && volumeIssues.length > 0) {
      const sortedCv = [...volumeIssues].sort((a, b) => {
        const numA = parseFloat(a.issueNumber || "9999");
        const numB = parseFloat(b.issueNumber || "9999");
        return numA - numB;
      });
      const fallback = sortedCv.find(cv => cv.description?.trim() && cv.description !== "No description available.");
      if (fallback) return fallback.description;
    }
    return null;
  };

  const displayDescription = getDisplayDescription();
  const hasCreators = selectedItem && (
    (selectedItem.writers?.length ?? 0) > 0 || 
    (selectedItem.artists?.length ?? 0) > 0 ||
    (selectedItem.coverArtists?.length ?? 0) > 0 ||
    (selectedItem.colorists?.length ?? 0) > 0 ||
    (selectedItem.letterers?.length ?? 0) > 0
  );
  
  const seriesBaseName = selectedItem?.volumeName || (selectedItem?.name ? selectedItem.name.split(' #')[0] : "Unknown");

 const searchForm = (
      <form 
        onSubmit={(e) => { setAskOpen(false); performSearch(e) }} 
        className="flex items-center gap-2 p-1 bg-background rounded-xl shadow-lg border border-border transition-colors duration-300"
      >
        <div className="relative flex-1 h-12">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input 
 autoFocus={variant === 'header'}
            placeholder="Search for a comic series..." 
            className="pl-11 h-full border-none bg-transparent focus-visible:ring-0 text-lg text-foreground placeholder:text-muted-foreground" 
            value={homeQuery} 
            onChange={(e) => setHomeQuery(e.target.value)} 
          />
        </div>
        <Button type="submit" className="h-12 px-8 rounded-lg font-bold">Search</Button>
      </form>
 )

  return (
    <div className={variant !== 'home' ? "contents" : "w-full max-w-2xl mx-auto transition-colors duration-300"}>
      {variant === 'find' ? (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] font-bold uppercase text-primary hover:bg-primary/10 shrink-0"
          onClick={() => { setHomeQuery(query || ''); performSearch(undefined, false, query || '') }}>
          <Search className="w-3.5 h-3.5 mr-1" /> Find
        </Button>
      ) : variant === 'header' ? (
        <>
          <Button variant="ghost" size="icon" aria-label="Search comics" className="rounded-full" onClick={() => setAskOpen(true)}>
            <Search className="h-5 w-5 text-muted-foreground" />
          </Button>
          <Dialog open={askOpen} onOpenChange={setAskOpen}>
            <DialogContent className="sm:max-w-2xl w-[95%] p-3 bg-transparent border-none shadow-none [&>button]:hidden">
              <DialogTitle className="sr-only">Search comics</DialogTitle>
              {searchForm}
            </DialogContent>
          </Dialog>
        </>
      ) : searchForm}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 border-none shadow-2xl [&>button]:hidden bg-background">
          <div className="p-4 border-b border-border bg-muted/30 flex flex-col sm:flex-row items-start sm:items-center justify-between z-10 transition-colors duration-300 gap-4">
            <div className="flex items-center gap-2">
              {selectedItem && (<Button variant="ghost" size="sm" onClick={() => setSelectedItem(null)} className="mr-2 -ml-2 text-foreground"><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>)}
              <DialogTitle className="text-xl font-bold truncate max-w-md text-foreground">{selectedItem ? selectedItem.name : `Results for "${homeQuery}"`}</DialogTitle>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>
            {!selectedItem && sortedResults.length > 0 && (
                <div className="flex items-center gap-2">
                    <Select value={searchSort} onValueChange={setSearchSort}>
                        <SelectTrigger className="w-[150px] shrink-0 h-9 bg-background"><SelectValue placeholder="Sort By" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="relevance">Relevance</SelectItem>
                            <SelectItem value="year_desc">Newest Year</SelectItem>
                            <SelectItem value="year_asc">Oldest Year</SelectItem>
                            <SelectItem value="name_asc">Name (A-Z)</SelectItem>
                            <SelectItem value="name_desc">Name (Z-A)</SelectItem>
                            <SelectItem value="issues_desc">Most Issues</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="text-foreground" onClick={() => setOpen(false)}><X className="h-5 w-5" /></Button>
                </div>
            )}
            {selectedItem && <Button variant="ghost" size="icon" className="text-foreground hidden sm:flex" onClick={() => setOpen(false)}><X className="h-5 w-5" /></Button>}
          </div>

          <div className="flex-1 overflow-y-auto p-6 bg-background transition-colors duration-300">
            {!selectedItem ? (
                <>
                {kindCounts.size > 1 && (
                    <div className="flex flex-wrap gap-2 mb-4 px-1">
                        <Chip active={kindFilter === 'all'} onClick={() => setKindFilter('all')} label="All" count={results.length} />
                        {(Object.keys(SEARCH_KIND_LABEL) as SearchKind[]).filter(k => kindCounts.has(k)).map(k => (
                            <Chip key={k} active={kindFilter === k} onClick={() => setKindFilter(k)} label={SEARCH_KIND_LABEL[k]} count={kindCounts.get(k)!} />
                        ))}
                    </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pb-4 px-1">
                  {sortedResults.map((item) => {
                    const volStatus = getVolumeStatus(item.id);
                    return (
                    <div key={item.id} className="cursor-pointer space-y-2 group flex flex-col" onClick={() => handleSelectSearchResult(item)}>
                      
                      <div className="relative aspect-[2/3] w-full rounded-lg overflow-hidden border bg-muted shadow-md border-border transition-colors duration-300">
                        {item.image ? (
                            <img src={item.image} alt={item.name} className="absolute inset-0 w-full h-full object-contain transition-transform duration-200 ease-out group-hover:scale-105" />
                        ) : (
                            <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-muted text-muted-foreground/30">
                                <ImageIcon className="w-10 h-10 mb-2" />
                            </div>
                        )}
                        
                        {searchKind(item) !== 'series' && (
                            <span className="absolute top-2 left-2 z-10 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/75 text-white shadow">
                                {searchKind(item) === 'collected' ? 'TPB / HC' : searchKind(item) === 'annual' ? 'Annual' : 'One-shot'}
                            </span>
                        )}
                        {volStatus === 'LIBRARY_MONITORED' && (<div className="absolute top-2 right-2 bg-green-500 text-white rounded-full p-1 z-10 shadow-md" title="Monitored"><Activity className="w-4 h-4" /></div>)}
                        {volStatus === 'LIBRARY_UNMONITORED' && (<div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full p-1 z-10 shadow-md" title="In Library"><Library className="w-4 h-4" /></div>)}
                        {volStatus === 'REQUESTED' && (<div className="absolute top-2 right-2 bg-orange-500 text-white rounded-full p-1 z-10 shadow-md" title="Requested"><Clock className="w-4 h-4" /></div>)}
                        {volStatus === 'PENDING_APPROVAL' && (<div className="absolute top-2 right-2 bg-yellow-500 text-white rounded-full p-1 z-10 shadow-md" title="Pending Admin Approval"><Clock className="w-4 h-4" /></div>)}
                        
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center z-20">
                          <Button size="sm" className="font-bold shadow-md">Details</Button>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-center text-center px-1">
                          <h4 className="text-xs font-black line-clamp-1 text-foreground" title={item.name}>{item.name}</h4>
                          <span className="text-[10px] font-bold text-muted-foreground line-clamp-1" title={item.publisher}>{item.publisher || "Unknown"}</span>
                          <span className="text-[9px] font-bold text-muted-foreground/80 uppercase tracking-wider mt-0.5">
                              {item.year || "????"} • {item.count || 0} Issues
                          </span>
                      </div>
                    </div>
                  )})}
                </div>
                
                {hasMoreSearch && (
                    <div className="mt-8 mb-4 flex justify-center">
                        <Button 
                            variant="secondary" 
                            onClick={() => performSearch(undefined, true)} 
                            disabled={isSearchingMore}
                            className="font-bold shadow-sm"
                        >
                            {isSearchingMore ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Load More Results
                        </Button>
                    </div>
                )}
                </>
            ) : (
              <div className="h-full flex flex-col">
                  <div className="mb-6">
                    <h2 className="text-3xl font-bold leading-tight mb-2 text-foreground">{selectedItem.name}</h2>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant="outline" className="gap-1 font-normal border-border text-muted-foreground"><Calendar className="w-3 h-3"/> {selectedItem.year}</Badge>
                      {selectedItem.publisher && selectedItem.publisher !== 'Unknown' && (
                          <span className="text-sm font-bold text-muted-foreground">{selectedItem.publisher}</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 mb-8">
                      <div className="space-y-5 flex flex-col items-center md:items-stretch">
                          <div className="relative aspect-[2/3] w-[200px] md:w-60 mx-auto rounded-lg overflow-hidden border bg-muted shadow-md border-border transition-colors duration-300">
                              {selectedItem.image ? (
                                  <img src={selectedItem.image} alt={selectedItem.name} className="absolute inset-0 w-full h-full object-contain" />
                              ) : (
                                  <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center bg-muted text-muted-foreground/30">
                                      <ImageIcon className="w-12 h-12 mb-2" />
                                  </div>
                              )}
                          </div>
                          
                          {(() => {
                              const issueTargetName = selectedItem.isVolume ? `${seriesBaseName} #${selectedItem.issueNumber || "1"}` : selectedItem.name;
    
                              const volStatus = getVolumeStatus(selectedItem.volumeId);
                              const issueStatus = getIssueStatus(selectedItem.id, selectedItem.volumeId, issueTargetName, selectedItem.isReleased, selectedItem.issueNumber, seriesBaseName);
                              
                              const isVolOwned = volStatus === 'LIBRARY_MONITORED' || volStatus === 'LIBRARY_UNMONITORED';
                              const isIssueOwned = issueStatus === 'ISSUE_OWNED';
                              const overallStatus = selectedItem.isVolume ? volStatus : issueStatus;

                              const missingAvailableIssues = volumeIssues.filter(issue => {
                                  const relIssueStatus = getIssueStatus(issue.id, selectedItem.volumeId, issue.name, issue.isReleased, issue.issueNumber, seriesBaseName);
                                  const isReleased = issue.isReleased !== false; 
                                  // #203 COLLECTED coverage: reprinted in an owned trade is not missing either.
                                  return isReleased && relIssueStatus !== 'ISSUE_OWNED' && relIssueStatus !== 'ISSUE_COVERED';
                              });
                              const isAllAvailableOwned = isVolOwned && volumeIssues.length > 0 && missingAvailableIssues.length === 0;

                              return (
                                <div className="flex flex-col gap-2.5 sm:gap-3 w-full max-w-[300px] mx-auto md:max-w-none mt-2">
                                    {/* Fork: open the whole series in the library (owned / subscribed), or subscribe and open it */}
                                    {seriesPath ? (
                                        <Button className="w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold" onClick={() => openSeries(seriesPath)}>
                                            <Library className="w-4 h-4 shrink-0" /> <span className="leading-tight">Open series</span>
                                        </Button>
                                    ) : canRequest && (
                                        <Button className="w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold" variant="secondary" disabled={opening} onClick={subscribeAndOpen}>
                                            {opening ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Library className="w-4 h-4 shrink-0" />} <span className="leading-tight">Subscribe &amp; open series</span>
                                        </Button>
                                    )}
                                    {/* VOLUME BUTTONS */}
                                    {loading ? (
                                        <Button className="w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold whitespace-normal" variant="outline" disabled>
                                            <Loader2 className="w-4 h-4 animate-spin shrink-0" /> <span className="leading-tight">Checking Library...</span>
                                        </Button>
                                    ) : volStatus === 'PENDING_APPROVAL' || volStatus === 'REQUESTED' ? (
                                        <Button className="w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold whitespace-normal" variant="default" disabled>
                                            {volStatus === 'PENDING_APPROVAL' && <><Clock className="w-4 h-4 text-yellow-500 shrink-0" /> <span className="leading-tight">Pending Approval</span></>}
                                            {volStatus === 'REQUESTED' && <><Clock className="w-4 h-4 text-orange-500 shrink-0" /> <span className="leading-tight">Requested</span></>}
                                        </Button>
                                    ) : (isAllAvailableOwned && volStatus === 'LIBRARY_MONITORED') ? (
                                        <Button className="w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold border-border hover:bg-muted text-foreground whitespace-normal" variant="outline" disabled>
                                            <FileCheck className="w-4 h-4 text-emerald-500 shrink-0" /> <span className="leading-tight">Up to Date</span>
                                        </Button>
                                    ) : (isAllAvailableOwned && volStatus === 'LIBRARY_UNMONITORED') ? (
                                        <Button 
                                            className="w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white whitespace-normal" 
                                            variant="default" 
                                            onClick={() => handleRequest(selectedItem.volumeId, seriesBaseName, selectedItem.image, selectedItem.year, 'volume', selectedItem.publisher || 'Unknown', true, undefined, true, selectedItem.metadataSource || 'COMICVINE')} 
                                            disabled={requestingTarget === `vol-${selectedItem.volumeId}`}
                                        >
                                            {requestingTarget === `vol-${selectedItem.volumeId}` ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : (
                                                <><Activity className="w-4 h-4 shrink-0" /> <span className="leading-tight text-center">Subscribe to Series</span></>
                                            )}
                                        </Button>
                                    ) : (
                                        <Button 
                                            className={cn("w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold whitespace-normal", isVolOwned && "bg-green-600 hover:bg-green-700 text-white")} 
                                            variant="default" 
                                            onClick={() => setMonitorPrompt({ id: selectedItem.volumeId, name: seriesBaseName, image: selectedItem.image, year: selectedItem.year, publisher: selectedItem.publisher || 'Unknown', metadataSource: selectedItem.metadataSource || 'COMICVINE' })} 
                                            disabled={requestingTarget === `vol-${selectedItem.volumeId}`}
                                        >
                                            {requestingTarget === `vol-${selectedItem.volumeId}` ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : (
                                                isVolOwned ? <><Download className="w-4 h-4 shrink-0" /> <span className="leading-tight text-center">Request Missing</span></> : <><Plus className="w-4 h-4 shrink-0" /> <span className="leading-tight text-center">Request Series</span></>
                                            )}
                                        </Button>
                                    )}
                                    
                                    {/* ISSUE BUTTONS */}
                                    {(isAllAvailableOwned && volStatus === 'LIBRARY_MONITORED') ? (
                                        <Button className={`w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold border-border hover:bg-muted text-foreground whitespace-normal`} variant="outline" disabled>
                                            <FileCheck className="w-4 h-4 text-emerald-500 shrink-0" /> <span className="leading-tight">Up to Date</span>
                                        </Button>
                                    ) : issueStatus === 'PENDING_APPROVAL' || issueStatus === 'REQUESTED' || issueStatus === 'UNRELEASED' || isIssueOwned ? (
                                        <Button className={`w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold border-border hover:bg-muted text-foreground whitespace-normal`} variant="outline" disabled>
                                            {isIssueOwned && <><FileCheck className="w-4 h-4 text-emerald-500 shrink-0" /> <span className="leading-tight">In Library</span></>}
                                            {issueStatus === 'PENDING_APPROVAL' && <><Clock className="w-4 h-4 text-yellow-500 shrink-0" /> <span className="leading-tight">Pending Approval</span></>}
                                            {issueStatus === 'REQUESTED' && <><Clock className="w-4 h-4 text-orange-500 shrink-0" /> <span className="leading-tight">Requested</span></>}
                                            {issueStatus === 'UNRELEASED' && <><Clock className="w-4 h-4 text-purple-500 shrink-0" /> <span className="leading-tight">Unreleased (Queued)</span></>}
                                        </Button>
                                    ) : (
                                        <Button 
                                            className="w-full gap-1.5 shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 whitespace-normal" 
                                            variant="outline" 
                                            onClick={() => handleRequest(selectedItem.volumeId, selectedItem.isVolume ? seriesBaseName : selectedItem.name, selectedItem.image, selectedItem.year, 'issue', selectedItem.publisher, false, selectedItem.issueNumber, false, selectedItem.metadataSource || 'COMICVINE')} 
                                            disabled={requestingTarget === `iss-${issueTargetName}`}
                                        >
                                            {requestingTarget === `iss-${issueTargetName}` ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <><Download className="w-4 h-4 shrink-0" /> <span className="leading-tight text-center">Request Issue</span></>}
                                        </Button>
                                    )}
                                    
                                    {selectedItem.volumeId && !(selectedItem.isVolume ? (isAllAvailableOwned && volStatus === 'LIBRARY_MONITORED') : isIssueOwned) && (
                                      <AllSources className="justify-center" label={selectedItem.isVolume ? "All" : null}>
                                        {canRequest && <GetComicsButton title={selectedItem.isVolume ? "Alle fehlenden über GetComics" : "Über GetComics laden"}
                                          onClick={() => selectedItem.isVolume
                                            ? handleRequest(selectedItem.volumeId, seriesBaseName, selectedItem.image, selectedItem.year, 'volume', selectedItem.publisher || 'Unknown', false, undefined, false, selectedItem.metadataSource || 'COMICVINE', 'getcomics')
                                            : handleRequest(selectedItem.volumeId, selectedItem.name, selectedItem.image, selectedItem.year, 'issue', selectedItem.publisher, false, selectedItem.issueNumber, false, selectedItem.metadataSource || 'COMICVINE', 'getcomics')} />}
                                        {((selectedItem as any).metadataSource || 'COMICVINE') === 'COMICVINE' && <BatcaveButton title={selectedItem.isVolume ? "Alle fehlenden über Batcave" : "Über Batcave laden"}
                                          body={selectedItem.isVolume ? { cvId: selectedItem.volumeId } : { cvId: selectedItem.volumeId, issues: [{ number: String(selectedItem.issueNumber || '1') }] }} />}
                                      </AllSources>
                                    )}
                                    <Button 
                                      variant="outline" 
                                      className="w-full gap-1.5 border-dashed shadow-sm h-auto min-h-10 py-1.5 text-sm font-bold border-border hover:bg-muted text-foreground whitespace-normal" 
                                      onClick={() => setInteractiveQuery({ query: selectedItem.isVolume ? seriesBaseName : selectedItem.name, type: selectedItem.isVolume ? 'issue' : 'volume' })}
                                      disabled={(isAllAvailableOwned && volStatus === 'LIBRARY_MONITORED') || (!selectedItem.isVolume && isIssueOwned) || overallStatus === 'PENDING_APPROVAL' || overallStatus === 'REQUESTED'}
                                    >
                                        {(isAllAvailableOwned && volStatus === 'LIBRARY_MONITORED') ? (
                                            <><FileCheck className="w-4 h-4 text-emerald-500 shrink-0" /> <span className="leading-tight">Up to Date</span></>
                                        ) : overallStatus === 'PENDING_APPROVAL' ? (
                                            <><Clock className="w-4 h-4 text-yellow-500 shrink-0" /> <span className="leading-tight">Pending Approval</span></>
                                        ) : overallStatus === 'REQUESTED' ? (
                                            <><Clock className="w-4 h-4 text-orange-500 shrink-0" /> <span className="leading-tight">Requested</span></>
                                        ) : (!selectedItem.isVolume && isIssueOwned) ? (
                                            <><FileCheck className="w-4 h-4 text-emerald-500 shrink-0" /> <span className="leading-tight">In Library</span></>
                                        ) : (
                                            <><Search className="w-4 h-4 text-primary shrink-0" /> <span className="leading-tight">Interactive Search</span></>
                                        )}
                                    </Button>
                                </div>
                              );
                          })()}

                      </div>
                      <div className="space-y-6">
                             {hasCreators && (
                                <div className="grid grid-cols-2 gap-4 bg-muted/50 p-4 rounded-lg border border-border transition-colors duration-300">
                                    {selectedItem.writers?.length > 0 && (<div><p className="text-[10px] sm:text-xs font-bold uppercase text-muted-foreground mb-1 flex items-center gap-1"><PenTool className="w-3 h-3" /> Writer</p><p className="text-sm font-medium text-foreground">{selectedItem.writers.join(", ")}</p></div>)}
                                    {selectedItem.artists?.length > 0 && (<div><p className="text-[10px] sm:text-xs font-bold uppercase text-muted-foreground mb-1 flex items-center gap-1"><Paintbrush className="w-3 h-3" /> Artist</p><p className="text-sm font-medium text-foreground">{selectedItem.artists.join(", ")}</p></div>)}
                                    {selectedItem.coverArtists?.length > 0 && (<div><p className="text-[10px] sm:text-xs font-bold uppercase text-muted-foreground mb-1 flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Cover Artist</p><p className="text-sm font-medium text-foreground">{selectedItem.coverArtists.join(", ")}</p></div>)}
                                    {selectedItem.colorists?.length > 0 && (<div><p className="text-[10px] sm:text-xs font-bold uppercase text-muted-foreground mb-1 flex items-center gap-1"><Paintbrush className="w-3 h-3" /> Colorist</p><p className="text-sm font-medium text-foreground">{selectedItem.colorists.join(", ")}</p></div>)}
                                    {selectedItem.letterers?.length > 0 && (<div><p className="text-[10px] sm:text-xs font-bold uppercase text-muted-foreground mb-1 flex items-center gap-1"><PenTool className="w-3 h-3" /> Letterer</p><p className="text-sm font-medium text-foreground">{selectedItem.letterers.join(", ")}</p></div>)}
                                </div>
                             )}

                             {selectedItem.characters && selectedItem.characters.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="font-semibold flex items-center gap-2 text-sm text-foreground"><Users className="w-4 h-4"/> Characters</h4>
                                    <div className="flex flex-wrap gap-1.5">
                                        {selectedItem.characters.map((char: string) => (
                                            <Badge key={char} variant="secondary" className="font-medium text-[10px] bg-muted text-foreground border-border hover:bg-muted/80">{char}</Badge>
                                        ))}
                                    </div>
                                </div>
                             )}

                             {selectedItem.teams && selectedItem.teams.length > 0 && (
                                <div className="space-y-2 mt-4 pt-4 border-t border-border">
                                    <h4 className="font-semibold flex items-center gap-2 text-sm text-foreground"><Shield className="w-4 h-4 text-primary"/> Teams</h4>
                                    <div className="flex flex-wrap gap-1.5">
                                        {selectedItem.teams.map((team: string) => (
                                            <Badge key={team} variant="secondary" className="font-medium text-[10px] bg-primary/5 text-primary border-primary/20 hover:bg-primary/10">{team}</Badge>
                                        ))}
                                    </div>
                                </div>
                             )}

                             {selectedItem.locations && selectedItem.locations.length > 0 && (
                                <div className="space-y-2 mt-4 pt-4 border-t border-border">
                                    <h4 className="font-semibold flex items-center gap-2 text-sm text-foreground"><MapPin className="w-4 h-4 text-primary"/> Locations</h4>
                                    <div className="flex flex-wrap gap-1.5">
                                        {selectedItem.locations.map((loc: string) => (
                                            <Badge key={loc} variant="outline" className="font-medium text-[10px] bg-background text-muted-foreground border-border">{loc}</Badge>
                                        ))}
                                    </div>
                                </div>
                             )}

                             {selectedItem.genres && selectedItem.genres.length > 0 && (
                                 <div className="space-y-2 mt-4 pt-4 border-t border-border">
                                     <h4 className="font-semibold flex items-center gap-2 text-sm text-foreground"><Tags className="w-4 h-4 text-primary"/> Concepts</h4>
                                     <div className="flex flex-wrap gap-1.5">
                                         {selectedItem.genres.map((genre: string) => (
                                             <Badge key={genre} variant="outline" className="font-medium text-[10px] bg-background text-muted-foreground border-border hover:text-foreground">{genre}</Badge>
                                         ))}
                                     </div>
                                 </div>
                             )}

                             {selectedItem.storyArcs && selectedItem.storyArcs.length > 0 && (
                                 <div className="space-y-2 mt-4 pt-4 border-t border-border">
                                     <h4 className="font-semibold flex items-center gap-2 text-sm text-foreground"><BookMarked className="w-4 h-4 text-primary"/> Story Arcs</h4>
                                     <div className="flex flex-wrap gap-1.5">
                                         {selectedItem.storyArcs.map((arc: string) => (
                                             <Badge key={arc} className="font-medium text-[10px] bg-primary/10 text-primary border-primary/30 hover:bg-primary/20">{arc}</Badge>
                                         ))}
                                     </div>
                                 </div>
                             )}

                             <div className="space-y-2">
                                <h4 className="font-semibold flex items-center gap-2 text-sm text-foreground"><Info className="w-4 h-4"/> Synopsis</h4>
                                <div className="text-sm text-muted-foreground leading-relaxed p-4 bg-muted/50 rounded-md border border-border min-h-[100px] break-words transition-colors duration-300">
                                    {displayDescription || <span className="italic opacity-70">No synopsis available.</span>}
                                </div>
                             </div>
                      </div>
                  </div>
                  <div className="space-y-4 pt-4 border-t border-border">
                      <h4 className="font-semibold flex items-center gap-2 text-base sm:text-lg text-foreground"><Layers className="w-4 h-4 sm:w-5 h-5"/> More in this Series</h4>
                      <div className="w-full">
                          {volumeIssues.length > 0 ? (
                              // Fork: a list (cover, number, title, year, status) instead of a sideways strip of covers
                              <div className="divide-y divide-border rounded-lg border border-border">
                                  {volumeIssues.map(issue => {
                                      const relIssueTargetName = issue.name;
                                      const relIssueStatus = getIssueStatus(issue.id, selectedItem.volumeId, relIssueTargetName, issue.isReleased, issue.issueNumber, seriesBaseName);
                                      const badge = relIssueStatus === 'REQUESTED' ? ['Requested', 'bg-orange-500'] : relIssueStatus === 'PENDING_APPROVAL' ? ['Pending', 'bg-yellow-500']
                                          : relIssueStatus === 'ISSUE_OWNED' ? ['In library', 'bg-emerald-500'] : relIssueStatus === 'ISSUE_COVERED' ? ['Covered', 'bg-emerald-700']
                                          : relIssueStatus === 'UNRELEASED' || (!relIssueStatus && issue.isReleased === false) ? ['Unreleased', 'bg-purple-500'] : null;
                                      return (
                                      <div
                                          key={issue.id}
                                          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50"
                                          onClick={() => {
                                              setSelectedItem({
                                                  ...issue,
                                                  volumeId: selectedItem.volumeId,
                                                  publisher: selectedItem.publisher,
                                                  issueNumber: issue.issueNumber,
                                                  description: undefined,
                                                  writers: undefined,
                                                  artists: undefined,
                                                  characters: undefined,
                                                  metadataSource: selectedItem.metadataSource || 'COMICVINE'
                                              });
                                          }}
                                      >
                                          <div className="relative w-10 h-14 shrink-0 rounded overflow-hidden bg-muted border border-border">
                                              {issue.image ? <img src={issue.image} className="absolute inset-0 w-full h-full object-cover" alt="" loading="lazy" />
                                                  : <ImageIcon className="w-4 h-4 m-auto mt-5 text-muted-foreground/40" />}
                                          </div>
                                          <span className="w-12 shrink-0 text-xs font-black text-muted-foreground">#{issue.issueNumber}</span>
                                          <div className="flex-1 min-w-0">
                                              <p className="text-sm font-bold truncate text-foreground">{issue.name}</p>
                                              <p className="text-[11px] text-muted-foreground">{issue.year || '????'}</p>
                                          </div>
                                          {badge && <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider text-white px-1.5 py-0.5 rounded ${badge[1]}`}>{badge[0]}</span>}
                                          {!relIssueStatus && (
                                              <RequestIconButton busy={requestingTarget === `iss-${relIssueTargetName}`}
                                                  onClick={() => handleRequest(selectedItem.volumeId, issue.name, issue.image, issue.year, 'issue', selectedItem.publisher, false, issue.issueNumber, false, selectedItem.metadataSource || 'COMICVINE')} />
                                          )}
                                          {canRequest && relIssueStatus !== 'ISSUE_OWNED' && relIssueStatus !== 'ISSUE_COVERED' && relIssueStatus !== 'REQUESTED' && <GetComicsButton onClick={() => handleRequest(selectedItem.volumeId, issue.name, issue.image, issue.year, 'issue', selectedItem.publisher, false, issue.issueNumber, false, selectedItem.metadataSource || 'COMICVINE', 'getcomics')} />}
                                          {relIssueStatus !== 'ISSUE_OWNED' && relIssueStatus !== 'ISSUE_COVERED' && <BatcaveButton body={{ cvId: selectedItem.volumeId, issues: [{ number: String(issue.issueNumber || '1') }] }} />}
                                      </div>
                                  )})}
                              </div>
                          ) : (<p className="text-sm text-muted-foreground">No individual issues found.</p>)}
                      </div>
                  </div>
              </div>
            )}
          </div>
          {selectedItem && (
            <div className="p-4 bg-background border-t border-border flex justify-between shrink-0 z-10 transition-colors duration-300">
                <Button variant="secondary" asChild className="h-12 sm:h-10 sm:mr-auto bg-background shadow-sm font-bold hover:bg-muted text-foreground border-border"><Link href={selectedItem.siteUrl || `https://comicvine.gamespot.com/volume/4050-${selectedItem.volumeId}/`} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 mr-2" />View on {selectedItem.siteUrl?.includes('metron') ? 'Metron' : 'ComicVine'}</Link></Button>
                <Button variant="outline" className="text-foreground" onClick={() => setOpen(false)}>Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {selectedItem && interactiveQuery && (
        <InteractiveSearchModal 
          isOpen={!!interactiveQuery} 
          onClose={() => setInteractiveQuery(null)} 
          initialQuery={interactiveQuery.query}
          comicData={{
            cvId: selectedItem.volumeId,
            year: selectedItem.year,
            publisher: selectedItem.publisher || 'Unknown',
            image: selectedItem.image,
            type: interactiveQuery.type,
            metadataSource: selectedItem.metadataSource || 'COMICVINE'
          }}
        />
      )}
      <Dialog open={!!monitorPrompt} onOpenChange={(open) => !open && setMonitorPrompt(null)}>
        <DialogContent className="sm:max-w-md bg-background border-border rounded-xl w-[95%]">
          <DialogHeader>
              <DialogTitle className="text-xl font-bold text-foreground">Monitor Series?</DialogTitle>
              <DialogDescription className="text-base text-muted-foreground mt-2">
                You are requesting the series <strong>{monitorPrompt?.name}</strong>. Would you like Omnibus to automatically monitor this series and download new issues as they are released in the future?
              </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 mt-4 sm:mt-6">
            <Button className="w-full h-12 sm:h-10 bg-primary hover:bg-primary/90 text-primary-foreground font-bold" onClick={() => {
                if (monitorPrompt) handleRequest(monitorPrompt.id, monitorPrompt.name, monitorPrompt.image, monitorPrompt.year, 'volume', monitorPrompt.publisher, true, undefined, false, monitorPrompt.metadataSource || 'COMICVINE');
                setMonitorPrompt(null);
            }}>
                Yes, Request & Monitor
            </Button>
            <Button variant="outline" className="w-full h-12 sm:h-10 font-bold border-primary/30 text-primary bg-primary/10 hover:bg-primary/20" onClick={() => {
                if (monitorPrompt) handleRequest(monitorPrompt.id, monitorPrompt.name, monitorPrompt.image, monitorPrompt.year, 'volume', monitorPrompt.publisher, false, undefined, false, monitorPrompt.metadataSource || 'COMICVINE');
                setMonitorPrompt(null);
            }}>
                No, Just Request Current Issues
            </Button>
            <Button variant="ghost" className="w-full h-12 sm:h-10 font-bold text-muted-foreground" onClick={() => setMonitorPrompt(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}