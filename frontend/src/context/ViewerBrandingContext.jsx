import { createContext, useContext, useEffect, useState } from 'react';
import { getPublicBranding } from '../api/client';

export const DEFAULT_VIEWER_BRANDING = {
  app_title: 'StreamRelay TV',
  app_tagline: 'بث داخلي آمن',
  live_watch_notice: 'أنت تشاهد عبر البث الداخلي على شبكة السيرفر',
  vod_watch_notice: 'تشغيل فيلم من السيرفر المحلي',
};

const ViewerBrandingContext = createContext(DEFAULT_VIEWER_BRANDING);

export function ViewerBrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULT_VIEWER_BRANDING);

  useEffect(() => {
    getPublicBranding()
      .then(({ data }) => setBranding({ ...DEFAULT_VIEWER_BRANDING, ...data }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (branding.app_title) {
      document.title = branding.app_title;
    }
  }, [branding.app_title]);

  return (
    <ViewerBrandingContext.Provider value={branding}>
      {children}
    </ViewerBrandingContext.Provider>
  );
}

export const useViewerBranding = () => useContext(ViewerBrandingContext);
