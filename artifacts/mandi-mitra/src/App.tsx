import { type FormEvent, type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  useGetCommodities, useGetStates, useGetMandis, useGetVarieties,
  useGetMarketToday, useGetMarketForecast, useCompareMandis,
  useGetAlerts, useCreateAlert, useUpdateAlert, useDeleteAlert,
  useGetProfile, useUpdateProfile, useRequestPhoneOtp, useVerifyPhoneOtp, useLogout,
  useHealthCheck, useGetAdminOverview, useGetAdminMarketRecords,
  useGetDataHealth, useCreateAdminMarketRecord, useUpdateAdminMarketRecord,
  useDeleteAdminMarketRecord, useImportAdminMarketRecords,
  getGetAlertsQueryKey, getGetProfileQueryKey, getGetAdminOverviewQueryKey,
  getGetAdminMarketRecordsQueryKey, getGetDataHealthQueryKey,
  getGetMarketTodayQueryKey, getGetMarketForecastQueryKey, getCompareMandisQueryKey,
  getGetStatesQueryKey, getGetMandisQueryKey, getGetVarietiesQueryKey,
} from '@workspace/api-client-react';
import type { AdminMarketRecord, AdminMarketRecordInput } from '@workspace/api-client-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Check, ChevronDown, CircleHelp,
  CloudSun, Compass, Leaf, LoaderCircle, LockKeyhole, MapPin, Menu, Minus, Plus,
  RefreshCw, Search, ShieldCheck, Sprout, TrendingDown, TrendingUp, UserRound, X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import AdminCatalogPanel from '@/components/admin-catalog';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
