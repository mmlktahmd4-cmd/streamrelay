import { z } from 'zod';

const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().email().optional()
);

const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional()
);

const optionalUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().url().optional()
);

export const loginSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(6).max(128),
});

const expiresAtField = z.preprocess(
  (v) => {
    if (v === null || v === undefined || v === '') return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  },
  z.string().datetime().optional()
);

export const createUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(6).max(128),
  role: z.enum(['admin', 'operator', 'viewer']).default('viewer'),
  max_connections: z.number().int().min(1).max(100).default(1),
  expires_at: expiresAtField,
}).superRefine((data, ctx) => {
  if (data.role === 'viewer' && !data.expires_at) {
    ctx.addIssue({ code: 'custom', message: 'تاريخ الانتهاء مطلوب للمشاهدين', path: ['expires_at'] });
  }
  if (data.role === 'viewer' && data.max_connections > 1) {
    ctx.addIssue({ code: 'custom', message: 'المشاهد مسموح له بجهاز واحد فقط', path: ['max_connections'] });
  }
});

export const updateUserSchema = z.object({
  password: z.string().min(6).max(128).optional(),
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
  is_active: z.boolean().optional(),
  max_connections: z.number().int().min(1).max(100).optional(),
  expires_at: expiresAtField.nullable(),
}).superRefine((data, ctx) => {
  if (data.max_connections && data.max_connections > 1 && data.role === 'viewer') {
    ctx.addIssue({ code: 'custom', message: 'المشاهد مسموح له بجهاز واحد فقط', path: ['max_connections'] });
  }
});

export const siteConfigSchema = z.object({
  public_domain: z.string().max(253).default(''),
  use_https: z.boolean().default(false),
});

export const brandingSettingsSchema = z.object({
  app_title: z.string().max(80).default('StreamRelay TV'),
  app_tagline: z.string().max(120).default('بث داخلي آمن'),
  live_watch_notice: z.string().max(200).default('أنت تشاهد عبر البث الداخلي على شبكة السيرفر'),
  vod_watch_notice: z.string().max(200).default('تشغيل فيلم من السيرفر المحلي'),
});

export const createServerSchema = z.object({
  name: z.string().min(1).max(128),
  hostname: z.string().min(1).max(255).regex(/^[a-zA-Z0-9._-]+$/),
  ip_address: z.string().max(45).optional(),
  role: z.enum(['full', 'api-only', 'stream-only']).default('stream-only'),
  max_streams: z.coerce.number().int().min(1).max(1000).default(100),
  hls_base_url: optionalUrl,
  public_base_url: optionalUrl,
});

export const updateServerSchema = createServerSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const provisionServerSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  ip_address: z.string().min(1).max(45),
  ssh_username: z.string().min(1).max(64),
  ssh_password: z.string().min(1).max(256),
  ssh_port: z.coerce.number().int().min(1).max(65535).default(22),
  hostname: z.string().min(1).max(255).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  max_streams: z.coerce.number().int().min(1).max(1000).default(100),
  save_ssh_for_updates: z.boolean().optional().default(true),
});

export const serverSshSchema = z.object({
  ssh_username: z.string().min(1).max(64),
  ssh_password: z.string().max(256).optional(),
  ssh_port: z.coerce.number().int().min(1).max(65535).default(22),
  auto_remote_update: z.boolean().optional().default(true),
});

export const uploadSessionSchema = z.object({
  filename: z.string().min(1).max(255),
  total_size: z.coerce.number().int().min(1).max(4 * 1024 * 1024 * 1024),
  name: z.string().max(255).optional(),
  description: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().max(1000).optional()
  ),
  is_public: z.boolean().optional(),
  poster_url: optionalUrl,
});

export const createChannelSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).optional(),
  description: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().max(1000).optional()
  ),
  logo_url: optionalUrl,
  category_id: z.string().uuid().optional(),
  source_type: z.enum(['m3u', 'hls', 'rtmp', 'udp', 'http']).default('hls'),
  source_url: z.string().min(1),
  backup_source_url: optionalString,
  output_format: z.enum(['hls', 'mpegts', 'rtmp', 'relay']).default('hls'),
  transcode_enabled: z.boolean().default(false),
  transcode_profile: z.object({
    video_codec: z.string().default('copy'),
    audio_codec: z.string().default('copy'),
    preset: z.string().optional(),
    video_bitrate: z.string().optional(),
  }).optional(),
  auto_restart: z.boolean().default(true),
  epg_id: z.string().optional(),
  sort_order: z.number().int().default(0),
  is_public: z.boolean().default(false),
  server_id: z.string().uuid().nullable().optional(),
});

export const updateChannelSchema = createChannelSchema.partial();

export const createTokenSchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.string()).default([]),
  expires_at: z.string().datetime().optional(),
});

export const importM3USchema = z.object({
  content: z.string().min(1),
  category_id: z.string().uuid().optional(),
  is_public: z.boolean().default(true),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

export const mikrotikConfigSchema = z.object({
  server_ip: z.string().min(7).max(45),
});

export const serverIpApplySchema = z.object({
  mode: z.enum(['app_only', 'static', 'dhcp']).default('app_only'),
  ip: z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}$/, 'IPv4 غير صالح').optional(),
  interface_name: z.string().max(64).optional(),
  gateway: z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}$/, 'بوابة غير صالحة').optional(),
  prefix: z.coerce.number().int().min(1).max(32).optional(),
  dns: z.union([z.string().max(255), z.array(z.string().max(45))]).optional(),
}).refine((data) => data.mode === 'dhcp' || !!data.ip, {
  message: 'IP مطلوب',
  path: ['ip'],
});

export const ipRuleSchema = z.object({
  ip_address: z.string().min(3).max(64),
  rule_type: z.enum(['allow', 'deny']),
  description: z.string().max(255).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  section_type: z.enum(['mixed', 'live', 'movies']).default('mixed'),
  sort_order: z.number().int().default(0),
});

export const updateCategorySchema = createCategorySchema.partial();

export const bulkUpdateChannelsSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
  updates: z.object({
    category_id: z.string().uuid().nullable().optional(),
    is_public: z.boolean().optional(),
    auto_restart: z.boolean().optional(),
  }),
}).refine((data) => data.all || (data.ids && data.ids.length > 0), {
  message: 'Provide ids or set all=true',
});

export const bulkStreamActionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart']),
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
}).refine((data) => data.all || (data.ids && data.ids.length > 0), {
  message: 'Provide ids or set all=true',
});

export const updateMovieSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().max(1000).optional()
  ),
  poster_url: optionalUrl,
  category_id: z.string().uuid().nullable().optional(),
  is_public: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export function validate(schema) {
  return async (request, reply) => {
    const result = schema.safeParse(request.body ?? request.query);
    if (!result.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    if (request.body !== undefined) request.body = result.data;
    else request.query = result.data;
  };
}
