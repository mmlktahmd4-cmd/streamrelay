import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { getChannels, getCategoriesFull } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { Play, Radio, Search, Tv2, Film } from 'lucide-react';

export default function ViewerHome() {
  const { activeCategory } = useOutletContext() || { activeCategory: 'all' };
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
              <SectionBlock title="كل المحتوى" items={uncategorized} />
            ) : (
              <>
                {sections.map((section) => (
                  <SectionBlock key={section.id} title={section.name} items={section.items} />
                ))}
                {uncategorized.length > 0 && (
                  <SectionBlock title="أخرى" items={uncategorized} />
                )}
              </>
            )
          ) : (
            <SectionBlock title={activeCatName || 'القسم'} items={filtered} />
          )}
        </div>
      )}
    </div>
  );
}

function SectionBlock({ title, items }) {
  const movies = items.filter((ch) => ch.content_type === 'vod');
  const live = items.filter((ch) => ch.content_type !== 'vod');
  const liveRunning = live.filter((ch) => ch.status === 'running');
  const liveOther = live.filter((ch) => ch.status !== 'running');

  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        {title}
        <span className="text-xs text-slate-500 font-normal">({items.length})</span>
      </h2>

      {movies.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
            <Film className="w-4 h-4" /> أفلام
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {movies.map((ch) => <MediaCard key={ch.id} channel={ch} movie />)}
          </div>
        </div>
      )}

      {liveRunning.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> مباشر
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveRunning.map((ch) => <MediaCard key={ch.id} channel={ch} live />)}
          </div>
        </div>
      )}

      {liveOther.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-2">
            <Radio className="w-4 h-4" /> قنوات غير نشطة
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveOther.map((ch) => <MediaCard key={ch.id} channel={ch} />)}
          </div>
        </div>
      )}
    </section>
  );
}

function MediaCard({ channel, live = false, movie = false }) {
  const canWatch = movie || channel.status === 'running';
  const imageUrl = channel.logo_url || channel.poster_url;

  const inner = (
    <div className={`viewer-channel-card ${canWatch ? 'cursor-pointer' : 'opacity-60'}`}>
      <div className="viewer-channel-thumb">
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
        <h3 className="font-bold text-white truncate mb-1.5">{channel.name}</h3>
        {movie ? (
          <span className="text-xs text-violet-400">فيلم</span>
        ) : (
          <StatusBadge status={channel.status} />
        )}
      </div>
    </div>
  );

  return canWatch ? <Link to={`/watch/live/${channel.id}`}>{inner}</Link> : inner;
}