type MarketSelection = { commodityId: string; stateId: string; mandiId: string; varietyId: string };
type MarketContextValue = MarketSelection & {
  setCommodityId: (v: string) => void;
  setStateId: (v: string) => void;
  setMandiId: (v: string) => void;
  setVarietyId: (v: string) => void;
};
const MarketContext = createContext<MarketContextValue | null>(null);
function useMarket() {
  const value = useContext(MarketContext);
  if (!value) throw new Error('Market context is missing');
  return value;
}
const currency = (value?: number) => value == null ? '—' : `₹${Math.round(value).toLocaleString('en-IN')}`;
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available';
const marketCsvColumns = ['commodityId', 'mandiId', 'date', 'minimumPrice', 'maximumPrice', 'modalPrice', 'arrivals', 'arrivalUnit', 'source'] as const;
function parseMarketCsv(csv: string): { records?: AdminMarketRecordInput[]; error?: string } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (afterQuote) {
      if (char === ',' || char === '\n' || char === '\r') {
        afterQuote = false;
      } else if (char.trim() === '') {
        continue;
      } else {
        return { error: 'CSV has an unexpected character after a quoted value.' };
      }
    }
    if (char === '"') {
      if (field.trim()) return { error: 'CSV quotes must wrap a complete field.' };
      field = '';
      inQuotes = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
      if (char === '\r' && csv[index + 1] === '\n') index += 1;
    } else {
      field += char;
    }
  }
  if (inQuotes) return { error: 'CSV contains an unclosed quoted value.' };
  if (field !== '' || row.length) {
    row.push(field.trim());
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  if (rows.length < 2) return { error: 'Add a CSV header row and at least one market record.' };

  const headers = rows[0]!.map((header, index) => index === 0 ? header.replace(/^\uFEFF/, '') : header);
  if (new Set(headers).size !== headers.length || marketCsvColumns.some((column) => !headers.includes(column))) {
    return { error: `CSV needs these columns exactly once: ${marketCsvColumns.join(', ')}.` };
  }
  const positions = Object.fromEntries(marketCsvColumns.map((column) => [column, headers.indexOf(column)])) as Record<typeof marketCsvColumns[number], number>;
  const records: AdminMarketRecordInput[] = [];
  const read = (cells: string[], column: typeof marketCsvColumns[number]) => cells[positions[column]] ?? '';
  for (const [index, cells] of rows.slice(1).entries()) {
    const rowNumber = index + 2;
    if (cells.length !== headers.length) return { error: `CSV row ${rowNumber} has ${cells.length} values; expected ${headers.length}.` };
    const numberValue = (column: 'minimumPrice' | 'maximumPrice' | 'modalPrice' | 'arrivals') => {
      const value = read(cells, column);
      return value === '' ? Number.NaN : Number(value);
    };
    const date = read(cells, 'date');
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    const minimumPrice = numberValue('minimumPrice');
    const maximumPrice = numberValue('maximumPrice');
    const modalPrice = numberValue('modalPrice');
    const arrivals = numberValue('arrivals');
    const record: AdminMarketRecordInput = {
      commodityId: read(cells, 'commodityId'),
      mandiId: read(cells, 'mandiId'),
      date,
      minimumPrice,
      maximumPrice,
      modalPrice,
      arrivals,
      arrivalUnit: read(cells, 'arrivalUnit'),
      source: read(cells, 'source'),
    };
    if (!record.commodityId || !record.mandiId || !record.arrivalUnit || !record.source
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date
      || ![minimumPrice, maximumPrice, modalPrice, arrivals].every((value) => Number.isFinite(value) && value >= 0)
      || minimumPrice > modalPrice || modalPrice > maximumPrice) {
      return { error: `CSV row ${rowNumber} has missing or invalid values. Check its IDs, date, numeric fields, source, and minimum ≤ typical ≤ maximum price.` };
    }
    records.push(record);
  }
  if (records.length > 5000) return { error: 'A single import can contain at most 5,000 records.' };
  return { records };
}
function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <div className="mb-6"><div className="eyebrow mb-2">{eyebrow}</div><h1 className="display-type text-[2.1rem] font-extrabold md:text-4xl">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>;
}
function LoadingBlock({ label = 'Loading market information' }: { label?: string }) {
  return <div className="panel p-5" aria-label={label}><div className="skeleton mb-4 h-4 w-36" /><div className="skeleton mb-3 h-9 w-2/3" /><div className="skeleton h-4 w-full" /></div>;
}
function LoadError({ retry, message = 'Unable to load this information. Please check your connection and try again.' }: { retry: () => void; message?: string }) {
  return <div role="status" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900"><p>{message}</p><button onClick={retry} data-testid="button-retry" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 font-bold"><RefreshCw size={15} /> Try again</button></div>;
}
function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-secondary/50 px-5 py-8 text-center"><div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-background text-primary"><CircleHelp size={19} /></div><p className="font-bold">{title}</p><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{copy}</p></div>;
}
function Header() {
  const [path] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = [{ href: '/', label: 'Home', icon: Sprout }, { href: '/forecast', label: 'Forecast', icon: TrendingUp }, { href: '/mandis', label: 'Compare mandis', icon: Compass }, { href: '/sell', label: 'Sell advice', icon: Activity }, { href: '/alerts', label: 'Alerts', icon: Bell }];
  return <header className="app-header sticky top-0 z-40 border-b border-border">
    <div className="page-wrap flex h-[68px] items-center justify-between gap-4">
      <Link href="/" className="flex items-center gap-2.5 text-foreground no-underline" data-testid="link-brand"><span className="brand-mark"><Sprout size={22} strokeWidth={2.5} /></span><span><b className="brand-type block text-[17px] leading-none">Mandi Mitra</b><span className="text-[10px] font-semibold tracking-wide text-muted-foreground">YOUR DAILY MARKET COMPANION</span></span></Link>
      <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link flex items-center gap-2 rounded-full px-3 py-2 text-[13px] font-bold no-underline ${path === href ? 'active' : ''}`} data-testid={`link-nav-${href.replace('/', '') || 'home'}`}><Icon size={15} />{label}</Link>)}</nav>
      <div className="hidden items-center gap-2 sm:flex"><Link href="/profile" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-bold text-foreground no-underline hover:bg-secondary" data-testid="link-profile"><UserRound size={16} /> Profile</Link><Link href="/login" className="inline-flex min-h-10 items-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground no-underline hover:opacity-90" data-testid="link-login">Sign in</Link></div>
      <button onClick={() => setMobileOpen(!mobileOpen)} className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card lg:hidden" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} data-testid="button-mobile-menu">{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
    </div>
    {mobileOpen && <nav className="page-wrap grid grid-cols-2 gap-2 pb-4 lg:hidden" aria-label="Mobile navigation">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`nav-link flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold no-underline ${path === href ? 'active' : ''}`} data-testid={`mobile-link-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16} />{label}</Link>)}<Link href="/profile" onClick={() => setMobileOpen(false)} className="nav-link flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold no-underline"><UserRound size={16} />Profile</Link></nav>}
  </header>;
}
function BottomNavigation() {
  const [path] = useLocation();
  const links = [{ href: '/', label: 'Market', icon: Sprout }, { href: '/forecast', label: 'Outlook', icon: TrendingUp }, { href: '/mandis', label: 'Mandis', icon: Compass }, { href: '/profile', label: 'Profile', icon: UserRound }];
  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur lg:hidden" aria-label="Quick navigation">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`flex flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-bold no-underline ${path === href ? 'text-primary' : 'text-muted-foreground'}`} data-testid={`bottom-link-${label.toLowerCase()}`}><Icon size={19} />{label}</Link>)}</nav>;
}
function Shell({ children }: { children: ReactNode }) {
  return <><Header/><main className="page-wrap min-h-[calc(100dvh-68px)] pb-24 pt-6 md:pt-9">{children}</main><BottomNavigation/><footer className="hidden border-t border-border py-5 text-center text-xs text-muted-foreground lg:block">Mandi Mitra · Clear market information for better everyday decisions.</footer></>;
}
function MarketSelectors({ buttonLabel, onSubmit }: { buttonLabel?: string; onSubmit?: () => void }) {
  const market = useMarket();
  const commoditiesQuery = useGetCommodities();
  const commodities = commoditiesQuery.data ?? [];
  const statesQuery = useGetStates({ commodityId: market.commodityId }, { query: { enabled: !!market.commodityId, queryKey: getGetStatesQueryKey({ commodityId: market.commodityId }) } });
  const states = statesQuery.data ?? [];
  const mandisQuery = useGetMandis({ commodityId: market.commodityId, stateId: market.stateId }, { query: { enabled: !!market.commodityId && !!market.stateId, queryKey: getGetMandisQueryKey({ commodityId: market.commodityId, stateId: market.stateId }) } });
  const mandis = mandisQuery.data ?? [];
  const varietiesQuery = useGetVarieties({ commodityId: market.commodityId, mandiId: market.mandiId }, { query: { enabled: !!market.commodityId && !!market.mandiId, queryKey: getGetVarietiesQueryKey({ commodityId: market.commodityId, mandiId: market.mandiId }) } });
  const varieties = varietiesQuery.data ?? [];
  const enabledCommodities = commodities.filter((item) => item.enabled);
  const updateCommodity = (id: string) => { market.setCommodityId(id); market.setStateId(''); market.setMandiId(''); market.setVarietyId(''); };
  const updateState = (id: string) => { market.setStateId(id); market.setMandiId(''); market.setVarietyId(''); };
  const updateMandi = (id: string) => { market.setMandiId(id); market.setVarietyId(''); };
  const busy = commoditiesQuery.isLoading;
  if (commoditiesQuery.isError) return <LoadError retry={() => void commoditiesQuery.refetch()} message="Market choices could not be loaded. Please try again." />;
  return <div className="grid gap-3 sm:grid-cols-2">
    <label><span className="field-label">Commodity</span><select className="field-control" data-testid="select-commodity" value={market.commodityId} disabled={busy} onChange={(e) => updateCommodity(e.target.value)}><option value="">{busy ? 'Loading commodities…' : 'Choose a commodity'}</option>{enabledCommodities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label><span className="field-label">State</span><select className="field-control" data-testid="select-state" value={market.stateId} disabled={!market.commodityId || statesQuery.isLoading} onChange={(e) => updateState(e.target.value)}><option value="">{statesQuery.isLoading ? 'Loading states…' : 'Choose a state'}</option>{states.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}</select></label>
    <label><span className="field-label">Mandi</span><select className="field-control" data-testid="select-mandi" value={market.mandiId} disabled={!market.stateId || mandisQuery.isLoading} onChange={(e) => updateMandi(e.target.value)}><option value="">{mandisQuery.isLoading ? 'Loading mandis…' : 'Choose a nearby mandi'}</option>{mandis.map((mandi) => <option key={mandi.id} value={mandi.id}>{mandi.name}{mandi.distanceKm ? ` · ${mandi.distanceKm} km` : ''}</option>)}</select></label>
    <label><span className="field-label">Variety <span className="font-normal text-muted-foreground">(if available)</span></span><select className="field-control" data-testid="select-variety" value={market.varietyId} disabled={!market.mandiId || varietiesQuery.isLoading || varieties.length === 0} onChange={(e) => market.setVarietyId(e.target.value)}><option value="">{!market.mandiId ? 'Select a mandi first' : varietiesQuery.isLoading ? 'Checking varieties…' : varieties.length ? 'All varieties' : 'Variety not available'}</option>{varieties.map((v) => <option value={v.id} key={v.id}>{v.name}</option>)}</select></label>
    {buttonLabel && <button disabled={!market.commodityId || !market.mandiId} onClick={onSubmit} className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45 sm:col-span-2" data-testid="button-market-submit">{buttonLabel}<ArrowRight size={17}/></button>}
  </div>;
}
function MarketReadout({ compact = false }: { compact?: boolean }) {
  const market = useMarket();
  const [refresh, setRefresh] = useState(0);
  const params = { commodityId: market.commodityId, mandiId: market.mandiId, ...(market.varietyId ? { varietyId: market.varietyId } : {}) };
  const query = useGetMarketToday(params, { query: { enabled: !!market.commodityId && !!market.mandiId, queryKey: getGetMarketTodayQueryKey(params), retry: refresh === 0 ? 1 : 0 } });
  if (!market.commodityId || !market.mandiId) return <EmptyState title="Choose a market to see today's price" copy="Pick a commodity, state and mandi above. Market information is available to guests too." />;
  if (query.isLoading) return <LoadingBlock label="Today's market price loading" />;
  if (query.isError) return <LoadError retry={() => { setRefresh((v) => v + 1); void query.refetch(); }} message="Unable to load market data. Please check your internet connection and try again." />;
  if (!query.data) return <EmptyState title="Market data is currently unavailable" copy="There is no price information for this selection. Please try another mandi." />;
  const item = query.data;
  return <section className={`panel overflow-hidden ${compact ? '' : 'fade-in'}`} data-testid="market-today-card">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-5 md:px-7">
      <div><div className="eyebrow mb-1">Today's market</div><h2 className="display-type text-2xl font-extrabold">{item.commodityName}</h2><p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin size={14}/>{item.mandiName}, {item.stateName}{item.varietyName ? ` · ${item.varietyName}` : ''}</p></div>
      <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs font-bold text-secondary-foreground"><span className={`h-2 w-2 rounded-full ${item.isDemo ? 'bg-amber-500' : 'bg-emerald-600'}`}/>{item.isDemo ? 'Demo data' : 'Market update'}</div>
    </div>
    <div className="px-5 py-6 md:px-7">
      <p className="text-sm font-semibold text-muted-foreground">Typical market price</p><div className="mt-1 flex flex-wrap items-end gap-2"><strong className="data-number text-[2.8rem] font-extrabold leading-none md:text-5xl">{currency(item.modalPrice)}</strong><span className="pb-1 text-sm font-bold text-muted-foreground">/ quintal</span><span className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${item.changePercent >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{item.changePercent >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>} {Math.abs(item.changePercent).toFixed(1)}% vs yesterday</span></div>
      <div className="mt-7 grid grid-cols-2 gap-y-5 border-t border-border pt-5 sm:grid-cols-3">
        <div><p className="text-xs font-semibold text-muted-foreground">Today's lowest – highest</p><p className="mt-1 font-bold">{currency(item.minimumPrice)} – {currency(item.maximumPrice)}</p></div>
        <div><p className="text-xs font-semibold text-muted-foreground">Today's market arrival</p><p className="mt-1 font-bold">{Number(item.arrivals).toLocaleString('en-IN')} {item.arrivalUnit}</p><p className="text-xs text-muted-foreground">Quantity brought to the mandi</p></div>
        <div className="col-span-2 sm:col-span-1"><p className="text-xs font-semibold text-muted-foreground">Price movement</p><p className={`mt-1 font-bold ${item.changePercent >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>Price is {Math.abs(item.changePercent).toFixed(1)}% {item.changePercent >= 0 ? 'higher' : 'lower'} than yesterday</p></div>
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><span>Source: {item.source || 'Not provided'}</span><span>Last updated: {dateTime(item.lastUpdated)}</span></div>
    </div>
  </section>;
}

function HomePage() {
  const market = useMarket();
  const [, navigate] = useLocation();
  const [showMarket, setShowMarket] = useState(false);
  const goToResult = () => { setShowMarket(true); document.getElementById('todays-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const ready = !!market.commodityId && !!market.mandiId;
  return <div className="space-y-7">
    <section className="relative overflow-hidden rounded-[24px] bg-[#e8f0e5] px-5 py-7 md:px-10 md:py-10">
      <div className="soft-grid absolute inset-0 opacity-40" aria-hidden="true"/><div className="relative grid gap-7 md:grid-cols-[1.08fr_.92fr] md:items-center">
        <div><div className="eyebrow mb-3 flex items-center gap-2"><span className="h-px w-6 bg-primary"/>A clearer view of your market</div><h1 className="display-type max-w-xl text-[2.6rem] font-extrabold text-[#1c382b] md:text-[3.5rem]">Know today's price.<br/><span className="text-primary">Plan your next move.</span></h1><p className="mt-4 max-w-md text-[15px] leading-6 text-[#53665a]">Check mandi prices and understand the next seven days—in plain, practical language.</p><div className="mt-5 flex flex-wrap gap-3"><button onClick={() => document.getElementById('market-selection')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground" data-testid="button-choose-market">Check today's market<ArrowRight size={17}/></button><button onClick={() => navigate('/forecast')} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[#b9c9b9] bg-white/70 px-4 font-bold text-[#244834]" data-testid="button-forecast-hero">7-day outlook</button></div></div>
        <div className="relative mx-auto w-full max-w-[390px] rounded-2xl border border-[#cad9c7] bg-[#f8fbf6] p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Market at a glance</span><Leaf size={18} className="text-primary"/></div><div className="flex items-end justify-between"><div><p className="text-xs font-semibold text-muted-foreground">{ready ? 'Selected market' : 'Your market, your choice'}</p><p className="display-type mt-1 text-2xl font-extrabold text-[#244834]">{ready ? 'Ready to check' : 'Start with a mandi'}</p></div><span className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-primary"><TrendingUp size={21}/></span></div><div className="mt-5 grid grid-cols-3 gap-2 border-t border-[#dce6d9] pt-4 text-center"><div><span className="block text-lg font-extrabold text-primary">01</span><small className="text-[10px] text-muted-foreground">Choose crop</small></div><div><span className="block text-lg font-extrabold text-primary">02</span><small className="text-[10px] text-muted-foreground">Compare prices</small></div><div><span className="block text-lg font-extrabold text-primary">03</span><small className="text-[10px] text-muted-foreground">Plan ahead</small></div></div></div>
      </div>
    </section>
    <section id="market-selection" className="grid gap-5 md:grid-cols-[.82fr_1.18fr]">
       <div className="panel p-5 md:p-6"><div className="eyebrow mb-1">Start here</div><h2 className="display-type text-2xl font-extrabold">Select your market</h2><p className="mb-5 mt-2 text-sm leading-5 text-muted-foreground">Choose a crop and nearby mandi to see available market data and its source label.</p><MarketSelectors buttonLabel="Check market price" onSubmit={goToResult}/><p className="mt-3 text-xs text-muted-foreground">No account needed to check prices.</p></div>
      <div id="todays-result" className="scroll-mt-24">{showMarket || ready ? <MarketReadout/> : <div className="panel soft-grid flex min-h-[300px] flex-col items-center justify-center p-7 text-center"><div className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary"><Sprout size={25}/></div><h2 className="display-type text-2xl font-extrabold">Your market, made clearer</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Today's typical price, daily arrivals, and market outlook will appear here once you choose a mandi.</p></div>}</div>
    </section>
    {ready && <section className="grid gap-4 md:grid-cols-2"><Link href="/forecast" className="panel group flex items-center justify-between p-5 text-foreground no-underline hover:border-primary/40" data-testid="card-forecast-link"><span><span className="eyebrow">Next 7 days</span><strong className="mt-1 block text-lg">See the market outlook</strong><small className="text-muted-foreground">A simple view of expected price movement</small></span><span className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-primary group-hover:translate-x-1"><ArrowRight size={19}/></span></Link><Link href="/sell" className="panel group flex items-center justify-between p-5 text-foreground no-underline hover:border-primary/40" data-testid="card-sell-link"><span><span className="eyebrow">Make a considered choice</span><strong className="mt-1 block text-lg">Should you hold or release?</strong><small className="text-muted-foreground">Guidance based on this market's outlook</small></span><span className="grid h-11 w-11 place-items-center rounded-full bg-accent text-accent-foreground group-hover:translate-x-1"><ArrowRight size={19}/></span></Link></section>}
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-[#f1f5ed] px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-primary"><ShieldCheck size={20}/></div><div><p className="font-bold">Market information is open to everyone</p><p className="text-sm text-muted-foreground">Sign in only when you want to save preferences or manage alerts.</p></div></div><Link href="/login" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold text-primary no-underline" data-testid="link-sign-in-home">Sign in <ArrowRight size={15}/></Link></section>
  </div>;
}

function ForecastChart({ points, unit }: { points: Array<{ date: string; label: string; price: number; kind: string }>; unit: string }) {
  const min = Math.min(...points.map((p) => p.price));
  const max = Math.max(...points.map((p) => p.price));
  const range = max - min || 1;
  const coords = points.map((point, i) => ({ ...point, x: 30 + (i * 540) / Math.max(1, points.length - 1), y: 156 - ((point.price - min) / range) * 105 }));
  const actual = coords.filter((p) => p.kind === 'actual');
  const predicted = coords.filter((p) => p.kind === 'forecast');
  const line = (arr: typeof coords) => arr.map((p) => `${p.x},${p.y}`).join(' ');
  return <div className="overflow-hidden rounded-xl bg-[#f5f8f2] p-3 md:p-5"><div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold text-muted-foreground"><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-primary"/>Actual price</span><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#d79d43]"/>Forecast price</span><span className="ml-auto">{unit || 'per quintal'}</span></div><svg viewBox="0 0 600 205" className="h-[205px] w-full" role="img" aria-label="Price outlook line chart"><line x1="30" x2="570" y1="51" y2="51" stroke="#dce5d9" strokeDasharray="4 5"/><line x1="30" x2="570" y1="103" y2="103" stroke="#dce5d9" strokeDasharray="4 5"/><line x1="30" x2="570" y1="156" y2="156" stroke="#dce5d9" strokeDasharray="4 5"/>{actual.length > 1 && <polyline points={line(actual)} fill="none" stroke="#286344" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>}{predicted.length && actual.length ? <polyline points={`${actual[actual.length - 1].x},${actual[actual.length - 1].y} ${line(predicted)}`} fill="none" stroke="#d79d43" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 6"/> : null}{coords.map((p) => <g key={`${p.date}-${p.kind}`}><circle cx={p.x} cy={p.y} r="5" fill={p.kind === 'actual' ? '#286344' : '#d79d43'} stroke="#f5f8f2" strokeWidth="2"/><text x={p.x} y="185" textAnchor="middle" fontSize="10" fill="#65766a">{p.label}</text><text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="10" fontWeight="700" fill="#294a36">{currency(p.price)}</text></g>)}</svg></div>;
}
function ForecastPage() {
  const market = useMarket();
  const params = { commodityId: market.commodityId, mandiId: market.mandiId, ...(market.varietyId ? { varietyId: market.varietyId } : {}) };
  const query = useGetMarketForecast(params, { query: { enabled: !!market.commodityId && !!market.mandiId, queryKey: getGetMarketForecastQueryKey(params) } });
  return <div className="space-y-6"><PageTitle eyebrow="Market outlook" title="The next seven days" description="A straightforward outlook to help you plan. Forecasts are estimates, not guaranteed prices."/><div className="panel p-5 md:p-6"><div className="mb-4 flex items-start justify-between gap-4"><div><h2 className="text-lg font-extrabold">Choose a market</h2><p className="text-sm text-muted-foreground">Select where and what you want to check.</p></div><CloudSun className="text-primary" size={23}/></div><MarketSelectors/></div>{!market.mandiId ? <EmptyState title="Select a mandi to see its outlook" copy="Choose a commodity, state and mandi above. You can explore market information without signing in."/> : query.isLoading ? <LoadingBlock label="Forecast loading"/> : query.isError ? <LoadError retry={() => void query.refetch()} message="The 7-day forecast is currently unavailable. Please check again later."/> : !query.data || query.data.points.length === 0 ? <EmptyState title="7-day forecast is currently unavailable" copy="There is no outlook available for this market right now. Please check again later."/> : <section className="panel p-5 md:p-7" data-testid="forecast-result"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Price outlook</div><h2 className="display-type mt-1 text-2xl font-extrabold">{query.data.commodityName} at {query.data.mandiName}</h2></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${query.data.isDemo || query.data.modelStatus === 'demo' ? 'bg-amber-50 text-amber-800' : 'bg-secondary text-secondary-foreground'}`}>{query.data.isDemo || query.data.modelStatus === 'demo' ? 'Demo forecast' : query.data.modelStatus === 'live' ? 'Current forecast' : 'Forecast status unavailable'}</span></div><div className="mt-5"><ForecastChart points={query.data.points} unit={`₹ / ${query.data.unit || 'quintal'}`}/></div><div className="mt-5 grid gap-4 sm:grid-cols-3"><div className="rounded-xl bg-secondary/60 p-4"><p className="text-xs font-bold text-muted-foreground">Expected after 7 days</p><p className="data-number mt-1 text-2xl font-extrabold">{currency(query.data.expectedPrice)}<span className="ml-1 text-xs font-bold text-muted-foreground">/ qtl</span></p></div><div className="rounded-xl bg-secondary/60 p-4"><p className="text-xs font-bold text-muted-foreground">Expected change</p><p className={`data-number mt-1 text-2xl font-extrabold ${query.data.expectedChangePercent >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>{query.data.expectedChangePercent >= 0 ? '+' : ''}{query.data.expectedChangePercent.toFixed(1)}%</p></div><div className="rounded-xl bg-secondary/60 p-4"><p className="text-xs font-bold text-muted-foreground">Forecast confidence</p><p className="mt-1 text-2xl font-extrabold">{query.data.confidence || 'Not available'}</p></div></div><div className="mt-4 rounded-xl border border-border p-4"><p className="font-bold">What does this mean?</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{query.data.reason || `Prices are expected to ${query.data.expectedChangePercent > 0 ? 'increase' : query.data.expectedChangePercent < 0 ? 'decrease' : 'stay close to'} the current level over the next seven days.`}</p></div></section>}</div>;
}
function MandiPage() {
  const market = useMarket();
  const [quantity, setQuantity] = useState('10');
  const qty = Math.max(1, Math.min(100000, Number(quantity) || 1));
  const params = { commodityId: market.commodityId, stateId: market.stateId, mandiId: market.mandiId, quantityQtl: qty };
  const query = useCompareMandis(params, { query: { enabled: !!market.commodityId && !!market.stateId && !!market.mandiId, queryKey: getCompareMandisQueryKey(params) } });
  return <div className="space-y-6"><PageTitle eyebrow="Make a better trip" title="Compare nearby mandis" description="See the expected price after estimated transport costs. Compare the amount you plan to take."/><div className="panel p-5 md:p-6"><div className="mb-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><Compass size={20}/></div><div><h2 className="font-extrabold">Your market area</h2><p className="text-sm text-muted-foreground">Choose a starting mandi to compare with nearby options.</p></div></div><MarketSelectors/><label className="mt-4 block max-w-xs"><span className="field-label">Quantity to compare (quintals)</span><input className="field-control" type="number" min="1" max="100000" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-quantity" /></label></div>{!market.mandiId ? <EmptyState title="Choose a mandi to compare" copy="Market choices will show nearby markets for your selected commodity and state."/> : query.isLoading ? <LoadingBlock label="Nearby mandi comparison loading"/> : query.isError ? <LoadError retry={() => void query.refetch()} message="Nearby market comparisons could not be loaded."/> : !query.data?.length ? <EmptyState title="No comparison available" copy="There are no nearby mandi prices for this selection right now."/> : <section className="space-y-3" data-testid="comparison-list"><div className="flex items-end justify-between gap-3"><div><div className="eyebrow">Estimated return</div><h2 className="display-type text-2xl font-extrabold">{qty.toLocaleString('en-IN')} quintals</h2></div><span className="text-xs text-muted-foreground">After estimated transport</span></div>{query.data.map((item) => <article className={`panel flex flex-wrap items-center justify-between gap-4 p-4 md:px-5 ${item.isBestOption ? 'border-primary/50 bg-[#f4f8f0]' : ''}`} key={item.mandiId} data-testid={`comparison-${item.mandiId}`}><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-primary"><MapPin size={18}/></span><div><div className="flex flex-wrap items-center gap-2 font-extrabold">{item.mandiName}{item.isBestOption && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">Best net return</span>}</div><p className="mt-1 text-xs text-muted-foreground">{item.distanceKm} km away · Transport {currency(item.transportCostPerQtl)}/qtl{item.isDemo ? ' · Demo data' : ''}</p></div></div><div className="ml-auto text-right"><p className="text-xs text-muted-foreground">Net return / quintal</p><strong className="data-number text-xl">{currency(item.netReturnPerQtl)}</strong><p className="text-xs text-muted-foreground">Estimated total {currency(item.netReturnPerQtl * qty)}</p></div></article>)}</section>}<p className="rounded-xl bg-accent/60 px-4 py-3 text-xs leading-5 text-accent-foreground">Transport estimates are indicative. Check actual transport costs and market conditions before making a trip.</p></div>;
}
function SellPage() {
  const market = useMarket();
  const params = { commodityId: market.commodityId, mandiId: market.mandiId, ...(market.varietyId ? { varietyId: market.varietyId } : {}) };
  const query = useGetMarketForecast(params, { query: { enabled: !!market.commodityId && !!market.mandiId, queryKey: getGetMarketForecastQueryKey(params) } });
  const forecast = query.data;
  const recommendation = forecast?.recommendation ?? 'WAIT';
  const styles = recommendation === 'HOLD' ? { bg: 'bg-[#eaf3e8]', text: 'text-[#245939]', line: 'border-[#c6ddc4]', Icon: TrendingUp, title: 'Holding may be worth considering' } : recommendation === 'RELEASE' ? { bg: 'bg-[#fbefeb]', text: 'text-[#833f34]', line: 'border-[#e8ccc3]', Icon: TrendingDown, title: 'Consider releasing your produce' } : { bg: 'bg-[#f5f1e7]', text: 'text-[#725c28]', line: 'border-[#e8ddb9]', Icon: Minus, title: 'Wait and check again' };
  return <div className="space-y-6"><PageTitle eyebrow="A considered next step" title="Should you hold or release?" description="A simple view of the market outlook to support your decision—not make it for you."/><div className="panel p-5 md:p-6"><div className="mb-4"><h2 className="font-extrabold">Choose your market</h2><p className="text-sm text-muted-foreground">Guidance is based on the selected crop and mandi.</p></div><MarketSelectors/></div>{!market.mandiId ? <EmptyState title="Choose a mandi for guidance" copy="Select a market to see its current outlook and recommendation."/> : query.isLoading ? <LoadingBlock label="Recommendation loading"/> : query.isError ? <LoadError retry={() => void query.refetch()} message="Market guidance is currently unavailable. Please check again later."/> : !forecast ? <EmptyState title="No guidance available" copy="A recommendation is not available for this market at the moment."/> : <><section className={`panel border p-5 md:p-8 ${styles.bg} ${styles.line}`} data-testid="sell-guidance"><div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-xl"><span className={`inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs font-extrabold tracking-wide ${styles.text}`}><styles.Icon size={15}/>{recommendation === 'RELEASE' ? 'RELEASE' : recommendation}</span><h2 className={`display-type mt-4 text-3xl font-extrabold md:text-4xl ${styles.text}`}>{styles.title}</h2><p className="mt-3 text-sm leading-6 text-foreground/80">{forecast.reason || (recommendation === 'HOLD' ? 'Prices are expected to rise over the next seven days.' : recommendation === 'RELEASE' ? 'Prices are not expected to increase significantly over the next seven days.' : 'Price movement is uncertain. We do not have enough confidence to recommend holding or selling.')}</p></div><div className="min-w-[150px] rounded-2xl bg-white/75 p-4"><p className="text-xs font-bold text-muted-foreground">Expected in 7 days</p><strong className="data-number mt-1 block text-2xl">{currency(forecast.expectedPrice)}<small className="ml-1 text-xs text-muted-foreground">/ qtl</small></strong><p className="mt-2 text-xs text-muted-foreground">Current price {currency(forecast.currentPrice)}</p></div></div><div className="mt-6 grid grid-cols-2 gap-3 border-t border-current/10 pt-5 sm:grid-cols-3"><div><p className="text-xs font-semibold text-muted-foreground">Expected change</p><p className="mt-1 font-extrabold">{forecast.expectedChangePercent >= 0 ? '+' : ''}{forecast.expectedChangePercent.toFixed(1)}%</p></div><div><p className="text-xs font-semibold text-muted-foreground">Forecast confidence</p><p className="mt-1 font-extrabold">{forecast.confidence || 'Not available'}</p></div><div className="col-span-2 sm:col-span-1"><p className="text-xs font-semibold text-muted-foreground">Forecast source</p><p className="mt-1 font-extrabold">{forecast.isDemo || forecast.modelStatus === 'demo' ? 'Demo forecast' : forecast.modelStatus === 'live' ? 'Current forecast' : 'Unavailable'}</p></div></div></section><aside className="flex gap-3 rounded-xl border border-border bg-card px-4 py-4 text-sm leading-6"><ShieldCheck className="mt-0.5 shrink-0 text-primary" size={18}/><p><strong>Market guidance, not a guarantee.</strong> Prices can change due to weather, demand, supply, transport, government policies and other market conditions. Use this information as guidance, not as a guaranteed return.</p></aside><Link href="/forecast" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 font-bold text-primary no-underline" data-testid="link-full-forecast">See the full 7-day outlook <ArrowRight size={16}/></Link></>}</div>;
}

function AlertsPage() {
  const profile = useGetProfile();
  const loggedIn = !!profile.data;
  const query = useGetAlerts({ query: { enabled: loggedIn, queryKey: getGetAlertsQueryKey(), refetchInterval: 30_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true } });
  const commoditiesQuery = useGetCommodities();
  const [createOpen, setCreateOpen] = useState(false);
  const [commodityId, setCommodityId] = useState('');
  const [mandiId, setMandiId] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [direction, setDirection] = useState<'above' | 'below'>('above');
  const [notice, setNotice] = useState('');
  const queryClient = useQueryClient();
  const createAlert = useCreateAlert({ mutation: { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetAlertsQueryKey() }); setCreateOpen(false); setNotice('Your price alert has been saved.'); } } });
  const updateAlert = useUpdateAlert({ mutation: { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetAlertsQueryKey() }) } });
  const deleteAlert = useDeleteAlert({ mutation: { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getGetAlertsQueryKey() }) } });
  const states = useGetStates({ commodityId }, { query: { enabled: !!commodityId, queryKey: getGetStatesQueryKey({ commodityId }) } });
  const [stateId, setStateId] = useState('');
  const mandis = useGetMandis({ commodityId, stateId }, { query: { enabled: !!commodityId && !!stateId, queryKey: getGetMandisQueryKey({ commodityId, stateId }) } });
  if (profile.isLoading) return <div className="space-y-5"><PageTitle eyebrow="Your price reminders" title="Price alerts"/><LoadingBlock/></div>;
  if (!loggedIn) return <div className="space-y-6"><PageTitle eyebrow="Your price reminders" title="Price alerts" description="Be notified when a market price reaches a level that matters to you."/><section className="panel flex flex-col items-center px-6 py-10 text-center"><div className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary"><LockKeyhole size={23}/></div><h2 className="display-type text-2xl font-extrabold">Sign in to manage alerts</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Price alerts are saved to your account. Sign in to create and manage them—no alerts are stored for guests.</p><Link href="/login" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground no-underline" data-testid="link-alert-signin">Sign in with your phone <ArrowRight size={16}/></Link><Link href="/" className="mt-3 text-sm font-bold text-primary underline underline-offset-4">Continue checking market prices</Link></section></div>;
  return <div className="space-y-6"><PageTitle eyebrow="Your price reminders" title="Price alerts" description="Choose a price target. We will keep your reminders linked to your account."/><div className="flex items-center justify-between gap-4"><p className="text-sm text-muted-foreground">Only you can manage your saved alerts.</p><button onClick={() => setCreateOpen(!createOpen)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-bold text-primary-foreground" data-testid="button-create-alert">{createOpen ? <X size={16}/> : <Plus size={16}/>} {createOpen ? 'Close' : 'New alert'}</button></div>
     <aside className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-950"><strong>In-app reminders only.</strong> Target status refreshes while this page is open; no background, SMS, or WhatsApp notification is sent. Demo market prices may trigger a reminder and are labeled below.</aside>
    {notice && <p role="status" className="rounded-lg bg-secondary p-3 text-sm font-semibold text-primary">{notice}</p>}
     {createOpen && <form className="panel grid gap-3 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (commodityId && mandiId && Number(targetPrice) > 0) createAlert.mutate({ data: { commodityId, mandiId, targetPrice: Number(targetPrice), direction, channel: 'app' } }); }}><div className="sm:col-span-2"><h2 className="font-extrabold">Create a price alert</h2><p className="text-sm text-muted-foreground">Set the market and price where you want a reminder.</p></div><label><span className="field-label">Commodity</span><select className="field-control" value={commodityId} onChange={(e) => { setCommodityId(e.target.value); setStateId(''); setMandiId(''); }} required data-testid="alert-select-commodity"><option value="">Choose commodity</option>{(commoditiesQuery.data ?? []).filter((c) => c.enabled).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><span className="field-label">State</span><select className="field-control" value={stateId} onChange={(e) => { setStateId(e.target.value); setMandiId(''); }} disabled={!commodityId} required data-testid="alert-select-state"><option value="">Choose state</option>{(states.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label><span className="field-label">Mandi</span><select className="field-control" value={mandiId} onChange={(e) => setMandiId(e.target.value)} disabled={!stateId} required data-testid="alert-select-mandi"><option value="">Choose mandi</option>{(mandis.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label><span className="field-label">Remind me when price goes</span><select className="field-control" value={direction} onChange={(e) => setDirection(e.target.value as 'above'|'below')} data-testid="alert-select-direction"><option value="above">Above my price</option><option value="below">Below my price</option></select></label><label><span className="field-label">Target price per quintal</span><input className="field-control" type="number" min="1" step="1" required value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} placeholder="Enter amount in rupees" data-testid="alert-input-price"/></label><p className="self-center text-sm text-muted-foreground">Reminder type: in app</p><div className="sm:col-span-2"><button disabled={createAlert.isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground disabled:opacity-60" data-testid="button-save-alert">{createAlert.isPending && <LoaderCircle size={16} className="animate-spin"/>}Save price alert</button>{createAlert.isError && <p className="mt-2 text-sm text-destructive">Could not save this alert. Please check the details and try again.</p>}</div></form>}
     {query.isLoading ? <LoadingBlock label="Alerts loading"/> : query.isError ? <LoadError retry={() => void query.refetch()} message="Your alerts could not be loaded."/> : !query.data?.length ? <EmptyState title="No price alerts yet" copy="Create a reminder for a price level you want to keep an eye on."/> : <div className="space-y-3">{query.data.map((alert) => <article className="panel flex flex-wrap items-center justify-between gap-4 p-4 md:p-5" key={alert.id} data-testid={`alert-${alert.id}`}><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><Bell size={18}/></div><div><p className="font-extrabold">{alert.commodityName} · {alert.mandiName}</p><p className="mt-1 text-sm text-muted-foreground">Remind when price goes {alert.direction} <strong className="text-foreground">{currency(alert.targetPrice)}/qtl</strong> · In app</p><p className="mt-1 text-xs text-muted-foreground">Current price {currency(alert.currentPrice)}/qtl{alert.priceDataIsDemo ? ' · Demo price' : alert.currentPrice !== null ? ' · Market update' : ''}</p></div></div><div className="ml-auto flex flex-wrap items-center justify-end gap-2"><span className={`rounded-lg px-3 py-2 text-xs font-bold ${alert.targetReached ? 'bg-emerald-100 text-emerald-900' : alert.active ? 'bg-secondary text-secondary-foreground' : 'border border-border text-muted-foreground'}`} role="status">{alert.targetReached ? 'Target reached' : alert.active ? 'Watching' : 'Paused'}</span><button onClick={() => updateAlert.mutate({ alertId: alert.id, data: { active: !alert.active } })} className={`min-h-10 rounded-lg px-3 text-sm font-bold ${alert.active ? 'bg-secondary text-primary' : 'border border-border text-muted-foreground'}`} data-testid={`button-toggle-alert-${alert.id}`}>{alert.active ? 'Pause' : 'Resume'}</button><button onClick={() => { if (window.confirm('Delete this price alert?')) deleteAlert.mutate({ alertId: alert.id }); }} className="min-h-10 rounded-lg border border-border px-3 text-sm font-bold text-destructive" data-testid={`button-delete-alert-${alert.id}`}>Delete</button></div></article>)}</div>}</div>;
}

function ProfilePage() {
  const query = useGetProfile();
  const commodities = useGetCommodities();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const logout = useLogout({ mutation: { onSuccess: () => { queryClient.clear(); navigate('/'); } } });
  const update = useUpdateProfile({ mutation: { onSuccess: (profile) => { queryClient.setQueryData(getGetProfileQueryKey(), profile); } } });
  const [name, setName] = useState('');
  const [commodityId, setCommodityId] = useState('');
  const [mandiId, setMandiId] = useState('');
  const [stateId, setStateId] = useState('');
  const [role, setRole] = useState<'farmer'|'trader'|'admin'>('farmer');
  const states = useGetStates({ commodityId }, { query: { enabled: !!commodityId, queryKey: getGetStatesQueryKey({ commodityId }) } });
  const mandis = useGetMandis({ commodityId, stateId }, { query: { enabled: !!commodityId && !!stateId, queryKey: getGetMandisQueryKey({ commodityId, stateId }) } });
  useEffect(() => {
    if (!query.data) return;
    setName(query.data.name ?? '');
    setCommodityId(query.data.preferredCommodityId ?? '');
    setMandiId(query.data.preferredMandiId ?? '');
    setStateId(query.data.preferredStateId ?? '');
    setRole(query.data.role);
  }, [query.data]);
  if (query.isLoading) return <div><PageTitle eyebrow="Your account" title="Profile"/><LoadingBlock label="Profile loading"/></div>;
  if (query.isError || !query.data) return <div className="space-y-6"><PageTitle eyebrow="Your account" title="Profile"/><section className="panel px-6 py-8 text-center"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-secondary text-primary"><UserRound size={22}/></div><h2 className="display-type text-2xl font-extrabold">Your market preferences</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Sign in with your phone to save your preferred commodity and mandi. You can still browse market prices as a guest.</p><Link href="/login" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground no-underline" data-testid="link-profile-signin">Sign in / Register <ArrowRight size={16}/></Link></section></div>;
  const profile = query.data;
  return <div className="space-y-6"><PageTitle eyebrow="Your account" title="Profile" description="Keep your usual market close at hand."/><form className="panel p-5 md:p-7" onSubmit={(e) => { e.preventDefault(); update.mutate({ data: { name: name.trim(), preferredCommodityId: commodityId || null, preferredMandiId: mandiId || null, ...(profile.role === 'admin' ? {} : { role: role === 'admin' ? 'farmer' : role }) } }); }}><div className="mb-5 flex items-center gap-3 border-b border-border pb-5"><span className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-primary"><UserRound size={22}/></span><div><h2 className="font-extrabold">{profile.name || 'Welcome'}</h2><p className="text-sm text-muted-foreground">{profile.phone}</p></div></div><div className="grid gap-4 sm:grid-cols-2"><label><span className="field-label">Your name</span><input className="field-control" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Enter your name" data-testid="profile-input-name"/></label>{profile.role === 'admin' ? <div><span className="field-label">Account type</span><p className="field-control flex items-center font-bold">Administrator · protected role</p></div> : <label><span className="field-label">I am a</span><select className="field-control" value={role === 'admin' ? 'farmer' : role} onChange={(e) => setRole(e.target.value as 'farmer'|'trader')} data-testid="profile-select-role"><option value="farmer">Farmer</option><option value="trader">Trader</option></select></label>}<label><span className="field-label">Preferred commodity</span><select className="field-control" value={commodityId} onChange={(e) => { setCommodityId(e.target.value); if (!e.target.value) { setStateId(''); setMandiId(''); } else if (e.target.value !== profile.preferredCommodityId) { setStateId(''); setMandiId(''); } }} data-testid="profile-select-commodity"><option value="">No preference</option>{(commodities.data ?? []).filter((c) => c.enabled).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><span className="field-label">State</span><select className="field-control" value={stateId} onChange={(e) => { setStateId(e.target.value); setMandiId(''); }} disabled={!commodityId} data-testid="profile-select-state"><option value="">Choose a state</option>{(states.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="sm:col-span-2"><span className="field-label">Preferred mandi</span><select className="field-control" value={mandiId} onChange={(e) => setMandiId(e.target.value)} disabled={!stateId} data-testid="profile-select-mandi"><option value="">No preference</option>{(mandis.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div><div className="mt-5 flex flex-wrap items-center gap-3"><button disabled={update.isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground disabled:opacity-60" data-testid="button-save-profile">{update.isPending && <LoaderCircle size={15} className="animate-spin"/>}Save preferences</button>{update.isSuccess && <span role="status" className="inline-flex items-center gap-1 text-sm font-bold text-emerald-800"><Check size={15}/> Saved</span>}{update.isError && <span role="alert" className="text-sm text-destructive">Could not save your preferences.</span>}</div></form><section className="grid gap-3 sm:grid-cols-2"><Link href="/alerts" className="panel flex items-center justify-between p-5 text-foreground no-underline" data-testid="link-profile-alerts"><span><strong className="block">Price alerts</strong><span className="text-sm text-muted-foreground">Manage price reminders for your markets.</span></span><ArrowRight size={18} className="text-primary"/></Link><button onClick={() => logout.mutate()} disabled={logout.isPending} className="panel flex min-h-16 items-center justify-between p-5 text-left font-bold text-destructive disabled:opacity-50" data-testid="button-logout"><span>{logout.isPending ? 'Signing out…' : 'Sign out'}</span><LockKeyhole size={18}/></button>{logout.isError && <p role="alert" className="text-sm text-destructive">Could not sign out. Please try again.</p>}</section></div>;
}
function LoginPage() {
  const requestOtp = useRequestPhoneOtp();
  const verifyOtp = useVerifyPhoneOtp();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone'|'code'>('phone');
  const [requestResult, setRequestResult] = useState<{ developmentCode?: string | null; expiresInSeconds: number } | null>(null);
  const digits = phone.replace(/\D/g, '').slice(0, 10);
  const validPhone = /^[6-9]\d{9}$/.test(digits);
  const startOtp = (e: FormEvent) => {
    e.preventDefault();
    if (!validPhone) return;
    requestOtp.mutate({ data: { phone: `+91${digits}` } }, { onSuccess: (result) => { setRequestResult(result); setStep('code'); } });
  };
  const finishOtp = (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    verifyOtp.mutate({ data: { phone: `+91${digits}`, code } }, { onSuccess: (profile) => { queryClient.setQueryData(getGetProfileQueryKey(), profile); void queryClient.invalidateQueries({ queryKey: getGetAlertsQueryKey() }); navigate('/profile'); } });
  };
  return <div className="mx-auto grid max-w-4xl gap-7 md:grid-cols-[.92fr_1.08fr] md:items-center">
    <section className="hidden rounded-[24px] bg-[#e8f0e5] p-8 md:block"><span className="brand-mark mb-5"><Sprout size={22}/></span><div className="eyebrow">Mandi Mitra</div><h1 className="display-type mt-2 text-4xl font-extrabold text-[#1c382b]">Your markets.<br/>Your way.</h1><p className="mt-4 text-sm leading-6 text-[#53665a]">Save the market choices that matter to you, and keep price reminders in one place. Market prices remain open to everyone.</p><div className="mt-8 flex items-center gap-3 border-t border-[#cbd9c7] pt-5 text-sm font-bold text-[#315b3e]"><ShieldCheck size={19}/> Your phone is your sign-in</div></section>
    <section className="panel p-5 md:p-7"><Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-primary no-underline" data-testid="link-login-back">← Back to market prices</Link><div className="eyebrow mb-2">{step === 'phone' ? 'Sign in / register' : 'Phone verification'}</div><h2 className="display-type text-3xl font-extrabold">{step === 'phone' ? 'Welcome to Mandi Mitra' : 'Enter your sign-in code'}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{step === 'phone' ? 'Enter your mobile number. We will send a one-time code to verify it.' : `We sent a code to +91 ${digits}. Enter the six-digit code to continue.`}</p>
      {step === 'phone' ? <form className="mt-6 space-y-4" onSubmit={startOtp}><label><span className="field-label">Mobile number</span><div className="flex h-12 items-center rounded-xl border border-input bg-card focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15"><span className="border-r border-border px-3 font-bold text-muted-foreground">+91</span><input className="h-full min-w-0 flex-1 rounded-r-xl bg-transparent px-3 outline-none" value={digits} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile number" required aria-label="10-digit mobile number" data-testid="input-phone"/></div></label><p className="text-xs text-muted-foreground">We only use this number to sign you in and keep your saved market preferences.</p><button disabled={!validPhone || requestOtp.isPending} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50" data-testid="button-request-otp">{requestOtp.isPending && <LoaderCircle size={17} className="animate-spin"/>}Send one-time code</button>{requestOtp.isError && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm leading-5 text-rose-900">We could not send a code. The OTP provider may not be configured yet. Please try again later or continue using market prices as a guest.</div>}</form> : <form className="mt-6 space-y-4" onSubmit={finishOtp}><label><span className="field-label">Six-digit code</span><input className="field-control text-lg tracking-[.35em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} required placeholder="••••••" data-testid="input-otp"/></label>{requestResult?.developmentCode && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-5 text-amber-950" role="status"><strong>Development-only OTP</strong><p>Your OTP service is not sending a live message. The API returned a temporary development code: <b className="tracking-widest">{requestResult.developmentCode}</b>. Configure a production OTP provider before using this flow with real users.</p></div>}{requestResult && !requestResult.developmentCode && <p className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">Code requested. It expires in about {Math.ceil(requestResult.expiresInSeconds / 60)} minutes. If no message arrives, check that your OTP service is configured.</p>}<button disabled={code.length !== 6 || verifyOtp.isPending} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50" data-testid="button-verify-otp">{verifyOtp.isPending && <LoaderCircle size={17} className="animate-spin"/>}Verify and sign in</button>{verifyOtp.isError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900">That code could not be verified. Check it and try again.</p>}<button type="button" onClick={() => { setStep('phone'); setCode(''); setRequestResult(null); }} className="w-full py-2 text-sm font-bold text-primary underline underline-offset-4" data-testid="button-change-phone">Use a different number</button></form>}
      <div className="mt-6 border-t border-border pt-4 text-center text-xs leading-5 text-muted-foreground">You can still view today's mandi prices, forecasts and guidance without signing in.</div>
    </section>
  </div>;
}

function AdminPage() {
  const healthQuery = useHealthCheck();
  const overviewQuery = useGetAdminOverview();
  const health = useGetDataHealth();
  const [search, setSearch] = useState('');
  const searchParams = search.trim() ? { search: search.trim() } : {};
  const records = useGetAdminMarketRecords(searchParams, { query: { queryKey: getGetAdminMarketRecordsQueryKey(searchParams) } });
  const commodities = useGetCommodities();
  const [openAdd, setOpenAdd] = useState(false);
  const [editing, setEditing] = useState<AdminMarketRecord | null>(null);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetAdminMarketRecordsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetDataHealthQueryKey() }); };
  const create = useCreateAdminMarketRecord({ mutation: { onSuccess: invalidate } });
  const update = useUpdateAdminMarketRecord({ mutation: { onSuccess: () => { setEditing(null); invalidate(); } } });
  const remove = useDeleteAdminMarketRecord({ mutation: { onSuccess: invalidate } });
  const importRecords = useImportAdminMarketRecords({ mutation: { onSuccess: (result) => { setImportResult(`${result.imported} records imported, ${result.rejected} rejected${result.errors.length ? `: ${result.errors.join('; ')}` : '.'}`); setImportText(''); invalidate(); } } });
  const [form, setForm] = useState({ commodityId: '', mandiId: '', date: new Date().toISOString().slice(0,10), minimumPrice: '', maximumPrice: '', modalPrice: '', arrivals: '', arrivalUnit: 'tonnes', source: '' });
  const [editForm, setEditForm] = useState({ minimumPrice: '', maximumPrice: '', modalPrice: '', arrivals: '', source: '' });
  const [adminMandiState, setAdminMandiState] = useState('');
  const adminStates = useGetStates({ commodityId: form.commodityId }, { query: { enabled: openAdd && !!form.commodityId, queryKey: getGetStatesQueryKey({ commodityId: form.commodityId }) } });
  const adminMandis = useGetMandis({ commodityId: form.commodityId, stateId: adminMandiState }, { query: { enabled: openAdd && !!form.commodityId && !!adminMandiState, queryKey: getGetMandisQueryKey({ commodityId: form.commodityId, stateId: adminMandiState }) } });
  const accessDenied = overviewQuery.isError || records.isError || health.isError;
  const live = !!overviewQuery.data && !overviewQuery.isError;
  const saveNew = (e: FormEvent) => {
    e.preventDefault();
    const data: AdminMarketRecordInput = { commodityId: form.commodityId, mandiId: form.mandiId, date: form.date, minimumPrice: Number(form.minimumPrice), maximumPrice: Number(form.maximumPrice), modalPrice: Number(form.modalPrice), arrivals: Number(form.arrivals), arrivalUnit: form.arrivalUnit, source: form.source.trim() };
    create.mutate({ data }, { onSuccess: () => setOpenAdd(false) });
  };
  const saveCsv = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseMarketCsv(importText);
    if (!parsed.records) { setImportResult(parsed.error ?? 'CSV could not be read.'); return; }
    setImportResult(null);
    importRecords.mutate({ data: { records: parsed.records } });
  };
  return <div className="space-y-6"><PageTitle eyebrow="Restricted data management" title="Admin console" description="Market data operations and data health. Access is determined by the server; this page does not create or assume admin access."/>
    <section className={`rounded-xl border px-4 py-3 ${live ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : accessDenied ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-border bg-card'}`} data-testid="admin-access-state"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0" size={19}/><div><p className="font-extrabold">{live ? 'Admin data access confirmed by server' : accessDenied ? 'Admin access unavailable' : 'Checking server access…'}</p><p className="mt-1 text-sm leading-5">{live ? 'Overview and data records are available through the protected admin API.' : accessDenied ? 'The protected admin API did not authorize this session or is not configured. No admin success is assumed. Sign in with an authorized admin account or check server configuration.' : 'Admin status is being checked. This screen will display data only after the protected API confirms access.'}</p><p className="mt-2 text-xs">API health: {healthQuery.isLoading ? 'Checking…' : healthQuery.data?.status || (healthQuery.isError ? 'Unavailable' : 'Unknown')}</p></div></div></section>
    {(overviewQuery.isLoading || health.isLoading) && <LoadingBlock label="Admin overview loading"/>}
    {live && <><section className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Registered users', overviewQuery.data.totalUsers], ['Commodities', overviewQuery.data.totalCommodities], ['Mandis', overviewQuery.data.totalMandis], ["Today's records", overviewQuery.data.todayRecords]].map(([label, value]) => <article className="panel p-4" key={label}><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="data-number mt-2 text-2xl font-extrabold">{Number(value).toLocaleString('en-IN')}</p></article>)}</section>
      <section className="panel p-5 md:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Data health</div><h2 className="display-type text-2xl font-extrabold">Keep the feed trustworthy</h2></div><span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-bold capitalize">{health.data?.freshness || 'Status unknown'}</span></div>{health.data ? <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Last successful update</p><b className="mt-1 block text-sm">{dateTime(health.data.lastSuccessfulUpdate)}</b></div><div><p className="text-xs text-muted-foreground">Missing data</p><b className="mt-1 block text-sm">{health.data.missingDataCount}</b></div><div><p className="text-xs text-muted-foreground">Failed imports</p><b className="mt-1 block text-sm">{health.data.failedImports}</b></div><div><p className="text-xs text-muted-foreground">Market records</p><b className="mt-1 block text-sm">{health.data.recordCount.toLocaleString('en-IN')}</b></div></div> : health.isError ? <p className="mt-3 text-sm text-muted-foreground">Data health details are not available.</p> : null}<div className="mt-5 flex flex-wrap gap-2 text-xs">{[['Market data provider', health.data?.marketProviderConfigured], ['Forecast provider', health.data?.forecastProviderConfigured], ['OTP provider', health.data?.otpProviderConfigured]].map(([label, configured]) => <span key={String(label)} className="rounded-full border border-border px-3 py-1.5">{label}: <b>{configured === true ? 'Configured' : configured === false ? 'Not configured' : 'Unknown'}</b></span>)}</div></section>
      <section className="panel p-5 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Protected dataset</div><h2 className="display-type text-2xl font-extrabold">Market records</h2></div><button onClick={() => { setOpenAdd(!openAdd); setEditing(null); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground" data-testid="button-add-record">{openAdd ? <X size={16}/> : <Plus size={16}/>} {openAdd ? 'Close form' : 'Add record'}</button></div>
        <label className="relative mt-4 block max-w-lg"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search market records" className="field-control pl-10" data-testid="input-record-search"/></label>
        {openAdd && <form onSubmit={saveNew} className="mt-5 grid gap-3 rounded-xl bg-secondary/50 p-4 sm:grid-cols-2"><h3 className="font-extrabold sm:col-span-2">New market record</h3><label><span className="field-label">Commodity</span><select className="field-control" required value={form.commodityId} onChange={(e) => { setForm({ ...form, commodityId: e.target.value, mandiId: '' }); setAdminMandiState(''); }} data-testid="admin-select-commodity"><option value="">Choose commodity</option>{(commodities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><span className="field-label">State</span><select className="field-control" value={adminMandiState} onChange={(e) => { setAdminMandiState(e.target.value); setForm({ ...form, mandiId: '' }); }} disabled={!form.commodityId} data-testid="admin-select-state"><option value="">Choose state</option>{(adminStates.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label><span className="field-label">Mandi</span><select className="field-control" required value={form.mandiId} onChange={(e) => setForm({ ...form, mandiId: e.target.value })} disabled={!adminMandiState} data-testid="admin-select-mandi"><option value="">Choose mandi</option>{(adminMandis.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label><span className="field-label">Market date</span><input type="date" className="field-control" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="admin-input-date"/></label>{[['minimumPrice','Lowest price'],['maximumPrice','Highest price'],['modalPrice','Typical price'],['arrivals','Arrivals']].map(([key,label]) => <label key={key}><span className="field-label">{label}</span><input className="field-control" type="number" min="0" step="0.01" required value={form[key as keyof typeof form]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} data-testid={`admin-input-${key}`}/></label>)}<label><span className="field-label">Arrival unit</span><input className="field-control" required value={form.arrivalUnit} onChange={(e) => setForm({ ...form, arrivalUnit: e.target.value })} data-testid="admin-input-arrival-unit"/></label><label><span className="field-label">Source</span><input className="field-control" required value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} data-testid="admin-input-source"/></label><button disabled={create.isPending} className="min-h-11 rounded-xl bg-primary px-4 font-bold text-primary-foreground sm:col-span-2" data-testid="button-save-record">{create.isPending ? 'Saving…' : 'Save market record'}</button>{create.isError && <p className="text-sm text-destructive sm:col-span-2">Record could not be saved. Check values and admin access.</p>}</form>}
        <form onSubmit={saveCsv} className="mt-5 rounded-xl border border-border p-4"><div className="flex items-center gap-2"><Plus size={16} className="text-primary"/><h3 className="font-extrabold">Import records from CSV</h3></div><p className="mb-3 mt-1 text-xs leading-5 text-muted-foreground">Paste CSV with columns: commodityId, mandiId, date, minimumPrice, maximumPrice, modalPrice, arrivals, arrivalUnit, source.</p><textarea rows={3} className="field-control h-auto py-3 font-mono text-xs" placeholder="commodityId,mandiId,date,minimumPrice,maximumPrice,modalPrice,arrivals,arrivalUnit,source" value={importText} onChange={(e) => setImportText(e.target.value)} data-testid="textarea-import-csv"/><div className="mt-2 flex flex-wrap items-center gap-3"><button disabled={!importText.trim() || importRecords.isPending} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-bold text-primary disabled:opacity-50" data-testid="button-import-csv">{importRecords.isPending ? 'Importing…' : 'Import CSV'}</button>{importResult && <span role="status" className="text-xs text-muted-foreground">{importResult}</span>}{importRecords.isError && <span role="alert" className="text-xs text-destructive">Import failed. Check server configuration and CSV values.</span>}</div></form>
         {records.isLoading ? <div className="mt-5"><LoadingBlock label="Market records loading"/></div> : records.isError ? <div className="mt-5"><LoadError retry={() => void records.refetch()} message="Market records could not be loaded."/></div> : !records.data?.length ? <div className="mt-5"><EmptyState title="No market records found" copy={search ? 'Try a different search term.' : 'There are no market records in the protected dataset.'}/></div> : <div className="mt-5 space-y-3">{records.data.map((record) => <article key={record.id} className="rounded-xl border border-border p-4" data-testid={`admin-record-${record.id}`}>{editing?.id === record.id ? <form onSubmit={(e) => { e.preventDefault(); update.mutate({ recordId: record.id, data: { minimumPrice: Number(editForm.minimumPrice), maximumPrice: Number(editForm.maximumPrice), modalPrice: Number(editForm.modalPrice), arrivals: Number(editForm.arrivals), source: editForm.source } }); }} className="grid gap-3 sm:grid-cols-2"><strong className="sm:col-span-2">Edit {record.commodityName} · {record.mandiName}</strong>{[['minimumPrice','Lowest price'],['maximumPrice','Highest price'],['modalPrice','Typical price'],['arrivals','Arrivals'],['source','Source']].map(([key,label]) => <label key={key}><span className="field-label">{label}</span><input className="field-control" required type={key === 'source' ? 'text' : 'number'} min={key === 'source' ? undefined : 0} value={editForm[key as keyof typeof editForm]} onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })} data-testid={`edit-record-${key}`}/></label>)}<div className="flex gap-2 sm:col-span-2"><button className="min-h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground" data-testid="button-update-record">Save changes</button><button type="button" onClick={() => setEditing(null)} className="min-h-10 rounded-lg border border-border px-4 text-sm font-bold" data-testid="button-cancel-edit">Cancel</button></div>{update.isError && <p role="alert" className="text-sm text-destructive">Update failed.</p>}</form> : <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-extrabold">{record.commodityName} · {record.mandiName}</p><p className="mt-1 text-xs text-muted-foreground">{record.date} · {record.isDemo ? 'Demo data' : record.source}</p><p className="mt-2 text-sm">{currency(record.modalPrice)} typical · {currency(record.minimumPrice)}–{currency(record.maximumPrice)} · {record.arrivals} {record.arrivalUnit}</p></div><div className="flex gap-2"><button onClick={() => { setEditing(record); setOpenAdd(false); setEditForm({ minimumPrice: String(record.minimumPrice), maximumPrice: String(record.maximumPrice), modalPrice: String(record.modalPrice), arrivals: String(record.arrivals), source: record.source }); }} className="min-h-10 rounded-lg border border-border px-3 text-sm font-bold" data-testid={`button-edit-record-${record.id}`}>Edit</button><button onClick={() => { if (window.confirm(`Delete the ${record.commodityName} record for ${record.mandiName}?`)) remove.mutate({ recordId: record.id }); }} className="min-h-10 rounded-lg border border-rose-200 px-3 text-sm font-bold text-destructive" data-testid={`button-delete-record-${record.id}`}>Delete</button></div></div>}</article>)}</div>}
      </section>
      <AdminCatalogPanel/>
    </>}
  </div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function Router() {
  const [commodityId, setCommodityId] = useState('');
  const [stateId, setStateId] = useState('');
  const [mandiId, setMandiId] = useState('');
  const [varietyId, setVarietyId] = useState('');
  const market: MarketContextValue = { commodityId, stateId, mandiId, varietyId, setCommodityId, setStateId, setMandiId, setVarietyId };
  return <MarketContext.Provider value={market}><RoutedErrorBoundary><Switch>
    <Route path="/"><Shell><HomePage/></Shell></Route>
    <Route path="/forecast"><Shell><ForecastPage/></Shell></Route>
    <Route path="/mandis"><Shell><MandiPage/></Shell></Route>
    <Route path="/sell"><Shell><SellPage/></Shell></Route>
    <Route path="/alerts"><Shell><AlertsPage/></Shell></Route>
    <Route path="/profile"><Shell><ProfilePage/></Shell></Route>
    <Route path="/login"><Shell><LoginPage/></Shell></Route>
    <Route path="/admin"><Shell><AdminPage/></Shell></Route>
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary></MarketContext.Provider>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;