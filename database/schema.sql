-- StreamRelay IPTV Platform — Database Schema
-- PostgreSQL 16+

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Enums ───────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('admin', 'operator', 'viewer');
CREATE TYPE source_type AS ENUM ('m3u', 'hls', 'rtmp', 'udp', 'http');
CREATE TYPE output_format AS ENUM ('hls', 'mpegts', 'rtmp', 'relay');
CREATE TYPE stream_status AS ENUM ('stopped', 'starting', 'running', 'error', 'restarting');
CREATE TYPE server_role AS ENUM ('full', 'api-only', 'stream-only');
CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');

-- ─── Users ───────────────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        VARCHAR(64) UNIQUE NOT NULL,
    full_name       VARCHAR(120),
    email           VARCHAR(255) UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL DEFAULT 'viewer',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    max_connections INT NOT NULL DEFAULT 1,
    allowed_ips     INET[],
    expires_at      TIMESTAMPTZ,
    last_login      TIMESTAMPTZ,
    login_session_id VARCHAR(64),
    login_session_ids TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- ─── User Permissions ────────────────────────────────────────
CREATE TABLE user_permissions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission  VARCHAR(64) NOT NULL,
    granted     BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(user_id, permission)
);

-- ─── API Tokens ──────────────────────────────────────────────
CREATE TABLE api_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(128) NOT NULL,
    token_hash  VARCHAR(255) NOT NULL,
    token_prefix VARCHAR(8) NOT NULL,
    scopes      TEXT[] NOT NULL DEFAULT '{}',
    expires_at  TIMESTAMPTZ,
    last_used   TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_tokens_prefix ON api_tokens(token_prefix);

-- ─── Categories ──────────────────────────────────────────────
CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(128) NOT NULL,
    slug        VARCHAR(128) UNIQUE NOT NULL,
    description TEXT,
    section_type VARCHAR(16) NOT NULL DEFAULT 'mixed',
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Server Nodes (Multi-Server) ─────────────────────────────
CREATE TABLE servers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(128) NOT NULL,
    hostname        VARCHAR(255) NOT NULL,
    ip_address      INET,
    role            server_role NOT NULL DEFAULT 'full',
    max_streams     INT NOT NULL DEFAULT 100,
    current_streams INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_heartbeat  TIMESTAMPTZ,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Channels ────────────────────────────────────────────────
CREATE TABLE channels (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(255) NOT NULL,
    slug                VARCHAR(255) UNIQUE NOT NULL,
    description         TEXT,
    logo_url            VARCHAR(512),
    category_id         UUID REFERENCES categories(id) ON DELETE SET NULL,
    server_id           UUID REFERENCES servers(id) ON DELETE SET NULL,

    -- Source
    source_type         source_type NOT NULL DEFAULT 'hls',
    source_url          TEXT NOT NULL,
    backup_source_url   TEXT,

    -- Output
    output_format       output_format NOT NULL DEFAULT 'hls',
    output_url          TEXT,

    -- Transcoding (disabled by default)
    transcode_enabled   BOOLEAN NOT NULL DEFAULT false,
    transcode_profile   JSONB DEFAULT '{"video_codec":"copy","audio_codec":"copy"}',

    -- Stream state
    status              stream_status NOT NULL DEFAULT 'stopped',
    pid                 INT,
    failure_count       INT NOT NULL DEFAULT 0,
    restart_count       INT NOT NULL DEFAULT 0,
    last_started        TIMESTAMPTZ,
    last_stopped        TIMESTAMPTZ,
    last_error          TEXT,

    -- Settings
    auto_restart        BOOLEAN NOT NULL DEFAULT true,
    on_demand           BOOLEAN NOT NULL DEFAULT false,
    epg_id              VARCHAR(64),
    sort_order          INT NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    is_public           BOOLEAN NOT NULL DEFAULT false,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channels_status ON channels(status);
CREATE INDEX idx_channels_slug ON channels(slug);
CREATE INDEX idx_channels_category ON channels(category_id);
CREATE INDEX idx_channels_server ON channels(server_id);

-- ─── Movies (VOD) ────────────────────────────────────────────
CREATE TABLE movies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) UNIQUE NOT NULL,
    description     TEXT,
    poster_url      VARCHAR(512),
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
    file_path       TEXT NOT NULL,
    file_size       BIGINT,
    mime_type       VARCHAR(128),
    duration_seconds INT,
    output_url      TEXT,
    is_public       BOOLEAN NOT NULL DEFAULT true,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_movies_category ON movies(category_id);
CREATE INDEX idx_movies_slug ON movies(slug);

-- ─── User Channel Access ─────────────────────────────────────
CREATE TABLE user_channel_access (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

-- ─── Stream Sessions ─────────────────────────────────────────
CREATE TABLE stream_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    server_id       UUID REFERENCES servers(id),
    pid             INT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at      TIMESTAMPTZ,
    exit_code       INT,
    bytes_sent      BIGINT DEFAULT 0,
    viewer_count    INT DEFAULT 0
);

CREATE INDEX idx_stream_sessions_channel ON stream_sessions(channel_id);

-- ─── Stream Logs ─────────────────────────────────────────────
CREATE TABLE stream_logs (
    id          BIGSERIAL PRIMARY KEY,
    channel_id  UUID REFERENCES channels(id) ON DELETE SET NULL,
    level       log_level NOT NULL DEFAULT 'info',
    message     TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stream_logs_channel ON stream_logs(channel_id);
CREATE INDEX idx_stream_logs_created ON stream_logs(created_at DESC);
CREATE INDEX idx_stream_logs_level ON stream_logs(level);

-- ─── Audit Logs ──────────────────────────────────────────────
CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(128) NOT NULL,
    resource    VARCHAR(128),
    resource_id UUID,
    ip_address  INET,
    user_agent  TEXT,
    details     JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- ─── IP Rules ────────────────────────────────────────────────
CREATE TABLE ip_rules (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_address  INET NOT NULL,
    rule_type   VARCHAR(16) NOT NULL CHECK (rule_type IN ('allow', 'deny')),
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── System Settings ─────────────────────────────────────────
CREATE TABLE settings (
    key         VARCHAR(128) PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Active Viewer Sessions ──────────────────────────────────
CREATE TABLE viewer_sessions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    ip_address  INET,
    token       VARCHAR(255),
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_viewer_sessions_user ON viewer_sessions(user_id);
CREATE INDEX idx_viewer_sessions_expires ON viewer_sessions(expires_at);

-- ─── Default Data ────────────────────────────────────────────
INSERT INTO categories (name, slug, sort_order) VALUES
    ('General', 'general', 0),
    ('Sports', 'sports', 1),
    ('News', 'news', 2),
    ('Entertainment', 'entertainment', 3);

INSERT INTO settings (key, value) VALUES
    ('platform_name', '"StreamRelay"'),
    ('max_connections_per_user', '2'),
    ('signed_url_ttl', '3600'),
    ('auto_restart_enabled', 'true'),
    ('health_check_interval', '30');

-- ─── Updated_at Trigger ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_channels_updated BEFORE UPDATE ON channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
