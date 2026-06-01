import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { getChannels, getCategoriesFull } from '../../api/client';
import { useViewerBranding } from '../../context/ViewerBrandingContext';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { Play, Radio, Search, Tv2, Film } from 'lucide-react';

// أنماط العرض المتاحة في بوابة المشاهدة (تُختار من لوحة الإدارة)
const LAYOUTS = {
  grid: { card: 'grid', container: 'grid', gridCols: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' },
  posters: { card: 'poster', container: 'grid', gridCols: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' },
  list: { card: 'list', container: 'list' },
  rows: { card: 'poster', container: 'rows' },
};

export default function ViewerHome() {
  const { activeCategory } = useOutletContext() || { activeCategory: 'all' };
  const branding = useViewerBranding();
  const layout = LAYOUTS[branding.viewer_layout] || LAYOUTS.grid;
  const [channels, setChannels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    try {
      const { data } = await getChannels({ limit: 200, search: search || undefined });
      setChannels((data.channels || []).filter((ch) => ch.is_public !== false));
    } catch { /* ignore */ }

    try {
      const { data } = await getCategoriesFull();
      setCategories(data || []);
    } catch { /* ignore */ }

    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [search]);

  const filtered = activeCategory === 'all'
    ? channels
    : channels.filter((ch) => ch.category_id === activeCategory);

  const uncategorized = filtered.filter((ch) => !ch.category_id);
  const sections = (activeCategory === 'all' ? categories : categories.filter((c) => c.id === activeCategory))
    .map((cat) => ({
      ...cat,
      items: filtered.filter((ch) => ch.category_id === cat.id),
    }))
    .filter((cat) => cat.items.length > 0 || activeCategory === cat.id);

  const hasContent = filtered.length > 0;
  const activeCatName = categories.find((c) => c.id === activeCategory)?.name;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="viewer-page-title">{activeCategory === 'all' ? 'المحتوى' : activeCatName || 'القسم'}</h1>
        <p className="viewer-page-sub">قنوات مباشرة وأفلام حسب الأقسام</p>
      </div>

      <div className="relative mb-8">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input className="viewer-search" placeholder="ابحث..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <LoadingSpinner className="py-24" />
      ) : !hasContent ? (
        <div className="text-center py-20">
          <Tv2 className="w-14 h-14 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 font-medium">لا يوجد محتوى في هذا القسم</p>
        </div>
      ) : (
        <div className="space-y-10">
          {activeCategory === 'all' ? (
            sections.length === 0 && uncategorized.length > 0 ? (
              <SectionBlock title="كل المحتوى" items={uncategorized} layout={layout} />
            ) : (
              <>
                {sections.map((section) => (
                  <SectionBlock key={section.id} title={section.name} items={section.items} layout={layout} />
                ))}
                {uncategorized.length > 0 && (
                  <SectionBlock title="أخرى" items={uncategorized} layout={layout} />
                )}
              </>
            )
          ) : (
            <SectionBlock title={activeCatName || 'القسم'} items={filtered} layout={layout} />
          )}
        </div>
      )}
    </div>
  );
}

function ItemsContainer({ layout, children }) {
  if (layout.container === 'list') {
    return <div className="space-y-2">{children}</div>;
  }
  if (layout.container === 'rows') {
    return <div className="viewer-row-scroll">{children}</div>;
  }
  return <div className={`grid ${layout.gridCols} gap-4`}>{children}</div>;
}

function Group({ icon, title, items, layout, live = false, movie = false }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-5">
      <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
        {icon} {title}
      </h3>
      <ItemsContainer layout={layout}>
        {items.map((ch) => (
          <MediaCard key={ch.id} channel={ch} variant={layout.card} live={live} movie={movie} />
        ))}
      </ItemsContainer>
    </div>
  );
}

function SectionBlock({ title, items, layout }) {
  const movies = items.filter((ch) => ch.content_type === 'vod');
  const live = items.filter((ch) => ch.content_type !== 'vod');
  const liveRunning = live.filter((ch) => ch.on_demand || ch.status === 'running');
  const liveOther = live.filter((ch) => !ch.on_demand && ch.status !== 'running');

  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        {title}
        <span className="text-xs text-slate-500 font-normal">({items.length})</span>
      </h2>

      <Group
        icon={<Film className="w-4 h-4" />}
        title="أفلام"
        items={movies}
        layout={layout}
        movie
      />
      <Group
        icon={<span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
        title="مباشر"
        items={liveRunning}
        layout={layout}
        live
      />
      <Group
        icon={<Radio className="w-4 h-4" />}
        title="قنوات غير نشطة"
        items={liveOther}
        layout={layout}
      />
    </section>
  );
}

function MediaCard({ channel, variant = 'grid', live = false, movie = false }) {
  const canWatch = movie || channel.on_demand || channel.status === 'running';
  const imageUrl = channel.logo_url || channel.poster_url;

  // ── نمط القائمة (صف أفقي مدمج) ──
  if (variant === 'list') {
    const row = (
      <div className={`viewer-list-row ${canWatch ? 'cursor-pointer' : 'opacity-60'}`}>
        <div className="viewer-list-thumb">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          ) : (
            movie ? <Film className="w-6 h-6 text-slate-600" /> : <Tv2 className="w-6 h-6 text-slate-600" />
          )}
          {live && <span className="viewer-list-live" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-white truncate">{channel.name}</h3>
          {movie && (
            <div className="mt-0.5">
              <span className="text-xs text-violet-400">فيلم</span>
            </div>
          )}
        </div>
        {canWatch && (
          <div className="viewer-list-play">
            <Play className="w-4 h-4 text-teal-300 mr-[-1px]" fill="currentColor" />
          </div>
        )}
      </div>
    );
    return canWatch ? <Link to={`/watch/live/${channel.id}`}>{row}</Link> : row;
  }

  // ── نمط البطاقة (شبكة 16:9) أو البوستر (2:3) ──
  const isPoster = variant === 'poster';
  const inner = (
    <div className={`viewer-channel-card ${isPoster ? 'viewer-card--poster' : ''} ${canWatch ? 'cursor-pointer' : 'opacity-60'}`}>
      <div className={`viewer-channel-thumb ${isPoster ? 'viewer-channel-thumb--poster' : ''}`}>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : null}
        {live && <span className="viewer-live-badge"><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE</span>}
        {movie && <span className="viewer-live-badge bg-violet-600/90">فيلم</span>}
        {canWatch ? (
          <div className="viewer-play-btn">
            <Play className="w-5 h-5 text-teal-300 mr-[-2px]" fill="currentColor" />
          </div>
        ) : (
          !imageUrl && (movie ? <Film className="w-10 h-10 text-slate-600" /> : <Tv2 className="w-10 h-10 text-slate-600" />)
        )}
      </div>
      <div className="viewer-channel-body">
        <h3 className={`font-bold text-white truncate ${isPoster ? 'text-sm mb-0' : 'mb-0'}`}>{channel.name}</h3>
        {movie && !isPoster && (
          <span className="text-xs text-violet-400 mt-1 inline-block">فيلم</span>
        )}
      </div>
    </div>
  );

  return canWatch ? <Link to={`/watch/live/${channel.id}`}>{inner}</Link> : inner;
}
